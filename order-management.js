(()=>{
  "use strict";

  const ACCESS_STATES=Object.freeze(["guest","user","admin"]);
  const AUTH_KEY="getlink:chat-order-auth";
  const SELECTED_CUSTOMER_KEY="getlink:order-selected-customer";
  const ORDER_REPORT_STATE_KEY="getlink:taphoa-order-report-state";
  const QTY_KEY="getlink:user-work-order-qty";
  const CHAT_ORIGIN="https://chat.taphoa.xyz";
  const API_KEY=String(window.GETLINK_API_KEY||"");
  const CATALOG_API=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");
  const ORDER_API=CATALOG_API.replace(/\/getlink-api$/,"/getlink-orders");
  const STATUS_LABELS={pending:"Đơn tạm",delivered:"Đã giao",returned:"Đã hoàn"};
  const ORDER_SYNC_MS=3000;
  const DEBT_EVENT_LABELS={
    order_debt:"Đã giao",
    payment:"Thanh toán",
    order_return_reversal:"Hoàn đơn",
    manual_adjustment:"Điều chỉnh"
  };

  let activeView="orders";
  let taphoaWorkView="sales";
  let activeStatus="pending";
  let expandedOrderId="";
  let editingOrderId="";
  let editingOrderStatus="";
  let orderReportFilters=loadOrderReportFilters();
  let orderReportFilter=orderReportFilters[activeStatus];
  let sourceDrillSource="";
  let sourceDrillMode="detail";
  let debtLinkedOrder=null;
  let ordersVersion="";
  let debtVersion="";
  let syncBusy=false;
  let orders=[];
  let customers=[];
  let debtSummaries=[];
  let debtDetail=null;
  let debtCustomerId="";
  let selectedCustomerId=String(sessionStorage.getItem(SELECTED_CUSTOMER_KEY)||"");
  let busy=false;
  let pickerBusy=false;
  let bridgeSeq=0;
  let chatWorkContext=null;
  let pendingChatWorkContext=null;

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function compactMoney(value){
    const n=Number(value||0);
    if(!Number.isFinite(n))return "—";
    const compact=Math.round(n/500)*.5;
    return new Intl.NumberFormat("vi-VN",{minimumFractionDigits:0,maximumFractionDigits:1}).format(compact);
  }
  function dateTime(value){
    const d=new Date(value||0);
    if(!Number.isFinite(d.getTime()))return "";
    return new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d);
  }
  function normalizedSearch(value){
    return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D").toLowerCase().trim();
  }

  function readAuth(){
    try{
      const value=JSON.parse(sessionStorage.getItem(AUTH_KEY)||"null");
      if(!value?.accessToken||!value?.account?.id||value?.source!=="chat"){
        sessionStorage.removeItem(AUTH_KEY);
        return null;
      }
      if(value.expiresAt&&Date.parse(value.expiresAt)<=Date.now()+5000){
        sessionStorage.removeItem(AUTH_KEY);
        return null;
      }
      return value;
    }catch{return null;}
  }
  function storeAuth(value){
    sessionStorage.setItem(AUTH_KEY,JSON.stringify(value));
    syncCustomerControls();
    emitAccessChange();
  }
  function clearSelectedCustomer(){
    selectedCustomerId="";
    sessionStorage.removeItem(SELECTED_CUSTOMER_KEY);
    syncCustomerControls();
  }
  function clearAuth(){
    sessionStorage.removeItem(AUTH_KEY);
    customers=[];
    orders=[];
    debtSummaries=[];
    debtDetail=null;
    debtCustomerId="";
    clearSelectedCustomer();
    syncCustomerControls();
    emitAccessChange();
  }
  function currentAccount(){return readAuth()?.account||null}
  function currentAccessState(){
    const auth=readAuth();
    if(!auth)return "guest";
    return auth.account?.role==="admin"?"admin":"user";
  }
  function accessSnapshot(){
    const auth=readAuth();
    return {
      state:currentAccessState(),
      account:auth?.account?{...auth.account}:null,
      source:auth?.source==="chat"?"chat":null
    };
  }
  function emitAccessChange(){
    ensureTaphoaWorkspaceNav();
    syncTaphoaWorkspace();
    syncCartActions();
    document.dispatchEvent(new CustomEvent("getlink-access-change",{detail:accessSnapshot()}));
  }
  function currentRole(){return currentAccessState()}
  function selectedCustomer(){return customers.find(row=>String(row.id)===String(selectedCustomerId))||null}
  function normalizeChatWorkContext(message){
    if(!message||message.type!=="taphoa-chat-work-context")return null;
    const contactId=String(message.contactId||"").trim();
    if(!contactId)return null;
    const sourceMessageIds=Array.from(new Set(
      (Array.isArray(message.sourceMessageIds)?message.sourceMessageIds:[])
        .map(value=>String(value||"").trim())
        .filter(Boolean)
    )).slice(0,100);
    return {
      contactId,
      customerName:String(message.customerName||"").trim(),
      sourceMessageIds,
      preset:String(message.preset||"today").trim()||"today",
      from:String(message.from||"").trim(),
      to:String(message.to||"").trim(),
    };
  }
  function currentSelectedCart(){
    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
    return Array.isArray(selected)?selected:[];
  }
  function applyChatWorkContext(context){
    if(!context?.contactId)return "ignored";
    const cart=currentSelectedCart();
    const changingCustomer=selectedCustomerId&&String(selectedCustomerId)!==String(context.contactId);
    if(changingCustomer&&cart.length){
      pendingChatWorkContext=context;
      setMainStatus("Không đổi khách vì đơn đang có hàng. Gửi/xóa đơn hiện tại rồi chuyển khách.");
      renderChatWorkContext();
      return "deferred";
    }
    chatWorkContext=context;
    pendingChatWorkContext=null;
    if(currentRole()==="admin"){
      selectedCustomerId=context.contactId;
      sessionStorage.setItem(SELECTED_CUSTOMER_KEY,selectedCustomerId);
      syncCustomerControls();
    }
    renderChatWorkContext();
    return "applied";
  }
  function applyPendingChatWorkContextIfSafe(){
    if(!pendingChatWorkContext||currentSelectedCart().length)return false;
    const next=pendingChatWorkContext;
    pendingChatWorkContext=null;
    return applyChatWorkContext(next)==="applied";
  }
  function notifyChatOrderCreated({orderId="",orderNo="",contactId=""}={}){
    if(!isEmbeddedInChat()||!chatWorkContext)return false;
    const targetContact=String(contactId||"").trim();
    if(!targetContact||String(chatWorkContext.contactId)!==targetContact)return false;
    if(!chatWorkContext.sourceMessageIds.length)return false;
    window.parent.postMessage({
      type:"taphoa-work-order-created",
      contactId:targetContact,
      sourceMessageIds:[...chatWorkContext.sourceMessageIds],
      orderId:String(orderId||""),
      orderNo:String(orderNo||""),
    },CHAT_ORIGIN);
    return true;
  }

  function authHeaders(token,jsonBody=false){
    const h=new Headers();
    if(API_KEY)h.set("apikey",API_KEY);
    if(jsonBody)h.set("content-type","application/json");
    if(token)h.set("authorization","Bearer "+token);
    return h;
  }
  function headers(jsonBody=false){return authHeaders(String(readAuth()?.accessToken||""),jsonBody)}
  async function orderFetch(path,options={}){
    const request={...options,headers:headers(Boolean(options.body))};
    const res=await fetch(ORDER_API+path,request);
    const data=await res.json().catch(()=>({}));
    if(!res.ok){
      const error=new Error(String(data.error||"Không thực hiện được."));
      error.status=res.status;
      throw error;
    }
    return data;
  }
  async function orderFetchWithToken(path,token,options={}){
    const request={...options,headers:authHeaders(token,Boolean(options.body))};
    const res=await fetch(ORDER_API+path,request);
    const data=await res.json().catch(()=>({}));
    if(!res.ok){
      const error=new Error(String(data.error||"Không thực hiện được."));
      error.status=res.status;
      throw error;
    }
    return data;
  }

  async function acceptChatBridge(message){
    const seq=++bridgeSeq;
    if(!message?.accessToken){
      clearAuth();
      if(!document.getElementById("orderManager")?.hidden)setManagerGate("Cần đăng nhập Chat để tiếp tục.");
      return false;
    }
    try{
      const token=String(message.accessToken);
      const me=await orderFetchWithToken("/me",token);
      if(seq!==bridgeSeq)return false;
      const previous=currentAccount();
      storeAuth({accessToken:token,expiresAt:null,account:me.account,source:"chat"});
      if(previous?.id&&String(previous.id)!==String(me.account?.id))clearSelectedCustomer();
      if(currentRole()!=="admin")clearSelectedCustomer();
      updateIdentity();
      if(!document.getElementById("orderManager")?.hidden)await refreshManager();
      return true;
    }catch{
      if(seq===bridgeSeq){
        clearAuth();
        if(!document.getElementById("orderManager")?.hidden)setManagerGate("Phiên Chat chưa hợp lệ. Đăng nhập lại ở Chat.");
      }
      return false;
    }
  }

  window.addEventListener("message",event=>{
    if(event.origin!==CHAT_ORIGIN)return;
    const message=event.data;
    if(message?.type==="taphoa-chat-auth"){
      void acceptChatBridge(message);
      return;
    }
    if(message?.type==="taphoa-chat-work-context"){
      const context=normalizeChatWorkContext(message);
      if(context)applyChatWorkContext(context);
    }
  });

  function isEmbeddedInChat(){return window.parent!==window}
  function requestChatAuth(){
    if(!isEmbeddedInChat())return false;
    try{
      window.parent.postMessage({type:"taphoa-getlink-auth-request"},CHAT_ORIGIN);
      return true;
    }catch{return false;}
  }
  function goToChat(){window.location.assign(CHAT_ORIGIN+"/")}
  async function waitForChatAuth(timeoutMs=1200){
    if(readAuth())return true;
    if(!isEmbeddedInChat())return false;
    requestChatAuth();
    const started=Date.now();
    while(Date.now()-started<timeoutMs){
      await new Promise(resolve=>setTimeout(resolve,60));
      if(readAuth())return true;
    }
    return Boolean(readAuth());
  }
  async function requireChatAuth(message="Đang xác thực qua Chat..."){
    if(readAuth())return true;
    if(!isEmbeddedInChat()){
      goToChat();
      return false;
    }
    setMainStatus(message);
    setManagerGate(message);
    const ok=await waitForChatAuth();
    if(ok){clearManagerGate();return true;}
    setManagerGate("Cần đăng nhập Chat để tiếp tục.");
    return false;
  }

  function taphoaWorkspaceNavMarkup(kind){
    return '<nav class="taphoa-work-nav '+kind+'" aria-label="Tạp hóa">'+
      '<button type="button" data-taphoa-work-view="sales">Bán</button>'+
      '<button type="button" data-taphoa-work-view="orders">Đơn</button>'+
      '<button type="button" data-taphoa-work-view="debts">Công nợ</button>'+
    '</nav>';
  }
  function isTaphoaWorkspaceActive(){
    const home=document.getElementById("userWorkHome");
    if(!home||home.hidden)return false;
    if(window.matchMedia("(max-width:639px)").matches){
      const buttons=[...document.querySelectorAll("#mobileUserSourceTabs button")];
      const active=buttons.find(button=>button.classList.contains("active")||button.getAttribute("aria-pressed")==="true");
      if(!active)return true;
      return normalizedSearch(active.textContent).includes("tap hoa");
    }
    const active=document.querySelector('.user-work-jump-button.active,.user-work-jump-button[aria-pressed="true"]');
    return !active||String(active.dataset.workTarget||"mine")==="mine";
  }
  function activeTaphoaWorkspaceHost(){
    return window.matchMedia("(max-width:639px)").matches
      ?document.getElementById("mobileUserWork")
      :document.querySelector(".user-work-desktop");
  }
  function renderChatWorkContext(){
    const host=document.getElementById("taphoaChatOrderContext");
    if(!host)return;
    const context=pendingChatWorkContext||chatWorkContext;
    if(!context){host.hidden=true;host.textContent="";return;}
    host.hidden=false;
    const waiting=Boolean(pendingChatWorkContext);
    host.textContent=(waiting?"Đang chờ chuyển sang · ":"Nguồn Chat · ")+(context.customerName||"Khách hàng");
    host.dataset.state=waiting?"deferred":"applied";
  }
  function renderSalesContext(){
    const panel=document.getElementById("taphoaSalesContext");
    const preview=document.getElementById("taphoaSalesPreview");
    if(!panel||!preview)return;
    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
    preview.innerHTML=selected.length?selected.slice(0,12).map((item,index)=>{
      const row=item.row||{};
      const name=String(row.product_name||row.name||row.source_name||row.canonical_url||"Sản phẩm");
      return '<div class="taphoa-sales-preview-row"><span><small>'+(index+1)+'.</small>'+escapeHtml(name)+'</span><strong>×'+Number(item.qty||0)+'</strong></div>';
    }).join("")+(selected.length>12?'<div class="taphoa-sales-preview-more">+'+(selected.length-12)+' sản phẩm</div>':""):'<div class="taphoa-sales-preview-empty">Chưa chọn sản phẩm</div>';
    panel.classList.toggle("has-items",selected.length>0);
    renderChatWorkContext();
  }
  function ensureSalesContextPanel(){
    const mine=document.getElementById("userWorkMine");
    const wrap=mine?.querySelector(".user-work-order-wrap");
    const foot=mine?.querySelector(".user-work-order-foot");
    if(!mine||!wrap||!foot)return;
    mine.classList.add("taphoa-sales-grid");
    let panel=document.getElementById("taphoaSalesContext");
    if(!panel){
      panel=document.createElement("aside");
      panel.id="taphoaSalesContext";
      panel.className="taphoa-sales-context";
      panel.innerHTML='<div class="taphoa-sales-context-head"><strong>Xem đơn nhanh</strong><small>Khách · hàng đã chọn · thao tác</small></div><div id="taphoaChatOrderContext" class="taphoa-chat-order-context" hidden></div><div id="taphoaSalesPreview" class="taphoa-sales-preview"></div>';
      wrap.insertAdjacentElement("afterend",panel);
    }
    if(foot.parentElement!==panel)panel.appendChild(foot);
    renderSalesContext();
  }
  function ensureTaphoaWorkspaceNav(){
    const desktopTop=document.querySelector(".user-work-top");
    if(desktopTop&&!desktopTop.parentElement?.querySelector(".taphoa-work-nav.desktop")){
      desktopTop.insertAdjacentHTML("afterend",taphoaWorkspaceNavMarkup("desktop"));
    }
    const mobileToolbar=document.querySelector(".mobile-user-toolbar");
    if(mobileToolbar&&!mobileToolbar.parentElement?.querySelector(".taphoa-work-nav.mobile")){
      mobileToolbar.insertAdjacentHTML("afterend",taphoaWorkspaceNavMarkup("mobile"));
    }
    ensureSalesContextPanel();
  }
  function syncTaphoaWorkspace(){
    const active=isTaphoaWorkspaceActive();
    const sales=taphoaWorkView==="sales";
    const mobile=window.matchMedia("(max-width:639px)").matches;
    document.querySelectorAll(".taphoa-work-nav").forEach(nav=>{
      nav.hidden=!active;
      nav.querySelectorAll("[data-taphoa-work-view]").forEach(button=>{
        const on=String(button.dataset.taphoaWorkView)===taphoaWorkView;
        button.classList.toggle("active",on);
        button.setAttribute("aria-pressed",on?"true":"false");
      });
    });
    const desktop=document.querySelector(".user-work-desktop");
    const mobileRoot=document.getElementById("mobileUserWork");
    if(desktop)desktop.dataset.taphoaView=active&&!mobile?taphoaWorkView:"sales";
    if(mobileRoot)mobileRoot.dataset.taphoaView=active&&mobile?taphoaWorkView:"sales";
    if(active&&!mobile){
      const mine=document.getElementById("userWorkMine");
      const categories=document.getElementById("userWorkDesktopCategories");
      if(mine)mine.hidden=!sales;
      if(categories)categories.hidden=!sales;
    }
    const manager=document.getElementById("orderManager");
    const host=activeTaphoaWorkspaceHost();
    if(manager&&host&&manager.parentElement!==host)host.appendChild(manager);
    if(manager){
      manager.hidden=!(active&&!sales);
      manager.setAttribute("aria-hidden",manager.hidden?"true":"false");
    }
    const title=document.getElementById("orderManagerTitle");
    if(title)title.textContent=taphoaWorkView==="debts"?"Công nợ":"Đơn hàng";
    renderSalesContext();
  }

  function injectUi(){
    ensureTaphoaWorkspaceNav();
    ensureCartActions();
    if(document.getElementById("orderManager"))return;
    document.body.insertAdjacentHTML("beforeend",`
      <section id="orderManager" class="order-manager taphoa-workspace-panel" hidden aria-hidden="true" aria-labelledby="orderManagerTitle">
        <section class="order-manager-panel">
          <header class="order-manager-head">
            <div><h2 id="orderManagerTitle">Đơn hàng</h2><small id="orderManagerIdentity"></small></div>
          </header>
          <div id="orderManagerGate" class="order-manager-message" hidden></div>
          <div id="orderManagerBody" class="order-manager-body">
            <nav id="orderManagerTabs" class="order-manager-tabs" aria-label="Trạng thái đơn">
              <button type="button" data-order-status="pending" class="active">Đơn tạm <small>0</small></button>
              <button type="button" data-order-status="delivered">Đã giao <small>0</small></button>
              <button type="button" data-order-status="returned">Đã hoàn <small>0</small></button>
            </nav>
            <div class="order-manager-tools">
              <span id="orderManagerSummary"></span>
              <div class="order-manager-tool-actions">
                <button id="debtBackButton" type="button" hidden>Khách hàng</button>
                <button id="orderDeleteAllPendingButton" type="button" data-order-batch="delete-pending" hidden>Xóa tất cả</button>
                <button id="orderReturnAllDeliveredButton" type="button" data-order-batch="return-delivered" hidden>Xóa tất cả đã giao</button>
              </div>
            </div>
            <div id="orderManagerList" class="order-manager-list"></div>
            <div id="orderManagerEmpty" class="order-manager-empty" hidden></div>
          </div>
          <div id="orderCustomerPicker" class="order-customer-picker" hidden aria-hidden="true">
            <div class="order-customer-picker-head">
              <div><strong>Chọn khách hàng</strong><small>Tài khoản User của Chat</small></div>
              <button id="orderCustomerPickerClose" type="button" aria-label="Đóng">×</button>
            </div>
            <div class="order-customer-search-wrap">
              <input id="orderCustomerSearch" type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Tìm tên hoặc tài khoản">
            </div>
            <div id="orderCustomerList" class="order-customer-list"></div>
          </div>
        </section>
      </section>`);
    const picker=document.getElementById("orderCustomerPicker");
    if(picker&&picker.parentElement!==document.body)document.body.appendChild(picker);
    syncCustomerControls();
    syncManagerView();
    syncTaphoaWorkspace();
  }

  function ensureInlineCustomerButtons(){
    for(const id of ["userWorkSendOrder","mobileUserSendOrder"]){
      const send=document.getElementById(id);
      if(!send||send.parentElement?.querySelector?.(`[data-order-customer-for="${id}"]`))continue;
      const button=document.createElement("button");
      button.type="button";
      button.className="order-customer-inline";
      button.dataset.orderCustomerFor=id;
      button.dataset.orderCustomerSelect="true";
      button.hidden=true;
      send.parentElement?.insertBefore(button,send);
    }
  }

  function ensureCartActions(){
    for(const id of ["userWorkSendOrder","mobileUserSendOrder"]){
      const send=document.getElementById(id);
      if(!send||send.parentElement?.querySelector?.(`[data-order-cart-for="${id}"]`))continue;
      const wrap=document.createElement("span");
      wrap.className="order-cart-actions";
      wrap.dataset.orderCartFor=id;
      const clear=document.createElement("button");
      clear.type="button";clear.dataset.orderCartAction="clear";clear.textContent="Xóa";
      const quick=document.createElement("button");
      quick.type="button";quick.dataset.orderCartAction="quick";quick.textContent="Bán nhanh";
      const cancel=document.createElement("button");
      cancel.type="button";cancel.dataset.orderCartAction="cancel-edit";cancel.textContent="Hủy";
      const update=document.createElement("button");
      update.type="button";update.dataset.orderCartAction="update";update.textContent="Cập nhật đơn";
      wrap.append(clear,quick,cancel,update);
      send.parentElement?.insertBefore(wrap,send);
    }
    syncCartActions();
    renderSalesContext();
  }
  function syncCartActions(){
    const admin=currentRole()==="admin";
    const editing=Boolean(editingOrderId);
    document.querySelectorAll("[data-order-cart-for]").forEach(wrap=>{
      const send=document.getElementById(String(wrap.dataset.orderCartFor||""));
      if(send)send.hidden=editing;
      const clear=wrap.querySelector('[data-order-cart-action="clear"]');
      const quick=wrap.querySelector('[data-order-cart-action="quick"]');
      const cancel=wrap.querySelector('[data-order-cart-action="cancel-edit"]');
      const update=wrap.querySelector('[data-order-cart-action="update"]');
      if(clear)clear.hidden=editing;
      if(quick){quick.hidden=!admin||editing;quick.textContent="Bán nhanh";}
      if(cancel)cancel.hidden=!editing;
      if(update){update.hidden=!editing;update.textContent=editingOrderStatus==="delivered"?"Cập nhật đã giao":"Cập nhật đơn";}
      wrap.classList.toggle("editing",editing);
    });
  }
  function syncBatchControls(filtered=null){
    const pendingButton=document.getElementById("orderDeleteAllPendingButton");
    const deliveredButton=document.getElementById("orderReturnAllDeliveredButton");
    const pendingCount=orders.filter(order=>order.status==="pending").length;
    const filteredRows=Array.isArray(filtered)?filtered:filterOrdersForReport(orders);
    const deliveredCount=filteredRows.filter(order=>order.status==="delivered").length;
    if(pendingButton)pendingButton.hidden=activeView!=="orders"||activeStatus!=="pending"||pendingCount===0;
    if(deliveredButton)deliveredButton.hidden=activeView!=="orders"||activeStatus!=="delivered"||currentRole()!=="admin"||deliveredCount===0;
  }
  function syncCustomerControls(){
    ensureInlineCustomerButtons();
    const admin=currentRole()==="admin"&&Boolean(readAuth());
    const customer=selectedCustomer();
    for(const button of document.querySelectorAll("[data-order-customer-select]")){
      button.hidden=!admin||Boolean(editingOrderId);
      button.textContent=customer?"Khách · "+customer.name:"Chọn khách";
      button.title=customer?(customer.name+(customer.username?" · @"+customer.username:"")):"Chọn khách hàng trước khi gửi đơn";
    }
  }
  function syncManagerView(){
    const tabs=document.getElementById("orderManagerTabs");
    if(tabs)tabs.hidden=activeView!=="orders";
    const back=document.getElementById("debtBackButton");
    if(back)back.hidden=activeView!=="debts"||currentRole()!=="admin"||!debtCustomerId;
    syncCustomerControls();
    syncBatchControls();
    syncCartActions();
    syncTaphoaWorkspace();
  }

  function setMainStatus(message){
    for(const id of ["userWorkOrderStatus","mobileUserOrderStatus"]){
      const node=document.getElementById(id);
      if(node)node.textContent=message;
    }
  }
  function setManagerGate(message){
    injectUi();
    if(taphoaWorkView==="sales"){setMainStatus(message);return;}
    const host=document.getElementById("orderManager");
    const gate=document.getElementById("orderManagerGate");
    const body=document.getElementById("orderManagerBody");
    if(host){host.hidden=false;host.setAttribute("aria-hidden","false");}
    if(gate){gate.hidden=false;gate.textContent=message;}
    if(body)body.hidden=true;
  }
  function clearManagerGate(){
    const gate=document.getElementById("orderManagerGate");
    const body=document.getElementById("orderManagerBody");
    if(gate){gate.hidden=true;gate.textContent="";}
    if(body)body.hidden=false;
  }
  function openManager(){
    injectUi();
    taphoaWorkView=activeView==="debts"?"debts":"orders";
    syncTaphoaWorkspace();
    void refreshManager();
  }
  function closeManager(){
    closeCustomerPicker();
    taphoaWorkView="sales";
    syncTaphoaWorkspace();
  }
  function updateIdentity(){
    const node=document.getElementById("orderManagerIdentity");
    const auth=readAuth();
    if(!auth){if(node)node.textContent="Chưa xác thực qua Chat";return;}
    if(node)node.textContent=currentRole()==="admin"
      ?"Admin · tất cả khách hàng"
      :String(auth.account?.name||auth.account?.username||"Khách hàng");
    syncManagerView();
  }

  async function loadCustomers(force=false){
    if(currentRole()!=="admin")return [];
    if(customers.length&&!force)return customers;
    const data=await orderFetch("/customers",{method:"GET"});
    customers=Array.isArray(data.customers)?data.customers:[];
    if(selectedCustomerId&&!customers.some(row=>String(row.id)===String(selectedCustomerId)))clearSelectedCustomer();
    syncCustomerControls();
    return customers;
  }
  function renderCustomerList(){
    const list=document.getElementById("orderCustomerList");
    if(!list)return;
    const query=normalizedSearch(document.getElementById("orderCustomerSearch")?.value||"");
    const rows=customers.filter(row=>!query||normalizedSearch((row.name||"")+" "+(row.username||"")).includes(query));
    list.innerHTML=rows.length?rows.map(row=>`
      <button type="button" class="order-customer-option ${String(row.id)===String(selectedCustomerId)?"selected":""}" data-order-customer-id="${escapeHtml(row.id)}">
        <span>${escapeHtml(row.name||row.username||"Khách hàng")}</span>
        <small>${row.username?"@"+escapeHtml(row.username):""}</small>
      </button>`).join(""):'<div class="order-customer-empty">Không tìm thấy khách hàng.</div>';
  }
  async function openCustomerPicker(){
    if(!(await requireChatAuth()))return false;
    if(currentRole()!=="admin")return false;
    injectUi();
    const picker=document.getElementById("orderCustomerPicker");
    if(!picker)return false;
    picker.hidden=false;picker.setAttribute("aria-hidden","false");
    const list=document.getElementById("orderCustomerList");
    if(list)list.innerHTML='<div class="order-customer-empty">Đang tải khách hàng...</div>';
    try{
      pickerBusy=true;
      await loadCustomers();
      renderCustomerList();
      setTimeout(()=>document.getElementById("orderCustomerSearch")?.focus(),0);
      return true;
    }catch(error){
      handleAuthError(error);
      if(list)list.innerHTML='<div class="order-customer-empty">'+escapeHtml(error?.message||error)+'</div>';
      return false;
    }finally{pickerBusy=false;}
  }
  function closeCustomerPicker(){
    const picker=document.getElementById("orderCustomerPicker");
    if(!picker)return;
    picker.hidden=true;picker.setAttribute("aria-hidden","true");
  }
  function chooseCustomer(id){
    const customer=customers.find(row=>String(row.id)===String(id));
    if(!customer)return false;
    selectedCustomerId=String(customer.id);
    sessionStorage.setItem(SELECTED_CUSTOMER_KEY,selectedCustomerId);
    syncCustomerControls();
    renderCustomerList();
    closeCustomerPicker();
    setMainStatus("Đã chọn khách "+customer.name+" · bấm Gửi đơn.");
    return true;
  }

  async function loadOrders(){
    const data=await orderFetch("/orders",{method:"GET"});
    orders=Array.isArray(data.orders)?data.orders:[];
    return orders;
  }
  function renderTabs(){
    document.querySelectorAll("[data-order-status]").forEach(button=>{
      const status=String(button.dataset.orderStatus||"");
      const count=orders.filter(order=>order.status===status).length;
      button.classList.toggle("active",status===activeStatus);
      button.setAttribute("aria-pressed",status===activeStatus?"true":"false");
      const small=button.querySelector("small");
      if(small)small.textContent=String(count);
    });
  }
  function orderActions(order){
    const admin=currentRole()==="admin";
    if(order.status==="pending")return `
      <div class="order-card-actions">
        <button type="button" class="order-action-secondary" data-order-action="edit" data-order-id="${escapeHtml(order.id)}">Sửa</button>
        ${admin?`<button type="button" class="order-action-primary" data-order-action="deliver" data-order-id="${escapeHtml(order.id)}">Đã giao</button>`:""}
        <button type="button" class="order-action-danger" data-order-action="delete" data-order-id="${escapeHtml(order.id)}">Xóa</button>
      </div>`;
    if(order.status==="delivered"&&admin)return `
      <div class="order-card-actions">
        <button type="button" class="order-action-secondary" data-order-action="edit" data-order-id="${escapeHtml(order.id)}">Sửa</button>
        <button type="button" class="order-action-danger" data-order-action="return" data-order-id="${escapeHtml(order.id)}">Xóa</button>
      </div>`;
    return "";
  }
  function orderRef(order){return order.orderNo?"#"+order.orderNo:String(order.id||"")}
  function orderItemPriceMarkup(item){
    const sale=escapeHtml(compactMoney(item?.price));
    const bargainPrice=Number(item?.bargainPrice||0);
    return `<span class="order-item-prices"><span>Giá bán ${sale}</span>${bargainPrice>0?`<span> · Mặc cả ${escapeHtml(compactMoney(bargainPrice))}</span>`:""}</span>`;
  }
  function orderRecencyValue(order){
    if(order.status==="returned")return order.returnedAt||order.deliveredAt||order.orderedAt||0;
    if(order.status==="delivered")return order.deliveredAt||order.orderedAt||0;
    return order.submittedAt||order.orderedAt||0;
  }
  function orderRecency(order){return Date.parse(orderRecencyValue(order)||0)||0;}
  function sortOrdersNewestFirst(rows){
    return [...(rows||[])].sort((a,b)=>orderRecency(b)-orderRecency(a)||Number(b.orderNo||0)-Number(a.orderNo||0));
  }
  function sortDebtCustomersNewestFirst(rows){
    return [...(rows||[])].sort((a,b)=>(Date.parse(b.lastOccurredAt||0)||0)-(Date.parse(a.lastOccurredAt||0)||0));
  }
  function newestDebtTimeline(rows){
    return [...(rows||[])].sort((a,b)=>(Date.parse(b.occurredAt||0)||0)-(Date.parse(a.occurredAt||0)||0));
  }
  function localDateKey(value){
    const d=value instanceof Date?new Date(value):new Date(value||0);
    if(!Number.isFinite(d.getTime()))return "";
    const p=n=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }
  function defaultOrderReportFilter(status){
    const today=localDateKey(new Date());
    if(status==="pending")return {mode:"all",from:today,to:today,search:""};
    if(status==="delivered")return {mode:"today",from:today,to:today,search:""};
    return {mode:"today",from:today,to:today,search:""};
  }
  function loadOrderReportFilters(){
    const allowed=new Set(["all","today","yesterday","week","month","year","custom"]),result={};
    let stored=null;
    try{stored=JSON.parse(sessionStorage.getItem(ORDER_REPORT_STATE_KEY)||"null");}catch{stored=null;}
    for(const status of Object.keys(STATUS_LABELS)){
      const base=defaultOrderReportFilter(status),raw=stored?.[status]||{};
      result[status]={
        mode:allowed.has(String(raw.mode||""))?String(raw.mode):base.mode,
        from:/^\d{4}-\d{2}-\d{2}$/.test(String(raw.from||""))?String(raw.from):base.from,
        to:/^\d{4}-\d{2}-\d{2}$/.test(String(raw.to||""))?String(raw.to):base.to,
        search:String(raw.search||"")
      };
    }
    return result;
  }
  function saveOrderReportFilters(){
    try{sessionStorage.setItem(ORDER_REPORT_STATE_KEY,JSON.stringify(orderReportFilters));}catch{}
  }
  function setOrderReportFilter(next){
    orderReportFilter={...orderReportFilter,...next};
    orderReportFilters[activeStatus]=orderReportFilter;
    saveOrderReportFilters();
  }
  function setActiveOrderStatus(status){
    const next=Object.prototype.hasOwnProperty.call(STATUS_LABELS,status)?status:"pending";
    activeStatus=next;
    if(!orderReportFilters[activeStatus])orderReportFilters[activeStatus]=defaultOrderReportFilter(activeStatus);
    orderReportFilter=orderReportFilters[activeStatus];
    saveOrderReportFilters();
  }
  function orderQuickRange(kind){
    const base=new Date();base.setHours(12,0,0,0);let from=new Date(base),to=new Date(base);
    if(kind==="today"){}
    else if(kind==="yesterday"){from.setDate(from.getDate()-1);to=new Date(from);}
    else if(kind==="week"){const day=base.getDay(),delta=day===0?-6:1-day;from.setDate(base.getDate()+delta);to=new Date(from);to.setDate(from.getDate()+6);}
    else if(kind==="month"){from=new Date(base.getFullYear(),base.getMonth(),1,12);to=new Date(base.getFullYear(),base.getMonth()+1,0,12);}
    else if(kind==="year"){from=new Date(base.getFullYear(),0,1,12);to=new Date(base.getFullYear(),11,31,12);}
    return {from:localDateKey(from),to:localDateKey(to)};
  }
  function orderFilterRange(filter){
    const mode=String(filter?.mode||"all");
    if(mode==="all")return null;
    if(mode==="custom")return {from:String(filter?.from||""),to:String(filter?.to||filter?.from||"")};
    return orderQuickRange(mode);
  }
  function filterOrdersForReport(rows=orders){
    const range=orderFilterRange(orderReportFilter),query=normalizedSearch(orderReportFilter.search);
    return (rows||[]).filter(order=>{
      if(order.status!==activeStatus)return false;
      const key=localDateKey(orderRecencyValue(order));
      if(range?.from&&range?.to&&(key<range.from||key>range.to))return false;
      if(query){
        const hay=normalizedSearch([orderRef(order),order.orderNo,order.customerName,...(order.items||[]).map(item=>item.name)].join(" "));
        if(!hay.includes(query))return false;
      }
      return true;
    });
  }
  function summarizeOrdersBySource(rows=[]){
    const map=new Map();const total={qty:0,expenseVnd:0,revenue:0,profit:0,costKnown:false};
    for(const order of rows){
      for(const item of order.items||[]){
        const source=String(item.sourceId||"Khác").trim()||"Khác",qty=Number(item.qty||0),price=Number(item.price||0),cost=Number(item.cost||0),known=item.cost!==undefined&&item.cost!==null;
        const row=map.get(source)||{source,qty:0,expenseVnd:0,revenue:0,profit:0,costKnown:false,orders:new Set()};
        row.qty+=qty;row.revenue+=price*qty;row.expenseVnd+=known?cost*qty:0;row.profit+=known?(price-cost)*qty:0;row.costKnown=row.costKnown||known;row.orders.add(String(order.id));map.set(source,row);
        total.qty+=qty;total.revenue+=price*qty;if(known){total.expenseVnd+=cost*qty;total.profit+=(price-cost)*qty;total.costKnown=true;}
      }
    }
    return {rows:[...map.values()].sort((a,b)=>b.revenue-a.revenue||a.source.localeCompare(b.source,"vi")).map(row=>({...row,orderCount:row.orders.size,orders:undefined})),total};
  }
  function orderReportControlsMarkup(){
    const f=orderReportFilter;
    const option=(value,label)=>`<option value="${value}" ${f.mode===value?"selected":""}>${label}</option>`;
    return `<section class="order-report-controls">
      <div class="order-report-search"><input type="search" data-order-report-search value="${escapeHtml(f.search)}" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Tìm khách, mã đơn, sản phẩm"></div>
      <div class="order-report-time">
        <label class="order-report-preset"><span>Thời gian</span><select data-order-report-preset aria-label="Chọn thời gian">${option("all","Tất cả")}${option("today","Hôm nay")}${option("yesterday","Hôm qua")}${option("week","Tuần này")}${option("month","Tháng này")}${option("year","Năm nay")}${option("custom","Tùy chọn")}</select></label>
        ${f.mode==="custom"?`<div class="order-report-custom"><label>Từ <input type="date" data-order-report-range="from" value="${escapeHtml(f.from)}"></label><span>→</span><label>Đến <input type="date" data-order-report-range="to" value="${escapeHtml(f.to)}"></label></div>`:""}
      </div>
    </section>`;
  }
  function sourceSummaryMarkup(rows){
    const summary=summarizeOrdersBySource(rows),admin=currentRole()==="admin";
    if(!summary.rows.length)return '<section class="order-source-summary"><div class="order-source-empty">Không có dữ liệu nguồn trong phạm vi này.</div></section>';
    const value=(n,known=true)=>known?compactMoney(n):"—";
    return `<section class="order-source-summary">
      <div class="order-source-grid order-source-head"><span>NGUỒN</span><span>SL</span><span>CHI</span><span>THU</span><span>LÃI</span></div>
      ${summary.rows.map(row=>`<button type="button" class="order-source-grid order-source-row" data-order-source-open="${escapeHtml(row.source)}"><span>${escapeHtml(row.source)}</span><span>${row.qty}</span><span>${escapeHtml(value(row.expenseVnd,admin&&row.costKnown))}</span><span>${escapeHtml(value(row.revenue))}</span><span>${escapeHtml(value(row.profit,admin&&row.costKnown))}</span></button>`).join("")}
      <div class="order-source-grid order-source-total"><span>TỔNG (${rows.length} đơn)</span><span>${summary.total.qty}</span><span>${escapeHtml(value(summary.total.expenseVnd,admin&&summary.total.costKnown))}</span><span>${escapeHtml(value(summary.total.revenue))}</span><span>${escapeHtml(value(summary.total.profit,admin&&summary.total.costKnown))}</span></div>
    </section>`;
  }
  function sourceDetailRows(rows,source){
    return rows.flatMap(order=>(order.items||[]).filter(item=>(String(item.sourceId||"Khác").trim()||"Khác")===source).map(item=>({order,customer:order.customerName||"Khách hàng",item})));
  }
  function sourceCombinedRows(rows,source){
    const map=new Map();
    for(const row of sourceDetailRows(rows,source)){
      const key=String(row.item.productId||row.item.name||"").trim()||row.item.name;
      const current=map.get(key)||{key,name:row.item.name||key,qty:0,revenue:0};
      current.qty+=Number(row.item.qty||0);current.revenue+=Number(row.item.price||0)*Number(row.item.qty||0);map.set(key,current);
    }
    return [...map.values()].sort((a,b)=>b.qty-a.qty||a.name.localeCompare(b.name,"vi"));
  }
  function sourceDrillMarkup(rows){
    if(!sourceDrillSource)return "";
    const source=sourceDrillSource,detail=sourceDetailRows(rows,source),combined=sourceCombinedRows(rows,source),combinedMode=sourceDrillMode==="combined";
    return `<section class="order-source-detail">
      <header><div><strong>Nguồn ${escapeHtml(source)}</strong><small>${detail.length} dòng · ${detail.reduce((sum,row)=>sum+Number(row.item.qty||0),0)} sp</small></div><div><button type="button" data-order-source-share>Chia sẻ</button><button type="button" data-order-source-close>×</button></div></header>
      <nav><button type="button" data-order-source-mode="detail" aria-pressed="${!combinedMode}">Chi tiết nguồn</button><button type="button" data-order-source-mode="combined" aria-pressed="${combinedMode}">Tổng SP</button></nav>
      ${combinedMode?`<div class="order-source-combined">${combined.map((row,index)=>`<div><span>${index+1}. ${escapeHtml(row.name)}</span><strong>×${row.qty}</strong></div>`).join("")||'<div>Không có sản phẩm</div>'}</div>`:`<div class="order-source-lines">${detail.map((row,index)=>`<div><span>${index+1}. <b>${escapeHtml(row.item.name)}</b><small>${escapeHtml(orderRef(row.order))} · ${escapeHtml(row.customer)}</small></span><strong>×${Number(row.item.qty||0)}</strong></div>`).join("")||'<div>Không có sản phẩm</div>'}</div>`}
    </section>`;
  }
  function orderSourceShareText(rows){
    const source=sourceDrillSource;if(!source)return "";
    if(sourceDrillMode==="combined"){
      const combined=sourceCombinedRows(rows,source);
      return [`TỔNG SP · ${source}`,...combined.map((row,index)=>`${index+1}. ${row.name} ×${row.qty}`)].join("\n");
    }
    const detail=sourceDetailRows(rows,source);
    return [`CHI TIẾT NGUỒN · ${source}`,...detail.map((row,index)=>`${index+1}. ${row.item.name} ×${Number(row.item.qty||0)} · ${orderRef(row.order)} · ${row.customer}`)].join("\n");
  }
  async function shareOrderSource(){
    const rows=filterOrdersForReport(orders),text=orderSourceShareText(rows);if(!text)return;
    const title=(sourceDrillMode==="combined"?"Tổng SP · ":"Chi tiết nguồn · ")+sourceDrillSource;
    if(navigator.share){try{await navigator.share({title,text});return;}catch(error){if(error?.name==="AbortError")return;}}
    if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(text);setMainStatus("Đã sao chép "+title+".");return;}
    setMainStatus("Thiết bị không hỗ trợ chia sẻ hoặc sao chép.");
  }
  function renderOrders(){
    renderTabs();
    const visible=sortOrdersNewestFirst(filterOrdersForReport(orders)),statusCount=orders.filter(order=>order.status===activeStatus).length;
    const list=document.getElementById("orderManagerList");
    const empty=document.getElementById("orderManagerEmpty");
    const summary=document.getElementById("orderManagerSummary");
    if(summary)summary.textContent=(STATUS_LABELS[activeStatus]||activeStatus)+" · "+visible.length+(visible.length!==statusCount?" / "+statusCount:"")+" đơn";
    syncBatchControls(visible);
    if(empty){empty.hidden=visible.length!==0;empty.textContent="Chưa có đơn trong phạm vi này.";}
    if(!list)return;
    const cards=visible.map(order=>{
      const items=Array.isArray(order.items)?order.items:[];
      const id=String(order.id||"");
      const expanded=expandedOrderId===String(order.id);
      const preview=items.slice(0,3).map(item=>`${String(item.name||"Sản phẩm")} ×${Number(item.qty||0)}`).join(" · ")+(items.length>3?` · +${items.length-3}`:"");
      return `<article class="order-card ${expanded?"expanded":""}" data-order-id="${escapeHtml(order.id)}">
        <div class="order-card-head"><div><strong class="order-card-customer">${escapeHtml(order.customerName||"Khách hàng")}</strong><small class="order-card-meta">${escapeHtml(dateTime(orderRecencyValue(order)))} · ${items.length+" dòng"} · ${escapeHtml(orderRef(order))}</small></div><b>${escapeHtml(compactMoney(order.total))}</b></div>
        ${preview?`<div class="order-card-preview">${escapeHtml(preview)}</div>`:""}
        <button type="button" class="order-card-detail-toggle" data-order-detail data-order-id="${escapeHtml(id)}">${expanded?"Thu gọn":"Xem đơn"}</button>
        ${expanded?`<div class="order-card-items">${items.map(item=>`<div><span>${escapeHtml(item.name)}</span><small>${Number(item.qty||0)} × ${orderItemPriceMarkup(item)}</small></div>`).join("")}</div>`:""}
        ${expanded?orderActions(order):""}
      </article>`;
    }).join("");
    list.innerHTML=orderReportControlsMarkup()+sourceSummaryMarkup(visible)+sourceDrillMarkup(visible)+`<div class="order-lifecycle-list">${cards}</div>`;
  }

  async function loadDebtSummaries(){
    const data=await orderFetch("/debts",{method:"GET"});
    debtSummaries=Array.isArray(data.debts)?data.debts:[];
    return debtSummaries;
  }
  async function loadDebtDetail(customerId){
    const data=await orderFetch("/debts/"+encodeURIComponent(customerId),{method:"GET"});
    debtCustomerId=String(data?.customer?.id||customerId||"");
    debtDetail=data;
    return data;
  }
  function debtEventSign(row){return row.direction==="decrease"?"−":"+"}
  function renderDebtSummaries(){
    const list=document.getElementById("orderManagerList");
    const empty=document.getElementById("orderManagerEmpty");
    const summary=document.getElementById("orderManagerSummary");
    const total=debtSummaries.reduce((sum,row)=>sum+Number(row.balanceVnd||0),0);
    if(summary)summary.textContent="Công nợ · "+debtSummaries.length+" khách · "+compactMoney(total);
    if(empty){empty.hidden=debtSummaries.length!==0;empty.textContent="Chưa có khách hàng hoặc công nợ.";}
    if(!list)return;
    const recent=sortDebtCustomersNewestFirst(debtSummaries);
    list.innerHTML=recent.map(row=>`
      <button type="button" class="debt-customer-card" data-debt-customer-id="${escapeHtml(row.customerId)}">
        <span><strong>${escapeHtml(row.customerName||row.username||"Khách hàng")}</strong><small>${row.username?"@"+escapeHtml(row.username):""}${row.lastOccurredAt?" · "+escapeHtml(dateTime(row.lastOccurredAt)):""}</small></span>
        <b>${escapeHtml(compactMoney(row.balanceVnd))}</b>
      </button>`).join("");
  }
  function paymentForm(customerId){
    if(currentRole()!=="admin")return "";
    return `<form class="debt-payment-form" data-debt-payment-form data-customer-id="${escapeHtml(customerId)}">
      <input name="amountVnd" inputmode="numeric" autocomplete="off" placeholder="Số tiền khách trả" aria-label="Số tiền khách trả">
      <input name="note" autocomplete="off" placeholder="Ghi chú (không bắt buộc)" aria-label="Ghi chú">
      <button type="submit">Ghi nhận thanh toán</button>
    </form>`;
  }
  async function openDebtLinkedOrder(id){
    const data=await orderFetch("/orders/"+encodeURIComponent(id),{method:"GET"});
    debtLinkedOrder=data?.order||null;
    if(debtLinkedOrder)orders=[debtLinkedOrder,...orders.filter(row=>String(row.id)!==String(debtLinkedOrder.id))];
    renderDebtLinkedOrder();
  }
  function renderDebtLinkedOrder(){
    if(!debtLinkedOrder){renderDebtDetail();return;}
    const order=debtLinkedOrder,items=Array.isArray(order.items)?order.items:[],qty=items.reduce((sum,item)=>sum+Number(item.qty||0),0);
    const list=document.getElementById("orderManagerList"),empty=document.getElementById("orderManagerEmpty"),summary=document.getElementById("orderManagerSummary");
    if(summary)summary.textContent="Đơn "+orderRef(order)+" · "+(STATUS_LABELS[order.status]||order.status);
    if(empty)empty.hidden=true;if(!list)return;
    list.innerHTML=`<section class="debt-linked-order">
      <button type="button" class="debt-linked-back" data-debt-order-back>← Công nợ</button>
      <div class="debt-linked-head"><div><strong>${escapeHtml(orderRef(order))}</strong><small>${escapeHtml(order.customerName||"Khách hàng")} · ${escapeHtml(dateTime(order.orderedAt))}</small></div><b>${escapeHtml(compactMoney(order.total))}</b></div>
      <div class="debt-linked-lines">${items.map((item,index)=>`<div><span><small>${index+1}.</small>${escapeHtml(item.name)}</span><span>${Number(item.qty||0)} × ${orderItemPriceMarkup(item)}</span><strong>${escapeHtml(compactMoney(Number(item.qty||0)*Number(item.price||0)))}</strong></div>`).join("")}</div>
      <div class="debt-linked-total"><span>Tổng ${qty} SP</span><strong>${escapeHtml(compactMoney(order.total))}</strong></div>
      ${orderActions(debtLinkedOrder)}
    </section>`;
  }
  function renderDebtDetail(){
    if(debtLinkedOrder){renderDebtLinkedOrder();return;}
    const list=document.getElementById("orderManagerList");
    const empty=document.getElementById("orderManagerEmpty");
    const summary=document.getElementById("orderManagerSummary");
    if(!debtDetail){renderDebtSummaries();return;}
    const customer=debtDetail.customer||{};
    const timeline=Array.isArray(debtDetail.timeline)?debtDetail.timeline:[];
    if(summary)summary.textContent=(customer.name||"Khách hàng")+" · Dư nợ "+compactMoney(debtDetail.balanceVnd);
    if(empty)empty.hidden=true;
    if(!list)return;
    list.innerHTML=`
      <section class="debt-detail-head"><div><strong>${escapeHtml(customer.name||customer.username||"Khách hàng")}</strong><small>${customer.username?"@"+escapeHtml(customer.username):""}</small></div><b>${escapeHtml(compactMoney(debtDetail.balanceVnd))}</b></section>
      ${paymentForm(customer.id||debtCustomerId)}
      <div class="debt-timeline">${timeline.length?newestDebtTimeline(timeline).map(row=>`
        <button type="button" class="debt-txn ${row.direction==="decrease"?"decrease":"increase"}" ${row.orderId?`data-debt-order-id="${escapeHtml(row.orderId)}"`:"disabled"}>
          <div class="debt-txn-main"><span><strong>${escapeHtml(DEBT_EVENT_LABELS[row.eventType]||row.eventType)}</strong><small>${escapeHtml(dateTime(row.occurredAt))}${row.orderNo?" · Đơn #"+escapeHtml(row.orderNo):""}</small></span><b>${debtEventSign(row)}${escapeHtml(compactMoney(row.amountVnd))}</b></div>
          ${row.note?`<div class="debt-txn-note">${escapeHtml(row.note)}</div>`:""}
          <div class="debt-balance-after">Dư nợ sau giao dịch <strong>${escapeHtml(compactMoney(row.balanceAfterVnd))}</strong></div>
        </button>`).join(""):'<div class="order-manager-message">Chưa có giao dịch công nợ.</div>'}</div>`;
  }
  async function refreshDebts(){
    const list=document.getElementById("orderManagerList");
    if(list)list.innerHTML='<div class="order-manager-message">Đang tải công nợ...</div>';
    if(currentRole()==="user"){
      const id=String(currentAccount()?.id||"");
      await loadDebtDetail(id);
      renderDebtDetail();
      return;
    }
    if(debtCustomerId){
      await loadDebtDetail(debtCustomerId);
      renderDebtDetail();
      return;
    }
    await loadDebtSummaries();
    renderDebtSummaries();
  }

  function handleAuthError(error){
    if(error?.status!==401)return false;
    clearAuth();
    void requireChatAuth("Phiên Chat đã hết hạn. Đang xác thực lại...");
    return true;
  }
  async function refreshManager(){
    injectUi();
    updateIdentity();
    if(!readAuth()){
      if(!isEmbeddedInChat()){goToChat();return;}
      setManagerGate("Đang xác thực qua Chat...");
      if(!(await waitForChatAuth())){setManagerGate("Cần đăng nhập Chat để tiếp tục.");return;}
    }
    clearManagerGate();
    updateIdentity();
    if(currentRole()==="admin")void loadCustomers().catch(()=>{});
    syncManagerView();
    try{
      if(activeView==="debts")await refreshDebts();
      else {await loadOrders();renderOrders();}
      if(!syncBusy)await checkRemoteRevision(true);
    }catch(error){
      if(!handleAuthError(error)){
        const list=document.getElementById("orderManagerList");
        if(list)list.innerHTML='<div class="order-manager-message">'+escapeHtml(error?.message||error)+'</div>';
      }
    }
  }


  function setSalesBusyState(kind,on){
    const labels={send:"Gửi đơn",quick:"Bán nhanh",update:editingOrderStatus==="delivered"?"Cập nhật đã giao":"Cập nhật đơn"};
    const busyLabels={send:"Đang gửi…",quick:"Đang bán…",update:"Đang cập nhật…"};
    const buttons=[...document.querySelectorAll('#userWorkSendOrder,#mobileUserSendOrder,[data-order-cart-action="clear"],[data-order-cart-action="quick"],[data-order-cart-action="cancel-edit"],[data-order-cart-action="update"]')];
    for(const button of buttons){
      const buttonKind=button.matches('[data-order-cart-action="quick"]')?"quick":button.matches('[data-order-cart-action="update"]')?"update":button.matches('#userWorkSendOrder,#mobileUserSendOrder')?"send":"other";
      const active=Boolean(on&&buttonKind===kind);
      button.disabled=Boolean(on);
      button.setAttribute("aria-busy",active?"true":"false");
      if(buttonKind==="send"){
        const label=button.querySelector("span");
        if(label)label.textContent=active?busyLabels.send:labels.send;
      }else if(buttonKind!=="other")button.textContent=active?busyLabels[buttonKind]:labels[buttonKind];
    }
    if(!on)syncCartActions();
  }

  function selectedOrderPayload(){
    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
    if(!Array.isArray(selected)||selected.length===0)return null;
    return selected.map(item=>({
      url:item.row.canonical_url,
      qty:item.qty,
      bargainPriceVnd:Math.max(0,Math.round(Number(item.bargain||0)))
    }));
  }
  function afterCartMutation(){
    window.setTimeout(()=>{ensureCartActions();syncCartActions();syncCustomerControls();},0);
  }
  function clearCurrentCart(){
    if(typeof window.clearUserWorkOrderSelection==="function")window.clearUserWorkOrderSelection();
    applyPendingChatWorkContextIfSafe();
    afterCartMutation();
  }
  async function startEditOrder(id){
    if(busy)return;
    const order=orders.find(row=>String(row.id)===String(id))||(debtLinkedOrder&&String(debtLinkedOrder.id)===String(id)?debtLinkedOrder:null);
    if(!order)return;
    const status=String(order.status||"");
    if(status!=="pending"&&status!=="delivered")return;
    if(status==="delivered"&&currentRole()!=="admin")return;
    if(typeof window.loadUserWorkOrderSelection!=="function"){alert("Không tải được đơn vào Tạp hóa.");return;}
    if(currentRole()==="admin"){
      selectedCustomerId=String(order.customerId||"");
      if(selectedCustomerId)sessionStorage.setItem(SELECTED_CUSTOMER_KEY,selectedCustomerId);
    }
    editingOrderId=String(order.id);editingOrderStatus=status;
    window.loadUserWorkOrderSelection(order);
    taphoaWorkView="sales";syncTaphoaWorkspace();syncCartActions();syncCustomerControls();
    setMainStatus("Đang sửa đơn "+orderRef(order)+(status==="delivered"?" · Đã giao":"")+".");
  }
  function cancelEditOrder(){
    if(!editingOrderId)return;
    const label=orderRef(orders.find(row=>String(row.id)===String(editingOrderId))||{id:editingOrderId});
    editingOrderId="";editingOrderStatus="";clearCurrentCart();
    taphoaWorkView="sales";syncTaphoaWorkspace();
    syncCartActions();syncCustomerControls();setMainStatus("Đã hủy sửa đơn "+label+".");
  }
  async function updateEditingOrder(){
    if(busy||!editingOrderId)return;
    if(!(await requireChatAuth()))return;
    const items=selectedOrderPayload();if(!items){setMainStatus("Đơn phải có ít nhất một sản phẩm.");return;}
    const id=editingOrderId,previousStatus=editingOrderStatus||"pending";
    busy=true;setSalesBusyState("update",true);setMainStatus("Đang cập nhật đơn...");
    try{
      const data=await orderFetch("/orders/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({items})});
      editingOrderId="";editingOrderStatus="";clearCurrentCart();
      const label=data?.order?.orderNo?"#"+data.order.orderNo:String(id);
      setMainStatus("Đã cập nhật đơn "+label+".");
      expandedOrderId=String(id);activeView="orders";setActiveOrderStatus(String(data?.order?.status||previousStatus));debtLinkedOrder=null;
      taphoaWorkView="sales";syncTaphoaWorkspace();
    }catch(error){handleAuthError(error);setMainStatus(String(error?.message||error));}
    finally{busy=false;setSalesBusyState("update",false);syncCartActions();syncCustomerControls();}
  }

  async function submitQuickSale(){
    if(busy||currentRole()!=="admin")return;
    if(!(await requireChatAuth()))return;
    const items=selectedOrderPayload();
    if(!items){setMainStatus("Chưa chọn sản phẩm.");return;}
    if(!selectedCustomerId){setMainStatus("Chưa chọn khách hàng.");await openCustomerPicker();return;}
    const customerId=selectedCustomerId;
    busy=true;setSalesBusyState("quick",true);setMainStatus("Đang bán nhanh...");
    try{
      const data=await orderFetch("/orders",{method:"POST",body:JSON.stringify({items,customerId,mode:"quick"})});
      clearCurrentCart();
      const label=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");
      setMainStatus("Đã bán nhanh đơn "+label+" · Đã giao.");
      expandedOrderId="";activeView="orders";setActiveOrderStatus("delivered");
      taphoaWorkView="sales";syncTaphoaWorkspace();
    }catch(error){
      handleAuthError(error);setMainStatus(String(error?.message||error));
    }finally{busy=false;setSalesBusyState("quick",false);syncCartActions();syncCustomerControls();}
  }

  async function deleteAllPendingOrders(){
    if(busy)return;
    const count=orders.filter(order=>order.status==="pending").length;
    if(!count)return;
    if(!confirm("Xóa tất cả "+count+" đơn tạm trong phạm vi hiện tại?"))return;
    busy=true;
    try{await orderFetch("/orders/pending",{method:"DELETE"});expandedOrderId="";sourceDrillSource="";await refreshManager();}
    catch(error){if(!handleAuthError(error))alert(String(error?.message||error));}
    finally{busy=false;}
  }
  async function returnFilteredDeliveredOrders(){
    if(busy||currentRole()!=="admin"||activeStatus!=="delivered")return;
    const ids=filterOrdersForReport(orders).filter(order=>order.status==="delivered").map(order=>String(order.id));
    if(!ids.length)return;
    if(!confirm("Xóa/hoàn tất cả "+ids.length+" đơn đã giao trong phạm vi đang lọc và đảo lại công nợ?"))return;
    busy=true;
    try{
      await orderFetch("/orders/return-batch",{method:"POST",body:JSON.stringify({ids})});
      expandedOrderId="";sourceDrillSource="";debtLinkedOrder=null;await refreshManager();
    }catch(error){if(!handleAuthError(error))alert(String(error?.message||error));}
    finally{busy=false;}
  }

  async function checkRemoteRevision(forceBaseline=false){
    const host=document.getElementById("orderManager");
    if(!readAuth()||!host||host.hidden||syncBusy||busy)return;
    syncBusy=true;
    try{
      const data=await orderFetch("/sync",{method:"GET"});
      const nextOrders=String(data?.ordersVersion||"");
      const nextDebt=String(data?.debtVersion||"");
      const hadBaseline=Boolean(ordersVersion||debtVersion);
      const changed=hadBaseline&&(nextOrders!==ordersVersion||nextDebt!==debtVersion);
      ordersVersion=nextOrders;debtVersion=nextDebt;
      if(changed&&!forceBaseline)await refreshManager();
    }catch(error){
      handleAuthError(error);
    }finally{syncBusy=false;}
  }

  async function submitSelectedOrder(){
    if(busy)return;
    if(!(await requireChatAuth()))return;
    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
    if(!Array.isArray(selected)||selected.length===0){setMainStatus("Chưa chọn sản phẩm.");return;}
    const items=selected.map(item=>({url:item.row.canonical_url,qty:item.qty}));
    const submittedCustomerId=currentRole()==="admin"
      ?String(selectedCustomerId||"").trim()
      :String(currentAccount()?.id||"").trim();
    let body;
    if(currentRole()==="admin"){
      if(!submittedCustomerId){
        setMainStatus("Chưa chọn khách hàng.");
        await openCustomerPicker();
        return;
      }
      body=JSON.stringify({items,customerId:submittedCustomerId});
    }else body=JSON.stringify({items});

    busy=true;setSalesBusyState("send",true);setMainStatus("Đang gửi đơn...");
    try{
      const data=await orderFetch("/orders",{method:"POST",body});
      const notified=notifyChatOrderCreated({
        orderId:String(data?.order?.id||""),
        orderNo:String(data?.order?.orderNo||""),
        contactId:submittedCustomerId,
      });
      if(notified)chatWorkContext=null;
      if(typeof window.clearUserWorkOrderSelection==="function"){
        window.clearUserWorkOrderSelection();
      }
      applyPendingChatWorkContextIfSafe();
      const customerName=currentRole()==="admin"?(selectedCustomer()?.name||""):"";
      const orderLabel=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");
      setMainStatus("Đã gửi đơn "+orderLabel+(customerName?" · "+customerName:"")+" · Đơn tạm.");
      expandedOrderId="";activeView="orders";setActiveOrderStatus("pending");
      debtCustomerId="";debtDetail=null;
      taphoaWorkView="sales";syncTaphoaWorkspace();
    }catch(error){
      handleAuthError(error);
      setMainStatus(String(error?.message||error));
    }finally{busy=false;setSalesBusyState("send",false);}
  }

  async function performAdminAction(action,id){
    return performOrderAction(action,id);
  }

  async function performOrderAction(action,id){
    if(action==="edit"){await startEditOrder(id);return;}
    if(busy)return;
    const admin=currentRole()==="admin";
    if((action==="deliver"||action==="return")&&!admin)return;
    if(action==="delete"&&!confirm("Xóa đơn tạm này?"))return;
    if(action==="return"&&!confirm("Hoàn đơn này và đảo lại công nợ?"))return;
    busy=true;
    try{
      if(action==="deliver")await orderFetch("/orders/"+encodeURIComponent(id)+"/deliver",{method:"POST"});
      else if(action==="return")await orderFetch("/orders/"+encodeURIComponent(id)+"/return",{method:"POST"});
      else if(action==="delete")await orderFetch("/orders/"+encodeURIComponent(id),{method:"DELETE"});
      expandedOrderId="";
      if(debtLinkedOrder&&String(debtLinkedOrder.id)===String(id))debtLinkedOrder=null;
      await refreshManager();
    }catch(error){
      if(!handleAuthError(error))alert(String(error?.message||error));
    }finally{busy=false;}
  }

  async function openDebtCustomer(id){
    debtCustomerId=String(id||"");
    debtDetail=null;
    syncManagerView();
    await refreshDebts();
  }
  async function submitPayment(form){
    if(busy||currentRole()!=="admin")return;
    const customerId=String(form.dataset.customerId||"");
    const amountText=String(form.elements.amountVnd?.value||"").replace(/[^0-9]/g,"");
    const amountVnd=Number(amountText||0);
    const note=String(form.elements.note?.value||"").trim();
    if(!Number.isFinite(amountVnd)||amountVnd<=0){alert("Nhập số tiền khách trả.");return;}
    busy=true;
    try{
      await orderFetch("/debts/"+encodeURIComponent(customerId)+"/payments",{
        method:"POST",body:JSON.stringify({amountVnd:Math.round(amountVnd),note})
      });
      await loadDebtDetail(customerId);
      renderDebtDetail();
    }catch(error){
      if(!handleAuthError(error))alert(String(error?.message||error));
    }finally{busy=false;}
  }

  document.addEventListener("click",async event=>{
    const send=event.target.closest?.("#userWorkSendOrder,#mobileUserSendOrder");
    if(!send)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    await submitSelectedOrder();
  },true);

  document.addEventListener("click",async event=>{
    const target=event.target;
    const cartAction=target.closest?.("[data-order-cart-action]");
    if(cartAction){const action=String(cartAction.dataset.orderCartAction||"");if(action==="clear")clearCurrentCart();else if(action==="quick")await submitQuickSale();else if(action==="cancel-edit")cancelEditOrder();else if(action==="update")await updateEditingOrder();return;}
    const batch=target.closest?.("[data-order-batch]");
    if(batch?.dataset.orderBatch==="delete-pending"){await deleteAllPendingOrders();return;}
    if(batch?.dataset.orderBatch==="return-delivered"){await returnFilteredDeliveredOrders();return;}
    const sourceOpen=target.closest?.("[data-order-source-open]");if(sourceOpen){sourceDrillSource=String(sourceOpen.dataset.orderSourceOpen||"");sourceDrillMode="detail";renderOrders();return;}
    const sourceMode=target.closest?.("[data-order-source-mode]");if(sourceMode){sourceDrillMode=String(sourceMode.dataset.orderSourceMode||"detail")==="combined"?"combined":"detail";renderOrders();return;}
    if(target.closest?.("[data-order-source-close]")){sourceDrillSource="";renderOrders();return;}
    if(target.closest?.("[data-order-source-share]")){await shareOrderSource();return;}
    if(target.closest?.("[data-debt-order-back]")){debtLinkedOrder=null;renderDebtDetail();return;}
    const debtOrder=target.closest?.("[data-debt-order-id]");if(debtOrder){await openDebtLinkedOrder(String(debtOrder.dataset.debtOrderId||""));return;}
    const workView=target.closest?.("[data-taphoa-work-view]");
    if(workView){
      taphoaWorkView=String(workView.dataset.taphoaWorkView||"sales");
      activeView=taphoaWorkView==="debts"?"debts":"orders";
      debtLinkedOrder=null;
      if(taphoaWorkView==="debts"&&currentRole()==="user")debtCustomerId=String(currentAccount()?.id||"");
      else if(taphoaWorkView!=="debts")debtCustomerId="";
      debtDetail=null;syncTaphoaWorkspace();syncManagerView();
      if(taphoaWorkView!=="sales"&&await requireChatAuth())await refreshManager();
      return;
    }
    if(target.closest?.("#orderCustomerPickerClose")){closeCustomerPicker();return;}
    if(target.closest?.("[data-order-customer-select]")){await openCustomerPicker();return;}
    if(target.closest?.("#debtBackButton")){debtCustomerId="";debtDetail=null;debtLinkedOrder=null;syncManagerView();await refreshDebts();return;}
    const debtCustomer=target.closest?.("[data-debt-customer-id]");if(debtCustomer){debtLinkedOrder=null;await openDebtCustomer(String(debtCustomer.dataset.debtCustomerId||""));return;}
    const customerOption=target.closest?.("[data-order-customer-id]");if(customerOption){chooseCustomer(String(customerOption.dataset.orderCustomerId||""));return;}
    const tab=target.closest?.("[data-order-status]");if(tab){expandedOrderId="";sourceDrillSource="";setActiveOrderStatus(String(tab.dataset.orderStatus||"pending"));renderOrders();return;}
    const detail=target.closest?.("[data-order-detail]");if(detail){const id=String(detail.dataset.orderId||"");expandedOrderId=expandedOrderId===id?"":id;renderOrders();return;}
    const action=target.closest?.("[data-order-action]");if(action){await performOrderAction(String(action.dataset.orderAction||""),String(action.dataset.orderId||""));return;}
    if(target.closest?.(".user-work-jump-button,#mobileUserSourceTabs button"))window.setTimeout(()=>{if(!isTaphoaWorkspaceActive())taphoaWorkView="sales";ensureTaphoaWorkspaceNav();syncTaphoaWorkspace();},0);
  });

  document.addEventListener("submit",async event=>{
    const form=event.target.closest?.("[data-debt-payment-form]");
    if(!form)return;
    event.preventDefault();
    await submitPayment(form);
  });
  document.addEventListener("input",event=>{
    if(event.target?.id==="orderCustomerSearch"&&!pickerBusy){renderCustomerList();return;}
    if(event.target?.matches?.("[data-order-report-search]")){
      setOrderReportFilter({search:String(event.target.value||"")});sourceDrillSource="";renderOrders();
      const input=document.querySelector("[data-order-report-search]");input?.focus();input?.setSelectionRange(orderReportFilter.search.length,orderReportFilter.search.length);return;
    }
    const range=event.target?.closest?.("[data-order-report-range]");
    if(range){const side=String(range.dataset.orderReportRange||"from"),value=String(range.value||"");let next={...orderReportFilter,mode:"custom",[side]:value};if(next.from&&next.to&&next.from>next.to){if(side==="from")next.to=next.from;else next.from=next.to;}setOrderReportFilter(next);sourceDrillSource="";renderOrders();}
  });
  document.addEventListener("change",event=>{
    if(!event.target?.matches?.("[data-order-report-preset]"))return;
    const mode=String(event.target.value||"all");
    if(!["all","today","yesterday","week","month","year","custom"].includes(mode))return;
    if(mode==="custom")setOrderReportFilter({mode});
    else if(mode==="all")setOrderReportFilter({mode});
    else setOrderReportFilter({mode,...orderQuickRange(mode)});
    sourceDrillSource="";renderOrders();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!document.getElementById("orderCustomerPicker")?.hidden){closeCustomerPicker();return;}
    if(event.key==="Escape"&&!document.getElementById("orderManager")?.hidden)closeManager();
  });

  // TAPHOA_FULL_ORDER_DEBT_PARITY_20260911
  window.GETLINK_ACCESS_CONTEXT={states:ACCESS_STATES,snapshot:accessSnapshot};
  injectUi();
  emitAccessChange();
  requestChatAuth();
  document.addEventListener("getlink-cart-change",()=>{ensureSalesContextPanel();renderSalesContext();});
  window.addEventListener("resize",()=>{ensureTaphoaWorkspaceNav();syncTaphoaWorkspace();});
  window.setInterval(()=>{ensureTaphoaWorkspaceNav();ensureInlineCustomerButtons();ensureCartActions();syncCustomerControls();syncTaphoaWorkspace();},1500);
  window.setInterval(()=>{void checkRemoteRevision();},ORDER_SYNC_MS);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void checkRemoteRevision();});
  window.addEventListener("focus",()=>{void checkRemoteRevision();});
})();
