const $=s=>document.querySelector(s);
const API=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");

let wantedUrl="";
let requestId="";
let pollTimer=0;
let pollUntil=0;
let activeComparison=null;
let activeGroupUrl="";
let libraryQuery="";
let libraryCache=[];
let libraryLoaded=false;

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

function productSearchKey(row){
  return searchKey([
    row.name,row.group_name,row.branch_name,row.packaging,row.canonical_url
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
    myPackQty:$("#myPackQty").value.trim(),
    watch:$("#watch").checked
  }));
}

function restoreLocal(url){
  try{
    const x=JSON.parse(localStorage.getItem("getlink:"+canonical(url))||"null");
    $("#myPrice").value=x&&x.myPrice||"";
    $("#myPackQty").value=x&&x.myPackQty||"1";
    $("#watch").checked=Boolean(x&&x.watch);
  }catch{
    $("#myPrice").value="";
    $("#myPackQty").value="1";
    $("#watch").checked=false;
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
$("#watch").addEventListener("change",saveLocal);

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

function productCard(row){
  const hasPromo=Boolean(
    Number(row.has_promo)||
    Number(row.promotion_price)||
    String(row.promotion_text||"").trim()
  );
  const current=Number(row.current_price||0);
  const promo=Number(row.promotion_price||0);
  const regular=Number(row.original_price||current||0);
  const sell=promo||current||regular;
  const unit=Number(row.unit_price||0);
  const image=String(row.image||"");
  const stamp=formatAge(row.last_checked_at||row.updated_at);
  const pack=String(row.packaging||"").trim();
  const badge=hasPromo
    ?'<span class="deal-badge">ƯU ĐÃI</span>'
    :'<span class="normal-badge">THƯỜNG</span>';
  const thumb=image
    ?'<img src="'+escapeAttr(image)+'" alt="" loading="lazy">'
    :'<div class="thumb-fallback">GL</div>';

  return '<button class="product-card" type="button" data-url="'+escapeAttr(row.canonical_url)+'">'+
    '<div class="product-main">'+
      '<div class="product-thumb">'+thumb+'</div>'+
      '<div class="product-name-wrap">'+badge+'<h3>'+escapeHtml(row.name||"Sản phẩm")+'</h3></div>'+
    '</div>'+
    '<div class="product-cell product-pack-cell" data-label="Quy cách">'+
      escapeHtml(pack||row.group_name||"—")+
    '</div>'+
    '<div class="product-cell product-regular" data-label="Giá thường">'+
      '<strong>'+money(regular||sell)+'</strong>'+
    '</div>'+
    '<div class="product-cell product-promo" data-label="Ưu đãi">'+
      (hasPromo
        ?'<strong>'+money(sell)+'</strong>'+
          (regular&&regular!==sell?'<small>giảm từ '+money(regular)+'</small>':'')
        :'<span>—</span>')+
    '</div>'+
    '<div class="product-cell product-unit" data-label="Giá lẻ">'+
      (unit?'<strong>'+money(unit)+'</strong><small>/ đơn vị</small>':'<span>—</span>')+
    '</div>'+
    '<div class="product-cell product-updated" data-label="Cập nhật">'+escapeHtml(stamp||"—")+'</div>'+
  '</button>';
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
  const r=await fetch(API+"/api/library?view=search&limit=2000",{cache:"no-store"});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"library_error");
  libraryCache=Array.isArray(data.products)?data.products:[];
  libraryLoaded=true;
}

function filteredLibraryProducts(){
  let products=libraryCache;
  if(libraryQuery){
    products=products.filter(row=>matchesSearch(row,libraryQuery));
  }else if(activeGroupUrl){
    products=products.filter(row=>row.parent_url===activeGroupUrl);
  }
  return products;
}

function renderLibraryProducts(){
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
    $("#libraryTitle").textContent="Tất cả sản phẩm đã lưu";
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
    libraryQuery="";
    $("#librarySearch").value="";
  }
  libraryLoaded=false;
  await Promise.all([
    loadLibraryGroups(),
    loadLibraryProducts(true)
  ]);
}

$("#categoryTabs").addEventListener("click",e=>{
  const chip=e.target.closest(".category-chip");
  if(!chip)return;
  activeGroupUrl=chip.dataset.group||"";
  libraryQuery="";
  $("#librarySearch").value="";
  document.querySelectorAll(".category-chip").forEach(x=>x.classList.remove("active"));
  chip.classList.add("active");
  renderLibraryProducts();
});

$("#librarySearch").addEventListener("input",e=>{
  libraryQuery=String(e.target.value||"").trim();
  renderLibraryProducts();
});

$("#libraryProducts").addEventListener("click",e=>{
  const card=e.target.closest(".product-card");
  if(!card)return;
  openLibraryItem(card.dataset.url||"");
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
  $("#get").disabled=true;
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
    setStatus("Không lấy được giá: "+String(error&&error.message||error));
  }finally{
    $("#get").disabled=false;
  }
});

const saved=localStorage.getItem("getlink:last-url")||"";
if(saved)$("#url").value=saved;
requestId=localStorage.getItem("getlink:request-id")||"";
wantedUrl=saved;

refreshCatalog();

if(requestId&&API){
  $("#importCard").hidden=false;
  setStatus("Đang tiếp tục yêu cầu cập nhật trước...");
  startPolling();
}
