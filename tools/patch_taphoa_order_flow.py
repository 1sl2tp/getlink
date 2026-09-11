from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "order-management.js"
CSS = ROOT / "order-management.css"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, got {count}")
    return text.replace(old, new, 1)


js = JS.read_text(encoding="utf-8")

js = replace_once(
    js,
    '  const SELECTED_CUSTOMER_KEY="getlink:order-selected-customer";\n  const QTY_KEY="getlink:user-work-order-qty";',
    '  const SELECTED_CUSTOMER_KEY="getlink:order-selected-customer";\n  const ORDER_REPORT_STATE_KEY="getlink:taphoa-order-report-state";\n  const QTY_KEY="getlink:user-work-order-qty";',
    "state key",
)

js = replace_once(
    js,
    '  let activeStatus="pending";\n  let expandedOrderId="";\n  let editingOrderId="";\n  let editingOrderStatus="";\n  let orderReportFilter={mode:"all",from:localDateKey(new Date()),to:localDateKey(new Date()),search:""};',
    '  let activeStatus="pending";\n  let expandedOrderId="";\n  let editingOrderId="";\n  let editingOrderStatus="";\n  let orderReportFilters=loadOrderReportFilters();\n  let orderReportFilter=orderReportFilters[activeStatus];',
    "filter state init",
)

old_dates = '''  function localDateKey(value){
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
  }'''

new_dates = '''  function localDateKey(value){
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
        from:/^\\d{4}-\\d{2}-\\d{2}$/.test(String(raw.from||""))?String(raw.from):base.from,
        to:/^\\d{4}-\\d{2}-\\d{2}$/.test(String(raw.to||""))?String(raw.to):base.to,
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
  }'''
js = replace_once(js, old_dates, new_dates, "date filter block")

js = replace_once(
    js,
    '''  function orderRecency(order){
    if(order.status==="returned")return Date.parse(order.returnedAt||order.deliveredAt||order.orderedAt||0)||0;
    if(order.status==="delivered")return Date.parse(order.deliveredAt||order.orderedAt||0)||0;
    return Date.parse(order.submittedAt||order.orderedAt||0)||0;
  }''',
    '''  function orderRecencyValue(order){
    if(order.status==="returned")return order.returnedAt||order.deliveredAt||order.orderedAt||0;
    if(order.status==="delivered")return order.deliveredAt||order.orderedAt||0;
    return order.submittedAt||order.orderedAt||0;
  }
  function orderRecency(order){return Date.parse(orderRecencyValue(order)||0)||0;}''',
    "recency value",
)

old_controls = '''  function orderReportControlsMarkup(){
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
  }'''
new_controls = '''  function orderReportControlsMarkup(){
    const f=orderReportFilter;
    const option=(value,label)=>`<option value="${value}" ${f.mode===value?"selected":""}>${label}</option>`;
    return `<section class="order-report-controls">
      <div class="order-report-search"><input type="search" data-order-report-search value="${escapeHtml(f.search)}" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Tìm khách, mã đơn, sản phẩm"></div>
      <div class="order-report-time">
        <label class="order-report-preset"><span>Thời gian</span><select data-order-report-preset aria-label="Chọn thời gian">${option("all","Tất cả")}${option("today","Hôm nay")}${option("yesterday","Hôm qua")}${option("week","Tuần này")}${option("month","Tháng này")}${option("year","Năm nay")}${option("custom","Tùy chọn")}</select></label>
        ${f.mode==="custom"?`<div class="order-report-custom"><label>Từ <input type="date" data-order-report-range="from" value="${escapeHtml(f.from)}"></label><span>→</span><label>Đến <input type="date" data-order-report-range="to" value="${escapeHtml(f.to)}"></label></div>`:""}
      </div>
    </section>`;
  }'''
js = replace_once(js, old_controls, new_controls, "report controls")

old_card = '''      const expanded=expandedOrderId===String(order.id);
      const secondary=currentRole()==="admin"?String(order.customerName||"Khách hàng")+" · "+dateTime(order.orderedAt):dateTime(order.orderedAt);
      return `<article class="order-card ${expanded?"expanded":""}" data-order-id="${escapeHtml(order.id)}">
        <div class="order-card-head"><div><strong>${escapeHtml(orderRef(order))}</strong><small>${escapeHtml(secondary)} · ${items.length+" dòng"}</small></div><b>${escapeHtml(compactMoney(order.total))}</b></div>
        <button type="button" class="order-card-detail-toggle" data-order-detail data-order-id="${escapeHtml(id)}">${expanded?"Thu gọn":"Xem đơn"}</button>'''
new_card = '''      const expanded=expandedOrderId===String(order.id);
      const preview=items.slice(0,3).map(item=>`${String(item.name||"Sản phẩm")} ×${Number(item.qty||0)}`).join(" · ")+(items.length>3?` · +${items.length-3}`:"");
      return `<article class="order-card ${expanded?"expanded":""}" data-order-id="${escapeHtml(order.id)}">
        <div class="order-card-head"><div><strong class="order-card-customer">${escapeHtml(order.customerName||"Khách hàng")}</strong><small class="order-card-meta">${escapeHtml(dateTime(orderRecencyValue(order)))} · ${items.length+" dòng"} · ${escapeHtml(orderRef(order))}</small></div><b>${escapeHtml(compactMoney(order.total))}</b></div>
        ${preview?`<div class="order-card-preview">${escapeHtml(preview)}</div>`:""}
        <button type="button" class="order-card-detail-toggle" data-order-detail data-order-id="${escapeHtml(id)}">${expanded?"Thu gọn":"Xem đơn"}</button>'''
js = replace_once(js, old_card, new_card, "customer-first card")

for old, new, label in (
    ('expandedOrderId=String(id);activeView="orders";activeStatus=String(data?.order?.status||previousStatus);debtLinkedOrder=null;', 'expandedOrderId=String(id);activeView="orders";setActiveOrderStatus(String(data?.order?.status||previousStatus));debtLinkedOrder=null;', "edit status"),
    ('expandedOrderId="";activeView="orders";activeStatus="delivered";', 'expandedOrderId="";activeView="orders";setActiveOrderStatus("delivered");', "quick status"),
    ('expandedOrderId="";activeView="orders";activeStatus="pending";', 'expandedOrderId="";activeView="orders";setActiveOrderStatus("pending");', "submit status"),
):
    js = replace_once(js, old, new, label)

js = replace_once(
    js,
    '''    if(target.closest?.("[data-order-report-all]")){orderReportFilter={...orderReportFilter,mode:"all"};sourceDrillSource="";renderOrders();return;}
    if(target.closest?.("[data-order-report-today]")){const today=localDateKey(new Date());orderReportFilter={...orderReportFilter,mode:"today",from:today,to:today};sourceDrillSource="";renderOrders();return;}
    const reportQuick=target.closest?.("[data-order-report-quick]");
    if(reportQuick){const range=orderQuickRange(String(reportQuick.dataset.orderReportQuick||""));orderReportFilter={...orderReportFilter,mode:"range",...range};sourceDrillSource="";renderOrders();return;}
''',
    '',
    "remove old time clicks",
)

js = replace_once(
    js,
    '    const tab=target.closest?.("[data-order-status]");if(tab){expandedOrderId="";sourceDrillSource="";activeStatus=String(tab.dataset.orderStatus||"pending");renderOrders();return;}',
    '    const tab=target.closest?.("[data-order-status]");if(tab){expandedOrderId="";sourceDrillSource="";setActiveOrderStatus(String(tab.dataset.orderStatus||"pending"));renderOrders();return;}',
    "status switch",
)

old_input = '''    if(event.target?.matches?.("[data-order-report-search]")){
      orderReportFilter={...orderReportFilter,search:String(event.target.value||"")};sourceDrillSource="";renderOrders();
      const input=document.querySelector("[data-order-report-search]");input?.focus();input?.setSelectionRange(orderReportFilter.search.length,orderReportFilter.search.length);return;
    }
    const range=event.target?.closest?.("[data-order-report-range]");
    if(range){const side=String(range.dataset.orderReportRange||"from"),value=String(range.value||"");let next={...orderReportFilter,mode:"range",[side]:value};if(next.from&&next.to&&next.from>next.to){if(side==="from")next.to=next.from;else next.from=next.to;}orderReportFilter=next;sourceDrillSource="";renderOrders();}
  });
  document.addEventListener("keydown",event=>{'''
new_input = '''    if(event.target?.matches?.("[data-order-report-search]")){
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
  document.addEventListener("keydown",event=>{'''
js = replace_once(js, old_input, new_input, "input and preset events")

JS.write_text(js, encoding="utf-8")

css = CSS.read_text(encoding="utf-8")
marker = "/* TAPHOA_ORDER_FLOW_POLISH_20260911 */"
if marker not in css:
    css += '''\n\n/* TAPHOA_ORDER_FLOW_POLISH_20260911 */
/* Order scanning follows the actual task: customer → amount → time/items → reference. */
.order-card-customer{font-size:15px;font-weight:750;letter-spacing:-.01em;color:#202936}
.order-card-meta{margin-top:3px;color:#697482;font-size:11.5px;font-variant-numeric:tabular-nums}
.order-card-preview{padding:7px 12px 8px;border-bottom:1px solid #f0f1f3;color:#5f6a77;font-size:11.5px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* One fast time choice; explicit date fields only appear for Tùy chọn. */
.order-report-time{display:grid;grid-template-columns:minmax(180px,280px) minmax(0,1fr);gap:8px;align-items:center}
.order-report-preset{min-height:44px;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;color:#697383;font-size:11px}
.order-report-preset select{width:100%;height:40px;min-width:0;padding:0 32px 0 10px;border:1px solid #d7dde4;border-radius:9px;background:#fff;color:#34404d;font:650 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline:0;cursor:pointer}
.order-report-preset select:focus-visible{border-color:#9dbce0;box-shadow:0 0 0 2px rgba(54,109,174,.08);outline:2px solid transparent}
.order-report-custom{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:7px}
.order-report-custom label{min-height:44px;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:5px;color:#697383;font-size:11px}
.order-report-custom input{width:100%;min-width:0;height:40px;padding:0 7px;border:1px solid #d7dde4;border-radius:8px;background:#fff;color:#34404d;font-size:12px;outline:0}
.order-report-custom input:focus-visible{border-color:#9dbce0;box-shadow:0 0 0 2px rgba(54,109,174,.08);outline:2px solid transparent}
@media(max-width:639px){
  .order-report-time{grid-template-columns:1fr}
  .order-report-preset{grid-template-columns:72px minmax(0,1fr)}
  .order-report-custom{grid-template-columns:1fr auto 1fr}
  .order-report-custom label{grid-template-columns:1fr;gap:3px}
  .order-card-preview{padding:6px 10px 7px;font-size:11px}
}
'''
CSS.write_text(css, encoding="utf-8")

print("TAPHOA order flow patch applied")
