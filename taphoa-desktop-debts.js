(()=>{
  "use strict";

  let slots=null;
  let active=false;
  let bound=false;
  const state={
    summaries:[],
    customerId:"",
    detail:null,
    selectedTxnId:"",
    busy:false,
    statusText:"",
  };

  function esc(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]))}
  function attr(value){return esc(value).replace(/`/g,"&#96;")}
  function money(value){
    const n=Number(value||0);if(!Number.isFinite(n))return "—";
    const compact=Math.round(n/500)*.5;
    return new Intl.NumberFormat("vi-VN",{minimumFractionDigits:0,maximumFractionDigits:1}).format(compact);
  }
  function dateTime(value){
    const d=new Date(value||0);if(!Number.isFinite(d.getTime()))return "";
    return new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d);
  }
  function auth(){return window.TaphoaDesktopData?.readAuth?.()||null}
  function isAdmin(){return auth()?.account?.role==="admin"}
  function eventLabel(type){return ({order_debt:"Đã giao",payment:"Thanh toán",order_return_reversal:"Hoàn đơn",manual_adjustment:"Điều chỉnh"})[type]||String(type||"Giao dịch")}
  function timeline(){return Array.isArray(state.detail?.timeline)?[...state.detail.timeline].reverse():[]}

  function renderCustomers(){
    if(!slots?.left)return;
    const rows=state.summaries;
    const total=rows.reduce((sum,row)=>sum+Number(row?.balanceVnd||0),0);
    slots.left.innerHTML='<div class="taphoa-column-head"><strong>Khách hàng</strong><small>'+rows.length+' khách · '+esc(money(total))+'</small></div>'+
      '<div class="taphoa-left-list">'+(rows.length?rows.map(row=>'<button type="button" class="taphoa-left-item taphoa-debt-customer '+(String(row.customerId)===state.customerId?'active':'')+'" data-debt-customer="'+attr(row.customerId)+'"><span><strong>'+esc(row.customerName||row.username||"Khách hàng")+'</strong><small>'+(row.lastOccurredAt?esc(dateTime(row.lastOccurredAt)):'Chưa giao dịch')+'</small></span><b>'+esc(money(row.balanceVnd))+'</b></button>').join(''):'<div class="taphoa-empty">Chưa có khách hàng.</div>')+'</div>';
  }

  function renderTimeline(){
    if(!slots?.master)return;
    const customer=state.detail?.customer||{};
    const rows=timeline();
    if(state.selectedTxnId&&!rows.some(row=>String(row.id)===state.selectedTxnId))state.selectedTxnId="";
    if(!state.selectedTxnId&&rows.length)state.selectedTxnId=String(rows[0].id||"");
    slots.master.innerHTML='<section class="taphoa-master-frame taphoa-debt-master">'+
      '<header class="taphoa-master-head"><div><strong>'+esc(customer.name||customer.username||"Công nợ")+'</strong><small>Dư nợ hiện tại</small></div><b>'+esc(money(state.detail?.balanceVnd))+'</b></header>'+
      '<div class="taphoa-debt-timeline">'+(rows.length?rows.map(row=>'<button type="button" class="taphoa-debt-txn '+(String(row.id)===state.selectedTxnId?'selected':'')+'" data-debt-txn="'+attr(row.id)+'" aria-pressed="'+(String(row.id)===state.selectedTxnId?'true':'false')+'"><span><strong>'+esc(eventLabel(row.eventType))+'</strong><small>'+esc(dateTime(row.occurredAt))+(row.orderNo?' · Đơn #'+esc(row.orderNo):'')+'</small></span><span class="taphoa-debt-amount '+(row.direction==='decrease'?'decrease':'increase')+'">'+(row.direction==='decrease'?'−':'+')+esc(money(row.amountVnd))+'</span><small class="taphoa-debt-after">Dư nợ sau giao dịch <b>'+esc(money(row.balanceAfterVnd))+'</b></small></button>').join(''):'<div class="taphoa-empty">Chưa có giao dịch công nợ.</div>')+'</div>'+
    '</section>';
    renderDetail(state.selectedTxnId);
  }

  function paymentMarkup(){
    if(!isAdmin()||!state.customerId)return "";
    return '<form class="taphoa-debt-payment" data-debt-payment><input name="amountVnd" inputmode="numeric" autocomplete="off" placeholder="Số tiền khách trả" required><input name="note" autocomplete="off" maxlength="160" placeholder="Ghi chú"><button type="submit">Ghi nhận thanh toán</button></form>';
  }

  function renderDetail(txnId){
    if(!slots?.detail)return;
    const customer=state.detail?.customer||{};
    const row=timeline().find(item=>String(item.id)===String(txnId));
    slots.detail.innerHTML='<section class="taphoa-detail-frame taphoa-debt-detail">'+
      '<header class="taphoa-detail-head"><div><span class="taphoa-detail-kicker">CÔNG NỢ</span><strong>'+esc(customer.name||customer.username||"Khách hàng")+'</strong><small>'+esc(customer.username?"@"+customer.username:"")+'</small></div><b>'+esc(money(state.detail?.balanceVnd))+'</b></header>'+
      '<div class="taphoa-detail-scroll">'+(row?'<article class="taphoa-debt-detail-card"><small>'+esc(dateTime(row.occurredAt))+'</small><h3>'+esc(eventLabel(row.eventType))+'</h3><div class="taphoa-debt-detail-amount '+(row.direction==='decrease'?'decrease':'increase')+'">'+(row.direction==='decrease'?'−':'+')+esc(money(row.amountVnd))+'</div>'+(row.orderNo?'<p>Đơn #'+esc(row.orderNo)+'</p>':'')+(row.note?'<p>'+esc(row.note)+'</p>':'')+'<div class="taphoa-debt-balance-after"><span>Dư nợ sau giao dịch</span><strong>'+esc(money(row.balanceAfterVnd))+'</strong></div></article>':'<div class="taphoa-empty">Chọn một giao dịch để xem chi tiết.</div>')+paymentMarkup()+'</div>'+
      '<div class="taphoa-action-status" aria-live="polite">'+esc(state.statusText)+'</div></section>';
  }

  function selectTxn(id){
    const next=String(id||"");if(!next||next===state.selectedTxnId)return;
    const previous=slots?.master?.querySelector?.('.taphoa-debt-txn.selected');
    if(previous){previous.classList.remove("selected");previous.setAttribute("aria-pressed","false");}
    state.selectedTxnId=next;
    const current=slots?.master?.querySelector?.('[data-debt-txn="'+CSS.escape(next)+'"]');
    if(current){current.classList.add("selected");current.setAttribute("aria-pressed","true");}
    renderDetail(next);
  }

  async function loadDetail(customerId){
    const id=String(customerId||"");if(!id)return;
    state.customerId=id;state.selectedTxnId="";state.statusText="Đang tải công nợ...";
    try{
      const data=await window.TaphoaDesktopData.orderRequest("/debts/"+encodeURIComponent(id),{method:"GET"});
      state.detail=data;state.statusText="";
      if(active){renderCustomers();renderTimeline();}
    }catch(error){state.detail=null;state.statusText=String(error?.message||error);if(active){renderCustomers();renderTimeline();renderDetail("");}}
  }

  async function refresh(){
    if(state.busy)return;
    state.busy=true;state.statusText="Đang tải công nợ...";
    try{
      const account=auth()?.account||{};
      const data=await window.TaphoaDesktopData.orderRequest("/debts",{method:"GET"});
      state.summaries=Array.isArray(data?.debts)?data.debts:[];
      if(!isAdmin())state.customerId=String(account.id||state.summaries[0]?.customerId||"");
      else if(state.customerId&&!state.summaries.some(row=>String(row.customerId)===state.customerId))state.customerId="";
      if(!state.customerId&&state.summaries.length)state.customerId=String(state.summaries[0].customerId||"");
      state.statusText="";
      if(active)renderCustomers();
      if(state.customerId)await loadDetail(state.customerId);else if(active){state.detail=null;renderTimeline();renderDetail("");}
    }catch(error){state.statusText=String(error?.message||error);if(active){renderCustomers();renderTimeline();renderDetail("");}}
    finally{state.busy=false;}
  }

  async function recordPayment(form){
    if(state.busy||!isAdmin()||!state.customerId)return;
    const amountVnd=Number(String(form.elements.amountVnd?.value||"").replace(/\D/g,""));
    const note=String(form.elements.note?.value||"").trim();
    if(!Number.isFinite(amountVnd)||amountVnd<=0){state.statusText="Nhập số tiền khách trả.";renderDetail(state.selectedTxnId);return;}
    state.busy=true;state.statusText="Đang ghi nhận thanh toán...";renderDetail(state.selectedTxnId);
    try{
      await window.TaphoaDesktopData.orderRequest("/debts/"+encodeURIComponent(state.customerId)+"/payments",{method:"POST",body:JSON.stringify({amountVnd:Math.round(amountVnd),note})});
      state.statusText="Đã ghi nhận thanh toán.";await refresh();
    }catch(error){state.statusText=String(error?.message||error);renderDetail(state.selectedTxnId);}
    finally{state.busy=false;}
  }

  function bindEvents(){
    if(bound||!slots)return;bound=true;
    slots.left.addEventListener("click",event=>{
      const button=event.target.closest?.("[data-debt-customer]");if(!button)return;
      void loadDetail(String(button.dataset.debtCustomer||""));
    });
    slots.master.addEventListener("click",event=>{
      const button=event.target.closest?.("[data-debt-txn]");if(button)selectTxn(String(button.dataset.debtTxn||""));
    });
    slots.detail.addEventListener("submit",event=>{
      const form=event.target.closest?.("[data-debt-payment]");if(!form)return;
      event.preventDefault();void recordPayment(form);
    });
    document.addEventListener("taphoa-desktop-debts-changed",()=>{if(active)void refresh();});
    document.addEventListener("taphoa-desktop-orders-changed",()=>{if(active)void refresh();});
  }

  function mount(nextSlots){slots=nextSlots||window.TaphoaDesktopWorkspace?.slots?.();if(!slots)return false;bindEvents();return true;}
  async function activate(){if(!mount())return false;active=true;await refresh();return true;}
  function deactivate(){active=false;}

  window.TaphoaDesktopDebts={mount,activate,deactivate,refresh,renderCustomers,renderTimeline,renderDetail,get state(){return state;}};
})();
