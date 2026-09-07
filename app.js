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
  return window.matchMedia("(max-width: 900px)").matches;
}
let lastMobileLayout=isCompactBrowse();

function canonical(url){
  try{
    const u=new URL(url);
    return ("https://bachhoaxanh.com"+u.pathname.replace(/\/+$/,"")).toLowerCase();
  }catch{return ""}
}

function categoryRoot(url){
  try{
    const u=new URL(url);
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


function escapeRegex(value){
  const special="\\^$.*+?()[]{}|";
  return String(value||"").split("").map(ch=>
    special.includes(ch)?"\\"+ch:ch
  ).join("");
}

function normalizedBaseName(row){
  const source=String(row.source_name||row.name||row.base_name||"").trim();
  if(!source)return "Sản phẩm";

  // Keep the commercial/product name intact. Only remove structural
  // packaging at the beginning and size/weight at the end.
  let value=source
    .replace(/^(thùng|lốc|cụm|combo|bộ)\s+/iu,"")
    .replace(/^\d+(?:[.,]\d+)?\s*\+\s*\d+(?:[.,]\d+)?\s*(hộp|chai|gói|bịch|túi|lon|hũ|ly|tô|khoanh|thanh|cây|viên|tuýp|can)\s+/iu,"")
    .replace(/^\d+(?:[.,]\d+)?\s*(hộp|chai|gói|bịch|túi|lon|hũ|ly|tô|khoanh|thanh|cây|viên|tuýp|can)\s+/iu,"")
    .replace(/\s+\d+(?:[.,]\d+)?\s*(ml|lít|lit|l|kg|g)\s*$/iu,"")
    .replace(/\s+(hộp|chai|gói|bịch|túi|lon|hũ|ly|tô|khoanh|thanh|cây|viên|tuýp|can)\s*$/iu,"")
    .replace(/\s+/g," ")
    .trim();

  if(!value)value=source;
  return value.charAt(0).toUpperCase()+value.slice(1);
}

function packSortRank(kind){
  const ranks={
    "Thùng":1,"Lốc":2,"Cụm":3,"Combo":4,"Bộ":5,
    "Chai":6,"Lon":7,"Hộp":8,"Gói":9,"Bịch":10,
    "Túi":11,"Can":12,"Hũ":13,"Ly":14,"Tô":15,"Khoanh":16,"Thanh":17,"Cây":18,
    "Viên":19,"Tuýp":20,"Đơn":90
  };
  return ranks[kind]||50;
}

function productSearchKey(row){
  const pack=inferSheetPack(row);
  return searchKey([
    row.source_name,row.name,
    row.group_name,row.branch_name,row.brand_name,row.packaging,
    pack.kind,pack.qty,pack.unit,pack.sizeValue,pack.sizeUnit,
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
  const qty=Math.max(1,Number(card.dataset.packQty)||1);
  const packKind=String(card.dataset.packKind||"");
  const cartonInput=card.querySelector(".sheet-my-carton");
  const retailInput=card.querySelector(".sheet-my-retail");

  const mineCarton=cartonInput
    ?Number(String(cartonInput.value||"").replace(/\D/g,""))||0
    :0;

  const canBorrowCartonQty=packKind==="Thùng"&&qty>1;
  const derivedRetail=canBorrowCartonQty&&mineCarton
    ?Math.round(mineCarton/qty)
    :0;

  if(retailInput){
    retailInput.placeholder=derivedRetail
      ?"≈ "+money(derivedRetail)+" từ thùng"
      :"Giá/Lẻ";
  }
}

function sheetNormalizeUnit(value){
  const raw=String(value||"").trim();
  const key=raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const map={
    hop:"Hộp",chai:"Chai",goi:"Gói",bich:"Bịch",tui:"Túi",
    lon:"Lon",hu:"Hũ",ly:"Ly",to:"Tô",can:"Can",thanh:"Thanh",cay:"Cây",
    vien:"Viên",tuyp:"Tuýp",khoanh:"Khoanh",thung:"Thùng",loc:"Lốc",
    combo:"Combo",bo:"Bộ"
  };
  return map[key]||raw;
}

function inferSheetPack(row){
  const nameTexts=[row.name,row.source_name]
    .map(value=>String(value||"").trim())
    .filter(Boolean);
  const primary=nameTexts[0]||"";
  const packaging=String(row.packaging||"").trim();

  const plainOf=value=>String(value||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const namePlain=plainOf(primary);
  const packagingPlain=plainOf(packaging);
  const nameRaw=String(primary||"").toLowerCase();
  const packagingRaw=String(packaging||"").toLowerCase();

  const kindPattern="thung|loc|tui|bich|chai|hop|goi|can|combo|bo|lon|hu|ly|to|khoanh|thanh|cay|vien|tuyp";
  const unitPattern="hop|chai|goi|bich|tui|lon|hu|ly|to|can|loc|khoanh|thanh|cay|vien|tuyp";
  // Accent-sensitive retail-unit detection avoids collisions such as
  // Vietnamese "lớn" -> "lon" after accent stripping.
  const rawUnitPattern="hộp|chai|gói|bịch|túi|lon|hũ|ly|tô|lốc|khoanh|thanh|cây|viên|tuýp|can";
  const rawUnitRe=new RegExp(
    "(?:^|[^\\p{L}\\p{N}])("+rawUnitPattern+")(?=$|[^\\p{L}\\p{N}])",
    "iu"
  );

  // Same priority as the Worker:
  // Thùng -> structural retail QC in name -> explicit retail unit in name
  // -> API packaging -> persisted fallback.
  const pureByName=/^thung\b/.test(namePlain);
  const pureByPackaging=!pureByName&&/^thung\b/.test(packagingPlain);
  const structuralPlain=pureByName
    ?namePlain
    :(pureByPackaging?packagingPlain:namePlain);

  const explicitKind=structuralPlain.match(new RegExp("^("+kindPattern+")\\b"));
  const body=explicitKind
    ?structuralPlain.slice(explicitKind[0].length).trimStart()
    :structuralPlain;

  const bonusMatch=body.match(
    new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s*\\+\\s*([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\b")
  );
  const bonusWithUnits=body.match(
    new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\s*\\+\\s*([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\b")
  );
  const countMatch=body.match(
    new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\b")
  );

  const nameUnit=nameRaw.match(rawUnitRe);
  const packagingUnit=packagingRaw.match(rawUnitRe);

  let qty=1;
  let unit="";
  let structuralCount=false;

  if(bonusMatch){
    const base=Number(String(bonusMatch[1]).replace(",","."));
    const bonus=Number(String(bonusMatch[2]).replace(",","."));
    if(base>0&&bonus>0&&base<=200&&bonus<=200&&(base+bonus)<=300){
      qty=base+bonus;
      unit=sheetNormalizeUnit(bonusMatch[3]);
      structuralCount=true;
    }
  }else if(bonusWithUnits){
    const base=Number(String(bonusWithUnits[1]).replace(",","."));
    const bonus=Number(String(bonusWithUnits[3]).replace(",","."));
    const unitA=sheetNormalizeUnit(bonusWithUnits[2]);
    const unitB=sheetNormalizeUnit(bonusWithUnits[4]);
    if(base>0&&bonus>0&&base<=200&&bonus<=200&&(base+bonus)<=300&&unitA===unitB){
      qty=base+bonus;
      unit=unitA;
      structuralCount=true;
    }
  }else if(countMatch){
    const parsed=Number(String(countMatch[1]).replace(",","."));
    if(parsed>0&&parsed<=300){
      qty=parsed;
      unit=sheetNormalizeUnit(countMatch[2]);
      structuralCount=true;
    }
  }

  if(!structuralCount){
    if(nameUnit){
      unit=sheetNormalizeUnit(nameUnit[1]);
    }else if(packagingUnit){
      unit=sheetNormalizeUnit(packagingUnit[1]);
    }else{
      unit=sheetNormalizeUnit(row.pack_unit||"");
    }

    const persisted=Number(row.pack_quantity);
    const persistedValid=Number.isFinite(persisted)&&persisted>0&&persisted<=300;
    qty=persistedValid?persisted:1;
  }

  let kind="";
  if(pureByName||pureByPackaging){
    kind="Thùng";
  }else if(explicitKind){
    kind=sheetNormalizeUnit(explicitKind[1]);
  }else if(structuralCount&&qty>1){
    kind="Cụm";
  }else if(unit){
    kind=unit;
  }else{
    const persistedKind=String(row.pack_kind||"").trim();
    kind=persistedKind&&!/^cụm$/i.test(persistedKind)
      ?persistedKind
      :"Đơn";
  }

  const sizeSource=[primary,packaging].filter(Boolean).join(" ");
  const sizeMatch=plainOf(sizeSource).match(/([0-9]+(?:[.,][0-9]+)?)\s*(ml|lit|l|kg|g)\b/);

  let sizeValue=0;
  let sizeUnit="";
  if(sizeMatch){
    sizeValue=Number(String(sizeMatch[1]).replace(",","."));
    sizeUnit=sizeMatch[2].toLowerCase();
    if(sizeUnit==="l"||sizeUnit==="lit"){
      sizeValue=Math.round(sizeValue*1000);
      sizeUnit="ml";
    }else if(sizeUnit==="kg"){
      sizeValue=Math.round(sizeValue*1000);
      sizeUnit="g";
    }
  }else{
    sizeValue=Number(row.size_value)||0;
    sizeUnit=String(row.size_unit||"");
  }

  return {
    qty,
    unit:unit||"đơn vị",
    kind:kind||"Đơn",
    sizeValue,
    sizeUnit
  };
}

function rowUrlIsCarton(row){
  try{
    const path=new URL(String(row&&row.canonical_url||"")).pathname
      .replace(/\/+$/,"")
      .toLowerCase();
    const slug=path.split("/").filter(Boolean).pop()||"";

    // BHX carton product URLs are commonly:
    //   /ca-phe-lon/thung-24-lon-ca-phe-sua-highlands-235ml
    // Older/imported URLs may also end with "-thung".
    // Treat only the product slug boundary as authoritative.
    return /^thung(?:-|$)/.test(slug)||/-thung$/.test(slug);
  }catch{
    return false;
  }
}

function rowCartonStartText(row){
  // A visible own field starting with "Thùng" is authoritative.
  const fields=[row.name,row.source_name,row.packaging]
    .map(searchKey)
    .filter(Boolean);
  const explicit=fields.find(value=>/^thung\b/.test(value));
  if(explicit)return explicit;

  // Some BHX category rows expose "24 lon ..." while the detail link is
  // the carton URL ending "-thung". Protect/classify that row as Thùng
  // until its detail payload is fetched.
  return rowUrlIsCarton(row)?"thung":"";
}

function rowCartonStructure(row){
  const names=[row.name,row.source_name].map(searchKey).filter(Boolean);
  const name=names[0]||"";
  const packaging=searchKey(row.packaging||"");
  const units="hop|chai|goi|bich|tui|lon|hu|ly|to|can|khoanh|thanh|cay|vien|tuyp|loc";

  // Pure carton priority:
  // 1) own text starts "Thùng"
  // 2) detail URL is the dedicated ...-thung URL
  // "2 thùng..." / "Combo..." remain multi-carton offers.
  const multiName=names
    .map(value=>value.match(/^(?:combo\s+)?([0-9]+(?:[.,][0-9]+)?)\s+thung\b/))
    .find(Boolean)||null;
  const nameIsCombo=names.some(value=>/^combo\b/.test(value));
  const cartonStart=rowCartonStartText(row);
  const pureByName=Boolean(cartonStart&&cartonStart!=="thung"&&names.includes(cartonStart));
  const pureByUrl=cartonStart==="thung"&&rowUrlIsCarton(row);
  const pureByPrice=!pureByName&&!pureByUrl&&!multiName&&!nameIsCombo&&/^thung\b/.test(packaging);
  const isPureCarton=pureByName||pureByUrl||pureByPrice;

  let cartonCount=1;
  if(multiName){
    cartonCount=Math.max(1,Number(String(multiName[1]).replace(",", "."))||1);
  }

  const innerText=pureByName
    ?cartonStart
    :(pureByPrice?packaging:name);
  const pureInner=innerText.match(
    new RegExp("^thung\\s+([0-9]+(?:[.,][0-9]+)?)\\s+("+units+")\\b")
  );
  const urlInner=pureByUrl
    ?name.match(new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s+("+units+")\\b"))
    :null;
  const multiInner=names
    .map(value=>value.match(
      new RegExp("^(?:combo\\s+)?[0-9]+(?:[.,][0-9]+)?\\s+thung\\s+([0-9]+(?:[.,][0-9]+)?)\\s+("+units+")\\b")
    ))
    .find(Boolean)||null;
  const inner=pureInner||urlInner||multiInner;

  return {
    isPureCarton,
    cartonCount,
    itemCount:inner?Math.max(1,Number(String(inner[1]).replace(",", "."))||1):0,
    itemUnit:inner?sheetNormalizeUnit(inner[2]):""
  };
}

function rowIsCarton(row){
  return rowCartonStructure(row).isPureCarton;
}

function rowHasMixedBundle(row){
  const name=searchKey(row.source_name||row.name||"");
  const units="thung|loc|tui|bich|chai|hop|goi|can|combo|bo|lon|hu|ly|to|khoanh|thanh|cay|vien|tuyp";
  // Only treat "và" as a mixed bundle when a SECOND explicit pack starts
  // after it, e.g. "24 lon ... và 24 lon ...". Normal product wording
  // such as "hương nhài trắng và tuyết tùng" must not trigger this.
  return new RegExp(
    "\\bva\\s+[0-9]+(?:[.,][0-9]+)?\\s+("+units+")\\b"
  ).test(name);
}

function simpleRowPrice(row){
  const rawName=String(row.source_name||row.name||"").trim();
  const inferred=inferSheetPack(row);
  const structure=rowCartonStructure(row);
  const hasCarton=structure.isPureCarton;
  const mixedBundle=!hasCarton&&rowHasMixedBundle(row);

  const ownPrice=Number(
    row.current_price||
    row.regular_pack_price||
    row.original_price||
    0
  );
  const rawPromo=Number(
    row.promo_pack_price||
    row.promotion_price||
    0
  );
  const promoOwn=(Number(row.has_promo||row.quantity_offer_active||row.promotion_active)>0&&
    rawPromo>0&&ownPrice>0&&rawPromo<ownPrice)
    ?rawPromo
    :0;

  // "Thùng xx chai/lon/..." = one carton.
  // "2 thùng..." / "Combo 5 thùng..." = multi-carton offer:
  // normalize current and promo prices to one carton for comparison.
  const hasCartonMath=hasCarton||structure.cartonCount>1;
  const cartonPrice=hasCartonMath&&ownPrice
    ?Math.round(ownPrice/Math.max(1,structure.cartonCount))
    :0;
  const promoCartonPrice=hasCartonMath&&promoOwn
    ?Math.round(promoOwn/Math.max(1,structure.cartonCount))
    :0;

  // Retail multi-packs are normalized to ONE retail unit.
  // Example: 6 lon = 139 => 23.167/lon.
  // Exception: "24 lon A và 24 lon B" is a mixed bundle, so there is no
  // single meaningful QC divisor; keep its raw link price for debugging.
  const retailDivisor=(!hasCartonMath&&!mixedBundle&&Number(inferred.qty)>1)
    ?Number(inferred.qty)
    :1;
  const retailPrice=hasCartonMath&&structure.itemCount>0&&cartonPrice
    ?Math.round(cartonPrice/structure.itemCount)
    :(!hasCartonMath
      ?Math.round(ownPrice/Math.max(1,retailDivisor))
      :0);
  const promoRetailPrice=hasCartonMath&&structure.itemCount>0&&promoCartonPrice
    ?Math.round(promoCartonPrice/structure.itemCount)
    :(!hasCartonMath&&promoOwn
      ?Math.round(promoOwn/Math.max(1,retailDivisor))
      :0);

  const cartonQty=hasCarton
    ?(structure.itemCount||Number(row.pack_quantity)||Number(inferred.qty)||1)
    :(structure.cartonCount>1?structure.cartonCount:0);
  const cartonUnit=hasCarton
    ?(structure.itemUnit||String(row.pack_unit||inferred.unit||"đơn vị").trim())
    :(structure.cartonCount>1?"Thùng":"");
  const retailUnit=structure.itemUnit||
    String(row.pack_unit||inferred.unit||"đơn vị").trim();

  const retailNormalized=
    !hasCartonMath&&
    !mixedBundle&&
    Number(inferred.qty)>1;

  // Once a non-Thùng QC>1 price has been divided to one retail unit,
  // the visible QC must also represent that normalized unit: QC = 1.
  // Thùng/multi-Thùng keep their real carton relationship.
  const displayQty=mixedBundle
    ?0
    :(hasCarton
      ?cartonQty
      :(structure.cartonCount>1
        ?structure.cartonCount
        :1));
  const displayUnit=mixedBundle
    ?""
    :(hasCarton
      ?cartonUnit
      :(structure.cartonCount>1
        ?"Thùng"
        :String(inferred.unit||row.pack_unit||"đơn vị").trim()));

  return {
    rawName:rawName||"Sản phẩm",
    hasCarton,
    hasPromo:Boolean(promoOwn),
    mixedBundle,
    retailNormalized,
    cartonCount:structure.cartonCount,
    cartonPrice,
    promoCartonPrice,
    cartonQty,
    cartonUnit:cartonUnit||"đơn vị",
    retailPrice,
    promoRetailPrice,
    retailUnit:retailUnit||"đơn vị",
    displayQty,
    displayUnit:displayUnit||"đơn vị"
  };
}

function xlsWebPrice(main,promo){
  return '<span class="xls-price-main">'+money(main)+'</span>'+
    (promo&&promo<main
      ?'<small class="xls-promo-note">ƯĐ '+money(promo)+'</small>'
      :'');
}

function capitalizeDisplayName(value){
  const text=String(value||"").trim();
  if(!text)return "Sản phẩm";
  return text.charAt(0).toLocaleUpperCase("vi-VN")+text.slice(1);
}

function retailDisplayName(row,simple){
  const raw=String(simple&&simple.rawName||row.source_name||row.name||"").trim();
  if(!raw)return "Sản phẩm";

  const shouldStrip=Boolean(
    simple&&
    simple.retailNormalized&&
    !simple.hasCarton&&
    !simple.mixedBundle
  );

  if(!shouldStrip)return capitalizeDisplayName(raw);

  const units="lốc|túi|bịch|chai|hộp|gói|can|lon|hũ|ly|tô|khoanh|thanh|cây|viên|tuýp";
  const cleaned=raw.replace(
    new RegExp("^(?:combo\\s+)?[0-9]+(?:[.,][0-9]+)?\\s*(?:"+units+")\\s+","iu"),
    ""
  ).trim();

  return capitalizeDisplayName(cleaned||raw);
}

function productCard(row){
  const simple=simpleRowPrice(row);
  const displayName=retailDisplayName(row,simple);
  const pref=String(row.preference_state||"normal");
  const mineCarton=simple.hasCarton
    ?readOwnPrice(row.canonical_url,"carton")
    :0;
  const mineRetail=readOwnPrice(row.canonical_url,"retail");
  const derivedRetail=simple.hasCarton&&simple.cartonQty>1&&mineCarton
    ?Math.round(mineCarton/simple.cartonQty)
    :0;
  const bargain=readOwnPrice(row.canonical_url,"bargain");

  return '<tr class="product-card xls-row '+(pref==="hidden"?"is-hidden ":"")+
    (canonical(selectedLibraryUrl)===canonical(row.canonical_url)?"selected ":"")+
    '" tabindex="0" '+
    'data-url="'+escapeAttr(row.canonical_url)+'" data-pack-kind="'+(simple.hasCarton?"Thùng":"Lẻ")+'" '+
    'data-pack-qty="'+(simple.cartonQty||0)+'" data-web-pack="'+simple.cartonPrice+'" data-web-unit="'+simple.retailPrice+'">'+
      '<td class="xls-name" title="'+escapeAttr(simple.rawName)+'">'+
        '<button class="xls-open-detail" type="button" data-url="'+escapeAttr(row.canonical_url)+'">'+escapeHtml(displayName)+'</button>'+
      '</td>'+
      '<td class="xls-qc xls-num-cell">'+
        (simple.displayQty>0
          ?'<span class="xls-qc-main">'+escapeHtml(simple.displayQty)+'</span>'
          :'<span class="xls-empty">—</span>')+
      '</td>'+
      '<td class="xls-unit">'+
        (simple.displayUnit
          ?escapeHtml(simple.displayUnit)
          :'<span class="xls-empty">—</span>')+
      '</td>'+
      '<td class="xls-num">'+xlsWebPrice(simple.cartonPrice,simple.promoCartonPrice)+'</td>'+
      '<td class="xls-num">'+xlsWebPrice(simple.retailPrice,simple.promoRetailPrice)+'</td>'+
      '<td>'+
        (simple.hasCarton
          ?'<input class="sheet-my-carton xls-input" inputmode="numeric" data-url="'+escapeAttr(row.canonical_url)+'" value="'+(mineCarton||"")+'" placeholder="—">'
          :'<span class="xls-empty">—</span>')+
      '</td>'+
      '<td>'+
        '<input class="sheet-my-retail xls-input" inputmode="numeric" data-url="'+escapeAttr(row.canonical_url)+'" value="'+(mineRetail||"")+'" placeholder="'+
          (derivedRetail?'≈ '+escapeAttr(money(derivedRetail)):'—')+'">'+
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

  host.innerHTML=
    '<button class="category-chip '+(!activeGroupUrl?"active":"")+'" data-group="" type="button">'+
      'Tất cả <small>'+libraryCache.filter(row=>String(row.preference_state||"normal")!=="hidden").length+'</small>'+
    '</button>'+
    libraryGroups.map(g=>
      '<button class="category-chip '+(activeGroupUrl===g.url?"active":"")+'" data-group="'+escapeAttr(g.url)+'" type="button">'+
        escapeHtml(g.name)+' <small>'+Number(g.product_count||0)+'</small>'+
      '</button>'
    ).join("");
}

function gridProductCard(row){
  const simple=simpleRowPrice(row);
  const displayName=retailDisplayName(row,simple);
  const price=simple.hasCarton
    ?(simple.promoCartonPrice||simple.cartonPrice)
    :(simple.promoRetailPrice||simple.retailPrice);
  const image=String(row.image||"").trim();
  const qc=simple.displayQty>0
    ?String(simple.displayQty)+" "+String(simple.displayUnit||"").trim()
    :String(simple.displayUnit||"").trim();
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
        '<button class="grid-product-name" type="button" data-url="'+escapeAttr(row.canonical_url)+'" title="'+escapeAttr(simple.rawName)+'">'+escapeHtml(displayName)+'</button>'+
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


function retailIdentity(row){
  const pack=inferSheetPack(row);
  const base=searchKey(normalizedBaseName(row));
  const unit=searchKey(pack.unit||"");
  const size=pack.sizeValue
    ?String(pack.sizeValue)+" "+String(pack.sizeUnit||"")
    :"";
  return [base,unit,size].join("|");
}

function suppressRedundantMultiPacks(products){
  // Keep source rows in D1 for debugging, but do not show an intermediate
  // multi-pack when the same exact product already has a real single-unit
  // row. Example: "6 lon Bia Heineken Silver 330ml" is redundant when
  // "Bia Heineken Silver lon 330ml" already exists.
  const singleKeys=new Set();

  for(const row of products){
    const pack=inferSheetPack(row);
    const simple=simpleRowPrice(row);
    const unit=String(pack.unit||"").trim().toLowerCase();
    const isRealSingle=
      !simple.hasCarton&&
      Number(pack.qty)===1&&
      unit&&unit!=="đơn vị"&&
      pack.kind!=="Combo"&&
      pack.kind!=="Bộ"&&
      pack.kind!=="Lốc";
    if(isRealSingle)singleKeys.add(retailIdentity(row));
  }

  return products.filter(row=>{
    // Hard safety gate: rows starting with "Thùng" are NEVER hidden by
    // redundant retail-pack cleanup.
    if(rowCartonStartText(row))return true;

    const pack=inferSheetPack(row);
    const simple=simpleRowPrice(row);
    const isIntermediateMulti=
      !simple.hasCarton&&
      pack.kind==="Cụm"&&
      Number(pack.qty)>1;
    if(!isIntermediateMulti)return true;
    return !singleKeys.has(retailIdentity(row));
  });
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

  // Suppress redundant 6-lon/10-bịch/... rows BEFORE text search so a
  // search for "6 lon" cannot bring back a row we intentionally hide.
  products=suppressRedundantMultiPacks(products);

  if(libraryQuery){
    products=products.filter(row=>matchesSearch(row,libraryQuery));
  }
  return products;
}

function renderPackTabs(){
  const host=$("#packTabs");
  if(!host)return;

  const base=visibleRowsBeforePack();
  const cartonCount=base.filter(row=>simpleRowPrice(row).hasCarton).length;
  const retailCount=base.length-cartonCount;
  const promoCount=base.filter(row=>simpleRowPrice(row).hasPromo).length;

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
    products=products.filter(row=>simpleRowPrice(row).hasCarton);
  }else if(activePackKind==="Lẻ"){
    products=products.filter(row=>!simpleRowPrice(row).hasCarton);
  }else if(activePackKind==="Ưu đãi"){
    products=products.filter(row=>simpleRowPrice(row).hasPromo);
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
    :"0 sản phẩm";

  $("#productGrid").innerHTML=visible.map(gridProductCard).join("");
  $("#libraryProducts").innerHTML=visible.map(productCard).join("");
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
  $("#libraryProducts").innerHTML='<tr class="catalog-loading-row"><td colspan="8">Đang đọc thư viện D1...</td></tr>';
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
  libraryPage=1;
  libraryQuery="";
  $("#librarySearch").value="";
  document.querySelectorAll(".category-chip").forEach(x=>x.classList.remove("active"));
  chip.classList.add("active");
  renderLibraryProducts();
});


$("#brandTabs").addEventListener("click",e=>{
  const chip=e.target.closest(".brand-chip");
  if(!chip)return;
  activeBrand=chip.dataset.brand||"";
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

  const priceInput=e.target.closest(".sheet-my-carton,.sheet-my-retail,.sheet-bargain");
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
  const retail=e.target.closest(".sheet-my-retail");
  const bargain=e.target.closest(".sheet-bargain");
  const input=carton||retail||bargain;
  if(!input)return;

  const type=carton?"carton":(retail?"retail":"bargain");
  writeOwnPrice(input.dataset.url||"",type,input.value);
  if(!bargain)updateSheetRow(input.closest(".product-card"));
});

$("#libraryProducts").addEventListener("keydown",e=>{
  if((e.key==="Enter"||e.key===" ")&&!e.target.closest(".pref-action")&&!e.target.closest(".sheet-my-carton,.sheet-my-retail,.sheet-bargain")){
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
        setJobStage("brightdata","Đang truy xuất dữ liệu từ Bách Hóa XANH...");
      }else if(data.status==="saving"){
        setJobStage("saving","Đã có response · đang chuẩn hóa và lưu vào D1...");
      }else if(data.status==="running"){
        setJobStage("brightdata","Đang xử lý response API Bách Hóa XANH...");
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

$("#get").addEventListener("click",async()=>{
  const url=$("#url").value.trim();

  if(!/^https?:\/\/(www\.)?bachhoaxanh\.com\//i.test(url)){
    setJobStage("error","Link chưa đúng bachhoaxanh.com.");
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
