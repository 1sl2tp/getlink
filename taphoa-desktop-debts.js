(()=>{
  "use strict";
  let slots=null,active=false,bound=false;
  const state={summaries:[],customerId:"",detail:null,selectedTxnId:"",linkedOrder:null,busy:false,statusText:""};
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const attr=v=>esc(v).replace(/`/g,"&#96;");
  const css=v=>window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/["\\]/g,"\\$&");
  function money(v){const n=Number(v||0);if(!Number.isFinite(n))return"—";return new Intl.NumberFormat("vi-VN",{maximumFractionDigits:1}).format(Math.round(n/500)*.5)}
  function dateTime(v){const d=new Date(v||0);if(!Number.isFinite(d.getTime()))return"";return new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d)}
  const auth=()=>window.TaphoaDesktopData?.readAuth?.()||null;
  const isAdmin=()=>auth()?.account?.role==="admin";
  const eventLabel=t=>({order_debt:"Đã giao",payment:"Thanh toán",order_return_reversal:"Hoàn đơn",manual_adjustment:"Điều chỉnh"})[t]||String(t||"Giao dịch");
  const orderStatusLabel=s=>({pending:"Đơn tạm",delivered:"Đã giao",returned:"Đã hoàn"})[String(s||"")]||String(s||"");
  const timeline=()=>Array.isArray(state.detail?.timeline)?[...state.detail.timeline].reverse():[];
  const orderItems=o=>Array.isArray(o?.items)?o.items:[];
  const orderProducts=o=>orderItems(o).reduce((sum,item)=>sum+Number(item?.qty||0),0);

  function renderCustomers(){if(!slots?.left)return;const rows=state.summaries,total=rows.reduce((s,r)=>s+Number(r?.balanceVnd||0),0);slots.left.innerHTML='<div class="taphoa-column-head"><strong>Khách hàng</strong><small>'+rows.length+' khách · '+esc(money(total))+'</small></div><div class="taphoa-left-list">'+(rows.length?rows.map(r=>'<button type="button" class="taphoa-left-item taphoa-debt-customer '+(String(r.customerId)===state.customerId?'active':'')+'" data-td-debt-customer="'+attr(r.customerId)+'"><span><strong>'+esc(r.customerName||r.username||"Khách hàng")+'</strong><small>'+(r.lastOccurredAt?esc(dateTime(r.lastOccurredAt)):'Chưa giao dịch')+'</small></span><b>'+esc(money(r.balanceVnd))+'</b></button>').join(''):'<div class="taphoa-empty">Chưa có khách hàng.</div>')+'</div>'}

  function txnMarkup(r){
    const id=String(r?.id||""),selected=id===state.selectedTxnId;
    return '<article class="taphoa-debt-txn '+(selected?'selected':'')+'" data-td-debt-row="'+attr(id)+'">'+
      '<button type="button" class="taphoa-debt-txn-select" data-td-debt-txn="'+attr(id)+'" aria-pressed="'+(selected?'true':'false')+'">'+
        '<span><strong>'+esc(eventLabel(r.eventType))+'</strong><small>'+esc(dateTime(r.occurredAt))+'</small></span>'+
        '<span class="taphoa-debt-amount '+(r.direction==='decrease'?'decrease':'increase')+'">'+(r.direction==='decrease'?'−':'+')+esc(money(r.amountVnd))+'</span>'+
      '</button>'+
      '<div class="taphoa-debt-txn-foot"><small class="taphoa-debt-after">Dư nợ sau giao dịch <b>'+esc(money(r.balanceAfterVnd))+'</b></small>'+
        (r.orderId?'<button type="button" class="taphoa-debt-order-link" data-td-debt-order="'+attr(r.orderId)+'">Đơn #'+esc(r.orderNo||r.orderId)+'</button>':'')+
      '</div></article>';
  }

  function renderTimeline(){if(!slots?.master)return;const customer=state.detail?.customer||{},rows=timeline();if(state.selectedTxnId&&!rows.some(r=>String(r.id)===state.selectedTxnId))state.selectedTxnId="";if(!state.selectedTxnId&&rows.length)state.selectedTxnId=String(rows[0].id||"");slots.master.innerHTML='<section class="taphoa-master-frame taphoa-debt-master"><header class="taphoa-master-head"><div><strong>'+esc(customer.name||customer.username||"Công nợ")+'</strong><small>Dư nợ hiện tại</small></div><b>'+esc(money(state.detail?.balanceVnd))+'</b></header><div class="taphoa-debt-timeline">'+(rows.length?rows.map(txnMarkup).join(''):'<div class="taphoa-empty">Chưa có giao dịch công nợ.</div>')+'</div></section>';renderDetail(state.selectedTxnId)}
  function paymentMarkup(){return isAdmin()&&state.customerId?'<form class="taphoa-debt-payment" data-td-debt-payment><input name="amountVnd" inputmode="numeric" autocomplete="off" placeholder="Số tiền khách trả" required><input name="note" autocomplete="off" maxlength="160" placeholder="Ghi chú"><button type="submit">Ghi nhận thanh toán</button></form>':""}

  function renderLinkedOrder(){
    if(!slots?.detail)return;
    const o=state.linkedOrder;
    if(!o){renderDetail(state.selectedTxnId);return;}
    const rows=orderItems(o),actions=window.TaphoaDesktopOrders?.actionMarkup?.(o)||"";
    slots.detail.innerHTML='<section class="taphoa-detail-frame taphoa-order-detail taphoa-debt-linked-order">'+
      '<header class="taphoa-detail-head"><div><span class="taphoa-detail-kicker">HÓA ĐƠN TỪ CÔNG NỢ · '+esc(orderStatusLabel(o.status))+'</span><strong>'+esc(o.customerName||state.detail?.customer?.name||"Khách hàng")+'</strong><small>Mã đơn #'+esc(o.orderNo||o.id||"")+' · '+esc(dateTime(o.orderedAt||o.submittedAt))+'</small></div><b>'+esc(money(o.total))+'</b></header>'+
      '<div class="taphoa-linked-order-back"><button type="button" data-td-debt-order-back>← Công nợ</button></div>'+
      '<div class="taphoa-detail-scroll"><div class="taphoa-invoice-head"><span>STT</span><span>Sản phẩm</span><span>Số lượng × giá</span><span>Thành tiền</span></div><div class="taphoa-invoice-lines">'+rows.map((item,index)=>'<div class="taphoa-invoice-line"><small>'+(index+1)+'</small><span><strong>'+esc(item?.name||"Sản phẩm")+'</strong>'+(item?.note?'<em>'+esc(item.note)+'</em>':'')+'</span><span>'+Number(item?.qty||0)+' × '+esc(money(item?.price))+'</span><b>'+esc(money(Number(item?.qty||0)*Number(item?.price||0)))+'</b></div>').join('')+'</div></div>'+
      '<footer class="taphoa-order-detail-footer"><div><small>'+rows.length+' dòng · '+orderProducts(o)+' sản phẩm</small><strong>Tổng cộng</strong></div><b>'+esc(money(o.total))+'</b></footer>'+
      '<div class="taphoa-detail-actions">'+actions+'</div><div class="taphoa-action-status">'+esc(state.statusText)+'</div></section>';
  }

  function renderDetail(id){if(!slots?.detail)return;if(state.linkedOrder){renderLinkedOrder();return}const customer=state.detail?.customer||{},r=timeline().find(x=>String(x.id)===String(id));slots.detail.innerHTML='<section class="taphoa-detail-frame taphoa-debt-detail"><header class="taphoa-detail-head"><div><span class="taphoa-detail-kicker">CÔNG NỢ</span><strong>'+esc(customer.name||customer.username||"Khách hàng")+'</strong><small>'+esc(customer.username?'@'+customer.username:'')+'</small></div><b>'+esc(money(state.detail?.balanceVnd))+'</b></header><div class="taphoa-detail-scroll">'+(r?'<article class="taphoa-debt-detail-card"><small>'+esc(dateTime(r.occurredAt))+'</small><h3>'+esc(eventLabel(r.eventType))+'</h3><div class="taphoa-debt-detail-amount '+(r.direction==='decrease'?'decrease':'increase')+'">'+(r.direction==='decrease'?'−':'+')+esc(money(r.amountVnd))+'</div>'+(r.orderNo?'<p>Đơn #'+esc(r.orderNo)+'</p>':'')+(r.note?'<p>'+esc(r.note)+'</p>':'')+'<div class="taphoa-debt-balance-after"><span>Dư nợ sau giao dịch</span><strong>'+esc(money(r.balanceAfterVnd))+'</strong></div></article>':'<div class="taphoa-empty">Chọn một giao dịch để xem chi tiết.</div>')+paymentMarkup()+'</div><div class="taphoa-action-status">'+esc(state.statusText)+'</div></section>'}

  function selectTxn(id){const next=String(id||"");if(!next||next===state.selectedTxnId)return;state.linkedOrder=null;const old=slots?.master?.querySelector?.(".taphoa-debt-txn.selected");if(old){old.classList.remove("selected");old.querySelector?.("[data-td-debt-txn]")?.setAttribute("aria-pressed","false")}state.selectedTxnId=next;const now=slots?.master?.querySelector?.('[data-td-debt-row="'+css(next)+'"]');if(now){now.classList.add("selected");now.querySelector?.("[data-td-debt-txn]")?.setAttribute("aria-pressed","true")}renderDetail(next)}

  async function loadLinkedOrder(orderId){
    const id=String(orderId||"");if(!id)return;
    state.statusText="Đang tải hóa đơn...";state.linkedOrder=null;renderDetail(state.selectedTxnId);
    try{
      const data=await window.TaphoaDesktopData.orderRequest("/orders/"+encodeURIComponent(id),{method:"GET"});
      state.linkedOrder=data?.order||null;
      state.statusText=state.linkedOrder?"":"Không tìm thấy hóa đơn.";
    }catch(e){state.linkedOrder=null;state.statusText=String(e?.message||e)}
    if(active)renderDetail(state.selectedTxnId);
  }

  async function loadDetail(id){id=String(id||"");if(!id)return;state.customerId=id;state.selectedTxnId="";state.linkedOrder=null;state.statusText="Đang tải công nợ...";try{state.detail=await window.TaphoaDesktopData.orderRequest("/debts/"+encodeURIComponent(id),{method:"GET"});state.statusText=""}catch(e){state.detail=null;state.statusText=String(e?.message||e)}if(active){renderCustomers();renderTimeline();if(!state.detail)renderDetail("")}}
  async function refresh(){if(state.busy)return;state.busy=true;state.linkedOrder=null;state.statusText="Đang tải công nợ...";try{const a=auth()?.account||{},d=await window.TaphoaDesktopData.orderRequest("/debts",{method:"GET"});state.summaries=Array.isArray(d?.debts)?d.debts:[];if(!isAdmin())state.customerId=String(a.id||state.summaries[0]?.customerId||"");else if(state.customerId&&!state.summaries.some(r=>String(r.customerId)===state.customerId))state.customerId="";if(!state.customerId&&state.summaries.length)state.customerId=String(state.summaries[0].customerId||"");state.statusText="";if(active)renderCustomers();if(state.customerId)await loadDetail(state.customerId);else if(active){state.detail=null;renderTimeline();renderDetail("")}}catch(e){state.statusText=String(e?.message||e);if(active){renderCustomers();renderTimeline();renderDetail("")}}finally{state.busy=false}}
  async function payment(form){if(state.busy||!isAdmin()||!state.customerId)return;const amount=Number(String(form.elements.amountVnd?.value||"").replace(/\D/g,"")),note=String(form.elements.note?.value||"").trim();if(!amount){state.statusText="Nhập số tiền khách trả.";renderDetail(state.selectedTxnId);return}state.busy=true;state.statusText="Đang ghi nhận thanh toán...";renderDetail(state.selectedTxnId);try{await window.TaphoaDesktopData.orderRequest("/debts/"+encodeURIComponent(state.customerId)+"/payments",{method:"POST",body:JSON.stringify({amountVnd:Math.round(amount),note})});state.busy=false;state.statusText="Đã ghi nhận thanh toán.";await refresh();return}catch(e){state.statusText=String(e?.message||e);renderDetail(state.selectedTxnId)}finally{state.busy=false}}

  function bind(){
    if(bound||!slots)return;bound=true;
    slots.left.addEventListener("click",e=>{const b=e.target.closest?.("[data-td-debt-customer]");if(b)void loadDetail(String(b.dataset.tdDebtCustomer||""))});
    slots.master.addEventListener("click",e=>{const order=e.target.closest?.("[data-td-debt-order]");if(order){void loadLinkedOrder(String(order.dataset.tdDebtOrder||""));return}const b=e.target.closest?.("[data-td-debt-txn]");if(b)selectTxn(String(b.dataset.tdDebtTxn||""))});
    slots.detail.addEventListener("click",e=>{
      if(e.target.closest?.("[data-td-debt-order-back]")){state.linkedOrder=null;state.statusText="";renderDetail(state.selectedTxnId);return}
      const action=e.target.closest?.("[data-td-order-action]");
      if(action&&state.linkedOrder){void window.TaphoaDesktopOrders?.performAction?.(String(action.dataset.tdOrderAction||""),state.linkedOrder);return}
    });
    slots.detail.addEventListener("submit",e=>{const f=e.target.closest?.("[data-td-debt-payment]");if(f){e.preventDefault();void payment(f)}});
    document.addEventListener("taphoa-desktop-debts-changed",()=>{if(active)void refresh()});
    document.addEventListener("taphoa-desktop-orders-changed",()=>{if(active)void refresh()});
  }
  function mount(s){slots=s||window.TaphoaDesktopWorkspace?.slots?.();if(!slots)return false;bind();return true}
  async function activate(){if(!mount())return false;active=true;renderCustomers();renderTimeline();await refresh();return true}
  function deactivate(){active=false}
  window.TaphoaDesktopDebts={mount,activate,deactivate,refresh,renderCustomers,renderTimeline,renderDetail,renderLinkedOrder,loadLinkedOrder,get state(){return state}};
})();
