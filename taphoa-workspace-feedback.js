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
  let orderWorkspaceSelectedId="";
  let customerReassignOrderId="";
  let customerReassignBusy=false;
  // TAPHOA_FAST_SEARCH_20260913
  // TAPHOA_ORDER_WORKSPACE_V2_20260913

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

  function orderSelectionCounts(selected=[]){
    const rows=Array.isArray(selected)?selected:[];
    return {
      lines:rows.length,
      products:rows.reduce((sum,item)=>sum+Math.max(0,Number(item?.qty||0)),0)
    };
  }
  function orderProductCount(order){
    const items=Array.isArray(order?.items)?order.items:[];
    return items.reduce((sum,item)=>sum+Math.max(0,Number(item?.qty||0)),0);
  }
  function orderWorkspaceRole(){return String(currentChatOrderAuth()?.account?.role||"")}
  function orderWorkspaceMoney(value){
    const n=Number(value||0);
    if(!Number.isFinite(n))return "—";
    const compact=Math.round(n/500)*.5;
    return new Intl.NumberFormat("vi-VN",{minimumFractionDigits:0,maximumFractionDigits:1}).format(compact);
  }
  function orderWorkspaceDate(value){
    const d=new Date(value||0);
    if(!Number.isFinite(d.getTime()))return "";
    return new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d);
  }
  function orderWorkspaceDateValue(order){
    if(order?.status==="returned")return order.returnedAt||order.deliveredAt||order.orderedAt||0;
    if(order?.status==="delivered")return order.deliveredAt||order.orderedAt||0;
    return order?.submittedAt||order?.orderedAt||0;
  }
  function orderWorkspaceCode(order){return order?.orderNo?"#"+order.orderNo:String(order?.id||"")}
  function orderWorkspaceStatus(order){
    return {pending:"Đơn tạm",delivered:"Đã giao",returned:"Đã hoàn"}[String(order?.status||"")]||String(order?.status||"");
  }
  function orderIndexCardMarkup(order,index,selected=false){
    const items=Array.isArray(order?.items)?order.items:[];
    const products=orderProductCount(order);
    return '<button type="button" class="order-index-card '+(selected?'selected':'')+'" data-order-list-item data-order-id="'+escapeAttr(order?.id)+'">'+
      '<span class="order-index-primary"><strong>'+escapeHtml(order?.customerName||"Khách hàng")+'</strong><b>'+escapeHtml(orderWorkspaceMoney(order?.total))+'</b></span>'+
      '<span class="order-index-meta"><small>STT '+(index+1)+'</small><small>Mã đơn '+escapeHtml(orderWorkspaceCode(order))+'</small><small>'+escapeHtml(orderWorkspaceDate(orderWorkspaceDateValue(order)))+'</small></span>'+
      '<span class="order-index-count">'+items.length+' dòng · '+products+' SP</span>'+
    '</button>';
  }
  function orderInvoiceActionsMarkup(order){
    const admin=orderWorkspaceRole()==="admin";
    const id=escapeAttr(order?.id);
    if(order?.status==="pending")return '<div class="order-invoice-actions">'+
      '<button type="button" class="order-action-secondary" data-order-action="edit" data-order-id="'+id+'">Sửa</button>'+
      (admin?'<button type="button" class="order-action-primary" data-order-action="deliver" data-order-id="'+id+'">Đã giao</button>':'')+
      '<button type="button" class="order-action-danger" data-order-action="delete" data-order-id="'+id+'">Xóa</button>'+
    '</div>';
    if(order?.status==="delivered"&&admin)return '<div class="order-invoice-actions">'+
      '<button type="button" class="order-action-secondary" data-order-action="edit" data-order-id="'+id+'">Sửa</button>'+
      '<button type="button" class="order-action-danger" data-order-action="return" data-order-id="'+id+'">Xóa</button>'+
    '</div>';
    return '<div class="order-invoice-actions order-invoice-actions-empty"><span>Đơn đã hoàn · chỉ xem</span></div>';
  }
  function orderInvoiceMarkup(order,index){
    if(!order)return '<div class="order-invoice-empty">Chọn một đơn để xem hóa đơn.</div>';
    const items=Array.isArray(order.items)?order.items:[];
    const products=orderProductCount(order);
    const admin=orderWorkspaceRole()==="admin";
    const canChangeCustomer=admin&&(order.status==="pending"||order.status==="delivered");
    const lines=items.map((item,lineIndex)=>{
      const qty=Number(item?.qty||0),price=Number(item?.price||0),note=String(item?.note||"").trim();
      return '<div class="order-invoice-line">'+
        '<span class="order-invoice-line-no">'+(lineIndex+1)+'</span>'+
        '<span class="order-invoice-product"><strong>'+escapeHtml(item?.name||"Sản phẩm")+'</strong>'+(note?'<small>Ghi chú: '+escapeHtml(note)+'</small>':'')+'</span>'+
        '<span class="order-invoice-qty">'+qty+' × '+escapeHtml(orderWorkspaceMoney(price))+'</span>'+
        '<strong class="order-invoice-line-total">'+escapeHtml(orderWorkspaceMoney(qty*price))+'</strong>'+
      '</div>';
    }).join('');
    return '<section class="order-invoice" data-order-invoice-id="'+escapeAttr(order.id)+'">'+
      '<header class="order-invoice-head">'+
        '<button type="button" class="order-invoice-back" data-order-back>← Danh sách đơn</button>'+
        '<div class="order-invoice-title"><span>HÓA ĐƠN</span><strong>'+escapeHtml(orderWorkspaceStatus(order))+'</strong></div>'+
        '<div class="order-invoice-customer"><span><strong>'+escapeHtml(order.customerName||"Khách hàng")+'</strong><small>STT '+(index+1)+' · Mã đơn '+escapeHtml(orderWorkspaceCode(order))+' · '+escapeHtml(orderWorkspaceDate(orderWorkspaceDateValue(order)))+'</small></span>'+
          (canChangeCustomer?'<button type="button" data-order-customer-change data-order-customer-select data-order-id="'+escapeAttr(order.id)+'">Đổi khách</button>':'')+
        '</div>'+
      '</header>'+
      '<div class="order-invoice-scroll">'+
        '<div class="order-invoice-table-head"><span>STT</span><span>Sản phẩm</span><span>Số lượng × giá</span><span>Thành tiền</span></div>'+
        '<div class="order-invoice-lines">'+(lines||'<div class="order-invoice-empty-line">Không có sản phẩm.</div>')+'</div>'+
        '<footer class="order-invoice-total"><span><small>'+items.length+' dòng · '+orderProductCount(order)+' sản phẩm</small><strong>Tổng cộng</strong></span><b>'+escapeHtml(orderWorkspaceMoney(order.total))+'</b></footer>'+
      '</div>'+
      orderInvoiceActionsMarkup(order)+
    '</section>';
  }
  function syncSalesSelectionCopy(){
    if(typeof window.userWorkSelectedItems!=="function")return;
    const selected=window.userWorkSelectedItems();
    const counts=orderSelectionCounts(selected);
    const count=document.getElementById("userWorkSelectedCount");
    if(count)count.textContent="Đã chọn "+counts.lines+" dòng · "+counts.products+" sản phẩm";
    const previewMore=document.querySelector("#taphoaSalesPreview .taphoa-sales-preview-more");
    if(previewMore&&counts.lines>12)previewMore.textContent="+"+(counts.lines-12)+" dòng khác";
    const contextCopy=document.querySelector("#taphoaSalesContext .taphoa-sales-context-head small");
    if(contextCopy)contextCopy.textContent=counts.lines?"Khách · "+counts.lines+" dòng · "+counts.products+" sản phẩm":"Khách · chưa chọn hàng";
  }
  function visibleOrderIdsFromSource(source){
    return [...(source?.querySelectorAll?.(".order-card[data-order-id]")||[])].map(card=>String(card.dataset.orderId||"")).filter(Boolean);
  }
  function renderOrderWorkspaceSelection(){
    const workspace=document.querySelector(".order-workspace-v2");
    if(!workspace)return;
    const ids=[...workspace.querySelectorAll("[data-order-list-item]")].map(row=>String(row.dataset.orderId||""));
    if(orderWorkspaceSelectedId&&!ids.includes(orderWorkspaceSelectedId))orderWorkspaceSelectedId="";
    const wide=window.matchMedia("(min-width:1000px)").matches;
    if(wide&&!orderWorkspaceSelectedId&&ids.length)orderWorkspaceSelectedId=ids[0];
    workspace.classList.toggle("has-selection",Boolean(orderWorkspaceSelectedId));
    workspace.querySelectorAll("[data-order-list-item]").forEach((row,index)=>{
      const selected=String(row.dataset.orderId||"")===orderWorkspaceSelectedId;
      row.classList.toggle("selected",selected);
      row.setAttribute("aria-pressed",selected?"true":"false");
      const order=orderCache.get(String(row.dataset.orderId||""));
      if(order){
        const refreshed=document.createElement("template");
        refreshed.innerHTML=orderIndexCardMarkup(order,index,selected);
        const next=refreshed.content.firstElementChild;
        if(next)row.replaceWith(next);
      }
    });
    const detail=workspace.querySelector(".order-detail-pane");
    if(!detail)return;
    const index=ids.indexOf(orderWorkspaceSelectedId);
    const order=index>=0?orderCache.get(orderWorkspaceSelectedId):null;
    detail.innerHTML=orderInvoiceMarkup(order,index>=0?index:0);
  }
  function mobileUsesCanonicalOrderOwner(){return window.matchMedia("(max-width:639px)").matches}
  function restoreCanonicalMobileOrders(){
    const list=document.getElementById("orderManagerList");
    if(!list)return;
    const workspace=list.querySelector(".order-workspace-v2");
    const source=list.querySelector(".order-lifecycle-list");
    if(workspace){
      const report=workspace.querySelector(".order-source-report");
      const sourceSummary=report?.querySelector(".order-source-summary");
      const sourceDrill=report?.querySelector(".order-source-detail");
      if(source){
        if(sourceSummary)source.insertAdjacentElement("beforebegin",sourceSummary);
        if(sourceDrill)source.insertAdjacentElement("beforebegin",sourceDrill);
      }
      workspace.remove();
    }
    if(source){delete source.dataset.taphoaV2Source;source.hidden=false;}
    orderWorkspaceSelectedId="";
  }
  function syncOrderWorkspaceV2(){
    if(mobileUsesCanonicalOrderOwner()){restoreCanonicalMobileOrders();return;}
    const list=document.getElementById("orderManagerList");
    const source=list?.querySelector?.(".order-lifecycle-list");
    if(!list||!source)return;
    const existing=list.querySelector(".order-workspace-v2");
    if(existing){renderOrderWorkspaceSelection();return;}
    const ids=visibleOrderIdsFromSource(source);
    const rows=ids.map(id=>orderCache.get(id)).filter(Boolean);
    if(ids.length&&rows.length!==ids.length)return;
    if(orderWorkspaceSelectedId&&!ids.includes(orderWorkspaceSelectedId))orderWorkspaceSelectedId="";
    const wide=window.matchMedia("(min-width:1000px)").matches;
    if(wide&&!orderWorkspaceSelectedId&&ids.length)orderWorkspaceSelectedId=ids[0];
    source.dataset.taphoaV2Source="1";
    source.hidden=true;
    const workspace=document.createElement("section");
    workspace.className="order-workspace-v2"+(orderWorkspaceSelectedId?" has-selection":"");
    workspace.innerHTML='<aside class="order-index-pane"><div class="order-index-scroll">'+
      '<div class="order-index-list">'+rows.map((order,index)=>orderIndexCardMarkup(order,index,String(order.id)===orderWorkspaceSelectedId)).join('')+'</div>'+
      '</div></aside><div class="order-detail-pane"></div>';
    const scroll=workspace.querySelector(".order-index-scroll");
    const resultsOwner=source.closest(".order-report-results")||list;
    const sourceSummary=resultsOwner.querySelector(":scope > .order-source-summary");
    const sourceDrill=resultsOwner.querySelector(":scope > .order-source-detail");
    if(scroll&&(sourceSummary||sourceDrill)){
      const report=document.createElement("details");
      report.className="order-source-report";
      report.open=!window.matchMedia("(min-width:1000px)").matches;
      report.innerHTML='<summary>Theo nguồn</summary><div class="order-source-report-body"></div>';
      const body=report.querySelector(".order-source-report-body");
      if(sourceSummary)body?.appendChild(sourceSummary);
      if(sourceDrill)body?.appendChild(sourceDrill);
      scroll.insertBefore(report,scroll.firstChild);
    }
    source.insertAdjacentElement("afterend",workspace);
    renderOrderWorkspaceSelection();
  }
  function orderCustomerEndpoint(){
    const base=String(window.GETLINK_API_BASE||"").replace(/\/+$/,"");
    return base.replace(/\/getlink-api$/,"/getlink-order-customer");
  }
  async function reassignOrderCustomer(orderId,customerId){
    if(customerReassignBusy)return;
    const auth=currentChatOrderAuth();
    const token=String(auth?.accessToken||"");
    if(!token||auth?.account?.role!=="admin")return;
    const endpoint=orderCustomerEndpoint();
    if(!endpoint||endpoint.endsWith("getlink-api"))return;
    customerReassignBusy=true;
    const status=document.getElementById("userWorkOrderStatus");
    if(status)status.textContent="Đang đổi khách hàng...";
    try{
      const headers={"content-type":"application/json","authorization":"Bearer "+token};
      const apiKey=String(window.GETLINK_API_KEY||"");
      if(apiKey)headers.apikey=apiKey;
      const response=await fetch(endpoint,{method:"PUT",headers,body:JSON.stringify({orderId,customerId})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data.detail||data.error||"Chưa đổi được khách hàng.");
      const current=orderCache.get(String(orderId));
      if(current&&data?.customer){
        orderCache.set(String(orderId),{...current,customerId:String(data.customer.id||customerId),customerName:String(data.customer.name||current.customerName||"Khách hàng")});
      }
      const picker=document.getElementById("orderCustomerPicker");
      if(picker){picker.hidden=true;picker.setAttribute("aria-hidden","true");}
      customerReassignOrderId="";
      renderOrderWorkspaceSelection();
      if(status)status.textContent="Đã đổi khách hàng của đơn "+orderWorkspaceCode(current||{id:orderId})+".";
    }catch(error){
      if(status)status.textContent=String(error?.message||error||"Chưa đổi được khách hàng.");
    }finally{customerReassignBusy=false;}
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
    syncSalesSelectionCopy();
    syncOrderWorkspaceV2();
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

  function selectOrderWorkspaceItem(listItem){
    if(!listItem)return false;
    const id=String(listItem.dataset.orderId||"");
    if(!id)return false;
    orderWorkspaceSelectedId=id;
    renderOrderWorkspaceSelection();
    return true;
  }

  document.addEventListener("click",event=>{
    const listItem=event.target?.closest?.("[data-order-list-item]");
    if(listItem){
      event.preventDefault();
      event.stopImmediatePropagation();
      selectOrderWorkspaceItem(listItem);
      return;
    }
    if(event.target?.closest?.("[data-order-back]")){
      event.preventDefault();
      event.stopImmediatePropagation();
      orderWorkspaceSelectedId="";
      renderOrderWorkspaceSelection();
      return;
    }
    const customerChange=event.target?.closest?.("[data-order-customer-change]");
    if(customerChange){
      customerReassignOrderId=String(customerChange.dataset.orderId||"");
      return;
    }
    if(event.target?.closest?.("#orderCustomerPickerClose")){
      customerReassignOrderId="";
      return;
    }
    const customerOption=event.target?.closest?.("[data-order-customer-id]");
    if(customerOption&&customerReassignOrderId){
      event.preventDefault();
      event.stopImmediatePropagation();
      void reassignOrderCustomer(customerReassignOrderId,String(customerOption.dataset.orderCustomerId||""));
      return;
    }
    const qty=event.target?.closest?.("[data-work-qty]");
    if(!qty)return;
    window.setTimeout(()=>{
      const row=qty.closest(".user-work-order-row");
      const value=Number(row?.querySelector(".user-work-order-qty b")?.textContent||0);
      if(value<=0){
        const input=row?.querySelector("[data-work-note]");
        if(input){setNote(input.dataset.workNote,"");input.value="";}
      }
      queueSync();
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
    window.addEventListener("resize",queueSync,{passive:true});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();