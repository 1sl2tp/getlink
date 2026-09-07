const $=s=>document.querySelector(s);
const WORKFLOW="https://github.com/1sl2tp/getlink/actions/workflows/scrape.yml";
let wantedUrl="";
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

async function checkLatest(){
  try{
    const r=await fetch("data/latest.json?ts="+Date.now(),{cache:"no-store"});
    if(!r.ok)return false;
    const data=await r.json();
    const p=data.product;
    if(!p)return false;
    if(wantedUrl&&canonical(p.url)!==canonical(wantedUrl))return false;
    renderProduct(p);
    setStatus("Đã lấy xong dữ liệu thật từ Bách Hóa XANH.");
    clearInterval(pollTimer);pollTimer=0;
    return true;
  }catch{return false}
}
function startPolling(){
  clearInterval(pollTimer);
  pollUntil=Date.now()+180000;
  checkLatest();
  pollTimer=setInterval(async()=>{
    if(Date.now()>pollUntil){
      clearInterval(pollTimer);pollTimer=0;
      setStatus("Chưa thấy kết quả mới. Kiểm tra GitHub Actions xem workflow đã chạy xong chưa.");
      return;
    }
    await checkLatest();
  },3000);
}

$("#get").addEventListener("click",async()=>{
  const url=$("#url").value.trim();
  if(!/^https?:\/\/(www\.)?bachhoaxanh\.com\//i.test(url)){
    setStatus("Link chưa đúng bachhoaxanh.com.");
    return;
  }
  wantedUrl=url;
  localStorage.setItem("getlink:last-url",url);
  try{await navigator.clipboard.writeText(url)}catch{}
  $("#steps").hidden=false;
  $("#result").hidden=true;
  setStatus("Đang chờ GitHub Actions lấy giá...");
  window.open(WORKFLOW,"_blank","noopener");
  startPolling();
});
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden&&wantedUrl)startPolling();
});

const saved=localStorage.getItem("getlink:last-url")||"";
if(saved)$("#url").value=saved;
checkLatest();
