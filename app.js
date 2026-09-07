const $=s=>document.querySelector(s);
const API=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");
let wantedUrl="";
let requestId="";
let pollTimer=0;
let pollUntil=0;

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
    watch:$("#watch").checked
  }));
}
function restoreLocal(url){
  try{
    const x=JSON.parse(localStorage.getItem("getlink:"+canonical(url))||"null");
    $("#myPrice").value=x&&x.myPrice||"";
    $("#watch").checked=Boolean(x&&x.watch);
  }catch{
    $("#myPrice").value="";
    $("#watch").checked=false;
  }
  updateCompare();
}
function updateCompare(){
  const web=Number($("#webPrice").dataset.value||0);
  const mine=Number($("#myPrice").value.replace(/\D/g,"")||0);
  if(!web||!mine){$("#compare").textContent="";return}
  const d=web-mine;
  $("#compare").textContent=d===0?"Giá bằng nhau":d>0
    ?"Giá web cao hơn giá của mình "+money(d)
    :"Giá của mình cao hơn giá web "+money(Math.abs(d));
}
$("#myPrice").addEventListener("input",()=>{saveLocal();updateCompare()});
$("#watch").addEventListener("change",saveLocal);

function renderProduct(p){
  if(!p)return false;
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
  const web=Number(p.price&&p.price.current||0);
  $("#webPrice").dataset.value=String(web||"");
  $("#webPrice").textContent=money(web);
  const promo=p.promotion||{};
  $("#promoPrice").textContent=promo.price?money(promo.price):(promo.active?"Có ưu đãi":"—");
  $("#promoText").textContent=promo.text||"";
  $("#productLink").href=p.url||"#";
  restoreLocal(p.url||wantedUrl);
  return true;
}

function renderCategory(payload){
  const products=Array.isArray(payload.products)?payload.products:[];
  const first=products[0]||{};
  $("#result").hidden=false;
  $("#priceGrid").hidden=true;
  $("#productPersonal").hidden=true;
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
  return renderProduct(payload.product||(Array.isArray(payload.products)?payload.products[0]:null));
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
      failPending("Chưa lấy được giá: "+(data.error||"Bách Hóa XANH không trả dữ liệu."));
      return false;
    }
    if(data.status!=="complete"){
      if(data.status==="queued")setStatus("Đã gửi yêu cầu. Đang chờ Bách Hóa XANH trả dữ liệu...");
      else if(data.status==="running")setStatus("Đang xử lý dữ liệu Bách Hóa XANH...");
      return false;
    }
    stopPolling();
    renderPayload(data.payload);
    if(Number(data.registry_count)>0)$("#registryCount").textContent="Kho link: "+data.registry_count;
    clearPending();
    setStatus("Đã lấy xong và lưu link vào kho.");
    return true;
  }catch{return false}
}
function startPolling(){
  stopPolling();
  pollUntil=Date.now()+240000;
  pollOnce();
  pollTimer=setInterval(async()=>{
    if(Date.now()>pollUntil){
      failPending("Chưa lấy được dữ liệu sau 90 giây. Bách Hóa XANH đang từ chối kết nối; bấm Lấy giá để thử lại.");
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
  setStatus("Đang gửi yêu cầu lấy giá...");
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
      setStatus("Đã lấy xong và lưu link vào kho.");
      return;
    }

    localStorage.setItem("getlink:request-id",requestId);
    if(data.engine==="github"){
      setStatus("Bách Hóa XANH chặn kết nối trực tiếp. Đã chuyển sang luồng dự phòng, đang chờ kết quả...");
    }else{
      setStatus(data.link_type==="category"?"Đang quét link nhóm...":"Đang lấy giá sản phẩm...");
    }
    startPolling();
  }catch(error){
    setStatus("Không gửi được yêu cầu: "+String(error&&error.message||error));
  }finally{
    $("#get").disabled=false;
  }
});

const saved=localStorage.getItem("getlink:last-url")||"";
if(saved)$("#url").value=saved;
requestId=localStorage.getItem("getlink:request-id")||"";
wantedUrl=saved;
if(requestId&&API){
  setStatus("Đang tiếp tục chờ kết quả lần trước...");
  startPolling();
}
