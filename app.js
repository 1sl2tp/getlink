const $=s=>document.querySelector(s);
const API=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");
const API_KEY=String(window.GETLINK_API_KEY||"");

// One-time clean break from the legacy D1 browser state.
// Keep only the user's grid/table view preference; all GETLINK data/state
// starts fresh with the Supabase backend.
const STORAGE_BACKEND_VERSION="supabase-v1";
if(localStorage.getItem("getlink:backend-version")!==STORAGE_BACKEND_VERSION){
  const keepView=localStorage.getItem("getlink:view-mode");
  for(let i=localStorage.length-1;i>=0;i--){
    const key=localStorage.key(i);
    if(key&&key.startsWith("getlink:"))localStorage.removeItem(key);
  }
  if(keepView)localStorage.setItem("getlink:view-mode",keepView);
  localStorage.setItem("getlink:backend-version",STORAGE_BACKEND_VERSION);
}

function apiFetch(path,options={}){
  const headers=new Headers(options.headers||{});
  if(API_KEY)headers.set("apikey",API_KEY);
  return fetch(API+path,{...options,headers});
}

function openUiCacheDb(){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)){resolve(null);return;}
    const req=indexedDB.open("getlink-ui-cache",1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("cache"))db.createObjectStore("cache");
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
const UI_LIBRARY_CACHE_KEY="library-data-v2";
const UI_LIBRARY_CACHE_FALLBACK_KEYS=[];

async function readUiLibraryCache(){
  try{
    const db=await openUiCacheDb();
    if(!db)return null;
    const keys=[UI_LIBRARY_CACHE_KEY,...UI_LIBRARY_CACHE_FALLBACK_KEYS];
    for(const key of keys){
      const cached=await new Promise((resolve,reject)=>{
        const tx=db.transaction("cache","readonly");
        const req=tx.objectStore("cache").get(key);
        req.onsuccess=()=>resolve(req.result||null);
        req.onerror=()=>reject(req.error);
      });
      if(cached&&Array.isArray(cached.rows)&&cached.rows.length){
        if(key!==UI_LIBRARY_CACHE_KEY){
          // UI releases must not invalidate thousands of already-loaded rows.
          // Migrate the last compatible cache once and preserve its age so
          // stale-while-revalidate still behaves correctly.
          setTimeout(()=>writeUiLibraryCache(cached.rows,Number(cached.savedAt)||Date.now()),0);
        }
        return cached;
      }
    }
    return null;
  }catch{return null;}
}
async function writeUiLibraryCache(rows,savedAt=Date.now()){
  try{
    const db=await openUiCacheDb();
    if(!db)return;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("cache","readwrite");
      tx.objectStore("cache").put({savedAt,rows},UI_LIBRARY_CACHE_KEY);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  }catch{}
}
function persistUiLibraryCacheSoon(){
  const snapshot=libraryCache;
  if("requestIdleCallback" in window){
    requestIdleCallback(()=>writeUiLibraryCache(snapshot),{timeout:1000});
  }else{
    setTimeout(()=>writeUiLibraryCache(snapshot),0);
  }
}

let wantedUrl="";
let requestId="";
let pollTimer=0;
let pollUntil=0;
let jobStartedAt=Number(localStorage.getItem("getlink:request-started-at")||0);
let statusTimer=0;
let lastPollAt=0;
let activeComparison=null;
let activeRootGroup="";
let activeGroupUrl="";
let activeBrand="";
let activePackKind=localStorage.getItem("getlink:filter-pack")||"";
let activeSourceFilter=localStorage.getItem("getlink:filter-source")||"";
let tableSourceSort="";
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
let matchAuditActive=false;
let matchAuditLoaded=false;
let matchAuditData=null;
let sourceManagerCache=null;
let sourceManagerLoadedAt=0;
let sourceManagerKind="brand";
let sourceManagerSource="all";
let sourceManagerQuery="";
let sourceManagerLimit=200;
let sourceManagerManualKey="";
let sourceManagerManualDetail=null;
let libraryRenderVersion=0;
const browseRowsMemo=new Map();
let browseRowsMemoVersion=-1;
let categoryMenuRefreshToken=0;
let libraryByUrl=new Map();
let searchFrame=0;
let catalogObserver=null;
const viewRenderState={
  grid:{key:"",products:[],rendered:0},
  table:{key:"",products:[],rendered:0}
};
const productSearchWordsCache=new WeakMap();
const LOCAL_LIBRARY_CACHE_TTL=10*60*1000;
const CLASSIFICATION_CHECK_MS=4000;
let classificationVersion="";
let classificationCheckTimer=0;
let classificationRefreshBusy=false;

function rebuildLibraryIndex(){
  libraryByUrl=new Map();
  for(const row of libraryCache){
    const key=canonical(row&&row.canonical_url||"");
    if(key)libraryByUrl.set(key,row);
  }
}
function findLibraryRow(url){
  return libraryByUrl.get(canonical(url||""))||null;
}
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
    if(host==="sieuthi-go.vn"){
      return ("https://sieuthi-go.vn"+path).toLowerCase();
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
function watchIconSvg(active){
  return '<svg class="ui-icon ui-icon-heart" aria-hidden="true" viewBox="0 0 24 24" '+
    'fill="'+(active?"currentColor":"none")+'"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>';
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


function stripCartonPackPhrase(value){
  const mode=arguments[1]||"carton";
  let text=String(value||"").normalize("NFC").trim();
  if(!text)return "";
  const unit="(?:lốc|túi|hộp|chai|chia|lon|gói|bịch|khay|vỉ|ly|tô|bình|hũ|lọ|can|miếng|thanh|viên|cái|cây|bộ|đôi|tuýp|túyp)";
  const qty="\\d+(?:\\s*\\+\\s*\\d+)*(?![\\p{L}\\p{N}])";
  const cartonRe=new RegExp(
    "(^|\\s)(?:thùng|khay|vỉ)\\s+"+qty+
    "(?:\\s+"+unit+"(?:\\s+"+qty+"(?:\\s+"+unit+")?)?)?"+
    "(?:\\s*[x×](?=\\s*\\d)\\s*)?",
    "giu"
  );
  const middleRe=new RegExp(
    "(^|\\s)"+unit+"\\s+"+qty+
    "(?:\\s+"+unit+")?"+
    "(?:\\s*[x×](?=\\s*\\d)\\s*)?",
    "giu"
  );
  const re=mode==="middle"?middleRe:cartonRe;
  return text
    .replace(re," ")
    .replace(/\s{2,}/g," ")
    .trim();
}

function searchDisplayName(row){
  let text=String(
    row&&(
      row.source_name||
      row.name||
      row.source_raw_name
    )||""
  ).trim();

  const packaging=String(row&&row.packaging||"").trim();
  const packKey=searchKey(packaging);
  const isCarton=
    String(row&&row.pack_label_1||"").trim().toLowerCase()==="thùng"||
    /^thung(?:\s|$)/.test(packKey)||
    String(row&&row.pack_kind||"").trim().toLowerCase()==="carton";
  const isMiddle=!isCarton&&Boolean(
    String(row&&row.pack_label_2||"").trim()||
    /\d/.test(packaging)
  );

  if(isCarton)return stripCartonPackPhrase(text,"carton");
  if(isMiddle)return stripCartonPackPhrase(text,"middle");
  return text;
}

function productSearchKey(row){
  // Search exactly the normalized visible product name.
  // Pack words such as "Thùng 24 lon" belong to the Thùng/Lẻ filter + QC chip,
  // so they must not make a text search for "thùng" match the product.
  return searchKey(searchDisplayName(row));
}

function productSearchWords(row){
  let words=productSearchWordsCache.get(row);
  if(words)return words;
  words=productSearchKey(row).split(/\s+/).filter(Boolean);
  productSearchWordsCache.set(row,words);
  return words;
}

function searchTokens(query){
  return searchKey(query).split(/\s+/).filter(Boolean);
}

function matchesSearchTokens(row,tokens){
  if(!tokens.length)return true;
  const words=productSearchWords(row);
  const used=new Array(words.length).fill(false);
  let previousFound=-1;

  for(let ti=0;ti<tokens.length;ti++){
    const token=tokens[ti];
    let found=-1;

    // A 1-2 character token after another word is treated as the user
    // still typing the immediately following word: "fami c" -> "Fami Canxi".
    // This avoids false matches such as "tuong ot" -> "... Ottogi".
    if(token.length<=2&&ti>0){
      const i=previousFound+1;
      if(i<words.length&&!used[i]&&words[i].startsWith(token))found=i;
    }else{
      const next=tokens[ti+1]||"";
      const needsAdjacentPrefix=Boolean(next&&next.length<=2);
      for(let i=0;i<words.length;i++){
        if(used[i])continue;
        const ok=token.length<=2?words[i]===token:words[i].startsWith(token);
        if(!ok)continue;
        if(needsAdjacentPrefix){
          const j=i+1;
          if(j>=words.length||used[j]||!words[j].startsWith(next))continue;
        }
        found=i;
        break;
      }
    }

    if(found<0)return false;
    used[found]=true;
    previousFound=found;
  }
  return true;
}

function matchesSearch(row,query){
  const tokens=searchKey(query).split(/\s+/).filter(Boolean);
  if(!tokens.length)return true;
  const words=productSearchKey(row).split(/\s+/).filter(Boolean);
  const used=new Array(words.length).fill(false);
  let previousFound=-1;

  for(let ti=0;ti<tokens.length;ti++){
    const token=tokens[ti];
    let found=-1;

    if(token.length<=2&&ti>0){
      const i=previousFound+1;
      if(i<words.length&&!used[i]&&words[i].startsWith(token))found=i;
    }else{
      const next=tokens[ti+1]||"";
      const needsAdjacentPrefix=Boolean(next&&next.length<=2);
      for(let i=0;i<words.length;i++){
        if(used[i])continue;
        const ok=token.length<=2?words[i]===token:words[i].startsWith(token);
        if(!ok)continue;
        if(needsAdjacentPrefix){
          const j=i+1;
          if(j>=words.length||used[j]||!words[j].startsWith(next))continue;
        }
        found=i;
        break;
      }
    }

    if(found<0)return false;
    used[found]=true;
    previousFound=found;
  }
  return true;
}

function auditSourceKey(value){
  const key=searchKey(value||"");
  if(key.includes("bach hoa xanh")||key==="bhx")return "bhx";
  if(key.includes("winmart")||key==="wm")return "wm";
  return "";
}

function auditIsMilkItem(row){
  const key=searchKey([
    row&&row.raw_name,
    row&&row.name,
    row&&row.category,
    row&&row.group_name,
    row&&row.parent_url
  ].filter(Boolean).join(" "));
  return /(^|\s)sua(\s|$)/.test(key);
}

function auditQc(row){
  const parts=[];
  if(row&&row.pack_label_1){
    parts.push(String(row.pack_label_1)+" "+(Number(row.pack_qty_1)||1));
  }
  if(row&&row.pack_label_2){
    parts.push(String(row.pack_label_2)+" "+(Number(row.pack_qty_2)||1));
  }
  if(row&&row.pack_label_3){
    parts.push(String(row.pack_label_3)+" "+(Number(row.pack_qty_3)||1));
  }
  return parts.length?parts.join(" → "):"—";
}

function auditCode(row){
  return String(
    row&&(
      row.barcode||
      row.source_code||
      row.sku||
      row.source_product_id
    )||""
  ).trim()||"—";
}

function auditGroupTitle(items){
  const rows=items||[];
  const bhx=rows.find(row=>auditSourceKey(row.source_name)==="bhx");
  const first=bhx||rows[0]||{};
  const brand=String(first.brand||"").trim();
  const size=first.size_value
    ?String(first.size_value)+(first.size_unit||"")
    :"";
  return [brand,size].filter(Boolean).join(" · ")||
    String(first.raw_name||first.name||"Nhóm ứng viên");
}

function auditRowHtml(row){
  const source=auditSourceKey(row.source_name);
  const sourceLabel=source==="bhx"?"BHX":(source==="wm"?"WM":String(row.source_name||""));
  const sourceClass=source==="bhx"?" audit-source-bhx":" audit-source-wm";
  const price=Number(row.promotion_price||row.current_price||0);
  return '<div class="match-audit-row">'+
    '<span class="match-audit-source'+sourceClass+'">'+escapeHtml(sourceLabel)+'</span>'+
    '<div class="match-audit-name">'+
      '<strong>'+escapeHtml(row.raw_name||row.name||"—")+'</strong>'+
      '<small>'+escapeHtml([row.category,row.brand].filter(Boolean).join(" · "))+'</small>'+
    '</div>'+
    '<strong class="match-audit-price">'+money(price)+'</strong>'+
    '<span class="match-audit-qc">'+escapeHtml(auditQc(row))+'</span>'+
    '<span class="match-audit-code">'+escapeHtml(auditCode(row))+'</span>'+
  '</div>';
}

function renderMatchAudit(){
  const host=$("#matchAuditGroups");
  const summary=$("#matchAuditSummary");
  if(!host||!summary)return;

  const rawGroups=Array.isArray(matchAuditData&&matchAuditData.matches)
    ?matchAuditData.matches:[];
  const groups=[];
  const matchedUrls=new Set();

  for(const group of rawGroups){
    const items=(Array.isArray(group.items)?group.items:[])
      .filter(row=>{
        const source=auditSourceKey(row.source_name);
        return (source==="bhx"||source==="wm")&&auditIsMilkItem(row);
      });
    const sources=new Set(items.map(row=>auditSourceKey(row.source_name)).filter(Boolean));
    if(!sources.has("bhx")||!sources.has("wm"))continue;
    items.forEach(row=>matchedUrls.add(canonical(row.link_url||"")));
    groups.push({...group,items});
  }

  const milkRows=libraryCache.filter(row=>{
    const source=auditSourceKey(row.source);
    return (source==="bhx"||source==="wm")&&auditIsMilkItem({
      ...row,
      raw_name:row.source_raw_name||row.name,
      category:row.group_name
    });
  });
  const standalone=milkRows.filter(row=>!matchedUrls.has(canonical(row.canonical_url))).length;
  const sure=groups.filter(group=>group.match_basis==="barcode").length;
  const candidates=groups.length-sure;

  summary.textContent=
    groups.length+" nhóm · Chắc "+sure+
    " · Ứng viên "+candidates+
    " · Đứng riêng "+standalone;

  if(!groups.length){
    host.innerHTML='<div class="match-audit-empty">Chưa có nhóm Sữa BHX ↔ WinMart đủ điều kiện ghép thử.</div>';
    return;
  }

  host.innerHTML=groups.map((group,index)=>{
    const basis=group.match_basis==="barcode"?"Barcode":"Brand + size + tên";
    const badge=group.match_basis==="barcode"?"Chắc":"Ứng viên";
    return '<article class="match-audit-group">'+
      '<div class="match-audit-group-head">'+
        '<div><strong>'+escapeHtml(auditGroupTitle(group.items))+'</strong>'+
        '<small>Nhóm '+(index+1)+' · '+escapeHtml(basis)+'</small></div>'+
        '<span class="match-audit-badge '+(group.match_basis==="barcode"?"sure":"candidate")+'">'+badge+'</span>'+
      '</div>'+
      '<div class="match-audit-columns" aria-hidden="true">'+
        '<span>Nguồn</span><span>Tên gốc</span><span>Giá</span><span>Quy cách</span><span>Barcode / code</span>'+
      '</div>'+
      group.items.map(auditRowHtml).join("")+
    '</article>';
  }).join("");
}

async function loadMatchAudit(force=false){
  if(!API)return;
  if(matchAuditLoaded&&!force){
    renderMatchAudit();
    return;
  }
  $("#matchAuditGroups").innerHTML='<div class="match-audit-empty">Đang đọc nhóm ghép thử...</div>';
  $("#matchAuditSummary").textContent="";
  try{
    await ensureLibraryCache(false);
    const r=await apiFetch("/api/library?view=matches",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||"match_audit_error");
    matchAuditData=data;
    matchAuditLoaded=true;
    renderMatchAudit();
  }catch{
    $("#matchAuditGroups").innerHTML='<div class="match-audit-empty">Chưa đọc được dữ liệu ghép thử.</div>';
  }
}

function syncMatchAuditMode(){
  const audit=$("#matchAudit");
  const grid=$("#productGrid");
  const table=$("#tableView");
  const empty=$("#libraryEmpty");
  const toggle=$("#toggleMatchAudit");
  if(audit)audit.hidden=!matchAuditActive;
  if(grid)grid.hidden=matchAuditActive||libraryView!=="grid";
  if(table)table.hidden=matchAuditActive||libraryView!=="table";
  if(empty&&matchAuditActive)empty.hidden=true;
  if(toggle){
    toggle.classList.toggle("active",matchAuditActive);
    toggle.setAttribute("aria-pressed",matchAuditActive?"true":"false");
    toggle.textContent=matchAuditActive?"Quay lại danh sách":"Ghép thử Sữa";
  }
  document.querySelectorAll(".view-switch .view-button").forEach(button=>{
    button.disabled=matchAuditActive;
  });
}

function setStatus(text){
  $("#status").textContent=text;
}

function progressLabel(stage){
  return ({
    idle:"Sẵn sàng",
    checking:"Kiểm tra Supabase",
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
function detailPriceContext(p,cmp,totalPrice,unitPrice){
  const h=p&&p.hierarchy||{};
  let qty=0,label="";
  if(String(h.label1||"").trim()==="Thùng"){
    if(h.label2&&Number(h.qty2)>1){
      qty=Number(h.qty2); label=String(h.label2);
    }else if(h.label3&&Number(h.qty3)>1){
      qty=Number(h.qty3); label=String(h.label3);
    }
  }
  if(!qty)qty=Math.max(1,Number(cmp&&cmp.pack_quantity)||1);
  if(!label){
    const fallback=String(cmp&&cmp.pack_unit||"").trim();
    if(fallback&&!/^thùng$/i.test(fallback))label=fallback;
  }
  const unit=String(label||"đơn vị").trim().toLocaleLowerCase("vi-VN");
  const each=Number(unitPrice||0)||(Number(totalPrice||0)>0&&qty>1?Number(totalPrice)/qty:0);
  const parts=[];
  if(each>0)parts.push(money(each)+" / "+unit);
  if(qty>1)parts.push(qty+" "+unit+"/thùng");
  return parts.join(" · ");
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
  const row=libraryByUrl.get(key);
  return row&&row.preference_state||"normal";
}

function syncWatchCheckbox(state){
  activePreferenceState=state||"normal";
  $("#watch").checked=activePreferenceState==="watch";
}

async function updatePreference(url,state,refreshHours=6,rerender=true){
  const r=await apiFetch("/api/preference",{
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
  const row=libraryByUrl.get(key);
  if(row){
    row.preference_state=data.preference&&data.preference.state||state;
    row.auto_refresh=Number(data.preference&&data.preference.auto_refresh||0);
    row.refresh_hours=Number(data.preference&&data.preference.refresh_hours||24);
  }
  if(canonical(wantedUrl)===key){
    syncWatchCheckbox(data.preference&&data.preference.state||state);
  }
  persistUiLibraryCacheSoon();
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

function openImageZoom(src,alt=""){
  const modal=$("#imageZoom");
  const target=$("#imageZoomTarget");
  if(!modal||!target||!src)return;
  target.src=src;
  target.alt=alt||"Ảnh sản phẩm";
  modal.hidden=false;
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("image-zoom-open");
}

function closeImageZoom(){
  const modal=$("#imageZoom");
  const target=$("#imageZoomTarget");
  if(!modal||!target)return;
  modal.hidden=true;
  modal.setAttribute("aria-hidden","true");
  target.removeAttribute("src");
  target.alt="";
  document.body.classList.remove("image-zoom-open");
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
  const detailSourceClass=sourceDisplayClass({
    source:p.source&&p.source.name,
    source_name:p.source&&p.source.name,
    canonical_url:p.url||payload.input_url||""
  }).trim();
  $("#result").classList.remove("source-bhx","source-winmart","source-go");
  if(detailSourceClass)$("#result").classList.add(detailSourceClass);
  $("#name").textContent=compactCartonDisplayName(p.name||"Sản phẩm",p.hierarchy||{});
  $("#group").textContent=displayCategoryLabel(p.group)||"—";
  $("#branch").textContent=p.branch||"—";
  $("#packaging").textContent=productHierarchyText(p);

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
  $("#webPriceNote").textContent=detailPriceContext(p,cmp,currentBhx,currentUnit);

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
  $("#name").textContent=displayCategoryLabel(payload.category_name||first.group)||"Nhóm sản phẩm";
  $("#group").textContent=displayCategoryLabel(first.group)||"—";
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

function detailSizeForUrl(url){
  const key=canonical(url||"");
  const row=libraryByUrl.get(key);
  if(!row||!row.size_value)return "—";
  const h=rowPackHierarchy(row);
  const leaf=String(h.label3||"").trim();
  const base=String(row.size_value)+" "+String(row.size_unit||"").trim();
  return leaf?base+" / "+leaf.toLowerCase():base;
}

function detailGroupForUrl(url){
  const key=canonical(url||"");
  const row=libraryByUrl.get(key);
  if(!row)return "";
  const root=rowRootGroup(row);
  const child=rowChildGroup(row);
  return [root,child].filter(Boolean).join(" › ");
}

function syncDetailCategoryLabel(url){
  const host=$("#detailCategoryLabel");
  if(!host)return;
  const key=canonical(url||"");
  const row=libraryByUrl.get(key);
  const label=row?rowManualGroupName(row):activeManualGroupName();
  host.textContent=label||"Tất cả";
}

function sourceObjectFromRow(row){
  if(isWinmartRow(row))return {key:"winmart",name:"WinMart",host:"winmart.vn"};
  if(isGoRow(row))return {key:"go",name:"GO!",host:"sieuthi-go.vn"};
  return {key:"bachhoaxanh",name:"Bách Hóa XANH",host:"bachhoaxanh.com"};
}

function payloadFromLibraryRow(row){
  if(!row)return null;
  const h=rowPackHierarchy(row);
  const cmp={
    pack_kind:row.pack_kind||"",
    pack_quantity:Number(row.pack_quantity)||1,
    pack_unit:row.pack_unit||"",
    size_value:row.size_value??null,
    size_unit:row.size_unit||"",
    regular_pack_price:row.regular_pack_price??row.current_price??null,
    promo_pack_price:row.promo_pack_price??null,
    regular_unit_price:row.regular_unit_price??null,
    promo_unit_price:row.promo_unit_price??null,
    promotion_active:Boolean(Number(row.promotion_active||row.has_promo||0))
  };
  const source=sourceObjectFromRow(row);
  const product={
    source,
    group:rowRootGroup(row)||row.group_name||"",
    branch:rowCanonicalBrand(row),
    name:row.source_name||row.name||"Sản phẩm",
    packaging:{text:row.packaging||""},
    hierarchy:h,
    comparison:cmp,
    price:{
      current:Number(row.current_price||row.regular_pack_price||0)||null,
      original:Number(row.original_price||0)||null
    },
    promotion:{
      active:Boolean(Number(row.promotion_active||row.has_promo||0)),
      price:Number(row.promotion_price||0)||null,
      text:row.promotion_text||""
    },
    url:row.canonical_url||"",
    image:row.image||"",
    breadcrumbs:[rowRootGroup(row),rowChildGroup(row),row.brand_name||row.branch_name||""].filter(Boolean),
    source_identity:{
      source_product_id:row.source_product_id||"",
      source_code:row.source_code||"",
      barcode:row.barcode||"",
      sku:row.sku||"",
      brand:row.brand_name||row.branch_name||"",
      category:row.source_category_name||row.group_name||"",
      raw_name:row.source_raw_name||row.name||"",
      raw_description:row.source_raw_description||"",
      bhx_group_name:row.bhx_group_name||"",
      bhx_brand_name:row.bhx_brand_name||"",
      bhx_match_url:row.bhx_match_url||"",
      bhx_match_name:row.bhx_match_name||""
    },
    last_checked_at:row.last_checked_at||row.updated_at||""
  };
  return {
    schema_version:20,
    request_id:row.last_request_id||"",
    input_url:product.url,
    input_type:"product",
    source,
    checked_at:product.last_checked_at,
    category_name:product.group,
    product,
    products:[product],
    variants:[],
    discovered_links:[product.url]
  };
}

function libraryRowFromProduct(p,previous=null){
  if(!p||!p.url)return null;
  const h=p.hierarchy||{};
  const cmp=p.comparison||{};
  const source=p.source&&p.source.name||previous&&previous.source||"Bách Hóa XANH";
  const isWin=String(source).toLowerCase().includes("winmart");
  const current=Number(p.price&&p.price.current||cmp.regular_pack_price||0)||null;
  const isCarton=Boolean(h.label1);
  const isMiddle=!isCarton&&Boolean(h.label2);
  return {
    ...(previous||{}),
    canonical_url:p.url,
    source,
    source_name:p.name||"",
    name:p.name||"",
    group_name:p.group||"",
    branch_name:p.branch||"",
    brand_name:p.branch||"",
    bhx_group_name:p.source_identity&&p.source_identity.bhx_group_name||previous&&previous.bhx_group_name||"",
    bhx_brand_name:p.source_identity&&p.source_identity.bhx_brand_name||previous&&previous.bhx_brand_name||"",
    packaging:p.packaging&&p.packaging.text||"",
    current_price:current,
    original_price:Number(p.price&&p.price.original||0)||null,
    promotion_price:Number(p.promotion&&p.promotion.price||0)||null,
    promotion_text:p.promotion&&p.promotion.text||"",
    last_checked_at:p.last_checked_at||"",
    updated_at:p.last_checked_at||"",
    preference_state:previous&&previous.preference_state||"normal",
    auto_refresh:Number(previous&&previous.auto_refresh||0),
    refresh_hours:Number(previous&&previous.refresh_hours||24),
    image:p.image||"",
    pack_kind:cmp.pack_kind||"",
    pack_quantity:Number(cmp.pack_quantity)||1,
    pack_unit:cmp.pack_unit||"",
    size_value:cmp.size_value??null,
    size_unit:cmp.size_unit||"",
    regular_pack_price:cmp.regular_pack_price??current,
    promo_pack_price:cmp.promo_pack_price??null,
    regular_unit_price:cmp.regular_unit_price??null,
    promo_unit_price:cmp.promo_unit_price??null,
    promotion_active:cmp.promotion_active?1:0,
    has_promo:cmp.promotion_active?1:0,
    pack_label_1:h.label1||"",
    pack_qty_1:Number(h.qty1)||0,
    pack_label_2:h.label2||"",
    pack_qty_2:Number(h.qty2)||0,
    pack_label_3:h.label3||"",
    pack_qty_3:Number(h.qty3)||0,
    pack_evidence:h.evidence||"",
    hierarchy_locked:h.locked?1:0,
    source_product_id:p.source_identity&&p.source_identity.source_product_id||"",
    source_code:p.source_identity&&p.source_identity.source_code||"",
    barcode:p.source_identity&&p.source_identity.barcode||"",
    sku:p.source_identity&&p.source_identity.sku||"",
    source_raw_name:p.source_identity&&p.source_identity.raw_name||p.name||"",
    source_raw_description:p.source_identity&&p.source_identity.raw_description||"",
    source_category_name:p.source_identity&&p.source_identity.category||p.group||"",
    source_root_name:isWin?(p.group||""):"",
    web_carton_price:!isWin&&isCarton?current:null,
    promo_carton_price:null,
    web_middle_price:!isWin&&isMiddle?current:null,
    promo_middle_price:null,
    web_leaf_price:!isWin&&!isCarton&&!isMiddle?current:null,
    promo_leaf_price:null,
    unit_price:cmp.promo_unit_price||cmp.regular_unit_price||null
  };
}

function mergePayloadIntoLibraryCache(payload){
  const products=Array.isArray(payload&&payload.products)?payload.products:[];
  if(!products.length)return;
  const map=new Map(libraryCache.map(row=>[canonical(row.canonical_url),row]));
  for(const p of products){
    const key=canonical(p&&p.url||"");
    if(!key)continue;
    const row=libraryRowFromProduct(p,map.get(key)||null);
    if(row)map.set(key,row);
  }
  libraryCache=[...map.values()];
  libraryLoaded=true;
  libraryRenderVersion+=1;
  rebuildLibraryIndex();
  for(const state of Object.values(viewRenderState)){
    state.key="";
    state.products=[];
    state.rendered=0;
  }
  persistUiLibraryCacheSoon();
  const registry=$("#registryCount");
  if(registry)registry.textContent="Kho link: "+libraryCache.length;
  renderCategoryMenu();
  renderLibraryProducts();
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

function winmartDisplayPack(row){
  const raw=String(row&&row.packaging||"").trim();
  if(!raw)return {kind:"",label:""};

  const plain=raw
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/đ/gi,"d")
    .toLowerCase();

  // Display-only classification. Raw WinMart data in D1 stays untouched:
  // THÙNG... -> Thùng
  // no digit   -> Lẻ
  // has digit  -> Giữa
  if(/^thung\b/.test(plain)){
    return {kind:"carton",label:raw};
  }
  if(/\d/.test(raw)){
    return {kind:"middle",label:raw};
  }
  return {kind:"leaf",label:raw};
}

function rowPackHierarchy(row){
  const stored={
    label1:String(row&&row.pack_label_1||"").trim(),
    qty1:Number(row&&row.pack_qty_1)||0,
    label2:String(row&&row.pack_label_2||"").trim(),
    qty2:Number(row&&row.pack_qty_2)||0,
    label3:String(row&&row.pack_label_3||"").trim(),
    qty3:Number(row&&row.pack_qty_3)||0,
    evidence:String(row&&row.pack_evidence||"").trim(),
    locked:Number(row&&row.hierarchy_locked||0)>0
  };
  if(stored.label1||stored.label2||stored.label3)return stored;

  if(isWinmartRow(row)){
    const wm=winmartDisplayPack(row);
    return {
      label1:wm.kind==="carton"?"Thùng":"",
      qty1:wm.kind==="carton"?1:0,
      label2:wm.kind==="middle"?wm.label:"",
      qty2:0,
      label3:wm.kind==="leaf"?wm.label:"",
      qty3:wm.kind==="leaf"?1:0,
      evidence:wm.kind?"winmart-fallback":"",
      locked:false
    };
  }
  return stored;
}

function rowIsCarton(row){
  return rowPackHierarchy(row).label1==="Thùng";
}

function rowIsRetail(row){
  return !rowIsCarton(row);
}

function rowPriceLevels(row){
  const h=rowPackHierarchy(row);
  const wm=isWinmartRow(row);
  const wmPrice=Number(row.current_price||row.regular_pack_price||0);
  const carton=wm&&h.label1?wmPrice:Number(row.web_carton_price||0);
  const middle=wm&&h.label2?wmPrice:Number(row.web_middle_price||0);
  const leaf=wm&&h.label3?wmPrice:Number(row.web_leaf_price||0);
  const promoCarton=wm?0:Number(row.promo_carton_price||0);
  const promoMiddle=wm?0:Number(row.promo_middle_price||0);
  const promoLeaf=wm?0:Number(row.promo_leaf_price||0);

  const hasPromo=Boolean(
    (promoCarton>0&&carton>0&&promoCarton<carton)||
    (promoMiddle>0&&middle>0&&promoMiddle<middle)||
    (promoLeaf>0&&leaf>0&&promoLeaf<leaf)||
    Number(row.has_promo||row.promotion_active||0)>0
  );

  return {
    rawName:String(row.source_name||row.name||"Sản phẩm").trim()||"Sản phẩm",
    hierarchy:h,
    hasCarton:wm?Boolean(h.label1):h.label1==="Thùng",
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

function compactCartonDisplayName(name,hierarchy){
  let text=String(name||"").trim();
  if(!text)return "Sản phẩm";
  const isCarton=String(hierarchy&&hierarchy.label1||"").trim()==="Thùng";
  const isMiddle=!isCarton&&Boolean(String(hierarchy&&hierarchy.label2||"").trim());
  if(isCarton){
    text=stripCartonPackPhrase(text,"carton");
  }else if(isMiddle){
    text=stripCartonPackPhrase(text,"middle");
  }
  return capitalizeDisplayName(text);
}

function canonicalDisplayName(row){
  return compactCartonDisplayName(
    String(row&&row.source_name||row&&row.name||"Sản phẩm"),
    rowPackHierarchy(row)
  );
}

function isWinmartRow(row){
  const raw=searchKey([
    row&&row.source,
    row&&row.source_name
  ].filter(Boolean).join(" "));
  if(raw.includes("winmart")||raw==="wm")return true;
  try{
    return new URL(String(row&&row.canonical_url||"")).hostname
      .toLowerCase().replace(/^www\./,"")==="winmart.vn";
  }catch{
    return false;
  }
}

function isGoRow(row){
  const raw=searchKey([
    row&&row.source,
    row&&row.source_name
  ].filter(Boolean).join(" "));
  if(raw==="go"||raw.includes("go ha nam"))return true;
  try{
    return new URL(String(row&&row.canonical_url||"")).hostname
      .toLowerCase().replace(/^www\./,"")==="sieuthi-go.vn";
  }catch{
    return false;
  }
}

function sourceDisplayLabel(row){
  const raw=String(row&&row.source||"").trim();
  if(isWinmartRow(row))return "WM";
  if(isGoRow(row))return "GO";
  const key=searchKey(raw);
  if(!raw||key.includes("bach hoa xanh"))return "BHX";
  return raw;
}

function sourceDisplayClass(row){
  if(isWinmartRow(row))return " source-winmart";
  if(isGoRow(row))return " source-go";
  const key=searchKey(String(row&&row.source||""));
  if(!key||key.includes("bach hoa xanh"))return " source-bhx";
  return "";
}

function rowPrimaryQc(row){
  const h=rowPackHierarchy(row);
  if(h.label1==="Thùng"){
    const child=h.label2
      ?packHierarchyText(h.qty2||1,h.label2)
      :(h.label3?packHierarchyText(h.qty3||1,h.label3):"");
    return child?"Thùng · "+child:"Thùng";
  }
  if(h.label2&&h.label3){
    return packHierarchyText(h.qty2||1,h.label2)+" · "+packHierarchyText(h.qty3||1,h.label3);
  }
  if(h.label3)return packHierarchyText(h.qty3||1,h.label3);
  if(h.label2)return packHierarchyText(h.qty2||1,h.label2);
  return "—";
}

function rowCartonCardMeta(row,packPrice){
  const h=rowPackHierarchy(row);
  if(h.label1!=="Thùng")return {pack:rowPrimaryQc(row),unitPrice:""};

  // Prefer the actual repeated child of the carton.
  let qty=0,label="";
  if(h.label2&&Number(h.qty2)>1){
    qty=Number(h.qty2); label=String(h.label2);
  }else if(h.label3&&Number(h.qty3)>1){
    qty=Number(h.qty3); label=String(h.label3);
  }

  if(!qty||!label)return {pack:"Thùng",unitPrice:""};

  const unit=label.toLocaleLowerCase("vi-VN");
  const total=Number(packPrice||0);
  const each=total>0?total/qty:0;

  // The chip already tells the user the inner unit (e.g. "24 lon"),
  // so the compact per-unit price only needs the number.
  return {
    // Keep the relationship in one compact chip: "12 hộp × 14".
    // The red value at the right remains the whole-carton price.
    pack:qty+" "+unit+(each>0?" × "+money(each):""),
    unitPrice:""
  };
}

function productHierarchyText(p){
  const h=p&&p.hierarchy||{};
  if(String(h.label1||"").trim()==="Thùng"){
    const child=h.label2
      ?packHierarchyText(h.qty2||1,h.label2)
      :(h.label3?packHierarchyText(h.qty3||1,h.label3):"");
    return child?"Thùng / "+child:"Thùng";
  }
  if(h.label2&&h.label3){
    return packHierarchyText(h.qty2||1,h.label2)+" / "+packHierarchyText(h.qty3||1,h.label3);
  }
  if(h.label3)return packHierarchyText(h.qty3||1,h.label3);
  if(h.label2)return packHierarchyText(h.qty2||1,h.label2);
  return String(p&&p.packaging&&p.packaging.text||"").trim()||"—";
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

function tableCompactQc(levels){
  const h=levels&&levels.hierarchy||{};
  if(String(h.label1||"").trim()==="Thùng"){
    const inner=h.label2
      ?packHierarchyText(h.qty2||1,h.label2)
      :(h.label3?packHierarchyText(h.qty3||1,h.label3):"");
    return inner?"Thùng · "+inner:"Thùng";
  }
  if(h.label2&&h.label3){
    return packHierarchyText(h.qty2||1,h.label2)+" · "+packHierarchyText(h.qty3||1,h.label3);
  }
  if(h.label3)return packHierarchyText(h.qty3||1,h.label3);
  if(h.label2)return packHierarchyText(h.qty2||1,h.label2);
  return "—";
}

function tablePrimarySourcePrice(levels){
  if(activePackKind==="Lẻ"){
    return xlsWebPrice(levels.leafPrice,levels.promoLeafPrice);
  }
  if(activePackKind==="Thùng"){
    return xlsWebPrice(levels.cartonPrice,levels.promoCartonPrice);
  }
  if(Number(levels.cartonPrice)>0)return xlsWebPrice(levels.cartonPrice,levels.promoCartonPrice);
  if(Number(levels.middlePrice)>0)return xlsWebPrice(levels.middlePrice,levels.promoMiddlePrice);
  return xlsWebPrice(levels.leafPrice,levels.promoLeafPrice);
}

function tableSourceRank(row){
  const key=rowSourceFilterKey(row);
  return key==="bhx"?0:(key==="wm"?1:(key==="go"?2:9));
}

function sortTableProducts(products){
  if(!tableSourceSort)return products;
  const dir=tableSourceSort==="desc"?-1:1;
  return [...products].sort((a,b)=>{
    const rank=(tableSourceRank(a)-tableSourceRank(b))*dir;
    if(rank)return rank;
    const sourceA=sourceDisplayLabel(a);
    const sourceB=sourceDisplayLabel(b);
    const sourceCmp=sourceA.localeCompare(sourceB,"vi")*dir;
    if(sourceCmp)return sourceCmp;
    return canonicalDisplayName(a).localeCompare(canonicalDisplayName(b),"vi");
  });
}

function syncTableSourceSortHeader(){
  const head=document.getElementById("tableSourceHeader");
  const button=document.getElementById("tableSourceSort");
  if(!head||!button)return;
  head.setAttribute("aria-sort","none");
  button.dataset.direction="";
  const labels={"":"3 nguồn",bhx:"BHX",wm:"WM",go:"GO"};
  const next=nextTableSourceFilter();
  button.title="Đang xem "+labels[activeSourceFilter]+" · bấm chuyển sang "+labels[next];
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

  return '<tr class="product-card xls-row'+sourceDisplayClass(row)+' '+(pref==="hidden"?"is-hidden ":"")+
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
        '<span class="xls-desktop-only">'+
          (hierarchy.label1
            ?escapeHtml(packHierarchyText(hierarchy.qty1,hierarchy.label1))
            :'<span class="xls-empty">—</span>')+
        '</span>'+
        '<span class="xls-compact-only xls-qc-compact">'+escapeHtml(tableCompactQc(levels))+'</span>'+
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
      '<td class="xls-num">'+
        '<span class="xls-desktop-only">'+xlsWebPrice(levels.cartonPrice,levels.promoCartonPrice)+'</span>'+
        '<span class="xls-compact-only xls-price-compact">'+tablePrimarySourcePrice(levels)+'</span>'+
      '</td>'+
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

const CATEGORY_DISPLAY_LABELS=new Map([
  ["cham soc ca nhan","Chăm sóc cá nhân"],
  ["banh keo cac loai","Bánh kẹo các loại"],
  ["do uong cac loai","Đồ uống các loại"],
  ["gao mi bun","Gạo, mì, bún"],
  ["sua cac loai","Sữa các loại"],
  ["nguyen lieu gia vi","Nguyên liệu, gia vị"],
  ["cham soc nha cua","Chăm sóc nhà cửa"],
  ["xuc xich do hop","Xúc xích, đồ hộp"],
  ["khan giay ve sinh","Khăn giấy, vệ sinh"]
]);

function displayCategoryLabel(value){
  const raw=String(value||"").normalize("NFC").trim();
  if(!raw)return "";
  const withoutSourceCode=raw.replace(/\s+[A-Z]\.\d+\s*$/iu,"").trim();
  return CATEGORY_DISPLAY_LABELS.get(searchKey(withoutSourceCode))||withoutSourceCode;
}

function rowRootGroup(row){
  // Browsing location follows BHX when a WinMart product has a confident BHX match.
  // WinMart's original group remains stored separately for audit/source context.
  if(isWinmartRow(row)){
    return String(
      row&&row.bhx_group_name||
      row&&row.group_name||
      row&&row.source_root_name||
      ""
    ).trim();
  }
  return String(row&&row.group_name||"").trim();
}

function rowChildGroup(row){
  if(!isWinmartRow(row))return "";
  // A matched WinMart product already sits in the exact BHX browsing group.
  if(String(row&&row.bhx_group_name||"").trim())return "";
  const child=String(row&&row.source_category_name||"").trim();
  const root=rowRootGroup(row);
  if(!child)return "";
  return searchKey(child)===searchKey(root)?"":child;
}

function rowManualGroupKey(row){
  return String(row&&row.manual_group_key||"").trim();
}

function rowManualGroupName(row){
  return String(row&&row.manual_group_name||"").trim();
}

function rowManualGroupSort(row){
  return Number(row&&row.manual_group_sort_order||999999);
}

const UNCLASSIFIED_GROUP_KEY="__unclassified__";
function rowBrowseGroupKey(row){
  return rowManualGroupKey(row)||UNCLASSIFIED_GROUP_KEY;
}
function rowBrowseGroupName(row){
  return rowManualGroupName(row)||"Chưa phân loại";
}
function rowBrowseGroupSort(row){
  return rowManualGroupKey(row)?rowManualGroupSort(row):9999999;
}

function activeManualGroupName(){
  if(!activeRootGroup)return "";
  if(activeRootGroup===UNCLASSIFIED_GROUP_KEY)return "Chưa phân loại";
  const row=libraryCache.find(x=>rowBrowseGroupKey(x)===activeRootGroup);
  return row?rowBrowseGroupName(row):"";
}


function renderCategoryMenu(){
  const host=$("#categoryTabs");
  if(!host)return;

  let visibleLibrary=libraryCache.filter(row=>
    String(row.preference_state||"normal")!=="hidden"
  );
  if(activeSourceFilter){
    visibleLibrary=visibleLibrary.filter(row=>rowSourceFilterKey(row)===activeSourceFilter);
  }

  const groups=new Map();
  for(const row of visibleLibrary){
    const key=rowBrowseGroupKey(row);
    const name=rowBrowseGroupName(row);
    if(!groups.has(key)){
      groups.set(key,{
        key,
        name,
        count:0,
        sort:rowBrowseGroupSort(row)
      });
    }
    const entry=groups.get(key);
    entry.count+=1;
    entry.sort=Math.min(entry.sort,rowBrowseGroupSort(row));
  }

  const groupRows=[...groups.values()]
    .sort((a,b)=>
      Number(a.sort||999999)-Number(b.sort||999999)||
      a.name.localeCompare(b.name,"vi")
    );

  activeGroupUrl="";

  const allPinned=$("#categoryAllPinned");
  const allPinnedCount=$("#categoryAllPinnedCount");
  if(allPinned){
    allPinned.classList.toggle("active",!activeRootGroup);
    allPinned.setAttribute("aria-pressed",!activeRootGroup?"true":"false");
  }
  if(allPinnedCount)allPinnedCount.textContent=String(visibleLibrary.length);

  host.innerHTML=
    groupRows.map(group=>
      '<button class="category-chip category-root '+(activeRootGroup===group.key?"active":"")+'" '+
        'data-root="'+escapeAttr(group.key)+'" data-group="" type="button">'+
        '<span>'+escapeHtml(group.name)+'</span><small>'+group.count+'</small>'+
      '</button>'
    ).join("")+
    '<div class="category-scroll-end-spacer" aria-hidden="true"></div>';

  const current=$("#mobileCategoryCurrent");
  if(current){
    current.textContent=activeManualGroupName()||"Tất cả";
  }
}
function gridProductCard(row){
  const levels=rowPriceLevels(row);
  const displayName=canonicalDisplayName(row);
  const hierarchy=levels.hierarchy;
  const rawWinmart=isWinmartRow(row);
  const price=rawWinmart
    ?Number(row.current_price||row.regular_pack_price||0)
    :(levels.hasCarton
      ?(levels.promoCartonPrice||levels.cartonPrice)
      :(levels.hasMiddle
        ?(levels.promoMiddlePrice||levels.middlePrice)
        :(levels.promoLeafPrice||levels.leafPrice)));
  const image=String(row.image||"").trim();
  const cartonMeta=rowIsCarton(row)?rowCartonCardMeta(row,price):null;
  const qc=cartonMeta?cartonMeta.pack:rowPrimaryQc(row);
  const unitPriceText=cartonMeta?cartonMeta.unitPrice:"";
  const isWatch=String(row.preference_state||"normal")==="watch";

  return '<article class="grid-product product-card'+sourceDisplayClass(row)+' '+
    (String(row.preference_state||"normal")==="hidden"?"is-hidden ":"")+
    (canonical(selectedLibraryUrl)===canonical(row.canonical_url)?"selected ":"")+
    '" tabindex="0" data-url="'+escapeAttr(row.canonical_url)+'">'+
      '<div class="grid-product-image">'+
        '<button class="grid-watch-button '+(isWatch?"active":"")+'" type="button" '+
          'data-url="'+escapeAttr(row.canonical_url)+'" data-watch="'+(isWatch?"1":"0")+'" '+
          'aria-label="'+(isWatch?"Bỏ quan tâm":"Đánh dấu quan tâm")+'" '+
          'title="'+(isWatch?"Bỏ quan tâm":"Quan tâm")+'">'+
          watchIconSvg(isWatch)+
        '</button>'+
        (image
          ?'<img src="'+escapeAttr(image)+'" alt="" loading="lazy" decoding="async">'
          :'<span class="grid-product-fallback">GL</span>')+
      '</div>'+
      '<div class="grid-product-body">'+
        '<button class="grid-product-name" type="button" data-url="'+escapeAttr(row.canonical_url)+'" title="'+escapeAttr(levels.rawName)+'">'+escapeHtml(displayName)+'</button>'+
        '<div class="grid-product-bottom">'+
          '<span class="grid-qc">'+escapeHtml(qc||"—")+'</span>'+
          '<span class="grid-price-group'+(unitPriceText?" has-unit":"")+'">'+
            '<strong class="grid-price'+(isWinmartRow(row)?" source-price-winmart":(isGoRow(row)?" source-price-go":""))+'">'+money(price)+'</strong>'+
            (unitPriceText?'<span class="grid-unit-price">'+escapeHtml(unitPriceText)+'</span>':'')+
          '</span>'+
        '</div>'+
      '</div>'+
    '</article>';
}


async function loadLibraryGroups(){
  if(!API)return;
  try{
    const r=await apiFetch("/api/library?view=groups",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||"library_error");
    libraryGroups=Array.isArray(data.groups)?data.groups:[];
    renderCategoryMenu();
  }catch{
    libraryGroups=[];
    $("#categoryTabs").innerHTML=
      '<span class="library-error">Chưa đọc được nhóm từ Supabase.</span>';
  }
}

async function fetchLibraryFromSupabase(){
  const r=await apiFetch("/api/library?view=search&limit=10000&include_hidden=1",{cache:"no-store"});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"library_error");
  libraryCache=Array.isArray(data.products)?data.products:[];
  libraryLoaded=true;
  libraryRenderVersion+=1;
  rebuildLibraryIndex();
  for(const state of Object.values(viewRenderState)){
    state.key="";
    state.products=[];
    state.rendered=0;
  }
  const registry=$("#registryCount");
  if(registry)registry.textContent="Kho link: "+libraryCache.length;
  persistUiLibraryCacheSoon();
}

const SOURCE_MANAGER_CACHE_MS=5*60*1000;

function sourceManagerSourceLabel(key){
  return key==="bhx"?"BHX":(key==="wm"?"WM":(key==="go"?"GO":""));
}

function sourceManagerActiveItems(){
  if(!sourceManagerCache)return [];
  const sourceItems=sourceManagerKind==="manual"
    ?sourceManagerCache.manual_groups
    :(sourceManagerKind==="group"?sourceManagerCache.groups:sourceManagerCache.brands);
  const q=searchKey(sourceManagerQuery);
  return (Array.isArray(sourceItems)?sourceItems:[]).filter(item=>{
    const sourceCount=sourceManagerSource==="all"
      ?Number(item.total||0)
      :Number(item.sources&&item.sources[sourceManagerSource]||0);
    if(!sourceCount)return false;
    if(!q)return true;
    const hay=searchKey([
      item.name,
      item.rule_label||"",
      ...(Object.values(item.variants||{}).flat())
    ].join(" "));
    return hay.includes(q);
  });
}

function sourceManagerVariantLine(item){
  const variants=item&&item.variants||{};
  const keys=sourceManagerSource==="all"?["bhx","wm","go"]:[sourceManagerSource];
  const parts=[];
  for(const key of keys){
    const values=Array.isArray(variants[key])?variants[key]:[];
    if(!values.length)continue;
    parts.push(sourceManagerSourceLabel(key)+": "+values.slice(0,3).join(" · "));
  }
  return parts.join("  |  ");
}

function sourceManagerBadges(item){
  const sources=item&&item.sources||{};
  const keys=sourceManagerSource==="all"?["bhx","wm","go"]:[sourceManagerSource];
  return keys
    .filter(key=>Number(sources[key]||0)>0)
    .map(key=>'<span class="source-manager-source-badge '+key+'">'+
      sourceManagerSourceLabel(key)+' <small>'+Number(sources[key]||0)+'</small></span>')
    .join("");
}

function renderSourceManager(){
  if(sourceManagerManualKey&&sourceManagerManualDetail){
    renderSourceManagerManualDetail();
    return;
  }
  if(!sourceManagerCache)return;
  document.querySelectorAll("#sourceManagerKinds button").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.kind===sourceManagerKind);
  });
  document.querySelectorAll("#sourceManagerSources button").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.source===sourceManagerSource);
  });

  $("#sourceManagerBrandCount").textContent=String((sourceManagerCache.brands||[]).length);
  $("#sourceManagerGroupCount").textContent=String((sourceManagerCache.groups||[]).length);
  $("#sourceManagerManualCount").textContent=String((sourceManagerCache.manual_groups||[]).length);
  const productCounts=sourceManagerCache.products||{};
  $("#sourceManagerAllCount").textContent=String(Number(productCounts.all||0));
  $("#sourceManagerWmCount").textContent=String(Number(productCounts.wm||0));
  $("#sourceManagerBhxCount").textContent=String(Number(productCounts.bhx||0));
  $("#sourceManagerGoCount").textContent=String(Number(productCounts.go||0));

  const items=sourceManagerActiveItems();
  const visible=items.slice(0,sourceManagerLimit);
  const host=$("#sourceManagerRows");
  if(!visible.length){
    host.innerHTML='<div class="source-manager-empty">Không có dữ liệu phù hợp.</div>';
  }else{
    host.innerHTML=visible.map(item=>{
      const count=sourceManagerSource==="all"
        ?Number(item.total||0)
        :Number(item.sources&&item.sources[sourceManagerSource]||0);
      const displayName=sourceManagerKind==="group"
        ?displayCategoryLabel(item.name)
        :String(item.name||"");
      const variants=sourceManagerKind==="manual"
        ?String(item.rule_label||"")
        :sourceManagerVariantLine(item);
      const manualAttrs=sourceManagerKind==="manual"
        ?' role="button" tabindex="0" data-manual-key="'+escapeAttr(item.key||"")+'" title="Mở danh sách sản phẩm trong nhóm"'
        :"";
      return '<article class="source-manager-row'+(sourceManagerKind==="manual"?" source-manager-manual-row":"")+'"'+manualAttrs+'>'+
        '<div class="source-manager-name">'+
          '<strong>'+escapeHtml(displayName||"—")+'</strong>'+
          (variants?'<small>'+escapeHtml(variants)+'</small>':'')+
          (sourceManagerKind==="manual"?'<small class="source-manager-open-hint">Xem '+count+' sản phẩm →</small>':'')+
        '</div>'+
        '<div class="source-manager-badges">'+sourceManagerBadges(item)+'</div>'+
        '<strong class="source-manager-total">'+count+'</strong>'+
      '</article>';
    }).join("");
  }

  const sourceLabel=sourceManagerSource==="all"?"3 nguồn":sourceManagerSourceLabel(sourceManagerSource);
  const kindLabel=sourceManagerKind==="brand"
    ?"hãng"
    :(sourceManagerKind==="manual"?"nhóm tự lập":"nhóm nguồn");
  $("#sourceManagerSummary").textContent=
    items.length+" "+kindLabel+" · "+sourceLabel;
  const more=$("#sourceManagerMore");
  more.hidden=items.length<=sourceManagerLimit;
  if(!more.hidden)more.textContent="Xem thêm · "+sourceManagerLimit+" / "+items.length;
}

function sourceManagerDetailItems(){
  const detail=sourceManagerManualDetail;
  if(!detail||!Array.isArray(detail.items))return [];
  const q=searchKey(sourceManagerQuery);
  return detail.items.filter(item=>{
    if(sourceManagerSource!=="all"&&item.source!==sourceManagerSource)return false;
    if(!q)return true;
    return searchKey([
      item.name,
      item.brand,
      item.raw_brand,
      item.raw_group,
      sourceManagerSourceLabel(item.source)
    ].join(" ")).includes(q);
  });
}

function renderSourceManagerManualDetail(){
  const detail=sourceManagerManualDetail;
  if(!detail)return;
  document.querySelectorAll("#sourceManagerKinds button").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.kind==="manual");
  });
  document.querySelectorAll("#sourceManagerSources button").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.source===sourceManagerSource);
  });

  const productCounts=detail.products||{};
  $("#sourceManagerAllCount").textContent=String(Number(productCounts.all||0));
  $("#sourceManagerWmCount").textContent=String(Number(productCounts.wm||0));
  $("#sourceManagerBhxCount").textContent=String(Number(productCounts.bhx||0));
  $("#sourceManagerGoCount").textContent=String(Number(productCounts.go||0));

  const items=sourceManagerDetailItems();
  const host=$("#sourceManagerRows");
  const groupName=String(detail.group&&detail.group.name||"Nhóm tự lập");
  const ruleLabel=String(detail.group&&detail.group.rule_label||"");
  const sourceLabel=sourceManagerSource==="all"?"3 nguồn":sourceManagerSourceLabel(sourceManagerSource);

  host.innerHTML=
    '<div class="source-manager-detail-head">'+
      '<button id="sourceManagerDetailBack" type="button">← Nhóm tự lập</button>'+
      '<div><strong>'+escapeHtml(groupName)+'</strong>'+
        (ruleLabel?'<small>'+escapeHtml(ruleLabel)+'</small>':'')+
      '</div>'+
    '</div>'+
    (items.length
      ?items.map(item=>
        '<article class="source-manager-product-row">'+
          '<div class="source-manager-product-name">'+
            '<strong>'+escapeHtml(item.name||"—")+'</strong>'+
            '<small>'+
              (item.brand?'Hãng: '+escapeHtml(item.brand):'Chưa có hãng')+
              (item.raw_group?' · Nhóm nguồn: '+escapeHtml(item.raw_group):'')+
            '</small>'+
          '</div>'+
          '<span class="source-manager-source-badge '+escapeAttr(item.source||"")+'">'+
            escapeHtml(sourceManagerSourceLabel(item.source))+
          '</span>'+
        '</article>'
      ).join("")
      :'<div class="source-manager-empty">Không có sản phẩm phù hợp.</div>');

  $("#sourceManagerSummary").textContent=
    items.length+" / "+Number(productCounts[sourceManagerSource==="all"?"all":sourceManagerSource]||0)+" SP · "+sourceLabel;
  $("#sourceManagerMore").hidden=true;
}

async function openSourceManagerManualGroup(groupKey){
  if(!groupKey)return;
  sourceManagerManualKey=groupKey;
  sourceManagerManualDetail=null;
  $("#sourceManagerRows").innerHTML='<div class="source-manager-loading">Đang đọc sản phẩm trong nhóm...</div>';
  const r=await apiFetch("/api/library?view=manual-group&group="+encodeURIComponent(groupKey),{cache:"no-store"});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"manual_group_error");
  sourceManagerManualDetail=data;
  renderSourceManagerManualDetail();
}

function closeSourceManagerManualGroup(){
  sourceManagerManualKey="";
  sourceManagerManualDetail=null;
  renderSourceManager();
}

async function loadSourceManager(force=false){
  if(!force&&sourceManagerCache&&Date.now()-sourceManagerLoadedAt<SOURCE_MANAGER_CACHE_MS){
    renderSourceManager();
    return;
  }
  $("#sourceManagerRows").innerHTML='<div class="source-manager-loading">Đang đọc Hãng / Nhóm từ Supabase...</div>';
  const r=await apiFetch("/api/library?view=source-manager",{cache:"no-store"});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||"source_manager_error");
  sourceManagerCache=data;
  sourceManagerLoadedAt=Date.now();
  sourceManagerLimit=200;
  renderSourceManager();
}

function openSourceManager(){
  closeMobileCategoryNav();
  const panel=$("#sourceManagerPanel");
  panel.hidden=false;
  panel.setAttribute("aria-hidden","false");
  document.body.classList.add("source-manager-open");
  loadSourceManager(true).catch(()=>{
    $("#sourceManagerRows").innerHTML=
      '<div class="source-manager-empty">Chưa đọc được dữ liệu quản lý nguồn.</div>';
  });
}

function closeSourceManager(){
  const panel=$("#sourceManagerPanel");
  if(!panel)return;
  panel.hidden=true;
  panel.setAttribute("aria-hidden","true");
  document.body.classList.remove("source-manager-open");
  sourceManagerManualKey="";
  sourceManagerManualDetail=null;
}

async function refreshLibraryInBackground(){
  try{
    await fetchLibraryFromSupabase();
    renderCategoryMenu();
    renderLibraryProducts();
  }catch{}
}

async function checkClassificationVersion(force=false){
  if(!API||classificationRefreshBusy)return;
  if(document.visibilityState==="hidden"&&!force)return;
  classificationRefreshBusy=true;
  try{
    const r=await apiFetch("/api/library?view=classification-version",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||"classification_version_error");
    const next=String(data.version||"")+"|"+String(data.member_count||0);

    if(!classificationVersion){
      classificationVersion=next;
      return;
    }
    if(next!==classificationVersion){
      classificationVersion=next;
      await fetchLibraryFromSupabase();
      renderCategoryMenu();
      renderLibraryProducts();
    }
  }catch{}finally{
    classificationRefreshBusy=false;
  }
}

function startClassificationAutoRefresh(){
  if(classificationCheckTimer)return;
  checkClassificationVersion(true);
  classificationCheckTimer=setInterval(()=>checkClassificationVersion(false),CLASSIFICATION_CHECK_MS);
  window.addEventListener("focus",()=>checkClassificationVersion(true));
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible")checkClassificationVersion(true);
  });
}

async function ensureLibraryCache(force=false){
  if(libraryLoaded&&!force)return;

  if(!force){
    const cached=await readUiLibraryCache();
    if(cached&&Array.isArray(cached.rows)&&cached.rows.length){
      libraryCache=cached.rows;
      libraryLoaded=true;
      libraryRenderVersion+=1;
      rebuildLibraryIndex();
      const registry=$("#registryCount");
      if(registry)registry.textContent="Kho link: "+libraryCache.length;

      const age=Date.now()-Number(cached.savedAt||0);
      if(age>LOCAL_LIBRARY_CACHE_TTL){
        setTimeout(refreshLibraryInBackground,0);
      }
      return;
    }
  }

  await fetchLibraryFromSupabase();
}


function brandKeyValue(value){
  return searchKey(value||"").replace(/\s+/g,"");
}

function rowCanonicalBrand(row){
  return String(
    row&&row.bhx_brand_name||
    row&&row.brand_name||
    row&&row.branch_name||
    ""
  ).trim();
}

function memoBrowseRows(key,builder){
  if(browseRowsMemoVersion!==libraryRenderVersion){
    browseRowsMemo.clear();
    browseRowsMemoVersion=libraryRenderVersion;
  }
  const cacheKey=String(key||"");
  if(browseRowsMemo.has(cacheKey))return browseRowsMemo.get(cacheKey);
  const value=builder();
  if(browseRowsMemo.size>=64){
    const first=browseRowsMemo.keys().next().value;
    if(first!==undefined)browseRowsMemo.delete(first);
  }
  browseRowsMemo.set(cacheKey,value);
  return value;
}

function scheduleCategoryMenuRefresh(){
  const token=++categoryMenuRefreshToken;
  const run=()=>{
    if(token!==categoryMenuRefreshToken)return;
    renderCategoryMenu();
  };
  if("requestIdleCallback" in window){
    requestIdleCallback(run,{timeout:180});
  }else{
    setTimeout(run,0);
  }
}

function rowsBeforeSearch(){
  const key=["before",libraryState,activeRootGroup,activeGroupUrl,activeBrand].join("|");
  return memoBrowseRows(key,()=>{
    let products=libraryCache.slice();

    if(libraryState==="watch"){
      products=products.filter(row=>String(row.preference_state||"normal")==="watch");
    }else if(libraryState==="hidden"){
      products=products.filter(row=>String(row.preference_state||"normal")==="hidden");
    }else{
      products=products.filter(row=>String(row.preference_state||"normal")!=="hidden");
    }

    if(activeRootGroup){
      products=products.filter(row=>rowBrowseGroupKey(row)===activeRootGroup);
    }
    activeGroupUrl="";
    if(activeBrand){
      products=products.filter(row=>
        brandKeyValue(rowCanonicalBrand(row))===activeBrand
      );
    }
    return products;
  });
}

function visibleRowsBeforePack(){
  const key=["visible",libraryState,activeRootGroup,activeGroupUrl,activeBrand,libraryQuery].join("|");
  return memoBrowseRows(key,()=>{
    let products=rowsBeforeSearch();
    if(libraryQuery){
      const tokens=searchTokens(libraryQuery);
      products=products.filter(row=>matchesSearchTokens(row,tokens));
    }
    return products;
  });
}

function categoryBaseRows(){
  const key=["category-base",activeSourceFilter,activeRootGroup,activeGroupUrl].join("|");
  return memoBrowseRows(key,()=>{
    let rows=libraryCache.filter(row=>String(row.preference_state||"normal")!=="hidden");
    if(activeSourceFilter)rows=rows.filter(row=>rowSourceFilterKey(row)===activeSourceFilter);
    if(activeRootGroup)rows=rows.filter(row=>rowBrowseGroupKey(row)===activeRootGroup);
    activeGroupUrl="";
    return rows;
  });
}

function renderPackTabs(){
  const host=$("#packTabs");
  if(!host)return;

  let base=rowsBeforeSearch();
  if(activeSourceFilter){
    base=base.filter(row=>rowSourceFilterKey(row)===activeSourceFilter);
  }
  const cartonCount=base.filter(row=>rowIsCarton(row)).length;
  const retailCount=base.filter(row=>rowIsRetail(row)).length;

  if(activePackKind!=="Thùng"&&activePackKind!=="Lẻ"){
    activePackKind="";
    localStorage.removeItem("getlink:filter-pack");
  }

  // Thùng/Lẻ is the user's global shopping mode, above category/brand/search.
  // Never clear it just because the current category has 0 matching products.
  host.hidden=!base.length;
  if(!base.length){
    host.innerHTML="";
    return;
  }

  host.innerHTML=
    '<button class="pack-chip '+(!activePackKind?"active":"")+'" data-pack="" type="button" aria-pressed="'+(!activePackKind?"true":"false")+'" title="Xem tất cả quy cách">Tất cả <small>'+base.length+'</small></button>'+
    '<button class="pack-chip '+(activePackKind==="Thùng"?"active":"")+'" data-pack="Thùng" type="button" aria-pressed="'+(activePackKind==="Thùng"?"true":"false")+'" title="Lọc theo quy cách Thùng">Thùng <small>'+cartonCount+'</small></button>'+
    '<button class="pack-chip '+(activePackKind==="Lẻ"?"active":"")+'" data-pack="Lẻ" type="button" aria-pressed="'+(activePackKind==="Lẻ"?"true":"false")+'" title="Lọc theo quy cách Lẻ">Lẻ <small>'+retailCount+'</small></button>';
}

function rowSourceFilterKey(row){
  if(isWinmartRow(row))return "wm";
  if(isGoRow(row))return "go";
  return "bhx";
}

function rowsAfterPackBeforeSource(){
  const key=["after-pack",libraryState,activeRootGroup,activeGroupUrl,activeBrand,libraryQuery,activePackKind].join("|");
  return memoBrowseRows(key,()=>{
    let products=visibleRowsBeforePack();
    if(activePackKind==="Thùng"){
      products=products.filter(row=>rowIsCarton(row));
    }else if(activePackKind==="Lẻ"){
      products=products.filter(row=>rowIsRetail(row));
    }
    return products;
  });
}

const TABLE_SOURCE_CYCLE=["","bhx","wm","go"];

function sourceRowsForSelection(source){
  const key=["source-selection",source].join("|");
  return memoBrowseRows(key,()=>libraryCache.filter(row=>
    String(row.preference_state||"normal")!=="hidden" &&
    (!source||rowSourceFilterKey(row)===source)
  ));
}

function normalizeBrowseCategoryForSource(source){
  const sourceRows=sourceRowsForSelection(source);
  if(activeRootGroup&&!sourceRows.some(row=>rowBrowseGroupKey(row)===activeRootGroup)){
    activeRootGroup="";
    activeBrand="";
  }
  activeGroupUrl="";
}

function setActiveSourceFilter(nextSource,{scroll=true}={}){
  activeSourceFilter=TABLE_SOURCE_CYCLE.includes(nextSource)?nextSource:"";
  if(activeSourceFilter)localStorage.setItem("getlink:filter-source",activeSourceFilter);
  else localStorage.removeItem("getlink:filter-source");

  normalizeBrowseCategoryForSource(activeSourceFilter);
  libraryPage=1;
  resetBrowseDetail();

  if(scroll){
    const activeScroller=libraryView==="table"?$("#tableView"):$("#productGrid");
    if(activeScroller)activeScroller.scrollTop=0;
  }

  renderLibraryProducts();
  scheduleCategoryMenuRefresh();
}

function nextTableSourceFilter(){
  const i=TABLE_SOURCE_CYCLE.indexOf(activeSourceFilter);
  return TABLE_SOURCE_CYCLE[(i+1+TABLE_SOURCE_CYCLE.length)%TABLE_SOURCE_CYCLE.length];
}

function sourceLogoMark(key){
  const logos={
    bhx:"assets/logo-bhx.svg",
    wm:"assets/logo-winmart.svg",
    go:"assets/logo-go.svg"
  };
  if(logos[key]){
    const fallback=key==="bhx"?"BHX":(key==="wm"?"WinMart":"GO!");
    return '<span class="source-logo-mark source-logo-'+key+'" aria-hidden="true">'+
      '<img class="source-logo-image" src="'+logos[key]+'" alt="" loading="eager" decoding="async" onerror="this.hidden=true">'+
      '<b class="source-logo-fallback">'+fallback+'</b>'+
    '</span>';
  }
  return '<span class="source-logo-mark source-logo-all" aria-hidden="true"><b>3</b></span>';
}

function sourceChipHtml(key,count,active,compact=false){
  const meta={
    "":{full:"Tất cả",short:"Tất cả",title:"Xem đồng thời cả 3 nguồn"},
    bhx:{full:"Bách Hóa Xanh",short:"BHX",title:"Bách Hóa Xanh"},
    wm:{full:"WinMart",short:"WinMart",title:"WinMart"},
    go:{full:"Siêu thị GO!",short:"GO!",title:"Siêu thị GO!"}
  }[key]||{full:key,short:key,title:key};

  const label=escapeHtml(compact?meta.short:meta.full);
  const classes='source-chip source-chip-brand '+(active?"active ":"")+'source-'+(key||"all")+(compact&&key?" source-chip-logo-only":"");

  if(compact&&key){
    return '<button class="'+classes+'" '+
      'data-source="'+escapeAttr(key)+'" type="button" aria-pressed="'+(active?"true":"false")+'" '+
      'title="'+escapeAttr(meta.title)+'" aria-label="'+escapeAttr(meta.title)+'">'+
        sourceLogoMark(key)+
      '</button>';
  }

  return '<button class="'+classes+'" '+
    'data-source="'+escapeAttr(key)+'" type="button" aria-pressed="'+(active?"true":"false")+'" title="'+escapeAttr(meta.title)+'">'+
      '<span class="source-chip-main"><span class="source-chip-label">'+label+'</span>'+sourceLogoMark(key)+'</span>'+
      (compact?'':'<small class="source-chip-count">'+count+'</small>')+
    '</button>';
}

function renderSourceTabs(){
  const navHost=$("#sourceTabs");
  const inlineHost=$("#sourceTabsInline");
  if(!navHost&&!inlineHost)return;

  let base=libraryCache.filter(row=>
    String(row.preference_state||"normal")!=="hidden"
  );
  if(activePackKind==="Thùng"){
    base=base.filter(row=>rowIsCarton(row));
  }else if(activePackKind==="Lẻ"){
    base=base.filter(row=>rowIsRetail(row));
  }

  const counts={bhx:0,wm:0,go:0};
  for(const row of base)counts[rowSourceFilterKey(row)]++;

  if(!["","bhx","wm","go"].includes(activeSourceFilter)){
    activeSourceFilter="";
    localStorage.removeItem("getlink:filter-source");
  }

  const rows=[
    ["",base.length,!activeSourceFilter],
    ["bhx",counts.bhx,activeSourceFilter==="bhx"],
    ["wm",counts.wm,activeSourceFilter==="wm"],
    ["go",counts.go,activeSourceFilter==="go"]
  ];

  if(navHost){
    navHost.innerHTML=rows.map(([key,count,active])=>sourceChipHtml(key,count,active,false)).join("");
  }
  if(inlineHost){
    inlineHost.innerHTML=rows.map(([key,count,active])=>sourceChipHtml(key,count,active,true)).join("");
  }
}


function filteredLibraryProducts(){
  const key=["filtered",libraryState,activeRootGroup,activeGroupUrl,activeBrand,libraryQuery,activePackKind,activeSourceFilter].join("|");
  return memoBrowseRows(key,()=>{
    let products=rowsAfterPackBeforeSource();

    if(activeSourceFilter){
      products=products.filter(row=>rowSourceFilterKey(row)===activeSourceFilter);
    }

    return [...products].sort((a,b)=>{
      const nameA=String(a.source_name||a.name||"");
      const nameB=String(b.source_name||b.name||"");
      return nameA.localeCompare(nameB,"vi");
    });
  });
}

function headerLibraryProducts(){
  let products=rowsBeforeSearch();
  if(activePackKind==="Thùng"){
    products=products.filter(row=>rowIsCarton(row));
  }else if(activePackKind==="Lẻ"){
    products=products.filter(row=>rowIsRetail(row));
  }
  if(activeSourceFilter){
    products=products.filter(row=>rowSourceFilterKey(row)===activeSourceFilter);
  }
  return products;
}

function renderBrandTabs(){
  const host=$("#brandTabs");
  if(!host)return;
  const section=host.closest(".brand-section");

  if(!activeRootGroup&&!activeGroupUrl){
    activeBrand="";
    host.hidden=true;
    host.innerHTML="";
    if(section)section.hidden=true;
    return;
  }

  const base=categoryBaseRows();
  const counts=new Map();
  const labels=new Map();
  const bhxPreferred=new Set();

  for(const row of base){
    const brand=rowCanonicalBrand(row);
    const key=brandKeyValue(brand);
    if(!key)continue;
    counts.set(key,(counts.get(key)||0)+1);

    const isBhx=String(row.source||"").toLowerCase().includes("bách hóa xanh")||
      String(row.source||"").toLowerCase().includes("bach hoa xanh");
    const current=labels.get(key)||"";
    if(isBhx){
      if(!bhxPreferred.has(key)){
        labels.set(key,brand);
        bhxPreferred.add(key);
      }
    }else if(!current){
      labels.set(key,brand);
    }
  }

  const allBrands=[...counts.entries()]
    .map(([key,count])=>[key,labels.get(key)||key,count])
    .sort((a,b)=>(b[2]-a[2])||a[1].localeCompare(b[1],"vi"));

  if(!allBrands.length){
    activeBrand="";
    host.hidden=true;
    host.innerHTML="";
    if(section)section.hidden=true;
    return;
  }

  if(activeBrand&&!counts.has(activeBrand))activeBrand="";
  let brands=allBrands.slice(0,10);
  if(activeBrand&&!brands.some(([key])=>key===activeBrand)){
    brands=[...brands,[activeBrand,labels.get(activeBrand)||activeBrand,counts.get(activeBrand)||0]];
  }

  if(section)section.hidden=false;
  host.hidden=false;
  host.innerHTML=
    '<button class="brand-chip '+(!activeBrand?"active":"")+'" data-brand="" type="button">Tất cả <small>'+base.length+'</small></button>'+
    brands.map(([key,label,count])=>
      '<button class="brand-chip '+(activeBrand===key?"active":"")+'" data-brand="'+escapeAttr(key)+'" type="button">'+
        escapeHtml(label)+' <small>'+count+'</small>'+
      '</button>'
    ).join("");
}

function resetBrowseDetail(){
  selectedLibraryUrl="";
  document.querySelectorAll(".product-card.selected").forEach(x=>x.classList.remove("selected"));
  const result=$("#result");
  const detail=$("#detailEmpty");
  if(result)result.hidden=true;
  if(detail)detail.hidden=false;
}

function contextChildName(row){
  const child=String(row&&row.source_category_name||"").trim();
  const root=rowRootGroup(row);
  return child&&child!==root?child:"";
}

function renderCategoryContext(visibleProducts){
  if(selectedLibraryUrl)return;
  const host=$("#detailEmpty");
  if(!host)return;

  host.hidden=false;
  const result=$("#result");
  if(result)result.hidden=true;

  const base=categoryBaseRows();
  const visible=Array.isArray(visibleProducts)?visibleProducts:filteredLibraryProducts();
  const title=activeManualGroupName()||"Toàn bộ thư viện";

  const titleHost=$("#categoryDetailTitle");
  const countHost=$("#categoryDetailCount");
  const descHost=$("#categoryDetailDescription");
  const statsHost=$("#categoryDetailStats");
  if(titleHost)titleHost.textContent=title;
  if(countHost)countHost.textContent=base.length+" SP";
  if(descHost){
    descHost.textContent=activeRootGroup
      ?"Danh mục đang chọn. Hãng phổ biến và cấu trúc nhóm được đặt ở đây để phần giữa dành cho sản phẩm."
      :"Chọn Thùng hoặc Lẻ, sau đó tìm kiếm. Chọn một sản phẩm để mở chi tiết.";
  }

  if(statsHost){
    const statsBase=base;
    const carton=statsBase.filter(row=>rowIsCarton(row)).length;
    const retail=statsBase.filter(row=>rowIsRetail(row)).length;
    statsHost.innerHTML=
      '<div><small>Tổng</small><strong>'+statsBase.length+'</strong></div>'+
      '<div><small>Thùng</small><strong>'+carton+'</strong></div>'+
      '<div><small>Lẻ</small><strong>'+retail+'</strong></div>';
  }

  const childWrap=$("#categoryDetailChildrenWrap");
  const childHost=$("#categoryDetailChildren");
  if(childWrap)childWrap.hidden=true;
  if(childHost)childHost.innerHTML="";

}


function productViewKey(products){
  return [
    libraryRenderVersion,
    libraryState,
    activeRootGroup,
    activeGroupUrl,
    activeBrand,
    activePackKind,
    activeSourceFilter,
    libraryQuery,
    products.length
  ].join("|");
}

function hydrateTableRows(rows){
  for(const row of rows)updateSheetRow(row);
}

function batchSizeForView(view){
  if(view!=="table")return 48;
  const table=$("#tableView");
  return table&&table.clientWidth>0&&table.clientWidth<=980?36:60;
}

function updateCatalogRenderMore(){
  const host=$("#catalogRenderMore");
  if(!host)return;
  const state=viewRenderState[libraryView];
  const total=state.products.length;
  if(!total||state.rendered>=total){
    host.hidden=true;
    host.textContent="";
    return;
  }
  host.hidden=false;
  host.textContent="Đang hiển thị "+state.rendered+" / "+total+" · cuộn để xem thêm";
}

function appendLocalViewBatch(view){
  const state=viewRenderState[view];
  if(!state||state.rendered>=state.products.length){
    updateCatalogRenderMore();
    return;
  }

  const size=batchSizeForView(view);
  const start=state.rendered;
  const end=Math.min(start+size,state.products.length);

  if(view==="grid"){
    const host=$("#productGrid");
    if(!host)return;
    host.insertAdjacentHTML("beforeend",state.products.slice(start,end).map(gridProductCard).join(""));
  }else{
    const body=$("#libraryProducts");
    if(!body)return;
    const before=body.children.length;
    body.insertAdjacentHTML("beforeend",state.products.slice(start,end).map(productCard).join(""));
    const added=[];
    for(let i=before;i<body.children.length;i++)added.push(body.children[i]);
    hydrateTableRows(added);
  }

  state.rendered=end;
  updateCatalogRenderMore();
}

function renderActiveProductView(products){
  const view=libraryView;
  const viewProducts=view==="table"?sortTableProducts(products):products;
  const key=productViewKey(viewProducts)+(view==="table"?"|source-sort:"+tableSourceSort:"");
  const state=viewRenderState[view];
  if(state.key!==key){
    state.key=key;
    state.products=viewProducts;
    state.rendered=0;
    if(view==="grid"){
      const host=$("#productGrid");
      if(host)host.innerHTML="";
    }else{
      const body=$("#libraryProducts");
      if(body)body.innerHTML="";
    }
    appendLocalViewBatch(view);
  }else if(state.rendered===0){
    state.products=viewProducts;
    appendLocalViewBatch(view);
  }
  syncTableSourceSortHeader();
  updateCatalogRenderMore();
}

function initCatalogLocalObserver(){
  const grid=$("#productGrid");
  const table=$("#tableView");
  const maybeAppend=(host,view)=>{
    if(!host||libraryView!==view||host.hidden)return;
    const remain=host.scrollHeight-host.scrollTop-host.clientHeight;
    if(remain<900)appendLocalViewBatch(view);
  };

  if(grid){
    grid.addEventListener("scroll",()=>maybeAppend(grid,"grid"),{passive:true});
  }
  if(table){
    table.addEventListener("scroll",()=>maybeAppend(table,"table"),{passive:true});
  }

  // Safety net for browsers switching between document-scroll and local-scroll
  // during viewport/toolbar changes. It costs no API calls; it only mounts the
  // next already-loaded local batch when the visible catalog nears its end.
  window.addEventListener("scroll",()=>{
    if(!isCompactBrowse())return;
    const host=libraryView==="table"?table:grid;
    if(!host||host.hidden)return;
    const rect=host.getBoundingClientRect();
    if(rect.bottom-window.innerHeight<900)appendLocalViewBatch(libraryView);
  },{passive:true});

  requestAnimationFrame(()=>{
    maybeAppend(grid,"grid");
    maybeAppend(table,"table");
  });
}

function renderResultPager(){
  // Intentionally no pagination: browsing stays continuous.
}

function syncViewMode(){
  const grid=$("#productGrid");
  const table=$("#tableView");
  if(grid)grid.hidden=matchAuditActive||libraryView!=="grid";
  if(table)table.hidden=matchAuditActive||libraryView!=="table";
  document.querySelectorAll(".view-button").forEach(button=>{
    button.classList.toggle("active",button.dataset.view===libraryView);
  });
  syncMatchAuditMode();
}

function renderLibraryProducts(){
  if(matchAuditActive){
    syncMatchAuditMode();
    return;
  }
  renderBrandTabs();
  renderPackTabs();
  renderSourceTabs();
  syncStateControls();
  const products=filteredLibraryProducts();

  if(activeRootGroup){
    $("#libraryTitle").textContent=activeManualGroupName()||"Sản phẩm";
  }else{
    $("#libraryTitle").textContent="Sản phẩm";
  }

  const hint=$("#catalogHint");
  if(hint){
    hint.textContent=activePackKind
      ?"Chế độ "+activePackKind+" · tìm kiếm hoặc chọn sản phẩm."
      :"Chọn cách mua trước, sau đó tìm sản phẩm theo thời gian thực.";
  }

  const visible=products;
  const headerProducts=headerLibraryProducts();

  $("#libraryCount").textContent=headerProducts.length
    ?headerProducts.length+" sản phẩm"
    :"";

  renderActiveProductView(visible);
  $("#libraryEmpty").hidden=products.length!==0;

  if(!products.length){
    $("#libraryEmpty").textContent=libraryQuery
      ?"Không có sản phẩm khớp tất cả từ đang tìm."
      :"Chưa có sản phẩm trong nhóm này.";
  }

  renderResultPager();
  syncViewMode();
  renderCategoryContext(products);
}

async function loadLibraryProducts(force=false){
  if(!API)return;
  $("#libraryProducts").innerHTML='<tr class="catalog-loading-row"><td colspan="12">Đang đọc thư viện Supabase...</td></tr>';
  $("#productGrid").innerHTML='<div class="grid-loading">Đang đọc thư viện Supabase...</div>';
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

  document.querySelectorAll(".product-card").forEach(x=>x.classList.remove("selected"));
  const card=document.querySelector('.product-card[data-url="'+CSS.escape(url)+'"]');
  if(card)card.classList.add("selected");

  const key=canonical(url);
  syncDetailCategoryLabel(url);
  const localRow=libraryByUrl.get(key);
  if(localRow){
    wantedUrl=url;
    $("#url").value=url;
    $("#detailEmpty").hidden=true;
    renderPayload(payloadFromLibraryRow(localRow));
    const sizeHost=$("#productSize");
    if(sizeHost)sizeHost.textContent=detailSizeForUrl(url);
    const groupHost=$("#group");
    const sourceGroup=detailGroupForUrl(url);
    if(groupHost&&sourceGroup)groupHost.textContent=sourceGroup;
    syncWatchCheckbox(preferenceStateForUrl(url));
    return;
  }

  // Fallback only for direct/deep links that are not already in the in-memory library.
  if(card)card.classList.add("loading");
  try{
    const r=await apiFetch("/api/library?view=item&url="+encodeURIComponent(url));
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||"not_found");
    wantedUrl=url;
    $("#url").value=url;
    $("#detailEmpty").hidden=true;
    renderPayload(data.payload);
    if(data.payload)mergePayloadIntoLibraryCache(data.payload);
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
    activeRootGroup="";
    activeGroupUrl="";
    activeBrand="";
    libraryQuery="";
    $("#librarySearch").value="";
  }
  if(!libraryLoaded){
    await loadLibraryProducts(false);
  }else{
    renderCategoryMenu();
    renderLibraryProducts();
  }
  if(matchAuditLoaded){
    matchAuditLoaded=false;
    if(matchAuditActive)await loadMatchAudit(true);
  }
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

function selectCategoryChip(chip){
  if(!chip)return;
  activeRootGroup=chip.dataset.root||"";
  activeGroupUrl=chip.dataset.group||"";
  activeBrand="";
  // Keep activePackKind: shopping mode > category.
  libraryPage=1;
  libraryQuery="";
  $("#librarySearch").value="";
  resetBrowseDetail();
  closeMobileCategoryNav();
  renderCategoryMenu();
  renderLibraryProducts();
}

$("#categoryTabs").addEventListener("click",e=>{
  selectCategoryChip(e.target.closest(".category-chip"));
});

const categoryAllPinned=$("#categoryAllPinned");
if(categoryAllPinned){
  categoryAllPinned.addEventListener("click",()=>selectCategoryChip(categoryAllPinned));
}

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
  if(e.key!=="Escape")return;
  closeImageZoom();
  closeMobileCategoryNav();
  closeSourceManager();
});

$("#backToCategory").addEventListener("click",()=>{
  resetBrowseDetail();
  renderCategoryContext(filteredLibraryProducts());
});

$("#detailImage").addEventListener("click",e=>{
  const image=e.currentTarget;
  if(image&&image.src)openImageZoom(image.currentSrc||image.src,image.alt||"Ảnh sản phẩm");
});
$("#closeImageZoom").addEventListener("click",closeImageZoom);
$("#imageZoom").addEventListener("click",e=>{
  if(e.target.id==="imageZoom")closeImageZoom();
});


$("#brandTabs").addEventListener("click",e=>{
  const chip=e.target.closest(".brand-chip");
  if(!chip)return;
  activeBrand=chip.dataset.brand||"";
  // Keep activePackKind: shopping mode > brand.
  libraryPage=1;
  resetBrowseDetail();
  document.querySelectorAll(".brand-chip").forEach(x=>x.classList.remove("active"));
  chip.classList.add("active");
  renderLibraryProducts();
});


$("#packTabs").addEventListener("click",e=>{
  const chip=e.target.closest(".pack-chip");
  if(!chip)return;
  const nextPack=chip.dataset.pack||"";
  activePackKind=activePackKind===nextPack?"":nextPack;
  libraryPage=1;
  if(activePackKind)localStorage.setItem("getlink:filter-pack",activePackKind);
  else localStorage.removeItem("getlink:filter-pack");
  resetBrowseDetail();
  renderLibraryProducts();
});

function handleSourceChipClick(e){
  const chip=e.target.closest(".source-chip[data-source]");
  if(!chip)return;
  setActiveSourceFilter(chip.dataset.source||"");
}
const sourceTabsSidebar=$("#sourceTabs");
if(sourceTabsSidebar)sourceTabsSidebar.addEventListener("click",handleSourceChipClick);
const sourceTabsInline=$("#sourceTabsInline");
if(sourceTabsInline)sourceTabsInline.addEventListener("click",handleSourceChipClick);

function queueLibrarySearch(value){
  const next=String(value||"").trim();
  if(searchFrame)cancelAnimationFrame(searchFrame);
  searchFrame=requestAnimationFrame(()=>{
    searchFrame=0;
    libraryQuery=next;
    libraryPage=1;
    resetBrowseDetail();
    const activeScroller=libraryView==="table"?$("#tableView"):$("#productGrid");
    if(activeScroller)activeScroller.scrollTop=0;
    renderLibraryProducts();
  });
}

$("#librarySearch").addEventListener("input",e=>{
  if(e.isComposing)return;
  queueLibrarySearch(e.target.value);
});

$("#librarySearch").addEventListener("compositionend",e=>{
  queueLibrarySearch(e.target.value);
});





$("#toggleMatchAudit").addEventListener("click",async()=>{
  matchAuditActive=!matchAuditActive;
  syncMatchAuditMode();
  if(matchAuditActive){
    $("#libraryTitle").textContent="Ghép thử Sữa · BHX ↔ WinMart";
    $("#libraryCount").textContent="";
    await loadMatchAudit(false);
  }else{
    renderLibraryProducts();
  }
});

$("#tableSourceSort").addEventListener("click",()=>{
  tableSourceSort="";
  viewRenderState.table.key="";
  viewRenderState.table.rendered=0;
  setActiveSourceFilter(nextTableSourceFilter());
});

document.querySelector(".view-switch").addEventListener("click",e=>{
  const button=e.target.closest(".view-button");
  if(!button)return;
  const next=button.dataset.view==="table"?"table":"grid";
  if(next===libraryView)return;
  libraryView=next;
  localStorage.setItem("getlink:view-mode",libraryView);
  syncViewMode();
  renderActiveProductView(filteredLibraryProducts());
  requestAnimationFrame(()=>{
    const host=libraryView==="table"?$("#tableView"):$("#productGrid");
    if(host&&host.scrollHeight-host.clientHeight<900){
      appendLocalViewBatch(libraryView);
    }
  });
});

$("#productGrid").addEventListener("click",async e=>{
  const zoomImage=e.target.closest(".grid-product-image img");
  if(zoomImage&&isCompactBrowse()){
    e.preventDefault();
    e.stopPropagation();
    openImageZoom(zoomImage.currentSrc||zoomImage.src,zoomImage.alt||"Ảnh sản phẩm");
    return;
  }

  const watch=e.target.closest(".grid-watch-button");
  if(watch){
    e.preventDefault();
    e.stopPropagation();
    if(watch.disabled)return;

    const url=watch.dataset.url||"";
    const key=canonical(url);
    const row=libraryByUrl.get(key);
    const wasWatch=watch.dataset.watch==="1";
    const next=wasWatch?"normal":"watch";

    // Optimistic UI: the heart changes immediately; persistence happens after.
    watch.dataset.watch=wasWatch?"0":"1";
    watch.classList.toggle("active",!wasWatch);
    watch.innerHTML=watchIconSvg(!wasWatch);
    watch.setAttribute("aria-label",wasWatch?"Đánh dấu quan tâm":"Bỏ quan tâm");
    if(row){
      row.preference_state=next;
      libraryRenderVersion+=1;
    }

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

const openSourceManagerButton=$("#openSourceManager");
if(openSourceManagerButton)openSourceManagerButton.addEventListener("click",openSourceManager);
$("#closeSourceManager").addEventListener("click",closeSourceManager);
$("#sourceManagerPanel").addEventListener("click",e=>{
  if(e.target===$("#sourceManagerPanel"))closeSourceManager();
});
$("#sourceManagerKinds").addEventListener("click",e=>{
  const btn=e.target.closest("button[data-kind]");
  if(!btn)return;
  const nextKind=btn.dataset.kind==="manual"
    ?"manual"
    :(btn.dataset.kind==="group"?"group":"brand");
  if(nextKind!==sourceManagerKind||nextKind!=="manual")closeSourceManagerManualGroup();
  sourceManagerKind=nextKind;
  sourceManagerLimit=200;
  renderSourceManager();
});
$("#sourceManagerSources").addEventListener("click",e=>{
  const btn=e.target.closest("button[data-source]");
  if(!btn)return;
  sourceManagerSource=["all","wm","bhx","go"].includes(btn.dataset.source)?btn.dataset.source:"all";
  sourceManagerLimit=200;
  renderSourceManager();
});
$("#sourceManagerSearch").addEventListener("input",e=>{
  sourceManagerQuery=String(e.target.value||"").trim();
  sourceManagerLimit=200;
  renderSourceManager();
});
$("#sourceManagerMore").addEventListener("click",()=>{
  sourceManagerLimit+=200;
  renderSourceManager();
});

$("#sourceManagerRows").addEventListener("click",e=>{
  const back=e.target.closest("#sourceManagerDetailBack");
  if(back){
    closeSourceManagerManualGroup();
    return;
  }
  const row=e.target.closest("[data-manual-key]");
  if(!row)return;
  openSourceManagerManualGroup(row.dataset.manualKey||"").catch(()=>{
    $("#sourceManagerRows").innerHTML=
      '<div class="source-manager-empty">Chưa đọc được sản phẩm trong nhóm.</div>';
  });
});
$("#sourceManagerRows").addEventListener("keydown",e=>{
  if(e.key!=="Enter"&&e.key!==" ")return;
  const row=e.target.closest("[data-manual-key]");
  if(!row)return;
  e.preventDefault();
  row.click();
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
    const r=await apiFetch(
      "/api/result?id="+encodeURIComponent(requestId),
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
        setJobStage("saving","Đã có response · đang chuẩn hóa và lưu vào Supabase...");
      }else if(data.status==="running"){
        setJobStage("brightdata","Đang xử lý response từ "+(inputSourceName(wantedUrl)||"nguồn")+"...");
      }else{
        setJobStage("queued","Đang chờ tiến trình lấy giá...");
      }
      return false;
    }

    stopPolling();
    renderPayload(data.payload);
    $("#registryCount").textContent="Kho link: "+Number(data.registry_count||0);
    const finishedUrl=data.payload&&data.payload.input_url||wantedUrl;
    clearPending(true);
    setGetBusy(false);
    setJobStage("complete",doneStatus());
    mergePayloadIntoLibraryCache(data.payload);
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
    return host==="bachhoaxanh.com"||host==="winmart.vn"||host==="sieuthi-go.vn";
  }catch{
    return false;
  }
}

function inputSourceName(raw){
  try{
    const host=new URL(String(raw||"")).hostname.toLowerCase().replace(/^www\./,"");
    if(host==="winmart.vn")return "WinMart";
    if(host==="sieuthi-go.vn")return "GO!";
    return "Bách Hóa XANH";
  }catch{
    return "";
  }
}

$("#get").addEventListener("click",async()=>{
  const url=$("#url").value.trim();

  if(!supportedSourceUrl(url)){
    setJobStage("error","Chỉ hỗ trợ link bachhoaxanh.com, winmart.vn hoặc sieuthi-go.vn.");
    return;
  }
  if(!API){
    setJobStage("error","GETLINK Supabase chưa được triển khai.");
    return;
  }

  wantedUrl=url;
  setGetBusy(true);
  jobStartedAt=Date.now();
  lastPollAt=0;
  localStorage.setItem("getlink:request-started-at",String(jobStartedAt));
  setJobStage("checking","Đang kiểm tra thư viện Supabase...");

  try{
    const r=await apiFetch("/api/get-price",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({url,force:true})
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
          ?"Đã đọc ngay từ Supabase vì link được lấy trong vòng 24 giờ."
          :doneStatus()
      );
      mergePayloadIntoLibraryCache(data.payload);
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


const AUTO_UPDATE_CHECK_MS=30000;
const AUTO_UPDATE_ATTEMPT_KEY="getlink:auto-update-attempt";
let autoUpdateBusy=false;
let pendingAutoUpdateVersion="";

function assetVersionFromUrl(raw){
  try{
    return new URL(String(raw||""),location.href).searchParams.get("v")||"";
  }catch{
    return "";
  }
}

function currentUiAssetVersion(){
  const appScript=[...document.scripts].find(x=>String(x.src||"").includes("app.js"));
  const configScript=[...document.scripts].find(x=>String(x.src||"").includes("config.js"));
  const styleLink=[...document.querySelectorAll('link[rel="stylesheet"]')]
    .find(x=>String(x.href||"").includes("style.css"));

  return [
    assetVersionFromUrl(appScript&&appScript.src),
    assetVersionFromUrl(styleLink&&styleLink.href),
    assetVersionFromUrl(configScript&&configScript.src)
  ].join("|");
}

function remoteUiAssetVersion(markup){
  const html=String(markup||"");
  const pick=re=>{
    const m=html.match(re);
    if(!m||!m[1])return "";
    try{return decodeURIComponent(m[1]);}catch{return m[1];}
  };
  const appVersion=pick(/<script[^>]*\bsrc=["'][^"']*app\.js\?v=([^"'&]+)[^"']*["'][^>]*>/i);
  const styleVersion=pick(/<link[^>]*\bhref=["'][^"']*style\.css\?v=([^"'&]+)[^"']*["'][^>]*>/i);
  const configVersion=pick(/<script[^>]*\bsrc=["'][^"']*config\.js\?v=([^"'&]+)[^"']*["'][^>]*>/i);
  if(!appVersion)return "";
  return [appVersion,styleVersion,configVersion].join("|");
}

function autoUpdateEditingActive(){
  const el=document.activeElement;
  if(!el)return false;
  return Boolean(
    el.isContentEditable||
    el.matches&&el.matches("input,textarea,select")
  );
}

function clearAutoUpdateUrlMarker(){
  try{
    const u=new URL(location.href);
    if(!u.searchParams.has("__getlink_v"))return;
    u.searchParams.delete("__getlink_v");
    history.replaceState(history.state,"",u.pathname+u.search+u.hash);
  }catch{}
}

function applyAutoUpdate(remoteVersion){
  if(!remoteVersion)return;
  if(autoUpdateEditingActive()){
    pendingAutoUpdateVersion=remoteVersion;
    return;
  }

  try{
    const now=Date.now();
    const previous=JSON.parse(sessionStorage.getItem(AUTO_UPDATE_ATTEMPT_KEY)||"{}");
    if(previous.version===remoteVersion&&now-Number(previous.at||0)<60000)return;
    sessionStorage.setItem(
      AUTO_UPDATE_ATTEMPT_KEY,
      JSON.stringify({version:remoteVersion,at:now})
    );
  }catch{}

  const next=new URL(location.href);
  next.searchParams.delete("__getlink_version_check");
  next.searchParams.set("__getlink_v",remoteVersion);
  location.replace(next.toString());
}

function applyPendingAutoUpdate(){
  if(!pendingAutoUpdateVersion||autoUpdateEditingActive())return;
  const remoteVersion=pendingAutoUpdateVersion;
  pendingAutoUpdateVersion="";
  applyAutoUpdate(remoteVersion);
}

async function checkUiVersion(){
  if(autoUpdateBusy||document.visibilityState==="hidden")return;
  autoUpdateBusy=true;
  try{
    const checkUrl=new URL(location.href);
    checkUrl.hash="";
    checkUrl.searchParams.delete("__getlink_v");
    checkUrl.searchParams.set("__getlink_version_check",String(Date.now()));

    const response=await fetch(checkUrl.toString(),{cache:"no-store"});
    if(!response.ok)return;

    const remoteVersion=remoteUiAssetVersion(await response.text());
    const currentVersion=currentUiAssetVersion();
    if(!remoteVersion||!currentVersion)return;

    if(remoteVersion===currentVersion){
      pendingAutoUpdateVersion="";
      try{sessionStorage.removeItem(AUTO_UPDATE_ATTEMPT_KEY);}catch{}
      clearAutoUpdateUrlMarker();
      return;
    }

    pendingAutoUpdateVersion=remoteVersion;
    applyPendingAutoUpdate();
  }catch{
    // Network/version checks must never interrupt normal catalog use.
  }finally{
    autoUpdateBusy=false;
  }
}

function startAutoUpdateChecks(){
  setTimeout(checkUiVersion,2500);
  setInterval(checkUiVersion,AUTO_UPDATE_CHECK_MS);

  window.addEventListener("focus",checkUiVersion);
  window.addEventListener("online",checkUiVersion);
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible")checkUiVersion();
  });
  document.addEventListener("focusout",()=>{
    setTimeout(applyPendingAutoUpdate,0);
  });
}

startAutoUpdateChecks();
startClassificationAutoRefresh();

const saved=localStorage.getItem("getlink:last-url")||"";
if(saved)$("#url").value=saved;
requestId=localStorage.getItem("getlink:request-id")||"";
wantedUrl=saved;

refreshCatalog();

syncViewMode();
initCatalogLocalObserver();

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
