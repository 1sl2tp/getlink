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
  const DEBT_EVENT_LABELS={
    order_debt:"Đã giao",
    payment:"Thanh toán",
    order_return_reversal:"Hoàn đơn",
    manual_adjustment:"Điều chỉnh"
  };

  let activeView="orders";
  let activeStatus="pending";
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
  function syncCustomerControls(){
    ensureInlineCustomerButtons();
    const admin=currentRole()==="admin"&&Boolean(readAuth());
    const customer=selectedCustomer();
    for(const button of document.querySelectorAll("[data-order-customer-select]")){
      button.hidden=!admin;
      button.textContent=customer?"Khách · "+customer.name:"Chọn khách";
      button.title=customer?(customer.name+(customer.username?" · @"+customer.username:"")):"Chọn khách hàng trước khi gửi đơn";
    }
    const picker=document.getElementById("orderCustomerPickerButton");
    if(picker){
      picker.hidden=!(admin&&activeView==="orders");
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
    if(currentRole()!=="admin")return "";
    if(order.status==="pending")return `
      <div class="order-card-actions">
        <button type="button" class="order-action-primary" data-order-action="deliver" data-order-id="${escapeHtml(order.id)}">Đã giao</button>
        <button type="button" class="order-action-danger" data-order-action="delete" data-order-id="${escapeHtml(order.id)}">Xóa đơn tạm</button>
      </div>`;
    if(order.status==="delivered")return `
      <div class="order-card-actions">
        <button type="button" class="order-action-danger" data-order-action="return" data-order-id="${escapeHtml(order.id)}">Đã hoàn</button>
      </div>`;
    return "";
  }
  function orderRef(order){return order.orderNo?"#"+order.orderNo:String(order.id||"")}
  function renderOrders(){
    renderTabs();
    const visible=orders.filter(order=>order.status===activeStatus);
    const list=document.getElementById("orderManagerList");
    const empty=document.getElementById("orderManagerEmpty");
    const summary=document.getElementById("orderManagerSummary");
    if(summary)summary.textContent=(STATUS_LABELS[activeStatus]||activeStatus)+" · "+visible.length+" đơn";
    if(empty){empty.hidden=visible.length!==0;empty.textContent="Chưa có đơn ở trạng thái này.";}
    if(!list)return;
    list.innerHTML=visible.map(order=>{
      const items=Array.isArray(order.items)?order.items:[];
      return `<article class="order-card" data-order-id="${escapeHtml(order.id)}">
        <div class="order-card-head">
          <div><strong>${currentRole()==="admin"?escapeHtml(order.customerName||"Khách hàng"):escapeHtml(STATUS_LABELS[order.status]||order.status)}</strong><small>${escapeHtml(dateTime(order.orderedAt))} · ${escapeHtml(orderRef(order))}</small></div>
          <b>${escapeHtml(moneyVnd(order.total))}</b>
        </div>
        <div class="order-card-items">${items.map(item=>`<div><span>${escapeHtml(item.name)}</span><small>${Number(item.qty||0)} × ${escapeHtml(moneyVnd(item.price))}</small></div>`).join("")}</div>
        ${orderActions(order)}
      </article>`;
    }).join("");
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
  function renderDebtDetail(){
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
      <section class="debt-detail-head">
        <div><strong>${escapeHtml(customer.name||customer.username||"Khách hàng")}</strong><small>${customer.username?"@"+escapeHtml(customer.username):""}</small></div>
        <b>${escapeHtml(moneyVnd(debtDetail.balanceVnd))}</b>
      </section>
      ${paymentForm(customer.id||debtCustomerId)}
      <div class="debt-timeline">${timeline.length?timeline.map(row=>`
        <article class="debt-txn ${row.direction==="decrease"?"decrease":"increase"}">
          <div class="debt-txn-main">
            <span><strong>${escapeHtml(DEBT_EVENT_LABELS[row.eventType]||row.eventType)}</strong><small>${escapeHtml(dateTime(row.occurredAt))}${row.orderNo?" · Đơn #"+escapeHtml(row.orderNo):""}</small></span>
            <b>${debtEventSign(row)}${escapeHtml(moneyVnd(row.amountVnd))}</b>
          </div>
          ${row.note?`<div class="debt-txn-note">${escapeHtml(row.note)}</div>`:""}
          <div class="debt-balance-after">Dư nợ sau giao dịch <strong>${escapeHtml(moneyVnd(row.balanceAfterVnd))}</strong></div>
        </article>`).join(""):'<div class="order-manager-message">Chưa có giao dịch công nợ.</div>'}</div>`;
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
    }catch(error){
      if(!handleAuthError(error)){
        const list=document.getElementById("orderManagerList");
        if(list)list.innerHTML='<div class="order-manager-message">'+escapeHtml(error?.message||error)+'</div>';
      }
    }
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
      activeView="orders";activeStatus="pending";
      debtCustomerId="";debtDetail=null;
      if(currentRole()==="admin")clearSelectedCustomer();
      openManager();
    }catch(error){
      handleAuthError(error);
      setMainStatus(String(error?.message||error));
    }finally{busy=false;}
  }

  async function performAdminAction(action,id){
    if(busy||currentRole()!=="admin")return;
    if(action==="delete"&&!confirm("Xóa đơn tạm này?"))return;
    if(action==="return"&&!confirm("Hoàn đơn này và đảo lại công nợ?"))return;
    busy=true;
    try{
      if(action==="deliver")await orderFetch("/orders/"+encodeURIComponent(id)+"/deliver",{method:"POST"});
      else if(action==="return")await orderFetch("/orders/"+encodeURIComponent(id)+"/return",{method:"POST"});
      else if(action==="delete")await orderFetch("/orders/"+encodeURIComponent(id),{method:"DELETE"});
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
    const workView=target.closest?.("[data-order-work-view]");
    if(workView){
      activeView=String(workView.dataset.orderWorkView||"orders");
      if(activeView==="debts"&&currentRole()==="user")debtCustomerId=String(currentAccount()?.id||"");
      else debtCustomerId="";
      debtDetail=null;
      syncManagerView();
      if(await requireChatAuth())openManager();
      return;
    }
    if(target.closest?.("#orderManagerButton")){if(await requireChatAuth())openManager();return;}
    if(target.closest?.("#orderManagerClose")){closeManager();return;}
    if(target.id==="orderManager"){closeManager();return;}
    if(target.closest?.("#orderCustomerPickerClose")){closeCustomerPicker();return;}
    if(target.closest?.("#orderCustomerPickerButton,[data-order-customer-select]")){await openCustomerPicker();return;}
    if(target.closest?.("#debtBackButton")){
      debtCustomerId="";debtDetail=null;syncManagerView();await refreshDebts();return;
    }
    const mode=target.closest?.("[data-manager-view]");
    if(mode){
      activeView=String(mode.dataset.managerView||"orders");
      if(activeView==="debts"&&currentRole()==="user")debtCustomerId=String(currentAccount()?.id||"");
      else if(activeView==="orders")debtCustomerId="";
      debtDetail=null;syncManagerView();await refreshManager();return;
    }
    const debtCustomer=target.closest?.("[data-debt-customer-id]");
    if(debtCustomer){await openDebtCustomer(String(debtCustomer.dataset.debtCustomerId||""));return;}
    const customerOption=target.closest?.("[data-order-customer-id]");
    if(customerOption){chooseCustomer(String(customerOption.dataset.orderCustomerId||""));return;}
    const tab=target.closest?.("[data-order-status]");
    if(tab){activeStatus=String(tab.dataset.orderStatus||"pending");renderOrders();return;}
    const action=target.closest?.("[data-order-action]");
    if(action)await performAdminAction(String(action.dataset.orderAction||""),String(action.dataset.orderId||""));
  });

  document.addEventListener("submit",async event=>{
    const form=event.target.closest?.("[data-debt-payment-form]");
    if(!form)return;
    event.preventDefault();
    await submitPayment(form);
  });
  document.addEventListener("input",event=>{
    if(event.target?.id==="orderCustomerSearch"&&!pickerBusy)renderCustomerList();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!document.getElementById("orderCustomerPicker")?.hidden){closeCustomerPicker();return;}
    if(event.key==="Escape"&&!document.getElementById("orderManager")?.hidden)closeManager();
  });

  window.GETLINK_ACCESS_CONTEXT={states:ACCESS_STATES,snapshot:accessSnapshot};
  injectUi();
  emitAccessChange();
  requestChatAuth();
  window.setInterval(()=>{ensureWorkManagerNav();ensureInlineCustomerButtons();syncCustomerControls();},1500);
})();
