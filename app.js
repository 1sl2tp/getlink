const $=s=>document.querySelector(s);
const API=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");
let wantedUrl="";
let requestId="";
let pollTimer=0;
let pollUntil=0;
let activeComparison=null;

function canonical(url){
  try{
    const u=new URL(url);
    return ("https://bachhoaxanh.com"+u.pathname.replace(/\/+$/,"")).toLowerCase();
  }catch{return ""}
}
function money(v){
  const n=Number(v||0);
  return n>0?n.toLocaleString("vi-VN")+"₫":"—";
}
function setStatus(text){$("#status").textContent=text}
function doneStatus(payload){
  if(payload&&payload.data_mode==="snapshot"){
    const d=String(payload.snapshot_date||"").split("-").reverse().join("/");
    return "Đã hiển thị giá snapshot BHX"+(d?" ngày "+d:"")+". Live BHX đang chặn kết nối server.";
  }
  return "Đã lấy xong và lưu link vào kho.";
}
function stopPolling(){if(pollTimer)clearInterval(pollTimer);pollTimer=0}
function clearPending(){
  requestId="";
  localStorage.removeItem("getlink:request-id");
}
function failPending(message){
  stopPolling();
  clearPending();
  setStatus(message);
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
function unitLabel(cmp){
  const u=String(cmp&&cmp.pack_unit||"đơn vị").trim().toLowerCase();
  return u||"đơn vị";
}
function updateCompare(){
  const cmp=activeComparison||{};
  const mine=Number($("#myPrice").value.replace(/\D/g,"")||0);
  const bundleQty=Math.max(.0001,Number(String($("#myPackQty").value||"1").replace(",","."))||1);
  const unitsPerPack=Math.max(.0001,Number(cmp.pack_quantity)||1);
  const webUnit=Number(cmp.promo_unit_price||cmp.regular_unit_price||$("#webPrice").dataset.unitValue||0);

  if(!mine){
    $("#myUnitPrice").textContent="";
    $("#compare").textContent="";
    return;
  }

  const myPack=mine/bundleQty;
  const myUnit=myPack/unitsPerPack;
  $("#myUnitPrice").textContent="≈ "+money(Math.round(myPack))+" / quy cách · "+money(Math.round(myUnit))+" / "+unitLabel(cmp);

  if(!webUnit){
    $("#compare").textContent="";
    return;
  }

  const d=webUnit-myUnit;
  $("#compare").textContent=Math.abs(d)<.5
    ?"Giá lẻ bằng nhau"
    :d>0
      ?"Giá lẻ BHX cao hơn của mình "+money(Math.round(d))+" / "+unitLabel(cmp)
      :"Giá lẻ của mình cao hơn BHX "+money(Math.round(Math.abs(d)))+" / "+unitLabel(cmp);
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
  $("#linkType").textContent="Link chi tiết";
  $("#source").textContent=(p.source&&p.source.name)||"Bách Hóa XANH";
  $("#name").textContent=p.name||"Sản phẩm";
  $("#group").textContent=p.group||"—";
  $("#branch").textContent=p.branch||"—";
  $("#packaging").textContent=(p.packaging&&p.packaging.text)||"—";

  const cmp=p.comparison||{};
  activeComparison=cmp;
  const web=Number(cmp.regular_pack_price||p.price&&p.price.current||0);
  $("#webPrice").dataset.value=String(web||"");
  $("#webPrice").dataset.unitValue=String(cmp.regular_unit_price||0);
  $("#webPrice").textContent=money(web);
  if(cmp.regular_unit_price){
    $("#webPrice").textContent+=" · "+money(cmp.regular_unit_price)+"/"+unitLabel(cmp);
  }

  const promo=p.promotion||{};
  const promoPack=Number(cmp.promo_pack_price||promo.price||0);
  $("#promoPrice").textContent=promoPack?money(promoPack):(cmp.promotion_active||promo.active?"Có ưu đãi":"—");
  if(cmp.promo_unit_price){
    $("#promoPrice").textContent+=" · "+money(cmp.promo_unit_price)+"/"+unitLabel(cmp);
  }
  $("#promoText").textContent=cmp.promotion_text||promo.text||"";
  $("#productLink").href=p.url||"#";
  restoreLocal(p.url||wantedUrl);

  if(variants.length){
    $("#productVariants").hidden=false;
    $("#variantCount").textContent=variants.length+" quy cách";
    $("#variantList").innerHTML=variants.map(v=>{
      const meta=v.variant||{};
      const cmp=v.comparison||{};
      const pack=(v.packaging&&v.packaging.text)||meta.title||"Quy cách";
      const size=cmp.size_value?(cmp.size_value+" "+cmp.size_unit):"";
      const kind=cmp.promotion_active?"ƯU ĐÃI":"THƯỜNG";
      const stock=meta.is_can_buy===false?"Hết hàng":(meta.stock?"Tồn "+meta.stock:"");
      const packPrice=cmp.promo_pack_price||cmp.regular_pack_price||(v.price&&v.price.current);
      const unitPrice=cmp.promo_unit_price||cmp.regular_unit_price;
      const href=escapeAttr(v.url||"#");
      return '<a class="child-row" href="'+href+'" target="_blank" rel="noopener">'+
        '<span><b>'+escapeHtml(pack)+'</b><small>'+escapeHtml([v.name,size,kind,stock].filter(Boolean).join(" · "))+'</small></span>'+
        '<span class="variant-price"><strong>'+money(packPrice)+'</strong>'+
        (unitPrice?'<small>≈ '+money(unitPrice)+' / '+escapeHtml(unitLabel(cmp))+'</small>':'')+
        '</span></a>';
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
  $("#linkType").textContent="Link nhóm";
  $("#source").textContent=(payload.source&&payload.source.name)||"Bách Hóa XANH";
  $("#name").textContent=payload.category_name||first.group||"Nhóm sản phẩm";
  $("#group").textContent=first.group||"—";
  $("#branch").textContent="—";
  $("#packaging").textContent=products.length+" link chi tiết";
  $("#productLink").href=payload.input_url||wantedUrl||"#";
  $("#childCount").textContent=products.length+" sản phẩm";
  $("#childList").innerHTML=products.length?products.map(p=>{
    const price=money(p&&p.price&&p.price.current);
    const title=escapeHtml(p.name||p.url||"Sản phẩm");
    const href=escapeAttr(p.url||"#");
    return '<a class="child-row" href="'+href+'" target="_blank" rel="noopener"><span>'+title+'</span><strong>'+price+'</strong></a>';
  }).join(""):'<div class="child-empty">Chưa phát hiện link chi tiết.</div>';
}
function escapeHtml(v){return String(v||"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]))}
function escapeAttr(v){return escapeHtml(v).replace(/'/g,"&#39;")}

function renderPayload(payload){
  if(!payload)return false;
  if(payload.input_type==="category"){
    renderCategory(payload);
    return true;
  }
  return renderProduct(payload);
}

async function pollOnce(){
  if(!API||!requestId)return false;
  try{
    const r=await fetch(API+"/api/result?id="+encodeURIComponent(requestId),{cache:"no-store"});
    const data=await r.json();
    if(!r.ok){
      failPending("GETLINK API lỗi "+r.status+". Bấm Lấy giá để thử lại.");
      return false;
    }
    if(data.status==="error"){
      const error=String(data.error||"");
      if(error.includes("brightdata_credentials_missing")){
        failPending("Chưa cấu hình Bright Data Browser API cho GETLINK.");
      }else{
        failPending("Chưa lấy được giá: "+(data.detail||data.error||"Browser proxy chưa bắt được API BHX."));
      }
      return false;
    }
    if(data.status!=="complete"){
      if(data.status==="queued")setStatus("Bright Data đang mở link và chờ API Bách Hóa XANH...");
      else if(data.status==="running")setStatus("Đang xử lý response API Bách Hóa XANH...");
      return false;
    }
    stopPolling();
    renderPayload(data.payload);
    if(Number(data.registry_count)>0)$("#registryCount").textContent="Kho link: "+data.registry_count;
    clearPending();
    setStatus(doneStatus(data.payload));
    return true;
  }catch{return false}
}
function startPolling(){
  stopPolling();
  pollUntil=Date.now()+240000;
  pollOnce();
  pollTimer=setInterval(async()=>{
    if(Date.now()>pollUntil){
      failPending("Chưa có response sau 4 phút. Bright Data có thể đang chờ mở khóa trang; bấm Lấy giá để thử lại.");
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
    setStatus("GETLINK Worker chưa được triển khai. Cần cấu hình Worker một lần trước khi dùng 1 nút.");
    return;
  }
  wantedUrl=url;
  $("#result").hidden=true;
  $("#get").disabled=true;
  setStatus("Đang gửi link sang Bright Data Browser API...");
  try{
    const r=await fetch(API+"/api/get-price",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({url})
    });
    const data=await r.json();
    if(!r.ok||!data.request_id)throw new Error(data.detail||data.error||"Không tạo được yêu cầu");
    requestId=data.request_id;
    localStorage.setItem("getlink:last-url",url);

    if(data.status==="complete"&&data.payload){
      renderPayload(data.payload);
      if(Number(data.registry_count)>0)$("#registryCount").textContent="Kho link: "+data.registry_count;
      clearPending();
      setStatus(data.cache_hit
        ?"Đã đọc từ kho D1 vì link này được lấy trong vòng 24 giờ."
        :doneStatus(data.payload));
      return;
    }

    localStorage.setItem("getlink:request-id",requestId);
    setStatus("Bright Data đang mở link và bắt GetProductDetail/GetCate...");
    startPolling();
  }catch(error){
    const message=String(error&&error.message||error);
    if(message.includes("brightdata_credentials_missing")){
      setStatus("Chưa cấu hình Bright Data Browser API.");
    }else{
      setStatus("Không lấy được giá: "+message);
    }
  }finally{
    $("#get").disabled=false;
  }
});

const saved=localStorage.getItem("getlink:last-url")||"";
if(saved)$("#url").value=saved;
requestId=localStorage.getItem("getlink:request-id")||"";
wantedUrl=saved;
if(requestId&&API){
  setStatus("Đang tiếp tục chờ kết quả Bright Data lần trước...");
  startPolling();
}
