(()=>{
  "use strict";

  const AUTH_KEY="getlink:chat-order-auth";
  const SELECTED_CUSTOMER_KEY="getlink:order-selected-customer";
  const QTY_KEY="getlink:user-work-order-qty";
  const CHAT_ORIGIN="https://chat.taphoa.xyz";
  const API_KEY=String(window.GETLINK_API_KEY||"");
  const CATALOG_API=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");
  const ORDER_API=CATALOG_API.replace(/\/getlink-api$/,"/getlink-orders");
  const SUPABASE_ORIGIN=(()=>{try{return new URL(CATALOG_API).origin}catch{return ""}})();
  const STATUS_LABELS={pending:"Đơn tạm",done:"Đã giao",returned:"Đã hoàn"};
  let activeStatus="pending";
  let orders=[];
  let customers=[];
  let selectedCustomerId=String(sessionStorage.getItem(SELECTED_CUSTOMER_KEY)||"");
  let busy=false;
  let pickerBusy=false;
  let bridgeSeq=0;

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function moneyFromCore(value){
    const n=Number(value||0)*1000;
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
  function normalizeUsername(value){
    return String(value||"").trim().replace(/^@/,"").replace(/@taphoa\.chat$/i,"").toLowerCase();
  }

  function readAuth(){
    try{
      const value=JSON.parse(sessionStorage.getItem(AUTH_KEY)||"null");
      if(!value?.accessToken||!value?.account?.id)return null;
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
    clearSelectedCustomer();
    syncCustomerControls();
  }
  function currentAccount(){return readAuth()?.account||null}
  function currentRole(){return currentAccount()?.role==="admin"?"admin":"user"}
  function selectedCustomer(){return customers.find(row=>String(row.id)===String(selectedCustomerId))||null}

  function authHeaders(token,jsonBody=false){
    const h=new Headers();
    if(API_KEY)h.set("apikey",API_KEY);
    if(jsonBody)h.set("content-type","application/json");
    if(token)h.set("authorization","Bearer "+token);
    return h;
  }
  function headers(jsonBody=false){
    return authHeaders(String(readAuth()?.accessToken||""),jsonBody);
  }
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

  async function chatLogin(username,password){
    const user=normalizeUsername(username);
    if(!user||!password)throw new Error("Nhập tài khoản và mật khẩu.");
    const res=await fetch(SUPABASE_ORIGIN+"/auth/v1/token?grant_type=password",{
      method:"POST",
      headers:new Headers({"content-type":"application/json",...(API_KEY?{apikey:API_KEY}:{})}),
      body:JSON.stringify({email:user+"@taphoa.chat",password:String(password)})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data?.access_token)throw new Error("Tài khoản hoặc mật khẩu chưa đúng.");
    const me=await orderFetchWithToken("/me",String(data.access_token));
    const expiresIn=Math.max(30,Number(data.expires_in||3600));
    const auth={
      accessToken:String(data.access_token),
      expiresAt:new Date(Date.now()+expiresIn*1000).toISOString(),
      account:me.account,
      source:"direct"
    };
    storeAuth(auth);
    return auth;
  }

  async function acceptChatBridge(message){
    const seq=++bridgeSeq;
    if(!message?.accessToken){
      clearAuth();
      if(!document.getElementById("orderManager")?.hidden)await refreshManager();
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
      if(seq===bridgeSeq)clearAuth();
      return false;
    }
  }

  window.addEventListener("message",event=>{
    if(event.origin!==CHAT_ORIGIN)return;
    const message=event.data;
    if(!message||message.type!=="taphoa-chat-auth")return;
    void acceptChatBridge(message);
  });

  function requestChatAuth(){
    if(window.parent===window)return false;
    try{
      window.parent.postMessage({type:"taphoa-getlink-auth-request"},CHAT_ORIGIN);
      return true;
    }catch{return false;}
  }

  function injectUi(){
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
            <div><h2 id="orderManagerTitle">Quản lý đơn</h2><small id="orderManagerIdentity"></small></div>
            <button id="orderManagerClose" type="button" aria-label="Đóng">×</button>
          </header>
          <div id="orderManagerLogin" class="order-manager-login" hidden>
            <strong>Đăng nhập bằng tài khoản Chat</strong>
            <small>Cùng tài khoản đang dùng ở chat.taphoa.xyz.</small>
            <input id="orderLoginUsername" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Tài khoản">
            <input id="orderLoginPassword" type="password" autocomplete="current-password" placeholder="Mật khẩu">
            <button id="orderLoginSubmit" type="button">Đăng nhập</button>
            <span id="orderLoginStatus"></span>
          </div>
          <div id="orderManagerBody" class="order-manager-body">
            <nav id="orderManagerTabs" class="order-manager-tabs" aria-label="Trạng thái đơn">
              <button type="button" data-order-status="pending" class="active">Đơn tạm <small>0</small></button>
              <button type="button" data-order-status="done">Đã giao <small>0</small></button>
              <button type="button" data-order-status="returned">Đã hoàn <small>0</small></button>
            </nav>
            <div class="order-manager-tools">
              <span id="orderManagerSummary"></span>
              <div class="order-manager-tool-actions">
                <button id="orderCustomerPickerButton" type="button" hidden>Chọn khách hàng</button>
                <button id="orderCustomerLogout" type="button" hidden>Đăng xuất</button>
              </div>
            </div>
            <div id="orderManagerList" class="order-manager-list"></div>
            <div id="orderManagerEmpty" class="order-manager-empty" hidden>Chưa có đơn ở trạng thái này.</div>
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
      picker.hidden=!admin;
      picker.textContent=customer?"Khách · "+customer.name:"Chọn khách hàng";
    }
  }

  function setMainStatus(message){
    for(const id of ["userWorkOrderStatus","mobileUserOrderStatus"]){
      const node=document.getElementById(id);
      if(node)node.textContent=message;
    }
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
  function setLoginVisible(show,message=""){
    const login=document.getElementById("orderManagerLogin");
    const body=document.getElementById("orderManagerBody");
    if(login)login.hidden=!show;
    if(body)body.hidden=show;
    const status=document.getElementById("orderLoginStatus");
    if(status)status.textContent=message;
  }
  function updateIdentity(){
    const node=document.getElementById("orderManagerIdentity");
    const logout=document.getElementById("orderCustomerLogout");
    const auth=readAuth();
    if(!auth){if(node)node.textContent="Chưa đăng nhập";if(logout)logout.hidden=true;return;}
    if(node)node.textContent=currentRole()==="admin"
      ?"Admin · tất cả khách hàng"
      :(String(auth.account?.name||auth.account?.username||"Khách hàng"));
    if(logout)logout.hidden=auth.source==="chat";
    syncCustomerControls();
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
    const rows=customers.filter(row=>{
      if(!query)return true;
      return normalizedSearch((row.name||"")+" "+(row.username||"")).includes(query);
    });
    list.innerHTML=rows.length?rows.map(row=>`
      <button type="button" class="order-customer-option ${String(row.id)===String(selectedCustomerId)?"selected":""}" data-order-customer-id="${escapeHtml(row.id)}">
        <span>${escapeHtml(row.name||row.username||"Khách hàng")}</span>
        <small>${row.username?"@"+escapeHtml(row.username):""}</small>
      </button>`).join(""):'<div class="order-customer-empty">Không tìm thấy khách hàng.</div>';
  }
  async function openCustomerPicker(){
    if(currentRole()!=="admin")return false;
    injectUi();
    const host=document.getElementById("orderManager");
    if(host?.hidden){host.hidden=false;host.setAttribute("aria-hidden","false");}
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
        <button type="button" class="order-action-primary" data-order-action="approve" data-order-id="${escapeHtml(order.id)}">Đã giao</button>
        <button type="button" class="order-action-danger" data-order-action="delete" data-order-id="${escapeHtml(order.id)}">Xóa đơn tạm</button>
      </div>`;
    if(order.status==="done")return `
      <div class="order-card-actions">
        <button type="button" class="order-action-danger" data-order-action="return" data-order-id="${escapeHtml(order.id)}">Đã hoàn</button>
      </div>`;
    return "";
  }
  function renderOrders(){
    renderTabs();
    const visible=orders.filter(order=>order.status===activeStatus);
    const list=document.getElementById("orderManagerList");
    const empty=document.getElementById("orderManagerEmpty");
    const summary=document.getElementById("orderManagerSummary");
    if(summary)summary.textContent=(STATUS_LABELS[activeStatus]||activeStatus)+" · "+visible.length+" đơn";
    if(empty)empty.hidden=visible.length!==0;
    if(!list)return;
    list.innerHTML=visible.map(order=>{
      const items=Array.isArray(order.items)?order.items:[];
      return `<article class="order-card" data-order-id="${escapeHtml(order.id)}">
        <div class="order-card-head">
          <div><strong>${currentRole()==="admin"?escapeHtml(order.customerName||"Khách hàng"):escapeHtml(STATUS_LABELS[order.status]||order.status)}</strong><small>${escapeHtml(dateTime(order.orderedAt))} · ${escapeHtml(order.id)}</small></div>
          <b>${escapeHtml(moneyFromCore(order.total))}</b>
        </div>
        <div class="order-card-items">${items.map(item=>`<div><span>${escapeHtml(item.name)}</span><small>${Number(item.qty||0)} × ${escapeHtml(moneyFromCore(item.price))}</small></div>`).join("")}</div>
        ${orderActions(order)}
      </article>`;
    }).join("");
  }
  async function refreshManager(){
    injectUi();
    updateIdentity();
    if(!readAuth()){
      setLoginVisible(true,"Đăng nhập tài khoản Chat để tiếp tục.");
      requestChatAuth();
      return;
    }
    setLoginVisible(false);
    if(currentRole()==="admin")void loadCustomers().catch(()=>{});
    const list=document.getElementById("orderManagerList");
    if(list)list.innerHTML='<div class="order-manager-message">Đang tải đơn...</div>';
    try{
      await loadOrders();renderOrders();
    }catch(error){
      if(error?.status===401){
        clearAuth();setLoginVisible(true,"Phiên đăng nhập đã hết hạn.");requestChatAuth();
      }else if(list)list.innerHTML='<div class="order-manager-message">'+escapeHtml(error?.message||error)+'</div>';
    }
  }

  async function ensureLogin(){
    if(readAuth())return true;
    requestChatAuth();
    await new Promise(resolve=>setTimeout(resolve,80));
    if(readAuth())return true;
    openManager();setLoginVisible(true,"Đăng nhập tài khoản Chat trước khi gửi đơn.");
    return false;
  }
  async function submitSelectedOrder(){
    if(busy)return;
    if(!(await ensureLogin()))return;
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
    }else{
      body=JSON.stringify({items});
    }
    busy=true;setMainStatus("Đang gửi đơn...");
    try{
      const data=await orderFetch("/orders",{method:"POST",body});
      localStorage.removeItem(QTY_KEY);
      if(typeof window.renderUserWorkHome==="function")window.renderUserWorkHome();
      if(typeof window.updateUserWorkOrderSummary==="function")window.updateUserWorkOrderSummary();
      const customerName=currentRole()==="admin"?(selectedCustomer()?.name||""):"";
      setMainStatus("Đã gửi đơn "+String(data?.order?.id||"")+(customerName?" · "+customerName:"")+" · Đơn tạm.");
      activeStatus="pending";
      if(currentRole()==="admin")clearSelectedCustomer();
      if(!document.getElementById("orderManager")?.hidden)await refreshManager();
    }catch(error){
      if(error?.status===401){
        clearAuth();openManager();setLoginVisible(true,"Phiên đăng nhập đã hết hạn. Đăng nhập lại để gửi đơn.");
      }
      setMainStatus(String(error?.message||error));
    }finally{busy=false;}
  }

  async function performAdminAction(action,id){
    if(busy||currentRole()!=="admin")return;
    if(action==="delete"&&!confirm("Xóa đơn tạm này?"))return;
    if(action==="return"&&!confirm("Hoàn đơn này và đảo lại công nợ?"))return;
    busy=true;
    try{
      if(action==="approve")await orderFetch("/orders/"+encodeURIComponent(id)+"/approve",{method:"POST"});
      else if(action==="return")await orderFetch("/orders/"+encodeURIComponent(id)+"/return",{method:"POST"});
      else if(action==="delete")await orderFetch("/orders/"+encodeURIComponent(id),{method:"DELETE"});
      await refreshManager();
    }catch(error){
      alert(String(error?.message||error));
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
    if(target.closest?.("#orderManagerButton")){openManager();return;}
    if(target.closest?.("#orderManagerClose")){closeManager();return;}
    if(target.id==="orderManager"){closeManager();return;}
    if(target.closest?.("#orderCustomerPickerClose")){closeCustomerPicker();return;}
    if(target.closest?.("#orderCustomerPickerButton,[data-order-customer-select]")){await openCustomerPicker();return;}
    const customerOption=target.closest?.("[data-order-customer-id]");
    if(customerOption){chooseCustomer(String(customerOption.dataset.orderCustomerId||""));return;}
    const tab=target.closest?.("[data-order-status]");
    if(tab){activeStatus=String(tab.dataset.orderStatus||"pending");renderOrders();return;}
    if(target.closest?.("#orderCustomerLogout")){
      clearAuth();await refreshManager();return;
    }
    if(target.closest?.("#orderLoginSubmit")){
      const username=String(document.getElementById("orderLoginUsername")?.value||"").trim();
      const password=String(document.getElementById("orderLoginPassword")?.value||"");
      const status=document.getElementById("orderLoginStatus");
      if(!username||!password){if(status)status.textContent="Nhập tài khoản và mật khẩu.";return;}
      if(status)status.textContent="Đang đăng nhập...";
      try{
        await chatLogin(username,password);
        if(status)status.textContent="";
        setLoginVisible(false);updateIdentity();
        if(currentRole()==="admin")await loadCustomers(true);
        await loadOrders();renderOrders();
      }catch(error){if(status)status.textContent=String(error?.message||error);}
      return;
    }
    const action=target.closest?.("[data-order-action]");
    if(action){await performAdminAction(String(action.dataset.orderAction||""),String(action.dataset.orderId||""));}
  });

  document.addEventListener("input",event=>{
    if(event.target?.id==="orderCustomerSearch"&&!pickerBusy)renderCustomerList();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!document.getElementById("orderCustomerPicker")?.hidden){closeCustomerPicker();return;}
    if(event.key==="Escape"&&!document.getElementById("orderManager")?.hidden)closeManager();
    if(event.key==="Enter"&&event.target?.id==="orderLoginPassword")document.getElementById("orderLoginSubmit")?.click();
  });

  injectUi();
  requestChatAuth();
  window.setInterval(()=>{ensureInlineCustomerButtons();syncCustomerControls();},1500);
})();
