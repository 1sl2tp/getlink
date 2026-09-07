const $=s=>document.querySelector(s);
const workflow="https://github.com/1sl2tp/getlink/actions/workflows/scrape.yml";
let allRows=[];

$("#openAction").addEventListener("click",async()=>{
  const url=$("#url").value.trim();
  if(!/^https?:\/\/(www\.)?bachhoaxanh\.com\//i.test(url)){
    $("#status").textContent="Vui lòng nhập link thuộc bachhoaxanh.com.";
    return;
  }
  localStorage.setItem("getlink:last-url",url);
  try{await navigator.clipboard.writeText(url);}catch{}
  $("#status").textContent="Đã lưu link. GitHub Actions sẽ mở ở tab mới; dán link vào ô URL rồi Run workflow.";
  window.open(workflow,"_blank","noopener");
});

const saved=localStorage.getItem("getlink:last-url");
if(saved)$("#url").value=saved;

$("#search").addEventListener("input",render);
$("#watchOnly").addEventListener("change",render);

function money(v){
  const n=Number(v);
  return Number.isFinite(n)&&n>0?n.toLocaleString("vi-VN")+"₫":"—";
}

function esc(x){
  return String(x??"").replace(/[&<>"']/g,m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function compare(p){
  const market=Number(p&&p.price&&p.price.current)||0;
  const mine=Number(p&&p.my_price)||0;
  if(!market||!mine)return {text:"—",cls:""};
  const d=market-mine;
  if(d===0)return {text:"Bằng nhau",cls:"same"};
  return {
    text:(d>0?"+":"−")+Math.abs(d).toLocaleString("vi-VN")+"₫",
    cls:d>0?"good":"bad"
  };
}

function promoText(p){
  const promo=p&&p.promotion?p.promotion:{};
  if(!promo.active)return "—";
  const price=promo.price?money(promo.price):"";
  const text=promo.text||"Có ưu đãi";
  return [price,text].filter(Boolean).join(" · ");
}

function render(){
  const q=$("#search").value.trim().toLowerCase();
  const watchOnly=$("#watchOnly").checked;
  const rows=allRows.filter(p=>{
    if(watchOnly&&!p.watch)return false;
    if(!q)return true;
    return [
      p&&p.source&&p.source.name,p.group,p.branch,p.name,p&&p.packaging&&p.packaging.text,p.short_name
    ].some(v=>String(v||"").toLowerCase().includes(q));
  });

  $("#count").textContent=allRows.length?rows.length+"/"+allRows.length+" sản phẩm":"";
  $("#tbody").innerHTML=rows.length?rows.map(p=>{
    const cmp=compare(p);
    const history=Array.isArray(p.history)?p.history.length:0;
    const when=p.last_checked_at?new Date(p.last_checked_at).toLocaleString("vi-VN"):"—";
    const image=p.image?'<img src="'+esc(p.image)+'" loading="lazy" alt="">':"";
    const shortName=p.short_name?'<small>'+esc(p.short_name)+'</small>':"";
    const original=p.price&&p.price.original?'<small class="old">'+money(p.price.original)+'</small>':"";
    return '<tr>'+
      '<td><span class="watch '+(p.watch?"on":"")+'">'+(p.watch?"● Theo dõi":"○")+'</span></td>'+
      '<td><span class="source">'+esc(p.source&&p.source.name||"")+'</span></td>'+
      '<td><b>'+esc(p.group||"—")+'</b><small>'+esc(p.branch||"")+'</small></td>'+
      '<td class="product-cell">'+image+'<div><a href="'+esc(p.url||"#")+'" target="_blank" rel="noopener">'+esc(p.name||"")+'</a>'+shortName+'</div></td>'+
      '<td>'+esc(p.packaging&&p.packaging.text||"—")+'</td>'+
      '<td><strong>'+money(p.price&&p.price.current)+'</strong>'+original+'</td>'+
      '<td class="promo">'+esc(promoText(p))+'</td>'+
      '<td><strong>'+money(p.my_price)+'</strong></td>'+
      '<td><span class="delta '+cmp.cls+'">'+esc(cmp.text)+'</span></td>'+
      '<td><span>'+esc(when)+'</span><small>'+history+' mốc giá</small></td>'+
    '</tr>';
  }).join(""):'<tr><td colspan="10" class="empty">Không có sản phẩm phù hợp.</td></tr>';
}

async function load(){
  try{
    const r=await fetch("data/products.json?ts="+Date.now(),{cache:"no-store"});
    if(!r.ok)throw new Error("Không đọc được dữ liệu");
    const d=await r.json();
    allRows=Array.isArray(d.products)?d.products:[];
    allRows.sort((a,b)=>String(a.group||"").localeCompare(String(b.group||""),"vi")||String(a.name||"").localeCompare(String(b.name||""),"vi"));
    render();
  }catch(error){
    $("#status").textContent="Chưa đọc được data/products.json.";
  }
}
load();
