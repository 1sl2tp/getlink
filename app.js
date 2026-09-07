const $=s=>document.querySelector(s);
const API=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");

let wantedUrl="";
let requestId="";
let pollTimer=0;
let pollUntil=0;
let activeComparison=null;
let activeGroupUrl="";
let activeBrand="";
let activePackKind="";
let libraryQuery="";
let libraryCache=[];
let libraryLoaded=false;
let libraryState="visible";
let activePreferenceState="normal";

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
  return n>0?n.toLocaleString("vi-VN")+"₫":"—";
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
  const stored=String(row.base_name||"").trim();
  if(stored&&stored!==String(row.name||"").trim())return stored;

  const source=String(row.source_name||row.name||"").trim();
  if(!source)return "Sản phẩm";

  let value=source
    .replace(/^(thùng|lốc|cụm|combo|bộ)\s+/iu,"")
    .replace(/^\d+(?:[.,]\d+)?\s*\+\s*\d+(?:[.,]\d+)?\s*(hộp|chai|gói|bịch|túi|lon|hũ|thanh|cây|viên|tuýp|can)\s+/iu,"")
    .replace(/^\d+(?:[.,]\d+)?\s*(hộp|chai|gói|bịch|túi|lon|hũ|thanh|cây|viên|tuýp|can)\s+/iu,"")
    .replace(/\s+\d+(?:[.,]\d+)?\s*(ml|lít|lit|l|kg|g)\s*$/iu,"")
    .replace(/\s+(hộp|chai|gói|bịch|túi|lon|hũ|thanh|cây|viên|tuýp|can)\s*$/iu,"");

  const brand=String(row.brand_name||row.branch_name||"").trim();
  if(brand){
    value=value.replace(
      new RegExp("(^|\\s)"+escapeRegex(brand)+"(?=\\s|$)","iu"),
      " "
    );

    const tokens=brand.split(/\s+/).filter(Boolean).sort((a,b)=>b.length-a.length);
    for(const token of tokens){
      if(token.length<3&&!/^[A-ZĐ]{2,}$/u.test(token))continue;
      value=value.replace(
        new RegExp("(^|\\s)"+escapeRegex(token)+"(?=\\s|$)","giu"),
        " "
      );
    }
  }

  value=value
    .replace(/\s*[-–—·,]+\s*/g," ")
    .replace(/\s+/g," ")
    .trim();

  if(!value)value=source;
  return value.charAt(0).toUpperCase()+value.slice(1);
}

function packSortRank(kind){
  const ranks={
    "Thùng":1,"Lốc":2,"Cụm":3,"Combo":4,"Bộ":5,
    "Chai":6,"Lon":7,"Hộp":8,"Gói":9,"Bịch":10,
    "Túi":11,"Can":12,"Hũ":13,"Thanh":14,"Cây":15,
    "Viên":16,"Tuýp":17,"Đơn":90
  };
  return ranks[kind]||50;
}

function productSearchKey(row){
  const pack=inferSheetPack(row);
  return searchKey([
    normalizedBaseName(row),row.name,row.source_name,
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

function clearPending(){
  requestId="";
  localStorage.removeItem("getlink:request-id");
}

function failPending(message){
  stopPolling();
  clearPending();
  setGetBusy(false);
  setStatus(message);
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

async function updatePreference(url,state,refreshHours=6){
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
  renderLibraryProducts();
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

function renderProduct(payload){
  const p=payload&&payload.product?payload.product:payload;
  if(!p)return false;
  const variants=Array.isArray(payload&&payload.variants)?payload.variants:[];

  $("#result").hidden=false;
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

  const regular=Number(cmp.regular_pack_price||p.price&&p.price.original||p.price&&p.price.current||0);
  $("#webPrice").dataset.value=String(regular||"");
  $("#webPrice").dataset.unitValue=String(cmp.regular_unit_price||0);
  $("#webPrice").textContent=money(regular);
  if(cmp.regular_unit_price){
    $("#webPrice").textContent+=" · "+money(cmp.regular_unit_price)+"/"+unitLabel(cmp);
  }

  const promo=p.promotion||{};
  const promoPack=Number(cmp.promo_pack_price||promo.price||0);
  $("#promoPrice").textContent=promoPack
    ?money(promoPack)
    :(cmp.promotion_active||promo.active?"Có ưu đãi":"—");
  if(cmp.promo_unit_price){
    $("#promoPrice").textContent+=" · "+money(cmp.promo_unit_price)+"/"+unitLabel(cmp);
  }
  $("#promoText").textContent=cmp.promotion_text||promo.text||"";
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
  const webPack=Number(card.dataset.webPack)||0;
  const webUnit=Number(card.dataset.webUnit)||0;
  const cartonInput=card.querySelector(".sheet-my-carton");
  const retailInput=card.querySelector(".sheet-my-retail");
  const diffCell=card.querySelector(".sheet-diff");

  const mineCarton=cartonInput
    ?Number(String(cartonInput.value||"").replace(/\D/g,""))||0
    :0;
  const manualRetail=retailInput
    ?Number(String(retailInput.value||"").replace(/\D/g,""))||0
    :0;

  const canBorrowCartonQty=packKind==="Thùng"&&qty>1;
  const derivedRetail=canBorrowCartonQty&&mineCarton
    ?Math.round(mineCarton/qty)
    :0;
  const mineRetail=manualRetail||derivedRetail;

  if(retailInput){
    retailInput.placeholder=derivedRetail
      ?"≈ "+money(derivedRetail)+" từ thùng"
      :"Giá/Lẻ";
  }

  const lines=[];
  if(canBorrowCartonQty&&webPack&&mineCarton){
    lines.push("Thùng: "+sheetDiffText(webPack,mineCarton));
  }
  if(webUnit&&mineRetail){
    lines.push("Lẻ: "+sheetDiffText(webUnit,mineRetail));
  }

  if(diffCell){
    diffCell.innerHTML=lines.length
      ?lines.map(x=>'<span>'+escapeHtml(x)+'</span>').join("")
      :"—";
  }
}

function sheetNormalizeUnit(value){
  const raw=String(value||"").trim();
  const key=raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const map={
    hop:"Hộp",chai:"Chai",goi:"Gói",bich:"Bịch",tui:"Túi",
    lon:"Lon",hu:"Hũ",can:"Can",thanh:"Thanh",cay:"Cây",
    vien:"Viên",tuyp:"Tuýp",thung:"Thùng",loc:"Lốc",
    combo:"Combo",bo:"Bộ"
  };
  return map[key]||raw;
}

function inferSheetPack(row){
  const primary=String(row.source_name||row.name||"").trim();
  const packaging=String(row.packaging||"").trim();
  const source=primary||packaging;
  const plain=source.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();

  const kindPattern="thung|loc|tui|bich|chai|hop|goi|can|combo|bo|lon|hu|thanh|cay|vien|tuyp";
  const unitPattern="hop|chai|goi|bich|tui|lon|hu|can|thanh|cay|vien|tuyp";

  const explicitKind=plain.match(new RegExp("^("+kindPattern+")\\b"));
  const body=explicitKind
    ?plain.slice(explicitKind[0].length).trimStart()
    :plain;

  const bonusMatch=body.match(
    new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s*\\+\\s*([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\b")
  );
  const bonusWithUnits=body.match(
    new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\s*\\+\\s*([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\b")
  );
  const countMatch=body.match(
    new RegExp("^([0-9]+(?:[.,][0-9]+)?)\\s*("+unitPattern+")\\b")
  );
  const singleUnit=body.match(new RegExp("\\b("+unitPattern+")\\b"));
  const sizeMatch=plain.match(/([0-9]+(?:[.,][0-9]+)?)\s*(ml|lit|l|kg|g)\b/);

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

  if(!unit&&singleUnit){
    unit=sheetNormalizeUnit(singleUnit[1]);
  }

  // Only trust persisted quantity when the name itself does not provide
  // a readable single-unit grammar. This repairs old bad rows such as
  // "Bia Blanc 1664 lon 330ml" that were once stored as 1664 lon.
  if(!structuralCount){
    const persisted=Number(row.pack_quantity);
    const persistedValid=Number.isFinite(persisted)&&persisted>0&&persisted<=300;
    if(explicitKind&&persistedValid&&persisted>1){
      qty=persisted;
    }else{
      qty=1;
    }
  }

  let kind="";
  if(explicitKind){
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

function productCard(row){
  const hasPromo=Boolean(
    Number(row.promotion_active)||
    Number(row.has_promo)||
    Number(row.promotion_price)||
    String(row.promotion_text||"").trim()
  );
  const current=Number(row.current_price||0);
  const regularPack=Number(
    row.regular_pack_price||
    row.original_price||
    current||
    0
  );
  const promoPack=Number(
    row.promo_pack_price||
    (hasPromo?row.promotion_price||current:0)||
    0
  );
  const effectivePack=promoPack||current||regularPack;
  const inferred=inferSheetPack(row);
  const qty=inferred.qty;
  const unitName=inferred.unit;
  const webUnit=effectivePack
    ?Math.round(effectivePack/qty)
    :Number(row.promo_unit_price||row.regular_unit_price||row.unit_price||0);
  const packKind=inferred.kind;
  const size=inferred.sizeValue
    ?String(inferred.sizeValue)+" "+String(inferred.sizeUnit||"")
    :"—";
  const image=String(row.image||"");
  const pref=String(row.preference_state||"normal");
  const mineCarton=packKind==="Thùng"
    ?readOwnPrice(row.canonical_url,"carton")
    :0;
  const mineRetail=readOwnPrice(row.canonical_url,"retail");
  const derivedRetail=packKind==="Thùng"&&qty>1&&mineCarton
    ?Math.round(mineCarton/qty)
    :0;
  const effectiveMineRetail=mineRetail||derivedRetail;
  const initialDiff=[];
  if(packKind==="Thùng"&&effectivePack&&mineCarton){
    initialDiff.push("Thùng: "+sheetDiffText(effectivePack,mineCarton));
  }
  if(webUnit&&effectiveMineRetail){
    initialDiff.push("Lẻ: "+sheetDiffText(webUnit,effectiveMineRetail));
  }
  const thumb=image
    ?'<img src="'+escapeAttr(image)+'" alt="" loading="lazy">'
    :'<div class="thumb-fallback">GL</div>';

  const watchTitle=pref==="watch"?"Bỏ quan tâm":"Đánh dấu quan tâm";
  const watchNext=pref==="watch"?"normal":"watch";
  const hideTitle=pref==="hidden"?"Hiện lại":"Ẩn khỏi thư viện";
  const hideNext=pref==="hidden"?"normal":"hidden";

  return '<div class="product-card '+(pref==="hidden"?"is-hidden":"")+'" role="button" tabindex="0" '+
    'data-url="'+escapeAttr(row.canonical_url)+'" data-pack-kind="'+escapeAttr(packKind)+'" '+
    'data-pack-qty="'+qty+'" data-web-pack="'+effectivePack+'" data-web-unit="'+webUnit+'">'+
    '<div class="product-main">'+
      '<div class="product-thumb">'+thumb+'</div>'+
      '<div class="product-name-wrap">'+
        '<h3 title="'+escapeAttr(row.source_name||row.name||"")+'">'+escapeHtml(normalizedBaseName(row))+'</h3>'+
        '<div class="row-actions">'+
          '<button class="pref-action watch-action '+(pref==="watch"?"active":"")+'" data-state="'+watchNext+'" type="button" title="'+watchTitle+'">★</button>'+
          '<button class="pref-action hide-action '+(pref==="hidden"?"active":"")+'" data-state="'+hideNext+'" type="button" title="'+hideTitle+'">'+(pref==="hidden"?"↩":"⌫")+'</button>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="product-cell brand-cell">'+escapeHtml(row.brand_name||row.branch_name||"—")+'</div>'+
    '<div class="product-cell qc-kind"><strong>'+escapeHtml(packKind)+'</strong></div>'+
    '<div class="product-cell qc-count"><strong>'+qty+'</strong><small>'+escapeHtml(unitName)+'</small></div>'+
    '<div class="product-cell size-cell"><strong>'+escapeHtml(size)+'</strong></div>'+
    '<div class="product-cell bhx-pack"><strong>'+money(regularPack||effectivePack)+'</strong></div>'+
    '<div class="product-cell product-promo">'+
      (promoPack
        ?'<strong>'+money(promoPack)+'</strong>'+
          (regularPack&&regularPack!==promoPack?'<small>từ '+money(regularPack)+'</small>':'')
        :'<span>—</span>')+
    '</div>'+
    '<div class="product-cell bhx-unit"><strong>'+money(webUnit)+'</strong><small>/ '+escapeHtml(unitName)+'</small></div>'+
    '<div class="product-cell mine-pack-cell">'+
      (packKind==="Thùng"
        ?'<input class="sheet-my-carton" inputmode="numeric" data-url="'+escapeAttr(row.canonical_url)+'" '+
          'value="'+(mineCarton||"")+'" placeholder="Giá/Thùng">'
        :'<span class="not-comparable">—</span>')+
    '</div>'+
    '<div class="product-cell mine-retail-cell">'+
      '<input class="sheet-my-retail" inputmode="numeric" data-url="'+escapeAttr(row.canonical_url)+'" '+
        'value="'+(mineRetail||"")+'" placeholder="'+
          (derivedRetail?'≈ '+escapeAttr(money(derivedRetail))+' từ thùng':'Giá/Lẻ')+'">'+
    '</div>'+
    '<div class="product-cell sheet-diff">'+
      (initialDiff.length
        ?initialDiff.map(x=>'<span>'+escapeHtml(x)+'</span>').join("")
        :'—')+
    '</div>'+
  '</div>';
}

async function loadLibraryGroups(){
  if(!API)return;
  try{
    const r=await fetch(API+"/api/library?view=groups",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||"library_error");
    const groups=Array.isArray(data.groups)?data.groups:[];

    $("#categoryTabs").innerHTML=
      '<button class="category-chip '+(!activeGroupUrl?"active":"")+'" data-group="" type="button">Tất cả</button>'+
      groups.map(g=>
        '<button class="category-chip '+(activeGroupUrl===g.url?"active":"")+'" data-group="'+escapeAttr(g.url)+'" type="button">'+
          escapeHtml(g.name)+' <small>'+Number(g.product_count||0)+'</small>'+
        '</button>'
      ).join("");

    if(activeGroupUrl&&!groups.some(g=>g.url===activeGroupUrl)){
      activeGroupUrl="";
    }
  }catch{
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
  const counts=new Map();
  for(const row of base){
    const kind=inferSheetPack(row).kind||"Đơn";
    counts.set(kind,(counts.get(kind)||0)+1);
  }

  const kinds=[...counts.entries()].sort((a,b)=>{
    const rank=packSortRank(a[0])-packSortRank(b[0]);
    return rank||a[0].localeCompare(b[0],"vi");
  });

  if(!kinds.length){
    activePackKind="";
    host.hidden=true;
    host.innerHTML="";
    return;
  }

  if(activePackKind&&!counts.has(activePackKind))activePackKind="";
  host.hidden=false;
  host.innerHTML=
    '<button class="pack-chip '+(!activePackKind?"active":"")+'" data-pack="" type="button">Tất cả QC <small>'+base.length+'</small></button>'+
    kinds.map(([kind,count])=>
      '<button class="pack-chip '+(activePackKind===kind?"active":"")+'" data-pack="'+escapeAttr(kind)+'" type="button">'+
        escapeHtml(kind)+' <small>'+count+'</small>'+
      '</button>'
    ).join("");
}

function filteredLibraryProducts(){
  let products=visibleRowsBeforePack();

  if(activePackKind){
    products=products.filter(row=>inferSheetPack(row).kind===activePackKind);
  }

  products.sort((a,b)=>{
    const nameA=normalizedBaseName(a);
    const nameB=normalizedBaseName(b);
    let d=nameA.localeCompare(nameB,"vi");
    if(d)return d;

    d=String(a.brand_name||a.branch_name||"").localeCompare(
      String(b.brand_name||b.branch_name||""),"vi"
    );
    if(d)return d;

    const pa=inferSheetPack(a);
    const pb=inferSheetPack(b);
    d=packSortRank(pa.kind)-packSortRank(pb.kind);
    if(d)return d;
    d=Number(pa.qty||1)-Number(pb.qty||1);
    if(d)return d;
    return Number(pa.sizeValue||0)-Number(pb.sizeValue||0);
  });

  return products;
}


function renderBrandTabs(){
  const host=$("#brandTabs");
  if(!host)return;

  if(!activeGroupUrl){
    activeBrand="";
    host.hidden=true;
    host.innerHTML="";
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
    return;
  }

  if(activeBrand&&!counts.has(activeBrand))activeBrand="";
  host.hidden=false;
  host.innerHTML=
    '<button class="brand-chip '+(!activeBrand?"active":"")+'" data-brand="" type="button">Tất cả hãng <small>'+base.length+'</small></button>'+
    brands.map(([brand,count])=>
      '<button class="brand-chip '+(activeBrand===brand?"active":"")+'" data-brand="'+escapeAttr(brand)+'" type="button">'+
        escapeHtml(brand)+' <small>'+count+'</small>'+
      '</button>'
    ).join("");
}

function renderLibraryProducts(){
  renderBrandTabs();
  renderPackTabs();
  const products=filteredLibraryProducts();
  if(libraryQuery){
    $("#libraryTitle").textContent='Kết quả cho “'+libraryQuery+'”';
  }else if(activeGroupUrl){
    const chip=[...document.querySelectorAll(".category-chip")]
      .find(x=>x.dataset.group===activeGroupUrl);
    $("#libraryTitle").textContent=chip
      ?chip.textContent.replace(/\s+\d+$/,"").trim()
      :"Sản phẩm";
  }else{
    $("#libraryTitle").textContent=libraryState==="watch"
      ?"Sản phẩm quan tâm"
      :(libraryState==="hidden"?"Sản phẩm đang ẩn":"Tất cả sản phẩm đang dùng");
  }

  $("#libraryCount").textContent=products.length+" sản phẩm";
  $("#libraryProducts").innerHTML=products.map(productCard).join("");
  $("#libraryEmpty").hidden=products.length!==0;
  if(!products.length){
    $("#libraryEmpty").textContent=libraryQuery
      ?"Không có sản phẩm khớp tất cả từ đang tìm."
      :"Chưa có sản phẩm trong nhóm này.";
  }
}

async function loadLibraryProducts(force=false){
  if(!API)return;
  $("#libraryProducts").innerHTML='<div class="catalog-loading">Đang đọc thư viện D1...</div>';
  $("#libraryEmpty").hidden=true;
  try{
    await ensureLibraryCache(force);
    renderLibraryProducts();
  }catch{
    $("#libraryProducts").innerHTML="";
    $("#libraryCount").textContent="";
    $("#libraryEmpty").hidden=false;
    $("#libraryEmpty").textContent="Chưa đọc được thư viện giá.";
  }
}

async function openLibraryItem(url){
  if(!API||!url)return;
  const card=document.querySelector('.product-card[data-url="'+CSS.escape(url)+'"]');
  if(card)card.classList.add("loading");
  try{
    const r=await fetch(
      API+"/api/library?view=item&url="+encodeURIComponent(url),
      {cache:"no-store"}
    );
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||"not_found");
    wantedUrl=url;
    $("#url").value=url;
    renderPayload(data.payload);
    syncWatchCheckbox(data.preference&&data.preference.state||preferenceStateForUrl(url));
    $("#result").scrollIntoView({behavior:"smooth",block:"start"});
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
    activePackKind="";
    libraryQuery="";
    $("#librarySearch").value="";
  }
  libraryLoaded=false;
  await Promise.all([
    loadLibraryGroups(),
    loadLibraryProducts(true)
  ]);
}


$("#stateFilters").addEventListener("click",e=>{
  const chip=e.target.closest(".state-chip");
  if(!chip)return;
  libraryState=chip.dataset.state||"visible";
  document.querySelectorAll(".state-chip").forEach(x=>x.classList.remove("active"));
  chip.classList.add("active");
  renderLibraryProducts();
});

$("#categoryTabs").addEventListener("click",e=>{
  const chip=e.target.closest(".category-chip");
  if(!chip)return;
  activeGroupUrl=chip.dataset.group||"";
  activeBrand="";
  activePackKind="";
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
  activePackKind="";
  document.querySelectorAll(".brand-chip").forEach(x=>x.classList.remove("active"));
  chip.classList.add("active");
  renderLibraryProducts();
});


$("#packTabs").addEventListener("click",e=>{
  const chip=e.target.closest(".pack-chip");
  if(!chip)return;
  activePackKind=chip.dataset.pack||"";
  document.querySelectorAll(".pack-chip").forEach(x=>x.classList.remove("active"));
  chip.classList.add("active");
  renderLibraryProducts();
});

$("#librarySearch").addEventListener("input",e=>{
  libraryQuery=String(e.target.value||"").trim();
  renderLibraryProducts();
});

$("#libraryProducts").addEventListener("click",async e=>{
  const priceInput=e.target.closest(".sheet-my-carton,.sheet-my-retail");
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

  openLibraryItem(card.dataset.url||"");
});

$("#libraryProducts").addEventListener("input",e=>{
  const carton=e.target.closest(".sheet-my-carton");
  const retail=e.target.closest(".sheet-my-retail");
  const input=carton||retail;
  if(!input)return;

  writeOwnPrice(
    input.dataset.url||"",
    carton?"carton":"retail",
    input.value
  );
  updateSheetRow(input.closest(".product-card"));
});

$("#libraryProducts").addEventListener("keydown",e=>{
  if((e.key==="Enter"||e.key===" ")&&!e.target.closest(".pref-action")&&!e.target.closest(".sheet-my-carton,.sheet-my-retail")){
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
        (data.detail||data.error||"Bright Data chưa bắt được API BHX.")
      );
      return false;
    }

    if(data.status!=="complete"){
      if(data.status==="queued"){
        setStatus("Bright Data đang mở link và chờ API Bách Hóa XANH...");
      }else if(data.status==="running"){
        setStatus("Đang xử lý response API Bách Hóa XANH...");
      }
      return false;
    }

    stopPolling();
    renderPayload(data.payload);
    if(Number(data.registry_count)>0){
      $("#registryCount").textContent="Kho link: "+data.registry_count;
    }
    const finishedUrl=data.payload&&data.payload.input_url||wantedUrl;
    clearPending();
    setGetBusy(false);
    setStatus(doneStatus());
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
    setStatus("Link chưa đúng bachhoaxanh.com.");
    return;
  }
  if(!API){
    setStatus("GETLINK Worker chưa được triển khai.");
    return;
  }

  wantedUrl=url;
  setGetBusy(true);
  setStatus("Đang kiểm tra thư viện D1...");

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
      clearPending();
      setGetBusy(false);
      setStatus(
        data.cache_hit
          ?"Đã đọc ngay từ D1 vì link được lấy trong vòng 24 giờ."
          :doneStatus()
      );
      await refreshCatalog(url);
      return;
    }

    localStorage.setItem("getlink:request-id",requestId);
    setStatus("Chưa có dữ liệu mới trong 24 giờ. Bright Data đang cập nhật...");
    startPolling();
  }catch(error){
    setGetBusy(false);
    setStatus("Không lấy được giá: "+String(error&&error.message||error));
  }
});

const saved=localStorage.getItem("getlink:last-url")||"";
if(saved)$("#url").value=saved;
requestId=localStorage.getItem("getlink:request-id")||"";
wantedUrl=saved;

refreshCatalog();

if(requestId&&API){
  $("#importCard").hidden=false;
  setGetBusy(true);
  setStatus("Đang tiếp tục yêu cầu cập nhật trước...");
  startPolling();
}
