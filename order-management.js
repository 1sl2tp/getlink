(()=>{
  "use strict";

  const SESSION_KEY="getlink:taphoa-order-session";
  const ADMIN_KEY="getlink:update-admin-session";
  const QTY_KEY="getlink:user-work-order-qty";
  const API_KEY=String(window.GETLINK_API_KEY||"");
  const CATALOG_API=String(window.GETLINK_API_BASE||"").replace(/\/$/,"");
  const ORDER_API=CATALOG_API.replace(/\/getlink-api$/,"/getlink-orders");
  const TAPHOA_API=CATALOG_API.replace(/\/getlink-api$/,"/taphoa-api");
  const STATUS_LABELS={pending:"Đơn tạm",done:"Đã giao",returned:"Đã hoàn"};
  let activeStatus="pending";
  let orders=[];
  let busy=false;

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
  function currentRole(){return document.body?.dataset?.appRole==="admin"?"admin":"user"}
  function readCustomerSession(){
    try{
      const value=JSON.parse(localStorage.getItem(SESSION_KEY)||"null");
      if(!value?.token)return null;
      if(value.expiresAt&&Date.parse(value.expiresAt)<=Date.now()){
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return value;
    }catch{return null;}
  }
  function storeCustomerSession(value){
    localStorage.setItem(SESSION_KEY,JSON.stringify(value));
  }
  function adminToken(){return String(sessionStorage.getItem(ADMIN_KEY)||"")}
  function headers(jsonBody=false){
    const h=new Headers();
    if(API_KEY)h.set("apikey",API_KEY);
    if(jsonBody)h.set("content-type","application/json");
    if(currentRole()==="admin"){
      const token=adminToken();
      if(token)h.set("x-getlink-admin",token);
    }else{
      const session=readCustomerSession();
      if(session?.token)h.set("x-taphoa-session",String(session.token));
    }
    return h;
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
  async function taphoaLogin(username,password){
    const res=await fetch(TAPHOA_API,{
      method:"POST",
      headers:new Headers({"content-type":"application/json",...(API_KEY?{apikey:API_KEY}:{})}),
      body:JSON.stringify({action:"login",username,password,remember:true})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(String(data.error||"Đăng nhập chưa đúng."));
    if(data?.user?.loai!=="customer")throw new Error("Tài khoản này không phải tài khoản khách hàng.");
    const session={token:String(data.token||""),expiresAt:String(data.expiresAt||""),user:data.user};
    if(!session.token)throw new Error("Chưa tạo được phiên đăng nhập.");
    storeCustomerSession(session);
    return session;
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
            <strong>Đăng nhập để gửi và xem đơn</strong>
            <small>Dùng tài khoản khách hàng của Tạp hóa.</small>
            <input id="orderLoginUsername" autocomplete="username" placeholder="Tài khoản">
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
              <button id="orderCustomerLogout" type="button" hidden>Đăng xuất</button>
            </div>
            <div id="orderManagerList" class="order-manager-list"></div>
            <div id="orderManagerEmpty" class="order-manager-empty" hidden>Chưa có đơn ở trạng thái này.</div>
          </div>
        </section>
      </div>`);
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
    refreshManager();
  }
  function closeManager(){
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
    if(currentRole()==="admin"){
      if(node)node.textContent="Admin · tất cả khách hàng";
      if(logout)logout.hidden=true;
      return;
    }
    const session=readCustomerSession();
    if(node)node.textContent=session?.user?.ten?String(session.user.ten):"Khách hàng";
    if(logout)logout.hidden=!session;
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
    if(currentRole()!=="admin"&&!readCustomerSession()){
      setLoginVisible(true);
      return;
    }
    if(currentRole()==="admin"&&!adminToken()){
      setLoginVisible(false);
      const list=document.getElementById("orderManagerList");
      if(list)list.innerHTML='<div class="order-manager-message">Hãy mở chế độ Admin trước.</div>';
      return;
    }
    setLoginVisible(false);
    const list=document.getElementById("orderManagerList");
    if(list)list.innerHTML='<div class="order-manager-message">Đang tải đơn...</div>';
    try{
      await loadOrders();renderOrders();
    }catch(error){
      if(error?.status===401&&currentRole()!=="admin"){
        localStorage.removeItem(SESSION_KEY);setLoginVisible(true,"Phiên đăng nhập đã hết hạn.");
      }else if(list)list.innerHTML='<div class="order-manager-message">'+escapeHtml(error?.message||error)+'</div>';
    }
  }

  async function ensureCustomerLogin(){
    if(readCustomerSession())return true;
    openManager();setLoginVisible(true,"Đăng nhập trước khi gửi đơn.");
    return false;
  }
  async function submitSelectedOrder(){
    if(busy)return;
    if(currentRole()==="admin"){
      setMainStatus("Chế độ Admin không gửi đơn khách hàng.");
      return;
    }
    if(!(await ensureCustomerLogin()))return;
    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
    if(!Array.isArray(selected)||selected.length===0){setMainStatus("Chưa chọn sản phẩm.");return;}
    const items=selected.map(item=>({url:item.row.canonical_url,qty:item.qty}));
    busy=true;setMainStatus("Đang gửi đơn...");
    try{
      const data=await orderFetch("/orders",{method:"POST",body:JSON.stringify({items})});
      localStorage.removeItem(QTY_KEY);
      if(typeof window.renderUserWorkHome==="function")window.renderUserWorkHome();
      if(typeof window.updateUserWorkOrderSummary==="function")window.updateUserWorkOrderSummary();
      setMainStatus("Đã gửi đơn "+String(data?.order?.id||"")+" · đang chờ giao.");
      activeStatus="pending";
      if(!document.getElementById("orderManager")?.hidden)await refreshManager();
    }catch(error){
      if(error?.status===401){
        localStorage.removeItem(SESSION_KEY);openManager();setLoginVisible(true,"Phiên đăng nhập đã hết hạn. Đăng nhập lại để gửi đơn.");
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
    const tab=target.closest?.("[data-order-status]");
    if(tab){activeStatus=String(tab.dataset.orderStatus||"pending");renderOrders();return;}
    if(target.closest?.("#orderCustomerLogout")){
      localStorage.removeItem(SESSION_KEY);orders=[];await refreshManager();return;
    }
    if(target.closest?.("#orderLoginSubmit")){
      const username=String(document.getElementById("orderLoginUsername")?.value||"").trim();
      const password=String(document.getElementById("orderLoginPassword")?.value||"");
      const status=document.getElementById("orderLoginStatus");
      if(!username||!password){if(status)status.textContent="Nhập tài khoản và mật khẩu.";return;}
      if(status)status.textContent="Đang đăng nhập...";
      try{
        await taphoaLogin(username,password);
        if(status)status.textContent="";
        setLoginVisible(false);updateIdentity();
        await loadOrders();renderOrders();
      }catch(error){if(status)status.textContent=String(error?.message||error);}
      return;
    }
    const action=target.closest?.("[data-order-action]");
    if(action){await performAdminAction(String(action.dataset.orderAction||""),String(action.dataset.orderId||""));}
  });

  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!document.getElementById("orderManager")?.hidden)closeManager();
    if(event.key==="Enter"&&event.target?.id==="orderLoginPassword")document.getElementById("orderLoginSubmit")?.click();
  });

  injectUi();
})();
