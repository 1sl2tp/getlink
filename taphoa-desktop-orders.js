(()=>{
  "use strict";

  let slots=null;
  let active=false;
  let bound=false;
  const state={
    status:"pending",
    query:"",
    timePreset:"today",
    source:"",
    orders:[],
    selectedId:"",
    customers:[],
    busy:false,
    statusText:"",
  };

  function esc(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
  function attr(value){return esc(value).replace(/`/g,"&#96;")}
  function money(value){
    const n=Number(value||0);
    if(!Number.isFinite(n))return "—";
    const compact=Math.round(n/500)*.5;
    return new Intl.NumberFormat("vi-VN",{minimumFractionDigits:0,maximumFractionDigits:1}).format(compact);
  }
  function dateTime(value){
    const d=new Date(value||0);if(!Number.isFinite(d.getTime()))return "";
    return new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d);
  }
  function normalize(value){return window.TaphoaDesktopData?.normalize?.(value)||String(value||"").toLowerCase().trim()}
  function auth(){return window.TaphoaDesktopData?.readAuth?.()||null}
  function isAdmin(){return auth()?.account?.role==="admin"}
  function orderCode(order){return "#"+String(order?.orderNo||order?.id||"")}
  function orderItems(order){return Array.isArray(order?.items)?order.items:[]}
  function lineCount(order){return orderItems(order).length}
  function productCount(order){return orderItems(order).reduce((sum,item)=>sum+Number(item?.qty||0),0)}
  function orderSourceKeys(order){return [...new Set(orderItems(order).map(item=>String(item?.sourceId||"").trim()).filter(Boolean))]}
  function sourceLabel(key){
    const map={mine:"Tạp hóa",taphoa:"Tạp hóa",bhx:"BHX",wm:"WinMart",go:"GO!"};
    return map[String(key||"").toLowerCase()]||String(key||"Chưa rõ");
  }
  function statusLabel(status){return ({pending:"Đơn tạm",delivered:"Đã giao",returned:"Đã hoàn"})[status]||status}
  function sameLocalDay(value){
    const d=new Date(value||0);if(!Number.isFinite(d.getTime()))return false;
    const now=new Date();return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();
  }
  function orderMatchesQuery(order){
    const q=normalize(state.query);if(!q)return true;
    const hay=normalize([
      order?.customerName,
      order?.orderNo,
      order?.id,
      ...orderItems(order).map(item=>item?.name),
    ].filter(Boolean).join(" "));
    return q.split(/\s+/).filter(Boolean).every(token=>hay.includes(token));
  }
  function baseFilteredOrders(){
    return state.orders.filter(order=>{
      if(String(order?.status||"")!==state.status)return false;
      if(state.timePreset==="today"&&!sameLocalDay(order?.orderedAt||order?.submittedAt))return false;
      if(!orderMatchesQuery(order))return false;
      return true;
    });
  }
  function visibleOrders(){
    let rows=baseFilteredOrders();
    if(state.source)rows=rows.filter(order=>orderSourceKeys(order).includes(state.source));
    return rows;
  }

  function sourceStats(){
    const map=new Map();
    for(const order of baseFilteredOrders()){
      const keys=orderSourceKeys(order);
      if(!keys.length){
        const item=map.get("__unknown__")||{key:"__unknown__",orders:0,lines:0,products:0};
        item.orders+=1;item.lines+=lineCount(order);item.products+=productCount(order);map.set(item.key,item);continue;
      }
      for(const key of keys){
        const item=map.get(key)||{key,orders:0,lines:0,products:0};
        item.orders+=1;item.lines+=lineCount(order);item.products+=productCount(order);map.set(key,item);
      }
    }
    return [...map.values()].sort((a,b)=>b.orders-a.orders||sourceLabel(a.key).localeCompare(sourceLabel(b.key),"vi"));
  }

  function renderSourceRail(){
    if(!slots?.left)return;
    const rows=baseFilteredOrders(),stats=sourceStats();
    slots.left.innerHTML='<div class="taphoa-column-head"><strong>Theo nguồn</strong><small>'+rows.length+' đơn</small></div>'+
      '<div class="taphoa-left-list">'+
        '<button type="button" class="taphoa-left-item '+(!state.source?'active':'')+'" data-order-source=""><span>Tất cả</span><small>'+rows.length+'</small></button>'+
        stats.map(item=>'<button type="button" class="taphoa-left-item '+(state.source===item.key?'active':'')+'" data-order-source="'+attr(item.key)+'"><span>'+esc(sourceLabel(item.key))+'</span><small>'+item.orders+' đơn · '+item.products+' SP</small></button>').join('')+
      '</div>';
  }

  function orderRowMarkup(order,index){
    const selected=String(order?.id||"")===state.selectedId;
    const sources=orderSourceKeys(order).map(sourceLabel).join(" · ");
    return '<button type="button" class="taphoa-order-row '+(selected?'selected':'')+'" data-order-id="'+attr(order?.id)+'" aria-pressed="'+(selected?'true':'false')+'">'+
      '<span class="taphoa-order-row-main"><strong>'+esc(order?.customerName||"Khách hàng")+'</strong><small>STT '+(index+1)+' · Mã đơn '+esc(orderCode(order))+' · '+esc(dateTime(order?.orderedAt||order?.submittedAt))+'</small></span>'+
      '<span class="taphoa-order-row-meta"><small>'+lineCount(order)+' dòng · '+productCount(order)+' sản phẩm'+(sources?' · '+esc(sources):'')+'</small><b>'+esc(money(order?.total))+'</b></span>'+
    '</button>';
  }

  function renderOrderList(){
    if(!slots?.master)return;
    const rows=visibleOrders();
    if(state.selectedId&&!rows.some(order=>String(order.id)===state.selectedId))state.selectedId="";
    if(!state.selectedId&&rows.length)state.selectedId=String(rows[0].id||"");
    slots.master.innerHTML='<section class="taphoa-master-frame taphoa-orders-master">'+
      '<header class="taphoa-order-toolbar">'+
        '<nav class="taphoa-order-tabs" aria-label="Trạng thái đơn">'+
          ["pending","delivered","returned"].map(status=>'<button type="button" data-order-status="'+status+'" class="'+(state.status===status?'active':'')+'">'+statusLabel(status)+'</button>').join('')+
        '</nav>'+
        '<div class="taphoa-order-filter-row"><input id="taphoaOrderSearch" type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Tìm khách, mã đơn, sản phẩm" value="'+attr(state.query)+'"><select id="taphoaOrderTime" aria-label="Thời gian"><option value="today" '+(state.timePreset==='today'?'selected':'')+'>Hôm nay</option><option value="all" '+(state.timePreset==='all'?'selected':'')+'>Tất cả</option></select></div>'+
        '<div class="taphoa-order-list-summary"><span>'+rows.length+' đơn</span><small>'+rows.reduce((sum,row)=>sum+lineCount(row),0)+' dòng · '+rows.reduce((sum,row)=>sum+productCount(row),0)+' sản phẩm</small></div>'+
      '</header>'+
      '<div class="taphoa-order-list">'+(rows.length?rows.map(orderRowMarkup).join(''):'<div class="taphoa-empty">Chưa có đơn phù hợp.</div>')+'</div>'+
    '</section>';
    renderOrderDetail(state.selectedId);
  }

  function actionMarkup(order){
    if(!order)return "";
    const admin=isAdmin(),status=String(order.status||"");
    if(status==="pending"){
      return '<button type="button" data-order-action="edit">Sửa</button>'+(admin?'<button type="button" data-order-action="deliver" class="primary">Đã giao</button>':'')+'<button type="button" data-order-action="delete" class="danger">Xóa</button>';
    }
    if(status==="delivered"&&admin)return '<button type="button" data-order-action="edit">Sửa</button><button type="button" data-order-action="return" class="danger">Xóa / Hoàn</button>';
    return "";
  }

  function customerSelectMarkup(order){
    if(!isAdmin()||String(order?.status||"")==="returned")return "";
    const options=state.customers.map(customer=>'<option value="'+attr(customer.id)+'" '+(String(customer.id)===String(order?.customerId)?'selected':'')+'>'+esc(customer.name||customer.username||"Khách hàng")+'</option>').join('');
    return '<label class="taphoa-order-customer-change"><small>Khách hàng</small><select data-order-customer-change data-order-id="'+attr(order?.id)+'">'+options+'</select></label>';
  }

  function renderOrderDetail(id){
    if(!slots?.detail)return;
    const order=state.orders.find(row=>String(row.id)===String(id));
    if(!order){slots.detail.innerHTML='<div class="taphoa-empty taphoa-detail-empty">Chọn một đơn để xem chi tiết.</div>';return;}
    const items=orderItems(order);
    slots.detail.innerHTML='<section class="taphoa-detail-frame taphoa-order-detail">'+
      '<header class="taphoa-detail-head"><div><span class="taphoa-detail-kicker">HÓA ĐƠN · '+esc(statusLabel(order.status))+'</span><strong>'+esc(order.customerName||"Khách hàng")+'</strong><small>Mã đơn '+esc(orderCode(order))+' · '+esc(dateTime(order.orderedAt||order.submittedAt))+'</small></div><b>'+esc(money(order.total))+'</b></header>'+
      '<div class="taphoa-detail-customer">'+customerSelectMarkup(order)+'</div>'+
      '<div class="taphoa-detail-scroll"><div class="taphoa-invoice-head"><span>STT</span><span>Sản phẩm</span><span>Số lượng × giá</span><span>Thành tiền</span></div><div class="taphoa-invoice-lines">'+items.map((item,index)=>'<div class="taphoa-invoice-line"><small>'+(index+1)+'</small><span><strong>'+esc(item?.name||"Sản phẩm")+'</strong>'+(item?.note?'<em>'+esc(item.note)+'</em>':'')+'</span><span>'+Number(item?.qty||0)+' × '+esc(money(item?.price))+'</span><b>'+esc(money(Number(item?.qty||0)*Number(item?.price||0)))+'</b></div>').join('')+'</div></div>'+
      '<footer class="taphoa-order-detail-footer"><div><small>'+lineCount(order)+' dòng · '+productCount(order)+' sản phẩm</small><strong>Tổng cộng</strong></div><b>'+esc(money(order.total))+'</b></footer>'+
      '<div class="taphoa-detail-actions">'+actionMarkup(order)+'</div><div class="taphoa-action-status" aria-live="polite">'+esc(state.statusText)+'</div></section>';
  }

  function selectOrder(id){
    const next=String(id||"");if(!next||next===state.selectedId)return;
    const previous=slots?.master?.querySelector?.('.taphoa-order-row.selected');
    if(previous){previous.classList.remove("selected");previous.setAttribute("aria-pressed","false");}
    state.selectedId=next;
    const current=slots?.master?.querySelector?.('[data-order-id="'+CSS.escape(next)+'"]');
    if(current){current.classList.add("selected");current.setAttribute("aria-pressed","true");}
    renderOrderDetail(next);
  }

  async function loadCustomers(){
    if(!isAdmin()){state.customers=[];return;}
    try{
      const data=await window.TaphoaDesktopData.orderRequest("/customers",{method:"GET"});
      state.customers=Array.isArray(data?.customers)?data.customers:[];
    }catch{state.customers=[];}
  }

  async function refresh(){
    if(state.busy)return;
    state.busy=true;state.statusText="Đang tải đơn...";
    try{
      const data=await window.TaphoaDesktopData.orderRequest("/orders",{method:"GET"});
      state.orders=Array.isArray(data?.orders)?data.orders:[];
      await loadCustomers();
      state.statusText="";
      if(active){renderSourceRail();renderOrderList();}
    }catch(error){
      state.statusText=String(error?.message||error);
      if(active){renderSourceRail();renderOrderList();}
    }finally{state.busy=false;}
  }

  async function mutate(action,order){
    if(state.busy||!order)return;
    const id=String(order.id||"");
    if(action==="edit"){
      window.TaphoaDesktopSales?.editOrder?.(order);return;
    }
    if(action==="delete"&&!confirm("Xóa đơn tạm này?"))return;
    if(action==="return"&&!confirm("Hoàn đơn đã giao và đảo lại công nợ?"))return;
    state.busy=true;state.statusText="Đang xử lý...";renderOrderDetail(id);
    try{
      if(action==="deliver")await window.TaphoaDesktopData.orderRequest("/orders/"+encodeURIComponent(id)+"/deliver",{method:"POST"});
      else if(action==="return")await window.TaphoaDesktopData.orderRequest("/orders/"+encodeURIComponent(id)+"/return",{method:"POST"});
      else if(action==="delete")await window.TaphoaDesktopData.orderRequest("/orders/"+encodeURIComponent(id),{method:"DELETE"});
      state.statusText="";await refresh();
    }catch(error){state.statusText=String(error?.message||error);renderOrderDetail(id);}
    finally{state.busy=false;}
  }

  async function changeCustomer(orderId,customerId){
    if(state.busy||!isAdmin()||!orderId||!customerId)return;
    state.busy=true;state.statusText="Đang đổi khách hàng...";renderOrderDetail(orderId);
    try{
      const data=await window.TaphoaDesktopData.orderCustomerRequest({orderId,customerId});
      const order=state.orders.find(row=>String(row.id)===String(orderId));
      if(order&&data?.customer){order.customerId=String(data.customer.id||customerId);order.customerName=String(data.customer.name||order.customerName||"Khách hàng");}
      state.statusText="Đã đổi khách hàng.";renderOrderList();selectOrder(orderId);
      document.dispatchEvent(new CustomEvent("taphoa-desktop-debts-changed"));
    }catch(error){state.statusText=String(error?.message||error);renderOrderDetail(orderId);}
    finally{state.busy=false;}
  }

  function bindEvents(){
    if(bound||!slots)return;bound=true;
    slots.left.addEventListener("click",event=>{
      const button=event.target.closest?.("[data-order-source]");if(!button)return;
      state.source=String(button.dataset.orderSource||"");renderSourceRail();renderOrderList();
    });
    slots.master.addEventListener("click",event=>{
      const status=event.target.closest?.("[data-order-status]");
      if(status){state.status=String(status.dataset.orderStatus||"pending");state.source="";state.selectedId="";renderSourceRail();renderOrderList();return;}
      const row=event.target.closest?.("[data-order-id]");if(row)selectOrder(String(row.dataset.orderId||""));
    });
    slots.master.addEventListener("input",event=>{
      if(event.target.id!=="taphoaOrderSearch")return;
      state.query=String(event.target.value||"");state.source="";state.selectedId="";renderSourceRail();renderOrderList();
    });
    slots.master.addEventListener("change",event=>{
      if(event.target.id!=="taphoaOrderTime")return;
      state.timePreset=String(event.target.value||"today");state.source="";state.selectedId="";renderSourceRail();renderOrderList();
    });
    slots.detail.addEventListener("click",event=>{
      const button=event.target.closest?.("[data-order-action]");if(!button)return;
      const order=state.orders.find(row=>String(row.id)===state.selectedId);void mutate(String(button.dataset.orderAction||""),order);
    });
    slots.detail.addEventListener("change",event=>{
      const select=event.target.closest?.("[data-order-customer-change]");if(!select)return;
      void changeCustomer(String(select.dataset.orderId||""),String(select.value||""));
    });
    document.addEventListener("taphoa-desktop-orders-changed",()=>{if(active)void refresh();});
  }

  function mount(nextSlots){slots=nextSlots||window.TaphoaDesktopWorkspace?.slots?.();if(!slots)return false;bindEvents();return true;}
  async function activate(){if(!mount())return false;active=true;await refresh();return true;}
  function deactivate(){active=false;}

  window.TaphoaDesktopOrders={mount,activate,deactivate,refresh,renderSourceRail,renderOrderList,renderOrderDetail,selectOrder,get state(){return state;}};
})();
