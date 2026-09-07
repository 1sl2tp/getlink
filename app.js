const $=s=>document.querySelector(s);
const API=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");

let wantedUrl="";
let requestId="";
let pollTimer=0;
let pollUntil=0;
let jobStartedAt=Number(localStorage.getItem("getlink:request-started-at")||0);
let statusTimer=0;
let lastPollAt=0;
let activeComparison=null;
let activeGroupUrl="";
let activeBrand="";
let activePackKind=localStorage.getItem("getlink:filter-pack")||"";
let libraryQuery="";
let libraryCache=[];
let libraryLoaded=false;
let libraryState="visible";
let activePreferenceState="normal";
let selectedLibraryUrl="";
let libraryGroups=[];
let categoryPage=1;
let libraryPage=1;
let libraryView=localStorage.getItem("getlink:view-mode")==="table"?"table":"grid";
function isCompactBrowse(){
  return window.matchMedia("(max-width: 1100px)").matches;
}
let lastMobileLayout=isCompactBrowse();

function canonical(url){
  try{
    const u=new URL(url);
    const host=u.hostname.toLowerCase().replace(/^www\./,"");
    const path=(u.pathname||"/").replace(/\/+$/,"")||"/";
    if(host==="bachhoaxanh.com"){
      return ("https://bachhoaxanh.com"+path).toLowerCase();
    }
    if(host==="winmart.vn"){
      const out=new URL("https://winmart.vn"+path);
      const store=u.searchParams.get("storeCode");
      const cate2=u.searchParams.get("cate2");
      if(store)out.searchParams.set("storeCode",store);
      if(cate2)out.searchParams.set("cate2",cate2);
      return out.toString().replace(/\?$/,"").toLowerCase();
    }
    return (u.origin+path).toLowerCase();
  }catch{return ""}
}

function categoryRoot(url){
  try{
    const u=new URL(url);
    const host=u.hostname.toLowerCase().replace(/^www\./,"");
    if(host!=="bachhoaxanh.com")return "";
    const first=u.pathname.split("/").filter(Boolean)[0]||"";
    return first?"https://bachhoaxanh.com/"+first:"";
  }catch{return ""}
}

function money(v){
  const n=Number(v||0);
  if(!(n>0))return "—";

  // Display in thousands and round only the presentation to the nearest
  // 0.5 thousand: 15.3 -> 15.5, 61.5 -> 61.5, 88.1 -> 88.
  // Raw prices/calculations remain unchanged.
  const scaled=n/1000;
  const rounded=Math.round(scaled*2)/2;
  return Number.isInteger(rounded)
    ?String(rounded)
    :rounded.toFixed(1);
}

function escapeHtml(v){
  return String(v||"").replace(/[&<>"]/g,m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"
  }[m]));
}

function escapeAttr(v){
  return escapeHtml(v).replace(/'/g,"&#39;");
}

function formatAge(iso){
  const t=Date.parse(iso||"");
  if(!Number.isFinite(t))return "";
  const sec=Math.max(0,Math.round((Date.now()-t)/1000));
  if(sec<60)return "vừa cập nhật";
  if(sec<3600)return Math.floor(sec/60)+" phút trước";
  if(sec<86400)return Math.floor(sec/3600)+" giờ trước";
  return Math.floor(sec/86400)+" ngày trước";
}

function searchKey(value){
  return String(value||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/đ/gi,"d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}


function productSearchKey(row){
  return searchKey([
    row.source_name,row.name,
    row.group_name,row.branch_name,row.brand_name,row.packaging,
    row.pack_label_1,row.pack_qty_1,
    row.pack_label_2,row.pack_qty_2,
    row.pack_label_3,row.pack_qty_3,
    row.size_value,row.size_unit,
    row.canonical_url
  ].filter(Boolean).join(" "));
}

function matchesSearch(row,query){
  const tokens=searchKey(query).split(/\s+/).filter(Boolean);
  if(!tokens.length)return true;
  const hay=productSearchKey(row);
  return tokens.every(token=>hay.includes(token));
}

function setStatus(text){
  $("#status").textContent=text;
}

function progressLabel(stage){
  return ({
    idle:"Sẵn sàng",
    checking:"Kiểm tra D1",
    queued:"Đang chờ xử lý",
    runner:"Đang khởi tạo",
    brightdata:"Đang lấy dữ liệu",
    saving:"Đang lưu",
    complete:"Hoàn tất",
    error:"Có lỗi"
  })[stage]||"Đang xử lý";
}

function formatElapsed(ms){
  const sec=Math.max(0,Math.floor(ms/1000));
  if(sec<60)return sec+" giây";
  const min=Math.floor(sec/60);
  return min+"p "+String(sec%60).padStart(2,"0")+"s";
}

function refreshProgressMeta(){
  const el=$("#statusElapsed");
  if(!el)return;
  if(!jobStartedAt){
    el.textContent="";
    return;
  }
  const elapsed=formatElapsed(Date.now()-jobStartedAt);
  const checked=lastPollAt
    ?" · kiểm tra "+Math.max(0,Math.round((Date.now()-lastPollAt)/1000))+"s trước"
    :"";
  el.textContent=elapsed+checked;
}

function startStatusTimer(){
  if(statusTimer)return;
  refreshProgressMeta();
  statusTimer=setInterval(refreshProgressMeta,1000);
}

function stopStatusTimer(){
  if(statusTimer)clearInterval(statusTimer);
  statusTimer=0;
  refreshProgressMeta();
}

function setJobStage(stage,text){
  const badge=$("#statusStage");
  if(badge){
    badge.dataset.stage=stage||"idle";
    badge.textContent=progressLabel(stage||"idle");
  }
  if(text)setStatus(text);

  const active=["checking","queued","runner","brightdata","saving"].includes(stage);
  if(active){
    if(!jobStartedAt){
      jobStartedAt=Date.now();
      localStorage.setItem("getlink:request-started-at",String(jobStartedAt));
    }
    startStatusTimer();
  }else if(stage==="complete"||stage==="error"){
    stopStatusTimer();
  }
  refreshProgressMeta();
}

function setGetBusy(busy){
  $("#get").disabled=Boolean(busy);
  $("#get").textContent=busy?"Đang lấy...":"Lấy giá";
}

function doneStatus(){
  return "Đã lấy xong và lưu vào thư viện giá.";
}

function stopPolling(){
  if(pollTimer)clearInterval(pollTimer);
  pollTimer=0;
}

function clearPending(keepElapsed=true){
  requestId="";
  localStorage.removeItem("getlink:request-id");
  if(!keepElapsed){
    jobStartedAt=0;
    localStorage.removeItem("getlink:request-started-at");
    stopStatusTimer();
  }
}

function failPending(message){
  stopPolling();
  setGetBusy(false);
  setJobStage("error",message);
  clearPending(true);
}

function unitLabel(cmp){
  const u=String(cmp&&cmp.pack_unit||"đơn vị").trim().toLowerCase();
  return u||"đơn vị";
}

function saveLocal(){
  const key=canonical(wantedUrl||$("#url").value.trim());
  if(!key)return;
  localStorage.setItem("getlink:"+key,JSON.stringify({
    myPrice:$("#myPrice").value.trim(),
    myPackQty:$("#myPackQty").value.trim()
  }));
}

function restoreLocal(url){
  try{
    const x=JSON.parse(localStorage.getItem("getlink:"+canonical(url))||"null");
    $("#myPrice").value=x&&x.myPrice||"";
    $("#myPackQty").value=x&&x.myPackQty||"1";
  }catch{
    $("#myPrice").value="";
    $("#myPackQty").value="1";
  }
  updateCompare();
}

function updateCompare(){
  const cmp=activeComparison||{};
  const mine=Number($("#myPrice").value.replace(/\D/g,"")||0);
  const bundleQty=Math.max(
    .0001,
    Number(String($("#myPackQty").value||"1").replace(",","."))||1
  );
  const unitsPerPack=Math.max(.0001,Number(cmp.pack_quantity)||1);
  const webUnit=Number(
    cmp.promo_unit_price||
    cmp.regular_unit_price||
    $("#webPrice").dataset.unitValue||
    0
  );

  if(!mine){
    $("#myUnitPrice").textContent="";
    $("#compare").textContent="";
    return;
  }

  const myPack=mine/bundleQty;
  const myUnit=myPack/unitsPerPack;
  $("#myUnitPrice").textContent=
    "≈ "+money(Math.round(myPack))+" / quy cách · "+
    money(Math.round(myUnit))+" / "+unitLabel(cmp);

  if(!webUnit){
    $("#compare").textContent="";
    return;
  }

  const d=webUnit-myUnit;
  $("#compare").textContent=Math.abs(d)<.5
    ?"Giá lẻ bằng nhau"
    :d>0
      ?"BHX cao hơn giá của mình "+money(Math.round(d))+" / "+unitLabel(cmp)
      :"Giá của mình cao hơn BHX "+money(Math.round(Math.abs(d)))+" / "+unitLabel(cmp);
}

$("#myPrice").addEventListener("input",()=>{saveLocal();updateCompare()});
$("#myPackQty").addEventListener("input",()=>{saveLocal();updateCompare()});


function preferenceStateForUrl(url){
  const key=canonical(url);
  const row=libraryCache.find(x=>canonical(x.canonical_url)===key);
  return row&&row.preference_state||"normal";
}

function syncWatchCheckbox(state){
  activePreferenceState=state||"normal";
  $("#watch").checked=activePreferenceState==="watch";
}

async function updatePreference(url,state,refreshHours=6,rerender=true){
  const r=await fetch(API+"/api/preference",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      url,
      state,
      refresh_hours:refreshHours
    })
  });
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"preference_error");

  const key=canonical(url);
  const row=libraryCache.find(x=>canonical(x.canonical_url)===key);
  if(row){
    row.preference_state=data.preference&&data.preference.state||state;
    row.auto_refresh=Number(data.preference&&data.preference.auto_refresh||0);
    row.refresh_hours=Number(data.preference&&data.preference.refresh_hours||24);
  }
  if(canonical(wantedUrl)===key){
    syncWatchCheckbox(data.preference&&data.preference.state||state);
  }
  if(rerender)renderLibraryProducts();
  return data.preference;
}

$("#watch").addEventListener("change",async()=>{
  if(!wantedUrl)return;
  const desired=$("#watch").checked?"watch":"normal";
  $("#watch").disabled=true;
  try{
    await updatePreference(wantedUrl,desired,6);
  }catch{
    $("#watch").checked=activePreferenceState==="watch";
  }finally{
    $("#watch").disabled=false;
  }
});

function resetDetailImage(){
  const image=$("#detailImage");
  const fallback=$("#detailImageFallback");
  image.hidden=true;
  image.removeAttribute("src");
  image.alt="";
  fallback.hidden=false;
}

function renderProduct(payload){
  const p=payload&&payload.product?payload.product:payload;
  if(!p)return false;
  const variants=Array.isArray(payload&&payload.variants)?payload.variants:[];

  $("#result").hidden=false;
  $("#detailEmpty").hidden=true;
  const detailImage=String(p.image||"");
  resetDetailImage();
  if(detailImage){
    const image=$("#detailImage");
    image.alt=p.name||"Sản phẩm";
    image.onload=()=>{
      image.hidden=false;
      $("#detailImageFallback").hidden=true;
    };
    image.onerror=()=>{
      resetDetailImage();
    };
    image.src=detailImage;
  }
  $("#priceGrid").hidden=false;
  $("#productPersonal").hidden=false;
  $("#categoryChildren").hidden=true;
  $("#linkType").textContent="So sánh giá";
  $("#source").textContent=(p.source&&p.source.name)||"Bách Hóa XANH";
  $("#name").textContent=p.name||"Sản phẩm";
  $("#group").textContent=p.group||"—";
  $("#branch").textContent=p.branch||"—";
  $("#packaging").textContent=(p.packaging&&p.packaging.text)||"—";

  const cmp=p.comparison||{};
  activeComparison=cmp;

  const currentBhx=Number(
    p.price&&p.price.current||
    cmp.regular_pack_price||
    0
  );
  const currentUnit=Number(
    cmp.regular_unit_price||
    (currentBhx&&cmp.pack_quantity
      ?Math.round(currentBhx/Math.max(1,Number(cmp.pack_quantity)||1))
      :0)
  );
  $("#webPrice").dataset.value=String(currentBhx||"");
  $("#webPrice").dataset.unitValue=String(currentUnit||0);
  $("#webPrice").textContent=money(currentBhx);
  if(currentUnit){
    $("#webPrice").textContent+=" · "+money(currentUnit)+"/"+unitLabel(cmp);
  }

  // "Ưu đãi" is only an extra quantity condition for this exact pack.
  // A normal BHX markdown (e.g. 86k -> 65k) stays in Giá BHX as 65k.
  const quantityPromo=Boolean(cmp.quantity_offer_active);
  const promoPack=quantityPromo?Number(cmp.quantity_offer_pack_price||cmp.promo_pack_price||0):0;
  const promoUnit=quantityPromo?Number(cmp.quantity_offer_unit_price||cmp.promo_unit_price||0):0;
  $("#promoPrice").textContent=promoPack?money(promoPack):"—";
  if(promoUnit){
    $("#promoPrice").textContent+=" · "+money(promoUnit)+"/"+unitLabel(cmp);
  }
  $("#promoText").textContent=quantityPromo?(cmp.promotion_text||""):"";
  $("#productLink").href=p.url||payload.input_url||"#";

  wantedUrl=p.url||payload.input_url||wantedUrl;
  $("#url").value=wantedUrl||$("#url").value;
  restoreLocal(wantedUrl);
  syncWatchCheckbox(preferenceStateForUrl(wantedUrl));

  if(variants.length){
    $("#productVariants").hidden=false;
    $("#variantCount").textContent=variants.length+" quy cách";
    $("#variantList").innerHTML=variants.map(v=>{
      const meta=v.variant||{};
      const vc=v.comparison||{};
      const pack=(v.packaging&&v.packaging.text)||meta.title||"Quy cách";
      const size=vc.size_value?(vc.size_value+" "+vc.size_unit):"";
      const kind=vc.promotion_active?"ƯU ĐÃI":"THƯỜNG";
      const stock=meta.is_can_buy===false
        ?"Hết hàng"
        :(meta.stock?"Tồn "+meta.stock:"");
      const packPrice=
        vc.promo_pack_price||
        vc.regular_pack_price||
        (v.price&&v.price.current);
      const unitPrice=vc.promo_unit_price||vc.regular_unit_price;
      return '<div class="child-row variant-row">'+
        '<span><b>'+escapeHtml(pack)+'</b>'+
        '<small>'+escapeHtml([v.name,size,kind,stock].filter(Boolean).join(" · "))+'</small></span>'+
        '<span class="variant-price"><strong>'+money(packPrice)+'</strong>'+
        (unitPrice?'<small>≈ '+money(unitPrice)+' / '+escapeHtml(unitLabel(vc))+'</small>':'')+
        '</span></div>';
    }).join("");
  }else{
    $("#productVariants").hidden=true;
    $("#variantList").innerHTML="";
  }

  return true;
}

function renderCategory(payload){
  const products=Array.isArray(payload.products)?payload.products:[];
  const first=products[0]||{};

  $("#result").hidden=false;
  $("#detailEmpty").hidden=true;
  resetDetailImage();
  $("#priceGrid").hidden=true;
  $("#productPersonal").hidden=true;
  $("#productVariants").hidden=true;
  $("#categoryChildren").hidden=false;
  $("#linkType").textContent="Nhóm";
  $("#source").textContent=(payload.source&&payload.source.name)||"Bách Hóa XANH";
  $("#name").textContent=payload.category_name||first.group||"Nhóm sản phẩm";
  $("#group").textContent=first.group||"—";
  $("#branch").textContent="—";
  $("#packaging").textContent=products.length+" link chi tiết";
  $("#productLink").href=payload.input_url||wantedUrl||"#";
  $("#childCount").textContent=products.length+" sản phẩm";

  $("#childList").innerHTML=products.length
    ?products.map(p=>{
      const title=escapeHtml(p.name||p.url||"Sản phẩm");
      const price=money(p&&p.price&&p.price.current);
      const url=escapeAttr(p.url||"");
      return '<button class="child-row library-child" data-url="'+url+'" type="button">'+
        '<span>'+title+'</span><strong>'+price+'</strong></button>';
    }).join("")
    :'<div class="child-empty">Chưa phát hiện link chi tiết.</div>';
}

function renderPayload(payload){
  if(!payload)return false;
  if(payload.input_type==="category"){
    renderCategory(payload);
    return true;
  }
  return renderProduct(payload);
}

function sheetOwnKey(url,type){
  return "getlink:sheet-own-"+type+":"+canonical(url);
}

function readOwnPrice(url,type){
  const direct=localStorage.getItem(sheetOwnKey(url,type));
  if(direct!==null&&direct!==""){
    return Number(String(direct).replace(/\D/g,""))||0;
  }

  // Legacy one-price input is only safe to reuse as a carton price.
  if(type==="carton"){
    const legacy=localStorage.getItem("getlink:sheet-price:"+canonical(url));
    if(legacy!==null&&legacy!==""){
      return Number(String(legacy).replace(/\D/g,""))||0;
    }
  }
  return 0;
}

function writeOwnPrice(url,type,value){
  const n=Number(String(value||"").replace(/\D/g,""))||0;
  const key=sheetOwnKey(url,type);
  if(n>0)localStorage.setItem(key,String(n));
  else localStorage.removeItem(key);
  return n;
}

function sheetDiffText(webValue,mineValue){
  if(!webValue||!mineValue)return "—";
  const d=Math.round(webValue-mineValue);
  if(Math.abs(d)<1)return "Bằng";
  return d>0
    ?"BHX +"+money(d)
    :"Mình +"+money(Math.abs(d));
}

function updateSheetRow(card){
  if(!card)return;
  const middleQty=Math.max(1,Number(card.dataset.middleQty)||1);
  const leafQty=Math.max(1,Number(card.dataset.leafQty)||1);
  const cartonInput=card.querySelector(".sheet-my-carton");
  const middleInput=card.querySelector(".sheet-my-middle");
  const leafInput=card.querySelector(".sheet-my-retail");

  const mineCarton=cartonInput
    ?Number(String(cartonInput.value||"").replace(/\D/g,""))||0
    :0;
  const mineMiddle=middleInput
    ?Number(String(middleInput.value||"").replace(/\D/g,""))||0
    :0;

  const derivedMiddle=middleInput&&mineCarton
    ?Math.round(mineCarton/middleQty)
    :0;
  const leafBase=mineMiddle||derivedMiddle||mineCarton;
  const directLeafFromCarton=Boolean(
    leafInput&&
    !middleInput&&
    cartonInput&&
    mineCarton
  );
  const derivedLeaf=leafInput&&leafBase
    ?Math.round(leafBase/(directLeafFromCarton?leafQty:leafQty))
    :0;

  if(middleInput){
    middleInput.placeholder=derivedMiddle
      ?"≈ "+money(derivedMiddle)+" từ thùng"
      :"Giá/Giữa";
  }
  if(leafInput){
    leafInput.placeholder=derivedLeaf
      ?"≈ "+money(derivedLeaf)+(middleInput?" từ giữa":" từ thùng")
      :"Giá/Lẻ";
  }
}

function rowPackHierarchy(row){
  return {
    label1:String(row&&row.pack_label_1||"").trim(),
    qty1:Number(row&&row.pack_qty_1)||0,
    label2:String(row&&row.pack_label_2||"").trim(),
    qty2:Number(row&&row.pack_qty_2)||0,
    label3:String(row&&row.pack_label_3||"").trim(),
    qty3:Number(row&&row.pack_qty_3)||0,
    evidence:String(row&&row.pack_evidence||"").trim(),
    locked:Number(row&&row.hierarchy_locked||0)>0
  };
}

function rowIsCarton(row){
  return rowPackHierarchy(row).label1==="Thùng";
}

function rowPriceLevels(row){
  const h=rowPackHierarchy(row);
  const carton=Number(row.web_carton_price||0);
  const middle=Number(row.web_middle_price||0);
  const leaf=Number(row.web_leaf_price||0);
  const promoCarton=Number(row.promo_carton_price||0);
  const promoMiddle=Number(row.promo_middle_price||0);
  const promoLeaf=Number(row.promo_leaf_price||0);

  const hasPromo=Boolean(
    (promoCarton>0&&carton>0&&promoCarton<carton)||
    (promoMiddle>0&&middle>0&&promoMiddle<middle)||
    (promoLeaf>0&&leaf>0&&promoLeaf<leaf)||
    Number(row.has_promo||row.promotion_active||0)>0
  );

  return {
    rawName:String(row.source_name||row.name||"Sản phẩm").trim()||"Sản phẩm",
    hierarchy:h,
    hasCarton:h.label1==="Thùng",
    hasMiddle:Boolean(h.label2),
    hasLeaf:Boolean(h.label3),
    hasPromo,
    cartonPrice:carton,
    middlePrice:middle,
    leafPrice:leaf,
    promoCartonPrice:promoCarton,
    promoMiddlePrice:promoMiddle,
    promoLeafPrice:promoLeaf
  };
}

function capitalizeDisplayName(value){
  const text=String(value||"").trim();
  if(!text)return "Sản phẩm";
  return text.charAt(0).toLocaleUpperCase("vi-VN")+text.slice(1);
}

function canonicalDisplayName(row){
  return capitalizeDisplayName(
    String(row&&row.source_name||row&&row.name||"Sản phẩm")
  );
}

function sourceDisplayLabel(row){
  const raw=String(row&&row.source||"").trim();
  const key=searchKey(raw);
  if(!raw||key.includes("bach hoa xanh"))return "BHX";
  if(key.includes("winmart"))return "WM";
  return raw;
}

function sourceDisplayClass(row){
  const key=searchKey(String(row&&row.source||""));
  if(key.includes("winmart"))return " source-winmart";
  if(!key||key.includes("bach hoa xanh"))return " source-bhx";
  return "";
}

function rowPrimaryQc(row){
  const h=rowPackHierarchy(row);
  if(h.label1==="Thùng"){
    if(h.label2)return packHierarchyText(h.qty2,h.label2);
    if(h.label3)return packHierarchyText(h.qty3,h.label3);
    return "1 Thùng";
  }
  if(h.label2&&h.label3)return packHierarchyText(h.qty3,h.label3);
  if(h.label3)return packHierarchyText(h.qty3||1,h.label3);
  if(h.label2)return packHierarchyText(h.qty2||1,h.label2);
  return "—";
}

function packHierarchyText(qty,label){
  const q=Number(qty)||0;
  const unit=String(label||"").trim();
  if(!unit)return "";
  return (q>0?q+" ":"")+unit;
}

function xlsWebPrice(main,promo){
  return '<span class="xls-price-main">'+money(main)+'</span>'+
    (promo&&promo<main
      ?'<small class="xls-promo-note">ƯĐ '+money(promo)+'</small>'
      :'');
}

function productCard(row){
  const levels=rowPriceLevels(row);
  const hierarchy=levels.hierarchy;
  const displayName=canonicalDisplayName(row);
  const pref=String(row.preference_state||"normal");

  const mineCarton=levels.hasCarton
    ?readOwnPrice(row.canonical_url,"carton")
    :0;
  const mineMiddle=levels.hasMiddle
    ?readOwnPrice(row.canonical_url,"middle")
    :0;
  const mineRetail=levels.hasLeaf
    ?readOwnPrice(row.canonical_url,"retail")
    :0;
  const bargain=readOwnPrice(row.canonical_url,"bargain");

  return '<tr class="product-card xls-row '+(pref==="hidden"?"is-hidden ":"")+
    (canonical(selectedLibraryUrl)===canonical(row.canonical_url)?"selected ":"")+
    '" tabindex="0" '+
    'data-url="'+escapeAttr(row.canonical_url)+'" '+
    'data-middle-qty="'+(Number(hierarchy.qty2)||1)+'" '+
    'data-leaf-qty="'+(Number(hierarchy.qty3)||1)+'">'+
      '<td class="xls-name" title="'+escapeAttr(levels.rawName)+'">'+
        '<button class="xls-open-detail" type="button" data-url="'+escapeAttr(row.canonical_url)+'">'+escapeHtml(displayName)+'</button>'+
      '</td>'+
      '<td class="xls-source'+sourceDisplayClass(row)+'" title="'+escapeAttr(String(row.source||"Bách Hóa XANH"))+'">'+escapeHtml(sourceDisplayLabel(row))+'</td>'+
      '<td class="xls-pack-level">'+
        (hierarchy.label1
          ?escapeHtml(packHierarchyText(hierarchy.qty1,hierarchy.label1))
          :'<span class="xls-empty">—</span>')+
      '</td>'+
      '<td class="xls-pack-level">'+
        (hierarchy.label2
          ?escapeHtml(packHierarchyText(hierarchy.qty2,hierarchy.label2))
          :'<span class="xls-empty">—</span>')+
      '</td>'+
      '<td class="xls-pack-level">'+
        (hierarchy.label3
          ?escapeHtml(packHierarchyText(hierarchy.qty3,hierarchy.label3))
          :'<span class="xls-empty">—</span>')+
      '</td>'+
      '<td class="xls-num">'+xlsWebPrice(levels.cartonPrice,levels.promoCartonPrice)+'</td>'+
      '<td class="xls-num">'+xlsWebPrice(levels.middlePrice,levels.promoMiddlePrice)+'</td>'+
      '<td class="xls-num">'+xlsWebPrice(levels.leafPrice,levels.promoLeafPrice)+'</td>'+
      '<td>'+
        (levels.hasCarton
          ?'<input class="sheet-my-carton xls-input" inputmode="numeric" data-url="'+escapeAttr(row.canonical_url)+'" value="'+(mineCarton||"")+'" placeholder="—">'
          :'<span class="xls-empty">—</span>')+
      '</td>'+
      '<td>'+
        (levels.hasMiddle
          ?'<input class="sheet-my-middle xls-input" inputmode="numeric" data-url="'+escapeAttr(row.canonical_url)+'" value="'+(mineMiddle||"")+'" placeholder="—">'
          :'<span class="xls-empty">—</span>')+
      '</td>'+
      '<td>'+
        (levels.hasLeaf
          ?'<input class="sheet-my-retail xls-input" inputmode="numeric" data-url="'+escapeAttr(row.canonical_url)+'" value="'+(mineRetail||"")+'" placeholder="—">'
          :'<span class="xls-empty">—</span>')+
      '</td>'+
      '<td>'+
        '<input class="sheet-bargain xls-input" inputmode="numeric" data-url="'+escapeAttr(row.canonical_url)+'" value="'+(bargain||"")+'" placeholder="—">'+
      '</td>'+
    '</tr>';
}

function categoryPageSize(){
  return isCompactBrowse()?8:18;
}

function resultPageSize(){
  return isCompactBrowse()?20:36;
}

function pagerButtons(page,total){
  if(total<=1)return "";
  const out=[];
  const start=Math.max(1,Math.min(page-2,total-4));
  const end=Math.min(total,start+4);
  out.push('<button type="button" data-page="'+Math.max(1,page-1)+'" '+(page<=1?'disabled':'')+' aria-label="Trang trước">‹</button>');
  for(let p=start;p<=end;p++){
    out.push('<button type="button" data-page="'+p+'" class="'+(p===page?'active':'')+'">'+p+'</button>');
  }
  out.push('<button type="button" data-page="'+Math.min(total,page+1)+'" '+(page>=total?'disabled':'')+' aria-label="Trang sau">›</button>');
  return out.join("");
}

function categoryPagerButtons(page,total){
  if(total<=1)return "";
  return '<button type="button" data-page="'+Math.max(1,page-1)+'" '+(page<=1?'disabled':'')+' aria-label="Nhóm trước">‹</button>'+
    '<button type="button" data-page="'+Math.min(total,page+1)+'" '+(page>=total?'disabled':'')+' aria-label="Nhóm sau">›</button>';
}

function renderCategoryMenu(){
  const host=$("#categoryTabs");
  if(!host)return;

  const visibleLibrary=libraryCache.filter(row=>
    String(row.preference_state||"normal")!=="hidden"
  );
  const groupCounts=new Map();
  for(const row of visibleLibrary){
    const key=String(row.parent_url||"");
    if(!key)continue;
    groupCounts.set(key,(groupCounts.get(key)||0)+1);
  }

  host.innerHTML=
    '<button class="category-chip '+(!activeGroupUrl?"active":"")+'" data-group="" type="button">'+
      '<span>Tất cả</span><small>'+visibleLibrary.length+'</small>'+
    '</button>'+
    libraryGroups.map(g=>
      '<button class="category-chip '+(activeGroupUrl===g.url?"active":"")+'" data-group="'+escapeAttr(g.url)+'" type="button">'+
        '<span>'+escapeHtml(g.name)+'</span><small>'+Number(groupCounts.get(g.url)||0)+'</small>'+
      '</button>'
    ).join("");

  const current=$("#mobileCategoryCurrent");
  if(current){
    const group=libraryGroups.find(g=>g.url===activeGroupUrl);
    current.textContent=group?group.name:"Tất cả";
  }
}

function gridProductCard(row){
  const levels=rowPriceLevels(row);
  const displayName=canonicalDisplayName(row);
  const hierarchy=levels.hierarchy;
  const price=levels.hasCarton
    ?(levels.promoCartonPrice||levels.cartonPrice)
    :(levels.hasMiddle
      ?(levels.promoMiddlePrice||levels.middlePrice)
      :(levels.promoLeafPrice||levels.leafPrice));
  const image=String(row.image||"").trim();
  const qc=rowPrimaryQc(row);
  const isWatch=String(row.preference_state||"normal")==="watch";

  return '<article class="grid-product product-card '+
    (String(row.preference_state||"normal")==="hidden"?"is-hidden ":"")+
    (canonical(selectedLibraryUrl)===canonical(row.canonical_url)?"selected ":"")+
    '" tabindex="0" data-url="'+escapeAttr(row.canonical_url)+'">'+
      '<div class="grid-product-image">'+
        '<button class="grid-watch-button '+(isWatch?"active":"")+'" type="button" '+
          'data-url="'+escapeAttr(row.canonical_url)+'" data-watch="'+(isWatch?"1":"0")+'" '+
          'aria-label="'+(isWatch?"Bỏ quan tâm":"Đánh dấu quan tâm")+'" '+
          'title="'+(isWatch?"Bỏ quan tâm":"Quan tâm")+'">'+
          '<span aria-hidden="true">'+(isWatch?"♥":"♡")+'</span>'+
        '</button>'+
        (image
          ?'<img src="'+escapeAttr(image)+'" alt="" loading="lazy" decoding="async">'
          :'<span class="grid-product-fallback">GL</span>')+
      '</div>'+
      '<div class="grid-product-body">'+
        '<button class="grid-product-name" type="button" data-url="'+escapeAttr(row.canonical_url)+'" title="'+escapeAttr(levels.rawName)+'">'+escapeHtml(displayName)+'</button>'+
        '<div class="grid-product-bottom">'+
          '<span class="grid-qc">'+escapeHtml(qc||"—")+'</span>'+
          '<strong class="grid-price">'+money(price)+'</strong>'+
        '</div>'+
      '</div>'+
    '</article>';
}


async function loadLibraryGroups(){
  if(!API)return;
  try{
    const r=await fetch(API+"/api/library?view=groups",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||"library_error");
    libraryGroups=Array.isArray(data.groups)?data.groups:[];

    if(activeGroupUrl&&!libraryGroups.some(g=>g.url===activeGroupUrl)){
      activeGroupUrl="";
    }
    renderCategoryMenu();
  }catch{
    libraryGroups=[];
    $("#categoryTabs").innerHTML=
      '<span class="library-error">Chưa đọc được nhóm từ D1.</span>';
  }
}

async function ensureLibraryCache(force=false){
  if(libraryLoaded&&!force)return;
  const r=await fetch(API+"/api/library?view=search&limit=2000&include_hidden=1",{cache:"no-store"});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"library_error");
  libraryCache=Array.isArray(data.products)?data.products:[];
  libraryLoaded=true;
}


function visibleRowsBeforePack(){
  let products=libraryCache.slice();

  if(libraryState==="watch"){
    products=products.filter(row=>String(row.preference_state||"normal")==="watch");
  }else if(libraryState==="hidden"){
    products=products.filter(row=>String(row.preference_state||"normal")==="hidden");
  }else{
    products=products.filter(row=>String(row.preference_state||"normal")!=="hidden");
  }

  if(activeGroupUrl){
    products=products.filter(row=>row.parent_url===activeGroupUrl);
  }
  if(activeBrand){
    products=products.filter(row=>
      String(row.brand_name||row.branch_name||"")===activeBrand
    );
  }
  if(libraryQuery){
    products=products.filter(row=>matchesSearch(row,libraryQuery));
  }
  return products;
}

function renderPackTabs(){
  const host=$("#packTabs");
  if(!host)return;

  const base=visibleRowsBeforePack();
  const cartonCount=base.filter(row=>rowIsCarton(row)).length;
  const retailCount=base.length-cartonCount;
  const promoCount=base.filter(row=>rowPriceLevels(row).hasPromo).length;

  const selectedCount=activePackKind==="Thùng"
    ?cartonCount
    :(activePackKind==="Lẻ"
      ?retailCount
      :(activePackKind==="Ưu đãi"?promoCount:base.length));

  if(activePackKind&&selectedCount===0){
    activePackKind="";
    localStorage.removeItem("getlink:filter-pack");
  }

  if(!base.length){
    activePackKind="";
    host.hidden=true;
    host.innerHTML="";
    return;
  }

  if(activePackKind!=="Thùng"&&activePackKind!=="Lẻ"&&activePackKind!=="Ưu đãi"){
    activePackKind="";
    localStorage.removeItem("getlink:filter-pack");
  }

  host.hidden=false;
  host.innerHTML=
    '<button class="pack-chip '+(!activePackKind?"active":"")+'" data-pack="" type="button">Tất cả <small>'+base.length+'</small></button>'+
    '<button class="pack-chip '+(activePackKind==="Thùng"?"active":"")+'" data-pack="Thùng" type="button">Thùng <small>'+cartonCount+'</small></button>'+
    '<button class="pack-chip '+(activePackKind==="Lẻ"?"active":"")+'" data-pack="Lẻ" type="button">Lẻ <small>'+retailCount+'</small></button>'+
    '<button class="pack-chip '+(activePackKind==="Ưu đãi"?"active":"")+'" data-pack="Ưu đãi" type="button">Ưu đãi <small>'+promoCount+'</small></button>';
}

function filteredLibraryProducts(){
  let products=visibleRowsBeforePack();

  if(activePackKind==="Thùng"){
    products=products.filter(row=>rowIsCarton(row));
  }else if(activePackKind==="Lẻ"){
    products=products.filter(row=>!rowIsCarton(row));
  }else if(activePackKind==="Ưu đãi"){
    products=products.filter(row=>rowPriceLevels(row).hasPromo);
  }

  products.sort((a,b)=>{
    const nameA=String(a.source_name||a.name||"");
    const nameB=String(b.source_name||b.name||"");
    return nameA.localeCompare(nameB,"vi");
  });

  return products;
}

function renderBrandTabs(){
  const host=$("#brandTabs");
  if(!host)return;
  const section=host.closest(".brand-section");

  if(!activeGroupUrl){
    activeBrand="";
    host.hidden=true;
    host.innerHTML="";
    if(section)section.hidden=true;
    return;
  }

  const base=libraryCache.filter(row=>
    row.parent_url===activeGroupUrl&&
    String(row.preference_state||"normal")!=="hidden"
  );
  const counts=new Map();
  for(const row of base){
    const brand=String(row.brand_name||row.branch_name||"").trim();
    if(!brand)continue;
    counts.set(brand,(counts.get(brand)||0)+1);
  }
  const brands=[...counts.entries()]
    .sort((a,b)=>a[0].localeCompare(b[0],"vi"));

  if(!brands.length){
    activeBrand="";
    host.hidden=true;
    host.innerHTML="";
    if(section)section.hidden=true;
    return;
  }

  if(activeBrand&&!counts.has(activeBrand))activeBrand="";
  if(section)section.hidden=false;
  host.hidden=false;
  host.innerHTML=
    '<button class="brand-chip '+(!activeBrand?"active":"")+'" data-brand="" type="button">Tất cả hãng <small>'+base.length+'</small></button>'+
    brands.map(([brand,count])=>
      '<button class="brand-chip '+(activeBrand===brand?"active":"")+'" data-brand="'+escapeAttr(brand)+'" type="button">'+
        escapeHtml(brand)+' <small>'+count+'</small>'+
      '</button>'
    ).join("");
}

function renderResultPager(){
  // Intentionally no pagination: browsing stays continuous.
}

function syncViewMode(){
  const grid=$("#productGrid");
  const table=$("#tableView");
  if(grid)grid.hidden=libraryView!=="grid";
  if(table)table.hidden=libraryView!=="table";
  document.querySelectorAll(".view-button").forEach(button=>{
    button.classList.toggle("active",button.dataset.view===libraryView);
  });
}

function renderLibraryProducts(){
  renderBrandTabs();
  renderPackTabs();
  syncStateControls();
  const products=filteredLibraryProducts();

  if(libraryQuery){
    $("#libraryTitle").textContent='Kết quả cho “'+libraryQuery+'”';
  }else if(activeGroupUrl){
    const group=libraryGroups.find(g=>g.url===activeGroupUrl);
    $("#libraryTitle").textContent=group?group.name:"Sản phẩm";
  }else{
    $("#libraryTitle").textContent=libraryState==="watch"
      ?"Sản phẩm quan tâm"
      :(libraryState==="hidden"?"Sản phẩm đang ẩn":"Tất cả sản phẩm đang dùng");
  }

  const visible=products;

  $("#libraryCount").textContent=products.length
    ?products.length+" sản phẩm"
    :"";

  $("#productGrid").innerHTML=visible.map(gridProductCard).join("");
  $("#libraryProducts").innerHTML=visible.map(productCard).join("");
  document.querySelectorAll("#libraryProducts .product-card").forEach(updateSheetRow);
  $("#libraryEmpty").hidden=products.length!==0;

  if(!products.length){
    $("#libraryEmpty").textContent=libraryQuery
      ?"Không có sản phẩm khớp tất cả từ đang tìm."
      :"Chưa có sản phẩm trong nhóm này.";
  }

  renderResultPager();
  syncViewMode();
}

async function loadLibraryProducts(force=false){
  if(!API)return;
  $("#libraryProducts").innerHTML='<tr class="catalog-loading-row"><td colspan="12">Đang đọc thư viện D1...</td></tr>';
  $("#productGrid").innerHTML='<div class="grid-loading">Đang đọc thư viện D1...</div>';
  $("#libraryEmpty").hidden=true;
  try{
    await ensureLibraryCache(force);
    renderCategoryMenu();
    renderLibraryProducts();
  }catch{
    $("#libraryProducts").innerHTML="";
    $("#productGrid").innerHTML="";
    $("#libraryCount").textContent="";
    $("#libraryEmpty").hidden=false;
    $("#libraryEmpty").textContent="Chưa đọc được thư viện giá.";
  }
}

async function openLibraryItem(url){
  if(!API||!url)return;
  selectedLibraryUrl=url;

  // Never leave the previous product image visible while the next detail
  // request is still loading.
  resetDetailImage();

  document.querySelectorAll(".product-card").forEach(x=>x.classList.remove("selected"));
  const card=document.querySelector('.product-card[data-url="'+CSS.escape(url)+'"]');
  if(card){
    card.classList.add("selected","loading");
  }

  try{
    const r=await fetch(
      API+"/api/library?view=item&url="+encodeURIComponent(url),
      {cache:"no-store"}
    );
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||"not_found");
    wantedUrl=url;
    $("#url").value=url;
    $("#detailEmpty").hidden=true;
    renderPayload(data.payload);
    syncWatchCheckbox(data.preference&&data.preference.state||preferenceStateForUrl(url));
  }catch{
    $("#importCard").hidden=false;
    $("#url").value=url;
    setStatus("Link đã có trong kho nhưng chưa đủ dữ liệu chi tiết. Bấm Lấy giá để cập nhật.");
  }finally{
    if(card)card.classList.remove("loading");
  }
}

async function refreshCatalog(selectUrl=""){
  if(selectUrl){
    activeGroupUrl=categoryRoot(selectUrl);
    activeBrand="";
    libraryQuery="";
    $("#librarySearch").value="";
  }
  libraryLoaded=false;
  await Promise.all([
    loadLibraryGroups(),
    loadLibraryProducts(true)
  ]);
}


function syncStateControls(){
  document.querySelectorAll("#stateFilters .state-chip").forEach(chip=>{
    chip.classList.toggle("active",(chip.dataset.state||"visible")===libraryState);
  });
}



$("#stateFilters").addEventListener("click",e=>{
  const chip=e.target.closest(".state-chip");
  if(!chip)return;
  libraryState=chip.dataset.state||"visible";
  libraryPage=1;
  syncStateControls();
  renderLibraryProducts();
});

$("#categoryTabs").addEventListener("click",e=>{
  const chip=e.target.closest(".category-chip");
  if(!chip)return;
  activeGroupUrl=chip.dataset.group||"";
  activeBrand="";
  activePackKind="";
  localStorage.removeItem("getlink:filter-pack");
  libraryPage=1;
  libraryQuery="";
  $("#librarySearch").value="";
  document.querySelectorAll(".category-chip").forEach(x=>x.classList.remove("active"));
  chip.classList.add("active");
  closeMobileCategoryNav();
  renderCategoryMenu();
  renderLibraryProducts();
});

function openMobileCategoryNav(){
  if(!isCompactBrowse())return;
  const nav=$("#workspaceNav");
  const scrim=$("#mobileNavScrim");
  const button=$("#mobileCategoryButton");
  if(!nav||!scrim||!button)return;
  nav.classList.add("mobile-open");
  scrim.hidden=false;
  button.setAttribute("aria-expanded","true");
  document.body.classList.add("mobile-nav-open");
}

function closeMobileCategoryNav(){
  const nav=$("#workspaceNav");
  const scrim=$("#mobileNavScrim");
  const button=$("#mobileCategoryButton");
  if(nav)nav.classList.remove("mobile-open");
  if(scrim)scrim.hidden=true;
  if(button)button.setAttribute("aria-expanded","false");
  document.body.classList.remove("mobile-nav-open");
}

$("#mobileCategoryButton").addEventListener("click",()=>{
  const nav=$("#workspaceNav");
  if(nav&&nav.classList.contains("mobile-open"))closeMobileCategoryNav();
  else openMobileCategoryNav();
});
$("#mobileNavScrim").addEventListener("click",closeMobileCategoryNav);

let mobileNavTouchX=0;
$("#workspaceNav").addEventListener("touchstart",e=>{
  mobileNavTouchX=e.touches&&e.touches[0]?e.touches[0].clientX:0;
},{passive:true});
$("#workspaceNav").addEventListener("touchend",e=>{
  const endX=e.changedTouches&&e.changedTouches[0]?e.changedTouches[0].clientX:mobileNavTouchX;
  if(mobileNavTouchX-endX>55)closeMobileCategoryNav();
},{passive:true});

document.addEventListener("keydown",e=>{
  if(e.key==="Escape")closeMobileCategoryNav();
});

$("#brandTabs").addEventListener("click",e=>{
  const chip=e.target.closest(".brand-chip");
  if(!chip)return;
  activeBrand=chip.dataset.brand||"";
  activePackKind="";
  localStorage.removeItem("getlink:filter-pack");
  libraryPage=1;
  document.querySelectorAll(".brand-chip").forEach(x=>x.classList.remove("active"));
  chip.classList.add("active");
  renderLibraryProducts();
});


$("#packTabs").addEventListener("click",e=>{
  const chip=e.target.closest(".pack-chip");
  if(!chip)return;
  activePackKind=chip.dataset.pack||"";
  libraryPage=1;
  if(activePackKind)localStorage.setItem("getlink:filter-pack",activePackKind);
  else localStorage.removeItem("getlink:filter-pack");
  document.querySelectorAll(".pack-chip").forEach(x=>x.classList.remove("active"));
  chip.classList.add("active");
  renderLibraryProducts();
});

$("#librarySearch").addEventListener("input",e=>{
  libraryQuery=String(e.target.value||"").trim();
  libraryPage=1;
  renderLibraryProducts();
});





document.querySelector(".view-switch").addEventListener("click",e=>{
  const button=e.target.closest(".view-button");
  if(!button)return;
  libraryView=button.dataset.view==="table"?"table":"grid";
  localStorage.setItem("getlink:view-mode",libraryView);
  syncViewMode();
});

$("#productGrid").addEventListener("click",async e=>{
  const watch=e.target.closest(".grid-watch-button");
  if(watch){
    e.preventDefault();
    e.stopPropagation();
    if(watch.disabled)return;

    const url=watch.dataset.url||"";
    const key=canonical(url);
    const row=libraryCache.find(x=>canonical(x.canonical_url)===key);
    const wasWatch=watch.dataset.watch==="1";
    const next=wasWatch?"normal":"watch";

    // Optimistic UI: the heart changes immediately; persistence happens after.
    watch.dataset.watch=wasWatch?"0":"1";
    watch.classList.toggle("active",!wasWatch);
    watch.querySelector("span").textContent=wasWatch?"♡":"♥";
    watch.setAttribute("aria-label",wasWatch?"Đánh dấu quan tâm":"Bỏ quan tâm");
    if(row)row.preference_state=next;

    watch.disabled=true;
    try{
      await updatePreference(url,next,6,false);

      // If the current filter is Quan tâm and an item was unhearted,
      // remove it after persistence succeeds.
      if(libraryState==="watch"&&next!=="watch")renderLibraryProducts();
    }catch{
      // Roll back both local data and icon if persistence fails.
      if(row)row.preference_state=wasWatch?"watch":"normal";
      watch.dataset.watch=wasWatch?"1":"0";
      watch.classList.toggle("active",wasWatch);
      watch.querySelector("span").textContent=wasWatch?"♥":"♡";
      watch.setAttribute("aria-label",wasWatch?"Bỏ quan tâm":"Đánh dấu quan tâm");
    }finally{
      watch.disabled=false;
    }
    return;
  }

  if(isCompactBrowse())return;

  const button=e.target.closest(".grid-product-name");
  const card=e.target.closest(".grid-product");
  const url=(button&&button.dataset.url)||(card&&card.dataset.url)||"";
  if(url)openLibraryItem(url);
});

$("#productGrid").addEventListener("keydown",e=>{
  if(e.key!=="Enter"&&e.key!==" ")return;
  if(isCompactBrowse())return;
  const card=e.target.closest(".grid-product");
  if(!card)return;
  e.preventDefault();
  if(!isCompactBrowse())openLibraryItem(card.dataset.url||"");
});

$("#libraryProducts").addEventListener("click",async e=>{
  const detailButton=e.target.closest(".xls-open-detail");
  if(detailButton){
    e.stopPropagation();
    if(!isCompactBrowse())openLibraryItem(detailButton.dataset.url||"");
    return;
  }

  const priceInput=e.target.closest(".sheet-my-carton,.sheet-my-middle,.sheet-my-retail,.sheet-bargain");
  if(priceInput){
    e.stopPropagation();
    return;
  }

  const action=e.target.closest(".pref-action");
  const card=e.target.closest(".product-card");
  if(!card)return;

  if(action){
    e.stopPropagation();
    action.disabled=true;
    try{
      await updatePreference(
        card.dataset.url||"",
        action.dataset.state||"normal",
        6
      );
    }finally{
      action.disabled=false;
    }
    return;
  }

  if(!isCompactBrowse())openLibraryItem(card.dataset.url||"");
});

$("#libraryProducts").addEventListener("input",e=>{
  const carton=e.target.closest(".sheet-my-carton");
  const middle=e.target.closest(".sheet-my-middle");
  const retail=e.target.closest(".sheet-my-retail");
  const bargain=e.target.closest(".sheet-bargain");
  const input=carton||middle||retail||bargain;
  if(!input)return;

  const type=carton?"carton":(middle?"middle":(retail?"retail":"bargain"));
  writeOwnPrice(input.dataset.url||"",type,input.value);
  if(!bargain)updateSheetRow(input.closest(".product-card"));
});

$("#libraryProducts").addEventListener("keydown",e=>{
  if((e.key==="Enter"||e.key===" ")&&!e.target.closest(".pref-action")&&!e.target.closest(".sheet-my-carton,.sheet-my-middle,.sheet-my-retail,.sheet-bargain")){
    const card=e.target.closest(".product-card");
    if(!card)return;
    e.preventDefault();
    openLibraryItem(card.dataset.url||"");
  }
});

$("#childList").addEventListener("click",e=>{
  const row=e.target.closest(".library-child");
  if(!row)return;
  openLibraryItem(row.dataset.url||"");
});

$("#toggleImport").addEventListener("click",()=>{
  $("#importCard").hidden=false;
  $("#importCard").scrollIntoView({behavior:"smooth",block:"center"});
});

$("#closeImport").addEventListener("click",()=>{
  $("#importCard").hidden=true;
});

async function pollOnce(){
  if(!API||!requestId)return false;
  try{
    const r=await fetch(
      API+"/api/result?id="+encodeURIComponent(requestId),
      {cache:"no-store"}
    );
    const data=await r.json();

    if(!r.ok){
      failPending("GETLINK API lỗi "+r.status+". Bấm Lấy giá để thử lại.");
      return false;
    }

    if(data.status==="error"){
      failPending(
        "Chưa lấy được giá: "+
        (data.detail||data.error||"Chưa nhận được dữ liệu từ Bách Hóa XANH.")
      );
      return false;
    }

    if(data.status!=="complete"){
      lastPollAt=Date.now();
      if(data.status==="queued"){
        setJobStage("queued","Đã tiếp nhận yêu cầu · đang chờ xử lý...");
      }else if(data.status==="runner"){
        setJobStage("runner","Đang khởi tạo phiên lấy dữ liệu...");
      }else if(data.status==="brightdata"){
        setJobStage("brightdata","Đang truy xuất dữ liệu từ "+(inputSourceName(wantedUrl)||"nguồn")+"...");
      }else if(data.status==="saving"){
        setJobStage("saving","Đã có response · đang chuẩn hóa và lưu vào D1...");
      }else if(data.status==="running"){
        setJobStage("brightdata","Đang xử lý response từ "+(inputSourceName(wantedUrl)||"nguồn")+"...");
      }else{
        setJobStage("queued","Đang chờ tiến trình lấy giá...");
      }
      return false;
    }

    stopPolling();
    renderPayload(data.payload);
    if(Number(data.registry_count)>0){
      $("#registryCount").textContent="Kho link: "+data.registry_count;
    }
    const finishedUrl=data.payload&&data.payload.input_url||wantedUrl;
    clearPending(true);
    setGetBusy(false);
    setJobStage("complete",doneStatus());
    await refreshCatalog(finishedUrl);
    return true;
  }catch{
    return false;
  }
}

function startPolling(){
  stopPolling();
  pollUntil=Date.now()+240000;
  pollOnce();
  pollTimer=setInterval(async()=>{
    if(Date.now()>pollUntil){
      failPending("Chưa có response sau 4 phút. Bấm Lấy giá để thử lại.");
      return;
    }
    await pollOnce();
  },2500);
}

function supportedSourceUrl(raw){
  try{
    const host=new URL(String(raw||"")).hostname.toLowerCase().replace(/^www\./,"");
    return host==="bachhoaxanh.com"||host==="winmart.vn";
  }catch{
    return false;
  }
}

function inputSourceName(raw){
  try{
    const host=new URL(String(raw||"")).hostname.toLowerCase().replace(/^www\./,"");
    return host==="winmart.vn"?"WinMart":"Bách Hóa XANH";
  }catch{
    return "";
  }
}

$("#get").addEventListener("click",async()=>{
  const url=$("#url").value.trim();

  if(!supportedSourceUrl(url)){
    setJobStage("error","Chỉ hỗ trợ link bachhoaxanh.com hoặc winmart.vn.");
    return;
  }
  if(!API){
    setJobStage("error","GETLINK Worker chưa được triển khai.");
    return;
  }

  wantedUrl=url;
  setGetBusy(true);
  jobStartedAt=Date.now();
  lastPollAt=0;
  localStorage.setItem("getlink:request-started-at",String(jobStartedAt));
  setJobStage("checking","Đang kiểm tra thư viện D1...");

  try{
    const r=await fetch(API+"/api/get-price",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({url})
    });
    const data=await r.json();

    if(!r.ok||!data.request_id){
      throw new Error(data.detail||data.error||"Không tạo được yêu cầu");
    }

    requestId=data.request_id;
    localStorage.setItem("getlink:last-url",url);

    if(data.status==="complete"&&data.payload){
      renderPayload(data.payload);
      if(Number(data.registry_count)>0){
        $("#registryCount").textContent="Kho link: "+data.registry_count;
      }
      clearPending(true);
      setGetBusy(false);
      setJobStage(
        "complete",
        data.cache_hit
          ?"Đã đọc ngay từ D1 vì link được lấy trong vòng 24 giờ."
          :doneStatus()
      );
      await refreshCatalog(url);
      return;
    }

    localStorage.setItem("getlink:request-id",requestId);
    setJobStage("queued","Chưa có dữ liệu mới · yêu cầu đang chờ xử lý...");
    startPolling();
  }catch(error){
    setGetBusy(false);
    setJobStage("error","Không lấy được giá: "+String(error&&error.message||error));
  }
});

const saved=localStorage.getItem("getlink:last-url")||"";
if(saved)$("#url").value=saved;
requestId=localStorage.getItem("getlink:request-id")||"";
wantedUrl=saved;

refreshCatalog();

syncViewMode();

window.addEventListener("resize",()=>{
  const mobile=isCompactBrowse();
  if(mobile===lastMobileLayout)return;
  lastMobileLayout=mobile;
  if(!mobile)closeMobileCategoryNav();
  renderCategoryMenu();
  if(libraryLoaded)renderLibraryProducts();
});

if(requestId&&API){
  $("#importCard").hidden=false;
  setGetBusy(true);
  if(!jobStartedAt){
    jobStartedAt=Date.now();
    localStorage.setItem("getlink:request-started-at",String(jobStartedAt));
  }
  setJobStage("queued","Đang tiếp tục yêu cầu cập nhật trước...");
  startPolling();
}
