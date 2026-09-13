(()=>{
  "use strict";

  const SALES_HEADERS=["Sản phẩm","Giá","Số lượng","Ghi chú"];
  const NOTE_KEY="getlink:work-order-line-notes-v1";
  const NOTE_MAX=160;
  const orderCache=new Map();
  let syncFrame=0;
  let exportsPatched=false;
  let fetchPatched=false;
  let fastSearchTimer=0;
  let searchKeyPatched=false;
  let searchKeyCache=new WeakMap();
  // TAPHOA_FAST_SEARCH_20260913

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function escapeAttr(value){return escapeHtml(value).replace(/`/g,"&#96;")}
  function noteKey(url){return String(url||"").trim().toLowerCase()}
  function readNotes(){
    try{
      const value=JSON.parse(localStorage.getItem(NOTE_KEY)||"{}");
      return value&&typeof value==="object"?value:{};
    }catch{return {}}
  }
  function noteFor(url){return String(readNotes()[noteKey(url)]||"").slice(0,NOTE_MAX)}
  function setNote(url,value){
    const key=noteKey(url);if(!key)return "";
    const notes=readNotes(),next=String(value||"").replace(/\s+/g," ").trimStart().slice(0,NOTE_MAX);
    if(next)notes[key]=next;else delete notes[key];
    try{localStorage.setItem(NOTE_KEY,JSON.stringify(notes));}catch{}
    return next;
  }
  function clearNotes(urls=[]){
    const notes=readNotes();let changed=false;
    for(const url of urls){const key=noteKey(url);if(key&&Object.prototype.hasOwnProperty.call(notes,key)){delete notes[key];changed=true;}}
    if(changed){try{localStorage.setItem(NOTE_KEY,JSON.stringify(notes));}catch{}}
  }

  function isEmptyPrice(node){
    const text=String(node?.textContent||"").replace(/\s+/g," ").trim();
    return !text||text==="—"||text==="-";
  }
  function pickSingleSalePrice(row){
    const prices=row?.querySelectorAll?.(".user-work-order-price");
    if(!prices||prices.length<2)return;
    const primary=prices[0],secondary=prices[1];
    if(isEmptyPrice(primary)&&!isEmptyPrice(secondary))primary.innerHTML=secondary.innerHTML;
    if(secondary.getAttribute("aria-hidden")!=="true")secondary.setAttribute("aria-hidden","true");
  }
  function syncSalesHeader(){
    const head=document.querySelector("#userWorkMine .user-work-order-head");
    if(!head)return;
    const spans=[...head.children];
    if(spans.length<5)return;
    const labels=[SALES_HEADERS[0],SALES_HEADERS[1],"",SALES_HEADERS[2],SALES_HEADERS[3]];
    spans.forEach((span,index)=>{
      if(index<labels.length&&span.textContent!==labels[index])span.textContent=labels[index];
      if(index===2&&span.getAttribute("aria-hidden")!=="true")span.setAttribute("aria-hidden","true");
    });
    head.dataset.taphoaFeedback="1";
  }
  function syncSalesRows(){
    document.querySelectorAll("#userWorkMineRows .user-work-order-row").forEach(row=>{
      pickSingleSalePrice(row);
      const url=String(row.dataset.url||row.querySelector("[data-work-url]")?.dataset.workUrl||"");
      const input=row.querySelector(".user-work-order-bargain input");
      if(input&&!input.hasAttribute("data-work-note")){
        input.removeAttribute("data-work-bargain");
        input.removeAttribute("max");
        input.removeAttribute("inputmode");
        input.setAttribute("data-work-note",url);
        input.setAttribute("maxlength",String(NOTE_MAX));
        input.setAttribute("autocomplete","off");
        input.setAttribute("placeholder","Ghi chú");
        input.setAttribute("aria-label","Ghi chú sản phẩm");
        input.value=noteFor(url);
      }
      row.dataset.taphoaFeedback="1";
    });
  }

  function rememberOrders(payload){
    const rows=[];
    if(Array.isArray(payload?.orders))rows.push(...payload.orders);
    if(payload?.order)rows.push(payload.order);
    for(const order of rows){
      const id=String(order?.id||"");
      if(id)orderCache.set(id,order);
    }
    queueSync();
  }
  function syncOrderNotes(){
    document.querySelectorAll(".order-card[data-order-id]").forEach(card=>{
      const order=orderCache.get(String(card.dataset.orderId||""));
      if(!order||!Array.isArray(order.items))return;
      const lines=[...card.querySelectorAll(".order-card-items>div")];
      lines.forEach((line,index)=>{
        const note=String(order.items[index]?.note||"").trim();
        const current=line.querySelector(".order-item-note");
        if(!note){if(current)current.remove();return;}
        const text="Ghi chú: "+note;
        if(current){if(current.textContent!==text)current.textContent=text;return;}
        line.insertAdjacentHTML("beforeend",'<em class="order-item-note">'+escapeHtml(text)+"</em>");
      });
    });
  }

  function patchExports(){
    if(exportsPatched)return;
    const selected=window.userWorkSelectedItems;
    const load=window.loadUserWorkOrderSelection;
    const clear=window.clearUserWorkOrderSelection;
    if(typeof selected!=="function"||typeof load!=="function"||typeof clear!=="function")return;

    const originalSelected=selected;
    window.userWorkSelectedItems=function(){
      const rows=originalSelected.apply(this,arguments);
      return Array.isArray(rows)?rows.map(item=>({...item,bargain:0,lineNote:noteFor(item?.row?.canonical_url)})):rows;
    };

    const originalLoad=load;
    window.loadUserWorkOrderSelection=function(order){
      for(const item of Array.isArray(order?.items)?order.items:[]){
        if(item?.url)setNote(item.url,item.note||"");
      }
      const result=originalLoad.apply(this,arguments);
      queueSync();
      return result;
    };

    const originalClear=clear;
    window.clearUserWorkOrderSelection=function(){
      const active=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
      const urls=Array.isArray(active)?active.map(item=>item?.row?.canonical_url).filter(Boolean):[];
      const result=originalClear.apply(this,arguments);
      clearNotes(urls);
      queueSync();
      return result;
    };
    exportsPatched=true;
  }

  function shouldPatchOrderRequest(url,method){
    const text=String(url||"");
    return text.includes("/getlink-orders")&&(method==="POST"||method==="PUT");
  }
  function withLineNotes(body){
    if(!body||typeof body!=="object"||!Array.isArray(body.items))return body;
    return {...body,items:body.items.map(item=>({
      ...item,
      bargainPriceVnd:0,
      lineNote:noteFor(item?.url)
    }))};
  }
  function patchFetch(){
    if(fetchPatched||typeof window.fetch!=="function")return;
    const original=window.fetch.bind(window);
    window.fetch=async function(input,init={}){
      const url=typeof input==="string"?input:String(input?.url||"");
      const method=String(init?.method||input?.method||"GET").toUpperCase();
      let nextInit=init;
      if(shouldPatchOrderRequest(url,method)&&typeof init?.body==="string"){
        try{
          const parsed=JSON.parse(init.body);
          const next=withLineNotes(parsed);
          if(next!==parsed)nextInit={...init,body:JSON.stringify(next)};
        }catch{}
      }
      const response=await original(input,nextInit);
      if(url.includes("/getlink-orders")&&response?.ok){
        response.clone().json().then(rememberOrders).catch(()=>{});
      }
      return response;
    };
    fetchPatched=true;
  }

  function patchFastSearchIndex(){
    if(searchKeyPatched)return;
    if(typeof userWorkSearchKey!=="function")return;
    const original=userWorkSearchKey;
    userWorkSearchKey=function(row){
      if(row&&typeof row==="object"){
        const cached=searchKeyCache.get(row);
        if(cached!==undefined)return cached;
        const value=original(row);
        searchKeyCache.set(row,value);
        return value;
      }
      return original(row);
    };
    searchKeyPatched=true;
  }

  function currentChatOrderAuth(){
    try{return JSON.parse(sessionStorage.getItem("getlink:chat-order-auth")||"null")||null}catch{return null}
  }
  function manualProductSources(){
    try{
      if(typeof mobileSupplierSources==="function")return mobileSupplierSources();
    }catch{}
    return [];
  }
  function activeManualSource(mobile){
    const sources=manualProductSources();
    let active="";
    try{active=String(mobile?mobileUserCategoryKey:userWorkDesktopCategoryKey||"")}catch{}
    return sources.some(item=>item.key===active)?active:String(sources[0]?.key||"");
  }
  function trulyMissingMineProduct(){
    try{return String(libraryQuery||"").trim().length>0&&userWorkRowsForScope("mine","").length===0}catch{return false}
  }
  function quickAddMarkup(mobile=false){
    let query="";
    try{query=String(libraryQuery||"").trim()}catch{}
    if(query.length<2||!trulyMissingMineProduct())return "Chưa có sản phẩm Tạp hóa phù hợp.";
    const sources=manualProductSources();
    if(!sources.length)return "Không có sản phẩm phù hợp.";
    const selected=activeManualSource(mobile);
    const options=sources.map(item=>'<option value="'+escapeAttr(item.key)+'" '+(item.key===selected?"selected":"")+'>'+escapeHtml(item.label||item.key)+'</option>').join("");
    return '<form class="taphoa-quick-add" data-taphoa-add-product data-mobile="'+(mobile?"1":"0")+'">'+
      '<div class="taphoa-quick-add-copy"><strong>Không có “'+escapeHtml(query)+'”</strong><small>Thêm sản phẩm mới vào Tạp hóa.</small></div>'+
      '<div class="taphoa-quick-add-fields">'+
        '<input name="name" maxlength="120" autocomplete="off" value="'+escapeAttr(query)+'" aria-label="Tên sản phẩm">'+
        '<select name="sourceKey" aria-label="Nguồn hàng">'+options+'</select>'+
        '<input name="priceVnd" inputmode="numeric" autocomplete="off" placeholder="Giá bán (đ)" aria-label="Giá bán">'+
        '<button type="submit">Thêm mới</button>'+
      '</div><small class="taphoa-quick-add-status" aria-live="polite"></small></form>';
  }
  function setEmptyState(host,empty,mobile=false){
    if(!host)return;
    if(!empty){host.hidden=true;return;}
    host.hidden=false;
    host.innerHTML=quickAddMarkup(mobile);
  }

  function renderDesktopFastSearchResults(){
    if(typeof userWorkRowsForScope!=="function")return;
    const scopedRaw=userWorkRowsForScope(userWorkDesktopScope,userWorkDesktopCategoryKey);
    const scoped=userWorkDesktopScope==="market"?userWorkMarketSortRows(scopedRaw):scopedRaw;
    const marketHost=document.getElementById("userWorkMarketGrid");
    const marketEmpty=document.getElementById("userWorkMarketEmpty");
    const mineHost=document.getElementById("userWorkMineRows");
    const mineEmpty=document.getElementById("userWorkMineEmpty");
    let hasMore=false;

    if(userWorkDesktopScope==="market"){
      const visible=userWorkMarketVisibleRows(scoped,userWorkMarketLimit);
      if(marketHost){
        const hasCartons=scoped.some(row=>userWorkMarketPackGroup(row)==="carton");
        marketHost.classList.toggle("has-carton-lane",hasCartons);
        let retailLane=0;
        marketHost.innerHTML=visible.map(row=>{
          const lane=userWorkMarketPackGroup(row)==="retail"?retailLane++:0;
          return userWorkMarketCard(row,lane);
        }).join("");
      }
      setEmptyState(marketEmpty,scoped.length===0,false);
      if(marketEmpty&&scoped.length===0)marketEmpty.textContent="Không có sản phẩm siêu thị phù hợp.";
      hasMore=scoped.length>visible.length;
    }else{
      const visible=scoped.slice(0,userWorkMineLimit);
      if(mineHost)mineHost.innerHTML=visible.map(userWorkMineRow).join("");
      setEmptyState(mineEmpty,scoped.length===0,false);
      hasMore=scoped.length>visible.length;
    }
    setupUserWorkDesktopAutoLoad(hasMore);
    updateUserWorkOrderSummary();
    queueSync();
  }

  function renderMobileFastSearchResults(){
    if(typeof mobileUserRows!=="function")return;
    const rows=mobileUserRows();
    let visible=[];
    let hasMore=false;
    if(!mobileUserScope){
      const mine=rows.filter(isMineRow);
      const market=rows.filter(row=>!isMineRow(row));
      visible=[...mine.slice(0,mobileUserLimit),...market.slice(0,mobileUserLimit)];
      hasMore=mine.length>mobileUserLimit||market.length>mobileUserLimit;
    }else{
      visible=rows.slice(0,mobileUserLimit*2);
      hasMore=rows.length>visible.length;
    }
    const host=document.getElementById("mobileUserResults");
    if(host){
      host.classList.remove("news-results");
      host.innerHTML=visible.map(row=>{
        if(isMineRow(row))return String(row.canonical_product_id||"").trim()?mobileUserCanonicalMineCard(row):mobileUserMineCard(row);
        return mobileUserMarketCard(row);
      }).join("");
      host.dataset.hasMore=hasMore?"1":"0";
      host.hidden=rows.length===0;
    }
    renderMobileMergePanel();
    const empty=document.getElementById("mobileUserEmpty");
    if(mobileUserScope==="mine")setEmptyState(empty,rows.length===0,true);
    else if(empty){empty.hidden=rows.length!==0;if(rows.length===0)empty.textContent="Không có sản phẩm phù hợp.";}
    const orderBar=document.querySelector(".mobile-user-order-bar");
    const orderStatus=document.getElementById("mobileUserOrderStatus");
    const marketMode=mobileUserScope==="market";
    if(orderBar)orderBar.hidden=marketMode;
    if(orderStatus)orderStatus.hidden=marketMode;
    setupMobileUserAutoLoad();
    updateUserWorkOrderSummary();
    queueSync();
  }

  function scheduleFastSearch(input,mobile){
    try{libraryQuery=String(input?.value||"").trim()}catch{return}
    try{
      if(mobile)mobileUserLimit=8;
      else{userWorkMarketLimit=8;userWorkMineLimit=12;}
    }catch{}
    if(fastSearchTimer)clearTimeout(fastSearchTimer);
    fastSearchTimer=setTimeout(()=>{
      fastSearchTimer=0;
      requestAnimationFrame(()=>{
        if(mobile){
          renderMobileFastSearchResults();
          if(typeof resetMobileUserResultsScroll==="function")resetMobileUserResultsScroll();
        }else{
          renderDesktopFastSearchResults();
          if(typeof resetUserWorkDesktopScroll==="function")resetUserWorkDesktopScroll();
        }
      });
    },36);
  }

  function captureFastSearch(event){
    const input=event.target?.closest?.("#userWorkSearch,#mobileUserSearch");
    if(!input)return;
    if(event.type==="input"&&event.isComposing)return;
    const mobile=input.id==="mobileUserSearch";
    try{
      if((mobile&&mobileUserScope==="news")||(!mobile&&userWorkDesktopScope==="news"))return;
    }catch{return}
    event.stopImmediatePropagation();
    scheduleFastSearch(input,mobile);
  }

  function syncExactEditActions(){
    document.querySelectorAll(".order-cart-actions.editing").forEach(wrap=>{
      const cancel=wrap.querySelector('[data-order-cart-action="cancel-edit"]');
      const update=wrap.querySelector('[data-order-cart-action="update"]');
      wrap.querySelectorAll("button").forEach(button=>{button.hidden=button!==cancel&&button!==update;});
      if(cancel){cancel.hidden=false;cancel.textContent="Hủy";}
      if(update){
        update.hidden=false;
        if(update.getAttribute("aria-busy")!=="true")update.textContent="Cập nhật";
      }
    });
  }

  function manualProductEndpoint(){
    const base=String(window.GETLINK_API_BASE||"").replace(/\/+$/,"");
    return base.replace(/\/getlink-api$/,"/getlink-product-add");
  }
  async function submitQuickAdd(form){
    const status=form.querySelector(".taphoa-quick-add-status");
    const button=form.querySelector('button[type="submit"]');
    const auth=currentChatOrderAuth();
    const token=String(auth?.accessToken||"");
    if(!token){if(status)status.textContent="Cần đăng nhập Chat bằng Admin.";return;}
    const sourceKey=String(form.elements.sourceKey?.value||"").trim();
    const name=String(form.elements.name?.value||"").replace(/\s+/g," ").trim();
    const digits=String(form.elements.priceVnd?.value||"").replace(/\D+/g,"");
    const priceVnd=Number(digits||0);
    if(name.length<2){if(status)status.textContent="Nhập tên sản phẩm.";return;}
    if(!(priceVnd>0)){if(status)status.textContent="Nhập giá bán.";return;}
    const endpoint=manualProductEndpoint();
    if(!endpoint||endpoint.endsWith("getlink-api")){if(status)status.textContent="Chưa có API thêm sản phẩm.";return;}
    if(button){button.disabled=true;button.textContent="Đang thêm…";}
    if(status)status.textContent="Đang thêm sản phẩm…";
    try{
      const headers={"content-type":"application/json","authorization":"Bearer "+token};
      const apiKey=String(window.GETLINK_API_KEY||"");
      if(apiKey)headers.apikey=apiKey;
      const response=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({sourceKey,name,priceVnd})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){
        if(response.status===409)throw new Error("Sản phẩm này đã có.");
        if(response.status===403)throw new Error("Chỉ Admin mới được thêm sản phẩm.");
        throw new Error(data.detail||data.error||"Chưa thêm được sản phẩm.");
      }
      if(status)status.textContent="Đã thêm. Đang cập nhật danh sách…";
      searchKeyCache=new WeakMap();
      if(typeof fetchLibraryFromSupabase==="function")await fetchLibraryFromSupabase();
      try{libraryQuery=name}catch{}
      const desktop=document.getElementById("userWorkSearch");
      const mobile=document.getElementById("mobileUserSearch");
      if(desktop)desktop.value=name;
      if(mobile)mobile.value=name;
      if(typeof renderUserWorkHome==="function")renderUserWorkHome();
      queueSync();
    }catch(error){
      if(status)status.textContent=String(error?.message||error||"Chưa thêm được sản phẩm.");
      if(button){button.disabled=false;button.textContent="Thêm mới";}
    }
  }

  function syncAll(){
    syncFrame=0;
    patchFetch();
    patchExports();
    patchFastSearchIndex();
    syncSalesHeader();
    syncSalesRows();
    syncOrderNotes();
    syncExactEditActions();
  }
  function queueSync(){
    if(syncFrame)return;
    syncFrame=requestAnimationFrame(syncAll);
  }

  document.addEventListener("input",captureFastSearch,true);
  document.addEventListener("compositionend",captureFastSearch,true);

  document.addEventListener("input",event=>{
    const input=event.target?.closest?.("[data-work-note]");
    if(!input)return;
    const next=String(input.value||"").slice(0,NOTE_MAX);
    if(input.value!==next)input.value=next;
    setNote(input.dataset.workNote,next);
  },true);

  document.addEventListener("submit",event=>{
    const form=event.target?.closest?.("[data-taphoa-add-product]");
    if(!form)return;
    event.preventDefault();
    void submitQuickAdd(form);
  },true);

  document.addEventListener("click",event=>{
    const qty=event.target?.closest?.("[data-work-qty]");
    if(!qty)return;
    window.setTimeout(()=>{
      const row=qty.closest(".user-work-order-row");
      const value=Number(row?.querySelector(".user-work-order-qty b")?.textContent||0);
      if(value<=0){
        const input=row?.querySelector("[data-work-note]");
        if(input){setNote(input.dataset.workNote,"");input.value="";}
      }
    },0);
  },true);

  const observer=new MutationObserver(queueSync);
  function boot(){
    patchFetch();
    patchFastSearchIndex();
    observer.observe(document.documentElement,{subtree:true,childList:true});
    queueSync();
    let attempts=0;
    const timer=setInterval(()=>{
      syncAll();
      attempts+=1;
      if((exportsPatched&&searchKeyPatched)||attempts>80)clearInterval(timer);
    },100);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
