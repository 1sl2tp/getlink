(()=>{
  "use strict";

  const ACCESS_STATES=Object.freeze(["guest","user","admin"]);
  const AUTH_KEY="getlink:chat-order-auth";
  const SELECTED_CUSTOMER_KEY="getlink:order-selected-customer";
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
  let activeStatus="pending";
  let expandedOrderId="";
  let editingOrderId="";
  let editingOrderStatus="";
  let orderReportFilter={mode:"all",from:localDateKey(new Date()),to:localDateKey(new Date()),search:""};
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

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function moneyVnd(value){
    const n=Number(value||0);
    return Number.isFinite(n)?Math.round(n).toLocaleString("vi-VN")+" ₫":"—";
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
    syncWorkManagerNav();
    syncCartActions();
    document.dispatchEvent(new CustomEvent("getlink-access-change",{detail:accessSnapshot()}));
  }
  function currentRole(){return currentAccessState()}
  function selectedCustomer(){return customers.find(row=>String(row.id)===String(selectedCustomerId))||null}

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
    if(!message||message.type!=="taphoa-chat-auth")return;
    void acceptChatBridge(message);
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

  function workManagerNavMarkup(kind){
    return '<nav class="order-work-nav '+kind+'" aria-label="Quản lý mua hàng">'+
      '<span class="order-work-nav-label">Quản lý</span>'+
      '<button type="button" data-order-work-view="orders">Đơn của tôi</button>'+
      '<button type="button" data-order-work-view="debts">Công nợ</button>'+
    '</nav>';
  }
  function syncWorkManagerNav(){
    const admin=currentRole()==="admin";
    document.querySelectorAll('[data-order-work-view="orders"]').forEach(button=>{
      button.textContent=admin?"Đơn hàng":"Đơn của tôi";
    });
    document.querySelectorAll("[data-order-work-view]").forEach(button=>{
      const on=String(button.dataset.orderWorkView)===activeView;
      button.classList.toggle("active",on);
      button.setAttribute("aria-pressed",on?"true":"false");
    });
  }
  function ensureWorkManagerNav(){
    const desktopJump=document.querySelector(".user-work-jump");
    if(desktopJump){
      const desktopTop=desktopJump.closest(".user-work-top");
      if(desktopTop&&!desktopTop.parentElement?.querySelector(".order-work-nav.desktop")){
        desktopTop.insertAdjacentHTML("afterend",workManagerNavMarkup("desktop"));
      }
    }
    const mobileSource=document.querySelector(".mobile-user-source-row");
    if(mobileSource&&!mobileSource.parentElement?.querySelector(".order-work-nav.mobile")){
      mobileSource.insertAdjacentHTML("afterend",workManagerNavMarkup("mobile"));
    }
    syncWorkManagerNav();
  }

  function injectUi(){
    ensureWorkManagerNav();
    ensureCartActions();
    if(document.getElementById("orderManager"))return;
    const roleSwitch=document.querySelector(".role-switch");
    if(roleSwitch){
      const button=document.createElement("button");
      button.id="orderManagerButton";
      button.className="order-manager-entry";
      button.type="button";
      button.textContent="Đơn hàng";
      roleSwitch.insertBefore(button,document.getElementById("roleAdminButton")||null);
    }
    document.body.insertAdjacentHTML("beforeend",`
      <div id="orderManager" class="order-manager" hidden aria-hidden="true">
        <section class="order-manager-panel" role="dialog" aria-modal="true" aria-labelledby="orderManagerTitle">
          <header class="order-manager-head">
            <div><h2 id="orderManagerTitle">Bán hàng</h2><small id="orderManagerIdentity"></small></div>
            <button id="orderManagerClose" type="button" aria-label="Đóng">×</button>
          </header>
          <div id="orderManagerGate" class="order-manager-message" hidden></div>
          <div id="orderManagerBody" class="order-manager-body">
            <nav class="order-manager-modes" aria-label="Quản lý bán hàng">
              <button type="button" data-manager-view="orders" class="active">Đơn hàng</button>
              <button type="button" data-manager-view="debts">Công nợ</button>
            </nav>
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
                <button id="orderCustomerPickerButton" type="button" hidden>Chọn khách hàng</button>
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
      </div>`);
    syncCustomerControls();
    syncManagerView();
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
    const picker=document.getElementById("orderCustomerPickerButton");
    if(picker){
      picker.hidden=!(admin&&activeView==="orders"&&!editingOrderId);
      picker.textContent=customer?"Khách · "+customer.name:"Chọn khách hàng";
    }
  }
  function syncManagerView(){
    document.querySelectorAll("[data-manager-view]").forEach(button=>{
      const on=String(button.dataset.managerView)===activeView;
      button.classList.toggle("active",on);
      button.setAttribute("aria-pressed",on?"true":"false");
    });
    const tabs=document.getElementById("orderManagerTabs");
    if(tabs)tabs.hidden=activeView!=="orders";
    const back=document.getElementById("debtBackButton");
    if(back)back.hidden=activeView!=="debts"||currentRole()!=="admin"||!debtCustomerId;
    syncWorkManagerNav();
    syncCustomerControls();
    syncBatchControls();
    syncCartActions();
  }

  function setMainStatus(message){
    for(const id of ["userWorkOrderStatus","mobileUserOrderStatus"]){
      const node=document.getElementById(id);
      if(node)node.textContent=message;
    }
  }
  function setManagerGate(message){
    injectUi();
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
    const host=document.getElementById("orderManager");
    host.hidden=false;host.setAttribute("aria-hidden","false");
    void refreshManager();
  }
  function closeManager(){
    closeCustomerPicker();
    const host=document.getElementById("orderManager");
    if(!host)return;
    host.hidden=true;host.setAttribute("aria-hidden","true");
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
    const host=document.getElementById("orderManager");
    if(host?.hidden){host.hidden=false;host.setAttribute("aria-hidden","false");}
    clearManagerGate();
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
  function localDateKey(value){
    const d=value instanceof Date?new Date(value):new Date(value||0);
    if(!Number.isFinite(d.getTime()))return "";
    const p=n=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }
  function orderQuickRange(kind){
    const base=new Date();base.setHours(12,0,0,0);let from=new Date(base),to=new Date(base);
    if(kind==="yesterday"){from.setDate(from.getDate()-1);to=new Date(from);}
    else if(kind==="week"){const day=base.getDay(),delta=day===0?-6:1-day;from.setDate(base.getDate()+delta);to=new Date(from);to.setDate(from.getDate()+6);}
    else if(kind==="month"){from=new Date(base.getFullYear(),base.getMonth(),1,12);to=new Date(base.getFullYear(),base.getMonth()+1,0,12);}
    else if(kind==="year"){from=new Date(base.getFullYear(),0,1,12);to=new Date(base.getFullYear(),11,31,12);}
    return {from:localDateKey(from),to:localDateKey(to)};
  }
  function filterOrdersForReport(rows=orders){
    const mode=String(orderReportFilter.mode||"all"),from=String(orderReportFilter.from||""),to=String(orderReportFilter.to||from),query=normalizedSearch(orderReportFilter.search);
    const today=localDateKey(new Date());
    return (rows||[]).filter(order=>{
      if(order.status!==activeStatus)return false;
      const key=localDateKey(order.orderedAt);
      if(mode==="today"&&key!==today)return false;
      if(mode==="range"&&from&&to&&(key<from||key>to))return false;
      if(query){
        const hay=normalizedSearch([orderRef(order),order.orderNo,order.customerName,...(order.items||[]).map(item=>item.name)].join(" "));
        if(!hay.includes(query))return false;
      }
      return true;
    }).sort((a,b)=>new Date(b.orderedAt||0)-new Date(a.orderedAt||0)||Number(b.orderNo||0)-Number(a.orderNo||0));
  }
  function summarizeOrdersBySource(rows=[]){
    const map=new Map();const total={qty:0,cost:0,revenue:0,profit:0,costKnown:false};
    for(const order of rows){
      for(const item of order.items||[]){
        const source=String(item.sourceId||"Khác").trim()||"Khác",qty=Number(item.qty||0),price=Number(item.price||0),cost=Number(item.cost||0),known=item.cost!==undefined&&item.cost!==null;
        const row=map.get(source)||{source,qty:0,cost:0,revenue:0,profit:0,costKnown:false,orders:new Set()};
        row.qty+=qty;row.revenue+=price*qty;row.cost+=known?cost*qty:0;row.profit+=known?(price-cost)*qty:0;row.costKnown=row.costKnown||known;row.orders.add(String(order.id));map.set(source,row);
        total.qty+=qty;total.revenue+=price*qty;if(known){total.cost+=cost*qty;total.profit+=(price-cost)*qty;total.costKnown=true;}
      }
    }
    return {rows:[...map.values()].sort((a,b)=>b.revenue-a.revenue||a.source.localeCompare(b.source,"vi")).map(row=>({...row,orderCount:row.orders.size,orders:undefined})),total};
  }
  function orderReportControlsMarkup(){
    const f=orderReportFilter;
    return `<section class="order-report-controls">
      <div class="order-report-search"><input type="search" data-order-report-search value="${escapeHtml(f.search)}" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Tìm khách, mã đơn, sản phẩm"></div>
      <div class="order-report-time">
        <button type="button" data-order-report-all aria-pressed="${f.mode==="all"}">Tất cả</button>
        <button type="button" data-order-report-today aria-pressed="${f.mode==="today"}">Hôm nay</button>
        <label>Từ <input type="date" data-order-report-range="from" value="${escapeHtml(f.from)}"></label>
        <label>Đến <input type="date" data-order-report-range="to" value="${escapeHtml(f.to)}"></label>
      </div>
      <div class="order-report-quick">
        <button type="button" data-order-report-quick="yesterday">Hôm qua</button>
        <button type="button" data-order-report-quick="week">Tuần này</button>
        <button type="button" data-order-report-quick="month">Tháng này</button>
        <button type="button" data-order-report-quick="year">Năm nay</button>
      </div>
    </section>`;
  }
  function sourceSummaryMarkup(rows){
    const summary=summarizeOrdersBySource(rows),admin=currentRole()==="admin";
    if(!summary.rows.length)return '<section class="order-source-summary"><div class="order-source-empty">Không có dữ liệu nguồn trong phạm vi này.</div></section>';
    const value=(n,known=true)=>known?moneyVnd(n):"—";
    return `<section class="order-source-summary">
      <div class="order-source-grid order-source-head"><span>NGUỒN</span><span>SL</span><span>CHI</span><span>THU</span><span>LÃI</span></div>
      ${summary.rows.map(row=>`<button type="button" class="order-source-grid order-source-row" data-order-source-open="${escapeHtml(row.source)}"><span>${escapeHtml(row.source)}</span><span>${row.qty}</span><span>${escapeHtml(value(row.cost,admin&&row.costKnown))}</span><span>${escapeHtml(value(row.revenue))}</span><span>${escapeHtml(value(row.profit,admin&&row.costKnown))}</span></button>`).join("")}
      <div class="order-source-grid order-source-total"><span>TỔNG (${rows.length} đơn)</span><span>${summary.total.qty}</span><span>${escapeHtml(value(summary.total.cost,admin&&summary.total.costKnown))}</span><span>${escapeHtml(value(summary.total.revenue))}</span><span>${escapeHtml(value(summary.total.profit,admin&&summary.total.costKnown))}</span></div>
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
    const visible=filterOrdersForReport(orders),statusCount=orders.filter(order=>order.status===activeStatus).length;
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
      const secondary=currentRole()==="admin"?String(order.customerName||"Khách hàng")+" · "+dateTime(order.orderedAt):dateTime(order.orderedAt);
      return `<article class="order-card ${expanded?"expanded":""}" data-order-id="${escapeHtml(order.id)}">
        <div class="order-card-head"><div><strong>${escapeHtml(orderRef(order))}</strong><small>${escapeHtml(secondary)} · ${items.length+" dòng"}</small></div><b>${escapeHtml(moneyVnd(order.total))}</b></div>
        <button type="button" class="order-card-detail-toggle" data-order-detail data-order-id="${escapeHtml(id)}">${expanded?"Thu gọn":"Xem đơn"}</button>
        ${expanded?`<div class="order-card-items">${items.map(item=>`<div><span>${escapeHtml(item.name)}</span><small>${Number(item.qty||0)} × ${escapeHtml(moneyVnd(item.price))}</small></div>`).join("")}</div>`:""}
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
    if(summary)summary.textContent="Công nợ · "+debtSummaries.length+" khách · "+moneyVnd(total);
    if(empty){empty.hidden=debtSummaries.length!==0;empty.textContent="Chưa có khách hàng hoặc công nợ.";}
    if(!list)return;
    list.innerHTML=debtSummaries.map(row=>`
      <button type="button" class="debt-customer-card" data-debt-customer-id="${escapeHtml(row.customerId)}">
        <span><strong>${escapeHtml(row.customerName||row.username||"Khách hàng")}</strong><small>${row.username?"@"+escapeHtml(row.username):""}${row.lastOccurredAt?" · "+escapeHtml(dateTime(row.lastOccurredAt)):""}</small></span>
        <b>${escapeHtml(moneyVnd(row.balanceVnd))}</b>
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
      <div class="debt-linked-head"><div><strong>${escapeHtml(orderRef(order))}</strong><small>${escapeHtml(order.customerName||"Khách hàng")} · ${escapeHtml(dateTime(order.orderedAt))}</small></div><b>${escapeHtml(moneyVnd(order.total))}</b></div>
      <div class="debt-linked-lines">${items.map((item,index)=>`<div><span><small>${index+1}.</small>${escapeHtml(item.name)}</span><span>${Number(item.qty||0)} × ${escapeHtml(moneyVnd(item.price))}</span><strong>${escapeHtml(moneyVnd(Number(item.qty||0)*Number(item.price||0)))}</strong></div>`).join("")}</div>
      <div class="debt-linked-total"><span>Tổng ${qty} SP</span><strong>${escapeHtml(moneyVnd(order.total))}</strong></div>
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
    if(summary)summary.textContent=(customer.name||"Khách hàng")+" · Dư nợ "+moneyVnd(debtDetail.balanceVnd);
    if(empty)empty.hidden=true;
    if(!list)return;
    list.innerHTML=`
      <section class="debt-detail-head"><div><strong>${escapeHtml(customer.name||customer.username||"Khách hàng")}</strong><small>${customer.username?"@"+escapeHtml(customer.username):""}</small></div><b>${escapeHtml(moneyVnd(debtDetail.balanceVnd))}</b></section>
      ${paymentForm(customer.id||debtCustomerId)}
      <div class="debt-timeline">${timeline.length?timeline.map(row=>`
        <button type="button" class="debt-txn ${row.direction==="decrease"?"decrease":"increase"}" ${row.orderId?`data-debt-order-id="${escapeHtml(row.orderId)}"`:"disabled"}>
          <div class="debt-txn-main"><span><strong>${escapeHtml(DEBT_EVENT_LABELS[row.eventType]||row.eventType)}</strong><small>${escapeHtml(dateTime(row.occurredAt))}${row.orderNo?" · Đơn #"+escapeHtml(row.orderNo):""}</small></span><b>${debtEventSign(row)}${escapeHtml(moneyVnd(row.amountVnd))}</b></div>
          ${row.note?`<div class="debt-txn-note">${escapeHtml(row.note)}</div>`:""}
          <div class="debt-balance-after">Dư nợ sau giao dịch <strong>${escapeHtml(moneyVnd(row.balanceAfterVnd))}</strong></div>
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


  function selectedOrderPayload(){
    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
    if(!Array.isArray(selected)||selected.length===0)return null;
    return selected.map(item=>({url:item.row.canonical_url,qty:item.qty}));
  }
  function afterCartMutation(){
    window.setTimeout(()=>{ensureCartActions();syncCartActions();syncCustomerControls();},0);
  }
  function clearCurrentCart(){
    if(typeof window.clearUserWorkOrderSelection==="function")window.clearUserWorkOrderSelection();
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
    closeManager();syncCartActions();syncCustomerControls();
    setMainStatus("Đang sửa đơn "+orderRef(order)+(status==="delivered"?" · Đã giao":"")+".");
  }
  function cancelEditOrder(){
    if(!editingOrderId)return;
    const label=orderRef(orders.find(row=>String(row.id)===String(editingOrderId))||{id:editingOrderId});
    editingOrderId="";editingOrderStatus="";clearCurrentCart();
    if(currentRole()==="admin")clearSelectedCustomer();
    syncCartActions();syncCustomerControls();setMainStatus("Đã hủy sửa đơn "+label+".");
  }
  async function updateEditingOrder(){
    if(busy||!editingOrderId)return;
    if(!(await requireChatAuth()))return;
    const items=selectedOrderPayload();if(!items){setMainStatus("Đơn phải có ít nhất một sản phẩm.");return;}
    const id=editingOrderId,previousStatus=editingOrderStatus||"pending";
    busy=true;setMainStatus("Đang cập nhật đơn...");
    try{
      const data=await orderFetch("/orders/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({items})});
      editingOrderId="";editingOrderStatus="";clearCurrentCart();
      if(currentRole()==="admin")clearSelectedCustomer();
      const label=data?.order?.orderNo?"#"+data.order.orderNo:String(id);
      setMainStatus("Đã cập nhật đơn "+label+".");
      expandedOrderId=String(id);activeView="orders";activeStatus=String(data?.order?.status||previousStatus);debtLinkedOrder=null;
      openManager();
    }catch(error){handleAuthError(error);setMainStatus(String(error?.message||error));}
    finally{busy=false;syncCartActions();syncCustomerControls();}
  }

  async function submitQuickSale(){
    if(busy||currentRole()!=="admin")return;
    if(!(await requireChatAuth()))return;
    const items=selectedOrderPayload();
    if(!items){setMainStatus("Chưa chọn sản phẩm.");return;}
    if(!selectedCustomerId){setMainStatus("Chưa chọn khách hàng.");await openCustomerPicker();return;}
    const customerId=selectedCustomerId;
    busy=true;setMainStatus("Đang bán nhanh...");
    try{
      const data=await orderFetch("/orders",{method:"POST",body:JSON.stringify({items,customerId,mode:"quick"})});
      clearCurrentCart();
      const label=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");
      clearSelectedCustomer();
      setMainStatus("Đã bán nhanh đơn "+label+" · Đã giao.");
      expandedOrderId="";activeView="orders";activeStatus="delivered";
      openManager();
    }catch(error){
      handleAuthError(error);setMainStatus(String(error?.message||error));
    }finally{busy=false;syncCartActions();syncCustomerControls();}
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
    let body;
    if(currentRole()==="admin"){
      if(!selectedCustomerId){
        setMainStatus("Chưa chọn khách hàng.");
        await openCustomerPicker();
        return;
      }
      const customerId=selectedCustomerId;
      body=JSON.stringify({items,customerId});
    }else body=JSON.stringify({items});

    busy=true;setMainStatus("Đang gửi đơn...");
    try{
      const data=await orderFetch("/orders",{method:"POST",body});
      if(typeof window.clearUserWorkOrderSelection==="function"){
        window.clearUserWorkOrderSelection();
      }
      const customerName=currentRole()==="admin"?(selectedCustomer()?.name||""):"";
      const orderLabel=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");
      setMainStatus("Đã gửi đơn "+orderLabel+(customerName?" · "+customerName:"")+" · Đơn tạm.");
      expandedOrderId="";activeView="orders";activeStatus="pending";
      debtCustomerId="";debtDetail=null;
      if(currentRole()==="admin")clearSelectedCustomer();
      openManager();
    }catch(error){
      handleAuthError(error);
      setMainStatus(String(error?.message||error));
    }finally{busy=false;}
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
    if(target.closest?.("[data-order-report-all]")){orderReportFilter={...orderReportFilter,mode:"all"};sourceDrillSource="";renderOrders();return;}
    if(target.closest?.("[data-order-report-today]")){const today=localDateKey(new Date());orderReportFilter={...orderReportFilter,mode:"today",from:today,to:today};sourceDrillSource="";renderOrders();return;}
    const reportQuick=target.closest?.("[data-order-report-quick]");
    if(reportQuick){const range=orderQuickRange(String(reportQuick.dataset.orderReportQuick||""));orderReportFilter={...orderReportFilter,mode:"range",...range};sourceDrillSource="";renderOrders();return;}
    const sourceOpen=target.closest?.("[data-order-source-open]");if(sourceOpen){sourceDrillSource=String(sourceOpen.dataset.orderSourceOpen||"");sourceDrillMode="detail";renderOrders();return;}
    const sourceMode=target.closest?.("[data-order-source-mode]");if(sourceMode){sourceDrillMode=String(sourceMode.dataset.orderSourceMode||"detail")==="combined"?"combined":"detail";renderOrders();return;}
    if(target.closest?.("[data-order-source-close]")){sourceDrillSource="";renderOrders();return;}
    if(target.closest?.("[data-order-source-share]")){await shareOrderSource();return;}
    if(target.closest?.("[data-debt-order-back]")){debtLinkedOrder=null;renderDebtDetail();return;}
    const debtOrder=target.closest?.("[data-debt-order-id]");if(debtOrder){await openDebtLinkedOrder(String(debtOrder.dataset.debtOrderId||""));return;}
    const workView=target.closest?.("[data-order-work-view]");
    if(workView){activeView=String(workView.dataset.orderWorkView||"orders");sourceDrillSource="";debtLinkedOrder=null;if(activeView==="debts"&&currentRole()==="user")debtCustomerId=String(currentAccount()?.id||"");else debtCustomerId="";debtDetail=null;syncManagerView();if(await requireChatAuth())openManager();return;}
    if(target.closest?.("#orderManagerButton")){if(await requireChatAuth())openManager();return;}
    if(target.closest?.("#orderManagerClose")){closeManager();return;}
    if(target.id==="orderManager"){closeManager();return;}
    if(target.closest?.("#orderCustomerPickerClose")){closeCustomerPicker();return;}
    if(target.closest?.("#orderCustomerPickerButton,[data-order-customer-select]")){await openCustomerPicker();return;}
    if(target.closest?.("#debtBackButton")){debtCustomerId="";debtDetail=null;debtLinkedOrder=null;syncManagerView();await refreshDebts();return;}
    const mode=target.closest?.("[data-manager-view]");
    if(mode){activeView=String(mode.dataset.managerView||"orders");sourceDrillSource="";debtLinkedOrder=null;if(activeView==="debts"&&currentRole()==="user")debtCustomerId=String(currentAccount()?.id||"");else if(activeView==="orders")debtCustomerId="";debtDetail=null;syncManagerView();await refreshManager();return;}
    const debtCustomer=target.closest?.("[data-debt-customer-id]");if(debtCustomer){debtLinkedOrder=null;await openDebtCustomer(String(debtCustomer.dataset.debtCustomerId||""));return;}
    const customerOption=target.closest?.("[data-order-customer-id]");if(customerOption){chooseCustomer(String(customerOption.dataset.orderCustomerId||""));return;}
    const tab=target.closest?.("[data-order-status]");if(tab){expandedOrderId="";sourceDrillSource="";activeStatus=String(tab.dataset.orderStatus||"pending");renderOrders();return;}
    const detail=target.closest?.("[data-order-detail]");if(detail){const id=String(detail.dataset.orderId||"");expandedOrderId=expandedOrderId===id?"":id;renderOrders();return;}
    const action=target.closest?.("[data-order-action]");if(action)await performOrderAction(String(action.dataset.orderAction||""),String(action.dataset.orderId||""));
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
      orderReportFilter={...orderReportFilter,search:String(event.target.value||"")};sourceDrillSource="";renderOrders();
      const input=document.querySelector("[data-order-report-search]");input?.focus();input?.setSelectionRange(orderReportFilter.search.length,orderReportFilter.search.length);return;
    }
    const range=event.target?.closest?.("[data-order-report-range]");
    if(range){const side=String(range.dataset.orderReportRange||"from"),value=String(range.value||"");let next={...orderReportFilter,mode:"range",[side]:value};if(next.from&&next.to&&next.from>next.to){if(side==="from")next.to=next.from;else next.from=next.to;}orderReportFilter=next;sourceDrillSource="";renderOrders();}
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
  window.setInterval(()=>{ensureWorkManagerNav();ensureInlineCustomerButtons();ensureCartActions();syncCustomerControls();},1500);
  window.setInterval(()=>{void checkRemoteRevision();},ORDER_SYNC_MS);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void checkRemoteRevision();});
  window.addEventListener("focus",()=>{void checkRemoteRevision();});
})();
