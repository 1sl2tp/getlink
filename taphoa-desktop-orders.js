(()=>{
  "use strict";
  let slots=null,active=false,bound=false;
  let sourceNames=new Map();
  const state={status:"pending",query:"",timePreset:"today",from:"",to:"",source:"",orders:[],selectedId:"",customers:[],busy:false,statusText:""};
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const attr=v=>esc(v).replace(/`/g,"&#96;");
  const css=v=>window.CSS?.escape?CSS.escape(String(v)):String(v).replace(/["\\]/g,"\\$&");
  function money(v){const n=Number(v||0);if(!Number.isFinite(n))return"—";return new Intl.NumberFormat("vi-VN",{maximumFractionDigits:1}).format(Math.round(n/500)*.5)}
  function dateTime(v){const d=new Date(v||0);if(!Number.isFinite(d.getTime()))return"";return new Intl.DateTimeFormat("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(d)}
  const normalize=v=>window.TaphoaDesktopData?.normalize?.(v)||String(v||"").toLowerCase().trim();
  const auth=()=>window.TaphoaDesktopData?.readAuth?.()||null;
  const isAdmin=()=>auth()?.account?.role==="admin";
  const items=o=>Array.isArray(o?.items)?o.items:[];
  const lines=o=>items(o).length;
  const products=o=>items(o).reduce((s,i)=>s+Number(i?.qty||0),0);
  const sources=o=>[...new Set(items(o).map(i=>String(i?.sourceId||"").trim()).filter(Boolean))];
  function refreshSourceNames(){sourceNames=new Map((window.TaphoaDesktopData?.supplierSources?.()||[]).map(row=>[String(row.key||""),String(row.name||row.key||"")]))}
  function sourceLabel(k){const key=String(k||"").trim();if(key==="__unknown__")return"Chưa rõ";return sourceNames.get(key)||({mine:"Tạp hóa",taphoa:"Tạp hóa",bhx:"BHX",wm:"WinMart",go:"GO!"})[key.toLowerCase()]||key||"Chưa rõ"}
  const statusLabel=s=>({pending:"Đơn tạm",delivered:"Đã giao",returned:"Đã hoàn"})[s]||s;
  const pad=n=>String(n).padStart(2,"0");
  function localDateKey(value){const d=value instanceof Date?new Date(value):new Date(value||0);if(!Number.isFinite(d.getTime()))return"";return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
  function presetRange(mode){
    const now=new Date();now.setHours(0,0,0,0);
    const end=localDateKey(now);
    if(mode==="all")return{from:"",to:""};
    if(mode==="today")return{from:end,to:end};
    if(mode==="yesterday"){const d=new Date(now);d.setDate(d.getDate()-1);const key=localDateKey(d);return{from:key,to:key}}
    if(mode==="week"){const d=new Date(now);d.setDate(d.getDate()-((d.getDay()+6)%7));return{from:localDateKey(d),to:end}}
    if(mode==="month"){const d=new Date(now.getFullYear(),now.getMonth(),1);return{from:localDateKey(d),to:end}}
    if(mode==="year"){const d=new Date(now.getFullYear(),0,1);return{from:localDateKey(d),to:end}}
    return{from:state.from,to:state.to};
  }
  function orderMatchesTime(o){
    if(state.timePreset==="all")return true;
    const key=localDateKey(o?.orderedAt||o?.submittedAt);
    if(!key)return false;
    const range=state.timePreset==="custom"?{from:state.from,to:state.to}:presetRange(state.timePreset);
    return(!range.from||key>=range.from)&&(!range.to||key<=range.to);
  }
  function queryMatch(o){const q=normalize(state.query);if(!q)return true;const hay=normalize([o?.customerName,o?.orderNo,o?.id,...items(o).map(i=>i?.name)].filter(Boolean).join(" "));return q.split(/\s+/).filter(Boolean).every(t=>hay.includes(t))}
  function baseRows(){return state.orders.filter(o=>String(o?.status||"")===state.status&&orderMatchesTime(o)&&queryMatch(o))}
  function visibleRows(){const rows=baseRows();return state.source?rows.filter(o=>sources(o).includes(state.source)):rows}
  function stats(){const map=new Map();for(const o of baseRows()){const keys=sources(o);for(const k of(keys.length?keys:["__unknown__"])){const x=map.get(k)||{key:k,orders:0,products:0};x.orders+=1;x.products+=products(o);map.set(k,x)}}return[...map.values()].sort((a,b)=>b.orders-a.orders||sourceLabel(a.key).localeCompare(sourceLabel(b.key),"vi"))}
  function renderSourceRail(){if(!slots?.left)return;if(!sourceNames.size)refreshSourceNames();const rows=baseRows();slots.left.innerHTML='<div class="taphoa-column-head"><strong>Theo nguồn</strong><small>'+rows.length+' đơn</small></div><div class="taphoa-left-list"><button type="button" class="taphoa-left-item '+(!state.source?'active':'')+'" data-td-order-source=""><span>Tất cả</span><small>'+rows.length+'</small></button>'+stats().map(x=>'<button type="button" class="taphoa-left-item '+(state.source===x.key?'active':'')+'" data-td-order-source="'+attr(x.key)+'"><span>'+esc(sourceLabel(x.key))+'</span><small>'+x.orders+' đơn · '+x.products+' SP</small></button>').join('')+'</div>'}
  function rowMarkup(o,index){const selected=String(o?.id||"")===state.selectedId,src=sources(o).map(sourceLabel).join(" · ");return '<button type="button" class="taphoa-order-row '+(selected?'selected':'')+'" data-td-order-id="'+attr(o?.id)+'" aria-pressed="'+(selected?'true':'false')+'"><span class="taphoa-order-row-main"><strong>'+esc(o?.customerName||"Khách hàng")+'</strong><small>STT '+(index+1)+' · Mã đơn #'+esc(o?.orderNo||o?.id||"")+' · '+esc(dateTime(o?.orderedAt||o?.submittedAt))+'</small></span><span class="taphoa-order-row-meta"><small>'+lines(o)+' dòng · '+products(o)+' sản phẩm'+(src?' · '+esc(src):'')+'</small><b>'+esc(money(o?.total))+'</b></span></button>'}
  function normalizeSelection(rows){if(state.selectedId&&!rows.some(o=>String(o.id)===state.selectedId))state.selectedId="";if(!state.selectedId&&rows.length)state.selectedId=String(rows[0].id||"")}
  function batchMarkup(rows){
    if(state.status==="returned")return"";
    if(state.status==="pending"){
      const count=state.orders.filter(o=>String(o?.status||"")==="pending").length;
      return count?'<button type="button" class="taphoa-order-batch" data-td-order-batch="pending">Xóa tất cả</button>':"";
    }
    if(state.status==="delivered"&&isAdmin()&&rows.length)return '<button type="button" class="taphoa-order-batch" data-td-order-batch="delivered">Xóa tất cả đã giao</button>';
    return"";
  }
  function updateSummary(rows){const box=slots?.master?.querySelector?.(".taphoa-order-list-summary");if(box)box.innerHTML='<span>'+rows.length+' đơn</span><span class="taphoa-order-list-summary-actions"><small>'+rows.reduce((s,o)=>s+lines(o),0)+' dòng · '+rows.reduce((s,o)=>s+products(o),0)+' sản phẩm</small>'+batchMarkup(rows)+'</span>'}
  function renderOrderRows(){if(!slots?.master)return;const rows=visibleRows();normalizeSelection(rows);const list=slots.master.querySelector(".taphoa-order-list");if(!list){renderOrderList();return}list.innerHTML=rows.length?rows.map(rowMarkup).join(''):'<div class="taphoa-empty">Chưa có đơn phù hợp.</div>';updateSummary(rows);renderOrderDetail(state.selectedId)}
  function timeOptions(){return[['today','Hôm nay'],['yesterday','Hôm qua'],['week','Tuần này'],['month','Tháng này'],['year','Năm nay'],['custom','Tùy chọn'],['all','Tất cả']].map(([value,label])=>'<option value="'+value+'" '+(state.timePreset===value?'selected':'')+'>'+label+'</option>').join('')}
  function renderOrderList(){if(!slots?.master)return;const rows=visibleRows();normalizeSelection(rows);slots.master.innerHTML='<section class="taphoa-master-frame taphoa-orders-master"><header class="taphoa-order-toolbar"><nav class="taphoa-order-tabs">'+["pending","delivered","returned"].map(s=>'<button type="button" data-td-order-status="'+s+'" class="'+(state.status===s?'active':'')+'">'+statusLabel(s)+'</button>').join('')+'</nav><div class="taphoa-order-filter-row"><input id="taphoaOrderSearch" type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Tìm khách, mã đơn, sản phẩm" value="'+attr(state.query)+'"><select id="taphoaOrderTime">'+timeOptions()+'</select></div><div class="taphoa-order-custom-range" '+(state.timePreset==='custom'?'':'hidden')+'><label><small>Từ ngày</small><input id="taphoaOrderFrom" type="date" value="'+attr(state.from)+'"></label><label><small>Đến ngày</small><input id="taphoaOrderTo" type="date" value="'+attr(state.to)+'"></label></div><div class="taphoa-order-list-summary"></div></header><div class="taphoa-order-list">'+(rows.length?rows.map(rowMarkup).join(''):'<div class="taphoa-empty">Chưa có đơn phù hợp.</div>')+'</div></section>';updateSummary(rows);renderOrderDetail(state.selectedId)}
  function actionMarkup(o){if(!o)return"";const s=String(o.status||"");if(s==="pending")return '<button type="button" data-td-order-action="edit">Sửa</button>'+(isAdmin()?'<button type="button" data-td-order-action="deliver" class="primary">Đã giao</button>':'')+'<button type="button" data-td-order-action="delete" class="danger">Xóa</button>';if(s==="delivered"&&isAdmin())return '<button type="button" data-td-order-action="edit">Sửa</button><button type="button" data-td-order-action="return" class="danger">Xóa / Hoàn</button>';return""}
  function customerMarkup(o){if(!isAdmin()||String(o?.status||"")==="returned")return"";return '<label class="taphoa-order-customer-change"><small>Khách hàng</small><select data-td-order-customer data-td-order-id="'+attr(o?.id)+'">'+state.customers.map(c=>'<option value="'+attr(c.id)+'" '+(String(c.id)===String(o?.customerId)?'selected':'')+'>'+esc(c.name||c.username||"Khách hàng")+'</option>').join('')+'</select></label>'}
  function renderOrderDetail(id){if(!slots?.detail)return;const o=state.orders.find(x=>String(x.id)===String(id));if(!o){slots.detail.innerHTML='<div class="taphoa-empty taphoa-detail-empty">Chọn một đơn để xem chi tiết.</div>';return}slots.detail.innerHTML='<section class="taphoa-detail-frame taphoa-order-detail"><header class="taphoa-detail-head"><div><span class="taphoa-detail-kicker">HÓA ĐƠN · '+esc(statusLabel(o.status))+'</span><strong>'+esc(o.customerName||"Khách hàng")+'</strong><small>Mã đơn #'+esc(o.orderNo||o.id||"")+' · '+esc(dateTime(o.orderedAt||o.submittedAt))+'</small></div><b>'+esc(money(o.total))+'</b></header><div class="taphoa-detail-customer">'+customerMarkup(o)+'</div><div class="taphoa-detail-scroll"><div class="taphoa-invoice-head"><span>STT</span><span>Sản phẩm</span><span>Số lượng × giá</span><span>Thành tiền</span></div><div class="taphoa-invoice-lines">'+items(o).map((i,x)=>'<div class="taphoa-invoice-line"><small>'+(x+1)+'</small><span><strong>'+esc(i?.name||"Sản phẩm")+'</strong>'+(i?.note?'<em>'+esc(i.note)+'</em>':'')+'</span><span>'+Number(i?.qty||0)+' × '+esc(money(i?.price))+'</span><b>'+esc(money(Number(i?.qty||0)*Number(i?.price||0)))+'</b></div>').join('')+'</div></div><footer class="taphoa-order-detail-footer"><div><small>'+lines(o)+' dòng · '+products(o)+' sản phẩm</small><strong>Tổng cộng</strong></div><b>'+esc(money(o.total))+'</b></footer><div class="taphoa-detail-actions">'+actionMarkup(o)+'</div><div class="taphoa-action-status">'+esc(state.statusText)+'</div></section>'}
  function selectOrder(id){const next=String(id||"");if(!next||next===state.selectedId)return;const old=slots?.master?.querySelector?.(".taphoa-order-row.selected");if(old){old.classList.remove("selected");old.setAttribute("aria-pressed","false")}state.selectedId=next;const now=slots?.master?.querySelector?.('[data-td-order-id="'+css(next)+'"]');if(now){now.classList.add("selected");now.setAttribute("aria-pressed","true")}renderOrderDetail(next)}
  async function loadCustomers(){if(!isAdmin()){state.customers=[];return}try{const d=await window.TaphoaDesktopData.orderRequest("/customers",{method:"GET"});state.customers=Array.isArray(d?.customers)?d.customers:[]}catch{state.customers=[]}}
  async function refresh(){if(state.busy)return;state.busy=true;state.statusText="Đang tải đơn...";try{const d=await window.TaphoaDesktopData.orderRequest("/orders",{method:"GET"});state.orders=Array.isArray(d?.orders)?d.orders:[];refreshSourceNames();await loadCustomers();state.statusText="";if(active){renderSourceRail();renderOrderList()}}catch(e){state.statusText=String(e?.message||e);if(active){renderSourceRail();renderOrderList()}}finally{state.busy=false}}
  async function mutate(action,o){if(state.busy||!o)return;if(action==="edit"){window.TaphoaDesktopSales?.editOrder?.(o);return}if(action==="delete"&&!confirm("Xóa đơn tạm này?"))return;if(action==="return"&&!confirm("Hoàn đơn đã giao và đảo lại công nợ?"))return;const id=String(o.id||"");state.busy=true;state.statusText="Đang xử lý...";renderOrderDetail(id);try{if(action==="deliver")await window.TaphoaDesktopData.orderRequest("/orders/"+encodeURIComponent(id)+"/deliver",{method:"POST"});else if(action==="return")await window.TaphoaDesktopData.orderRequest("/orders/"+encodeURIComponent(id)+"/return",{method:"POST"});else if(action==="delete")await window.TaphoaDesktopData.orderRequest("/orders/"+encodeURIComponent(id),{method:"DELETE"});state.busy=false;state.statusText="";document.dispatchEvent(new CustomEvent("taphoa-desktop-debts-changed"));await refresh();return}catch(e){state.statusText=String(e?.message||e);renderOrderDetail(id)}finally{state.busy=false}}
  async function changeCustomer(orderId,customerId){if(state.busy||!isAdmin()||!orderId||!customerId)return;state.busy=true;state.statusText="Đang đổi khách hàng...";renderOrderDetail(orderId);try{const d=await window.TaphoaDesktopData.orderCustomerRequest({orderId,customerId}),o=state.orders.find(x=>String(x.id)===String(orderId));if(o&&d?.customer){o.customerId=String(d.customer.id||customerId);o.customerName=String(d.customer.name||o.customerName||"Khách hàng")}state.statusText="Đã đổi khách hàng.";renderOrderRows();document.dispatchEvent(new CustomEvent("taphoa-desktop-debts-changed"))}catch(e){state.statusText=String(e?.message||e);renderOrderDetail(orderId)}finally{state.busy=false}}
  async function batchCurrentOrders(kind){
    if(state.busy||state.status==="returned")return;
    if(kind==="pending"&&state.status==="pending"){
      const count=state.orders.filter(o=>String(o?.status||"")==="pending").length;
      if(!count||!confirm("Xóa tất cả "+count+" đơn tạm?"))return;
      state.busy=true;state.statusText="Đang xóa tất cả đơn tạm...";renderOrderDetail(state.selectedId);
      try{
        await window.TaphoaDesktopData.orderRequest("/orders/pending",{method:"DELETE"});
        state.busy=false;state.statusText="";state.selectedId="";state.source="";await refresh();return;
      }catch(e){state.statusText=String(e?.message||e);renderOrderDetail(state.selectedId)}finally{state.busy=false}
      return;
    }
    if(kind==="delivered"&&state.status==="delivered"&&isAdmin()){
      const ids=visibleRows().filter(o=>String(o?.status||"")==="delivered").map(o=>String(o.id||"")).filter(Boolean);
      if(!ids.length||!confirm("Hoàn "+ids.length+" đơn đã giao trong phạm vi đang xem và đảo lại công nợ?"))return;
      state.busy=true;state.statusText="Đang hoàn các đơn đã giao...";renderOrderDetail(state.selectedId);
      try{
        await window.TaphoaDesktopData.orderRequest("/orders/return-batch",{method:"POST",body:JSON.stringify({ids})});
        state.busy=false;state.statusText="";state.selectedId="";document.dispatchEvent(new CustomEvent("taphoa-desktop-debts-changed"));await refresh();return;
      }catch(e){state.statusText=String(e?.message||e);renderOrderDetail(state.selectedId)}finally{state.busy=false}
    }
  }
  function bind(){if(bound||!slots)return;bound=true;slots.left.addEventListener("click",e=>{const b=e.target.closest?.("[data-td-order-source]");if(!b)return;state.source=String(b.dataset.tdOrderSource||"");renderSourceRail();renderOrderRows()});slots.master.addEventListener("click",e=>{const batch=e.target.closest?.("[data-td-order-batch]");if(batch){void batchCurrentOrders(String(batch.dataset.tdOrderBatch||""));return}const tab=e.target.closest?.("[data-td-order-status]");if(tab){state.status=String(tab.dataset.tdOrderStatus||"pending");state.source="";state.selectedId="";slots.master.querySelectorAll("[data-td-order-status]").forEach(b=>b.classList.toggle("active",b===tab));renderSourceRail();renderOrderRows();return}const row=e.target.closest?.("[data-td-order-id]");if(row)selectOrder(String(row.dataset.tdOrderId||""))});slots.master.addEventListener("input",e=>{if(e.target.id!=="taphoaOrderSearch")return;state.query=String(e.target.value||"");state.source="";state.selectedId="";renderSourceRail();renderOrderRows()});slots.master.addEventListener("change",e=>{if(e.target.id==="taphoaOrderTime"){state.timePreset=String(e.target.value||"today");state.source="";state.selectedId="";const custom=slots.master.querySelector(".taphoa-order-custom-range");if(custom)custom.hidden=state.timePreset!=="custom";renderSourceRail();renderOrderRows();return}if(e.target.id==="taphoaOrderFrom"){state.from=String(e.target.value||"");if(state.from&&state.to&&state.from>state.to){state.to=state.from;const to=slots.master.querySelector("#taphoaOrderTo");if(to)to.value=state.to}state.source="";state.selectedId="";renderSourceRail();renderOrderRows();return}if(e.target.id==="taphoaOrderTo"){state.to=String(e.target.value||"");if(state.from&&state.to&&state.from>state.to){state.from=state.to;const from=slots.master.querySelector("#taphoaOrderFrom");if(from)from.value=state.from}state.source="";state.selectedId="";renderSourceRail();renderOrderRows()}});slots.detail.addEventListener("click",e=>{const b=e.target.closest?.("[data-td-order-action]");if(!b)return;const o=state.orders.find(x=>String(x.id)===state.selectedId);void mutate(String(b.dataset.tdOrderAction||""),o)});slots.detail.addEventListener("change",e=>{const s=e.target.closest?.("[data-td-order-customer]");if(s)void changeCustomer(String(s.dataset.tdOrderId||""),String(s.value||""))});document.addEventListener("taphoa-desktop-orders-changed",()=>{if(active)void refresh()})}
  function mount(s){slots=s||window.TaphoaDesktopWorkspace?.slots?.();if(!slots)return false;bind();return true}
  async function activate(){if(!mount())return false;active=true;refreshSourceNames();renderSourceRail();renderOrderList();await refresh();return true}
  function deactivate(){active=false}
  window.TaphoaDesktopOrders={mount,activate,deactivate,refresh,renderSourceRail,renderOrderList,renderOrderRows,renderOrderDetail,selectOrder,batchCurrentOrders,actionMarkup,performAction:mutate,get state(){return state}};
})();
