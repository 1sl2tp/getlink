(()=>{
  "use strict";

  // TAPHOA_HOT_PATHS_V1
  const QTY_KEY="getlink:user-work-order-qty";
  const NOTE_KEY="getlink:work-order-line-notes-v1";
  const NativeMutationObserver=window.MutationObserver;
  const qtyState=new Map();
  let qtyHydrated=false;
  let taphoaIndex=[];
  let taphoaIndexByUrl=new Map();
  let taphoaIndexSource=null;
  let taphoaIndexLength=-1;
  let searchTimer=0;
  let patched=false;
  let originalRowsForScope=null;
  let originalDesktopAutoload=null;
  let originalMobileAutoload=null;
  let sourceRailObserver=null;

  function elementTarget(record){
    const node=record&&record.target;
    if(!node)return null;
    return node.nodeType===1?node:node.parentElement||null;
  }

  function filterFeedbackObserverRecords(records){
    return records.filter(record=>{
      const target=elementTarget(record);
      if(!target)return true;
      if(target.closest?.(".order-detail-pane"))return false;
      if(target.closest?.(".order-index-list"))return false;
      if(target.closest?.(".taphoa-sales-preview"))return false;
      if(target.id==="userWorkSelectedCount"||target.id==="mobileUserSelectedCount")return false;
      if(target.matches?.(".user-work-order-qty b,.mobile-user-qty b"))return false;
      return true;
    });
  }

  if(typeof NativeMutationObserver==="function"){
    window.MutationObserver=class TaphoaMutationObserver extends NativeMutationObserver{
      constructor(callback){
        super((records,observer)=>{
          const filtered=filterFeedbackObserverRecords(records);
          if(filtered.length)callback(filtered,observer);
        });
      }
    };
  }

  function normalizeText(value){
    try{
      if(typeof searchKey==="function")return searchKey(value);
    }catch{}
    return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/đ/g,"d").replace(/[^a-z0-9]+/g," ").trim();
  }

  function qtyKey(url){
    try{
      if(typeof canonical==="function")return canonical(url)||String(url||"").trim().toLowerCase();
    }catch{}
    return String(url||"").trim().toLowerCase();
  }

  function hydrateQtyState(){
    if(qtyHydrated)return;
    qtyHydrated=true;
    try{
      const raw=JSON.parse(localStorage.getItem(QTY_KEY)||"{}");
      for(const [key,value] of Object.entries(raw&&typeof raw==="object"?raw:{})){
        const qty=Math.max(0,Math.min(999,Math.round(Number(value)||0)));
        if(qty)qtyState.set(String(key),qty);
      }
    }catch{}
  }

  function persistQtyState(){
    try{localStorage.setItem(QTY_KEY,JSON.stringify(Object.fromEntries(qtyState)));}catch{}
  }

  function isTaphoaQtyKey(key){
    return String(key||"").includes("get.taphoa.xyz/nguon-hang/");
  }

  function noteForUrl(url){
    try{
      const notes=JSON.parse(localStorage.getItem(NOTE_KEY)||"{}");
      return String(notes&&notes[String(url||"").trim().toLowerCase()]||"").slice(0,160);
    }catch{return "";}
  }

  function updateSummaryFast(){
    hydrateQtyState();
    let lines=0,products=0;
    for(const [key,qty] of qtyState){
      if(!qty||!isTaphoaQtyKey(key))continue;
      lines+=1;
      products+=qty;
    }
    const text="Đã chọn "+lines+" dòng · "+products+" sản phẩm";
    const desktop=document.getElementById("userWorkSelectedCount");
    const mobile=document.getElementById("mobileUserSelectedCount");
    const send=document.getElementById("userWorkSendOrder");
    const mobileSend=document.getElementById("mobileUserSendOrder");
    if(desktop&&desktop.textContent!==text)desktop.textContent=text;
    if(mobile&&mobile.textContent!==text)mobile.textContent=text;
    const disabled=lines===0;
    if(send)send.setAttribute("aria-disabled",disabled?"true":"false");
    if(mobileSend)mobileSend.setAttribute("aria-disabled",disabled?"true":"false");
    document.dispatchEvent(new CustomEvent("getlink-cart-change",{detail:{count:lines,products}}));
    return {lines,products};
  }

  function updateQtyDom(button,next){
    const box=button.closest("[data-work-url]");
    if(!box)return;
    const value=box.querySelector("b");
    if(value)value.textContent=String(next);
    const surface=button.closest(".mobile-user-product-card,.user-work-order-row");
    if(surface)surface.classList.toggle("is-selected",next>0);
  }

  function installQtyFunctions(){
    hydrateQtyState();
    try{
      userWorkQty=function(url){
        return Math.max(0,Number(qtyState.get(qtyKey(url))||0)||0);
      };
      setUserWorkQty=function(url,value){
        const key=qtyKey(url);
        if(!key)return 0;
        const next=Math.max(0,Math.min(999,Math.round(Number(value)||0)));
        if(next)qtyState.set(key,next);else qtyState.delete(key);
        persistQtyState();
        try{mobileUserScopeViewCache.delete("mine");}catch{}
        return next;
      };
      updateUserWorkOrderSummary=updateSummaryFast;
      window.updateUserWorkOrderSummary=updateSummaryFast;
    }catch{}
  }

  function buildTaphoaIndex(force=false){
    let cache=[];
    try{cache=Array.isArray(libraryCache)?libraryCache:[];}catch{}
    if(!force&&taphoaIndexSource===cache&&taphoaIndexLength===cache.length)return taphoaIndex;
    taphoaIndexSource=cache;
    taphoaIndexLength=cache.length;
    taphoaIndex=cache
      .filter(row=>{
        try{return String(row?.preference_state||"normal")!=="hidden"&&isMineRow(row);}catch{return false;}
      })
      .map((row,index)=>({
        row,
        index,
        key:qtyKey(row?.canonical_url),
        hay:(()=>{try{return userWorkSearchKey(row);}catch{return normalizeText([row?.canonical_product_name,row?.product_name,row?.supplier_source_name].filter(Boolean).join(" "));}})()
      }));
    taphoaIndexByUrl=new Map(taphoaIndex.filter(item=>item.key).map(item=>[item.key,item.row]));
    return taphoaIndex;
  }

  function selectedItemsFast(){
    hydrateQtyState();
    buildTaphoaIndex(false);
    const selected=[];
    for(const [key,qty] of qtyState){
      if(!qty||!isTaphoaQtyKey(key))continue;
      const row=taphoaIndexByUrl.get(key);
      if(!row)continue;
      selected.push({row,qty,bargain:0,lineNote:noteForUrl(row?.canonical_url)});
    }
    return selected;
  }

  function installSelectedItemsFast(){
    try{userWorkSelectedItems=selectedItemsFast;}catch{}
    window.userWorkSelectedItems=selectedItemsFast;
  }

  let cartLoadWrapper=null;
let cartClearWrapper=null;
function syncQtyStateFromStorage(){
  qtyState.clear();
  qtyHydrated=false;
  hydrateQtyState();
}
function clearSelectedNotes(items){
  try{
    const notes=JSON.parse(localStorage.getItem(NOTE_KEY)||"{}");
    let changed=false;
    for(const item of Array.isArray(items)?items:[]){
      const key=String(item?.row?.canonical_url||"").trim().toLowerCase();
      if(key&&Object.prototype.hasOwnProperty.call(notes,key)){delete notes[key];changed=true;}
    }
    if(changed)localStorage.setItem(NOTE_KEY,JSON.stringify(notes));
  }catch{}
}
function installCartLifecycleFast(){
  const currentLoad=window.loadUserWorkOrderSelection;
  if(typeof currentLoad==="function"&&currentLoad!==cartLoadWrapper){
    const baseLoad=currentLoad;
    cartLoadWrapper=function(order){
      const result=baseLoad.apply(this,arguments);
      syncQtyStateFromStorage();
      updateSummaryFast();
      return result;
    };
    window.loadUserWorkOrderSelection=cartLoadWrapper;
  }
  const currentClear=window.clearUserWorkOrderSelection;
  if(typeof currentClear==="function"&&currentClear!==cartClearWrapper){
    const baseClear=currentClear;
    cartClearWrapper=function(){
      const selected=selectedItemsFast();
      clearSelectedNotes(selected);
      qtyState.clear();
      qtyHydrated=true;
      persistQtyState();
      const result=baseClear.apply(this,arguments);
      qtyState.clear();
      qtyHydrated=true;
      persistQtyState();
      updateSummaryFast();
      return result;
    };
    window.clearUserWorkOrderSelection=cartClearWrapper;
  }
}

  function taphoaRowsForQuery(categoryKey=""){
    const indexed=buildTaphoaIndex(false);
    let candidates=indexed;
    if(categoryKey){
      candidates=indexed.filter(item=>{
        try{return userWorkRowCategoryKey(item.row,"mine")===categoryKey;}catch{return true;}
      });
    }
    let q="";
    try{q=normalizeText(libraryQuery);}catch{}
    const tokens=q.split(/\s+/).filter(Boolean);
    if(!tokens.length)return candidates.map(item=>item.row);

    const strict=candidates.filter(item=>tokens.every(token=>item.hay.includes(token)));
    let selected=strict;
    let rankQ=q;
    let rankTokens=tokens;
    if(!strict.length&&tokens.length>1){
      let fallback=tokens[tokens.length-1]||"";
      try{fallback=userWorkFallbackToken(tokens)||fallback;}catch{}
      if(fallback){
        selected=candidates.filter(item=>item.hay.includes(fallback));
        rankQ=fallback;
        rankTokens=[fallback];
      }
    }
    return selected
      .map(item=>({
        ...item,
        rank:(()=>{try{return userWorkSearchRank(item.row,rankQ,rankTokens);}catch{return item.index;}})()
      }))
      .sort((a,b)=>a.rank-b.rank||a.index-b.index)
      .map(item=>item.row);
  }

  function setEmpty(node,empty,message){
    if(!node)return;
    node.hidden=!empty;
    if(empty&&message)node.textContent=message;
  }

  function installTaphoaRowsScope(){
    try{
      if(!originalRowsForScope)originalRowsForScope=userWorkRowsForScope;
      userWorkRowsForScope=function(scope,categoryKey=""){
        if(scope==="mine")return taphoaRowsForQuery(categoryKey);
        return originalRowsForScope(scope,categoryKey);
      };
    }catch{}
  }

  function appendTaphoaRows(rows,start,end){
    const host=document.getElementById("userWorkMineRows");
    if(!host)return 0;
    const chunk=rows.slice(start,end);
    if(!chunk.length)return 0;
    host.insertAdjacentHTML("beforeend",chunk.map(row=>userWorkMineRow(row)).join(""));
    return chunk.length;
  }

  function installTaphoaAutoload(hasMore){
    try{
      if(userWorkDesktopAutoLoadObserver){userWorkDesktopAutoLoadObserver.disconnect();userWorkDesktopAutoLoadObserver=null;}
    }catch{}
    if(!hasMore)return;
    const root=(()=>{try{return userWorkDesktopScrollRoot();}catch{return null;}})();
    const target=document.getElementById("userWorkMineRows")?.lastElementChild;
    if(!root||!target)return;
    try{
      userWorkDesktopAutoLoadObserver=new IntersectionObserver(entries=>{
        if(!entries.some(entry=>entry.isIntersecting))return;
        try{if(userWorkDesktopAutoLoadBusy)return;userWorkDesktopAutoLoadBusy=true;}catch{}
        const rows=taphoaRowsForQuery((()=>{try{return userWorkDesktopCategoryKey;}catch{return "";}})());
        let start=0;
        try{start=userWorkMineLimit;userWorkMineLimit+=20;}catch{start=document.getElementById("userWorkMineRows")?.children.length||0;}
        const end=Math.min(rows.length,start+20);
        appendTaphoaRows(rows,start,end);
        requestAnimationFrame(()=>{
          try{userWorkDesktopAutoLoadBusy=false;}catch{}
          installTaphoaAutoload(end<rows.length);
        });
      },{root,rootMargin:"280px 0px",threshold:0.01});
      userWorkDesktopAutoLoadObserver.observe(target);
    }catch{}
  }

  function patchDesktopAutoload(){
    try{
      if(!originalDesktopAutoload)originalDesktopAutoload=setupUserWorkDesktopAutoLoad;
      setupUserWorkDesktopAutoLoad=function(hasMore){
        if(userWorkDesktopScope!=="mine")return originalDesktopAutoload(hasMore);
        return installTaphoaAutoload(hasMore);
      };
    }catch{}
  }

  function appendMobileTaphoaRows(rows,start,end){
    const host=document.getElementById("mobileUserResults");
    if(!host)return 0;
    const chunk=rows.slice(start,end);
    if(!chunk.length)return 0;
    host.insertAdjacentHTML("beforeend",chunk.map(row=>mobileUserMineCard(row)).join(""));
    return chunk.length;
  }

  function patchMobileAutoload(){
    try{
      if(!originalMobileAutoload)originalMobileAutoload=setupMobileUserAutoLoad;
      setupMobileUserAutoLoad=function(){
        if(mobileUserScope!=="mine")return originalMobileAutoload();
        try{
          if(mobileUserAutoLoadObserver){mobileUserAutoLoadObserver.disconnect();mobileUserAutoLoadObserver=null;}
        }catch{}
        const rows=taphoaRowsForQuery((()=>{try{return mobileUserCategoryKey;}catch{return "";}})());
        const host=document.getElementById("mobileUserResults");
        const target=host?.lastElementChild;
        let start=0;
        try{start=mobileUserLimit;}catch{start=host?.children.length||0;}
        if(!target||start>=rows.length)return;
        try{
          mobileUserAutoLoadObserver=new IntersectionObserver(entries=>{
            if(!entries.some(entry=>entry.isIntersecting))return;
            try{if(mobileUserAutoLoadBusy)return;mobileUserAutoLoadBusy=true;}catch{}
            let from=0;
            try{from=mobileUserLimit;mobileUserLimit+=8;}catch{from=host.children.length;}
            const end=Math.min(rows.length,from+8);
            appendMobileTaphoaRows(rows,from,end);
            requestAnimationFrame(()=>{
              try{mobileUserAutoLoadBusy=false;}catch{}
              setupMobileUserAutoLoad();
            });
          },{root:host,rootMargin:"240px 0px",threshold:0.01});
          mobileUserAutoLoadObserver.observe(target);
        }catch{}
      };
    }catch{}
  }

  function renderTaphoaDesktopSearch(){
    const category=(()=>{try{return userWorkDesktopCategoryKey;}catch{return "";}})();
    const rows=taphoaRowsForQuery(category);
    let limit=12;
    try{userWorkMineLimit=12;limit=userWorkMineLimit;}catch{}
    const host=document.getElementById("userWorkMineRows");
    if(host)host.innerHTML=rows.slice(0,limit).map(row=>userWorkMineRow(row)).join("");
    setEmpty(document.getElementById("userWorkMineEmpty"),rows.length===0,"Chưa có sản phẩm Tạp hóa phù hợp.");
    installTaphoaAutoload(rows.length>limit);
    updateSummaryFast();
  }

  function renderTaphoaMobileSearch(){
    const category=(()=>{try{return mobileUserCategoryKey;}catch{return "";}})();
    const rows=taphoaRowsForQuery(category);
    let limit=8;
    try{mobileUserLimit=8;limit=mobileUserLimit;}catch{}
    const host=document.getElementById("mobileUserResults");
    if(host){
      host.innerHTML=rows.slice(0,limit).map(row=>mobileUserMineCard(row)).join("");
      host.dataset.hasMore=rows.length>limit?"1":"0";
    }
    setEmpty(document.getElementById("mobileUserEmpty"),rows.length===0,"Không có sản phẩm phù hợp.");
    try{setupMobileUserAutoLoad();}catch{}
    updateSummaryFast();
  }

  function scheduleTaphoaSearch(input,mobile){
    try{libraryQuery=String(input?.value||"").trim();}catch{return;}
    if(searchTimer)clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{
      searchTimer=0;
      requestAnimationFrame(()=>mobile?renderTaphoaMobileSearch():renderTaphoaDesktopSearch());
    },18);
  }

  function captureSearch(event){
    const input=event.target?.closest?.("#userWorkSearch,#mobileUserSearch");
    if(!input||event.isComposing)return;
    const mobile=input.id==="mobileUserSearch";
    try{
      if(mobile){if(mobileUserScope!=="mine")return;}
      else if(userWorkDesktopScope!=="mine")return;
    }catch{return;}
    event.stopImmediatePropagation();
    scheduleTaphoaSearch(input,mobile);
  }

  function captureQty(event){
    const button=event.target?.closest?.("[data-work-qty]");
    if(!button)return;
    const mine=button.closest("#userWorkMine,#mobileUserResults");
    if(!mine)return;
    const box=button.closest("[data-work-url]");
    const url=String(box?.dataset.workUrl||"");
    if(!url)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    let current=0,next=0;
    try{current=userWorkQty(url);next=setUserWorkQty(url,current+Number(button.dataset.workQty||0));}catch{return;}
    updateQtyDom(button,next);
    updateSummaryFast();
  }

  function currentAuth(){
    try{return JSON.parse(sessionStorage.getItem("getlink:chat-order-auth")||"null")||null;}catch{return null;}
  }

  function manualEndpoint(){
    const base=String(window.GETLINK_API_BASE||"").replace(/\/+$/,"");
    return base.replace(/\/getlink-api$/,"/getlink-product-add");
  }

  function insertManualProduct(product){
    if(!product||!product.canonical_url)return null;
    const price=Math.max(0,Number(product.price_vnd||0));
    const row={
      canonical_url:String(product.canonical_url),
      canonical_product_name:String(product.product_name||""),
      product_name:String(product.product_name||""),
      supplier_source_name:String(product.source_name||product.source_key||"Tạp hóa"),
      supplier_source_key:String(product.source_key||""),
      source_key:String(product.source_key||""),
      source:"Tạp hóa",
      source_name:"Tạp hóa",
      supplier_carton_price_vnd:price,
      web_carton_price:price,
      display_price_vnd:price,
      source_row:Number(product.source_row||0),
      product_code:String(product.product_code||""),
      preference_state:"normal"
    };
    try{
      const exists=libraryCache.some(item=>qtyKey(item?.canonical_url)===qtyKey(row.canonical_url));
      if(!exists)libraryCache.unshift(row);
      if(typeof rebuildLibraryIndex==="function")rebuildLibraryIndex();
    }catch{}
    buildTaphoaIndex(true);
    return row;
  }

  async function captureQuickAdd(event){
    const form=event.target?.closest?.("[data-taphoa-add-product]");
    if(!form)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const status=form.querySelector(".taphoa-quick-add-status");
    const button=form.querySelector('button[type="submit"]');
    const auth=currentAuth();
    const token=String(auth?.accessToken||"");
    if(!token){if(status)status.textContent="Cần đăng nhập Chat bằng Admin.";return;}
    const sourceKey=String(form.elements.sourceKey?.value||"").trim();
    const name=String(form.elements.name?.value||"").replace(/\s+/g," ").trim();
    const priceVnd=Number(String(form.elements.priceVnd?.value||"").replace(/\D+/g,"")||0);
    if(name.length<2){if(status)status.textContent="Nhập tên sản phẩm.";return;}
    if(!(priceVnd>0)){if(status)status.textContent="Nhập giá bán.";return;}
    if(button){button.disabled=true;button.textContent="Đang thêm…";}
    if(status)status.textContent="Đang thêm sản phẩm…";
    try{
      const headers={"content-type":"application/json","authorization":"Bearer "+token};
      if(window.GETLINK_API_KEY)headers.apikey=String(window.GETLINK_API_KEY);
      const response=await fetch(manualEndpoint(),{method:"POST",headers,body:JSON.stringify({sourceKey,name,priceVnd})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(response.status===409?"Sản phẩm này đã có.":(data.detail||data.error||"Chưa thêm được sản phẩm."));
      const row=insertManualProduct(data?.product);
      if(!row)throw new Error("Đã thêm nhưng dữ liệu trả về chưa đủ.");
      try{libraryQuery=name;}catch{}
      const desktop=document.getElementById("userWorkSearch");
      const mobile=document.getElementById("mobileUserSearch");
      if(desktop)desktop.value=name;
      if(mobile)mobile.value=name;
      if(status)status.textContent="Đã thêm sản phẩm.";
      renderTaphoaDesktopSearch();
      if(document.getElementById("mobileUserResults"))renderTaphoaMobileSearch();
    }catch(error){
      if(status)status.textContent=String(error?.message||error||"Chưa thêm được sản phẩm.");
    }finally{
      if(button){button.disabled=false;button.textContent="Thêm mới";}
    }
  }

  function moveOrderSourceLeft(){
    const nav=document.getElementById("workspaceNav");
    const manager=document.getElementById("orderManager");
    if(!nav)return;
    let slot=nav.querySelector(".taphoa-source-left-slot");
    if(!slot){
      slot=document.createElement("div");
      slot.className="taphoa-source-left-slot";
      slot.hidden=true;
      nav.appendChild(slot);
    }
    const fresh=document.querySelector(".order-workspace-v2 .order-source-report");
    if(fresh&&fresh.parentElement!==slot)slot.replaceChildren(fresh);
    const report=fresh||slot.querySelector(".order-source-report");
    const visible=Boolean(manager&&!manager.hidden&&manager.getClientRects().length&&report);
    slot.hidden=!visible;
  }

  function installSourceRailWatcher(){
    if(sourceRailObserver)return;
    const host=document.querySelector(".workspace-list");
    if(host){
      sourceRailObserver=new NativeMutationObserver(()=>requestAnimationFrame(moveOrderSourceLeft));
      sourceRailObserver.observe(host,{subtree:true,childList:true,attributes:true,attributeFilter:["hidden","class"]});
    }
    document.addEventListener("click",()=>requestAnimationFrame(moveOrderSourceLeft),true);
    moveOrderSourceLeft();
  }

  function patchGlobals(){
    if(patched)return true;
    try{
      if(typeof libraryCache==="undefined"||typeof isMineRow!=="function"||typeof userWorkMineRow!=="function")return false;
      installQtyFunctions();
      installTaphoaRowsScope();
      installSelectedItemsFast();
      installCartLifecycleFast();
      patchDesktopAutoload();
      patchMobileAutoload();
      buildTaphoaIndex(true);
      installSourceRailWatcher();
      updateSummaryFast();
      patched=true;
      [50,250,1000,2000].forEach(delay=>setTimeout(()=>{
        installSelectedItemsFast();
        installCartLifecycleFast();
      },delay));
      return true;
    }catch{return false;}
  }

  document.addEventListener("input",captureSearch,true);
  document.addEventListener("compositionend",captureSearch,true);
  document.addEventListener("click",captureQty,true);
  document.addEventListener("submit",event=>{void captureQuickAdd(event);},true);

  let attempts=0;
  const timer=setInterval(()=>{
    attempts+=1;
    if(patchGlobals()||attempts>240)clearInterval(timer);
  },25);
  if(document.readyState!=="loading")patchGlobals();
})();
