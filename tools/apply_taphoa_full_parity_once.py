from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ORDER=ROOT/'order-management.js'
CSS=ROOT/'order-management.css'
EDGE=ROOT/'supabase/functions/getlink-orders/index.ts'
MARK='TAPHOA_FULL_ORDER_DEBT_PARITY_20260911'


def replace_between(text,start,end,new):
    a=text.find(start)
    if a<0: raise SystemExit(f'missing start anchor: {start}')
    b=text.find(end,a)
    if b<0: raise SystemExit(f'missing end anchor: {end}')
    return text[:a]+new+text[b:]


def patch_edge():
    text=EDGE.read_text('utf-8')
    if MARK in text:
        return

    delivered='''async function updateDeliveredOrder(id:string,body:any,actor:Identity){
  if(actor.kind!=="admin")throw fail("forbidden",403);
  const items=await resolveCreateItems(body?.items);
  const {error}=await db.rpc("getlink_sales_update_delivered_order",{
    p_id:id,p_actor_id:actor.id,p_items:items
  });
  if(error)throw error;
  return await readOrder(id,actor);
}

'''
    at=text.find('async function deliverOrder(')
    if at<0: raise SystemExit('deliverOrder anchor missing')
    text=text[:at]+delivered+text[at:]

    batch='''async function returnDeliveredScope(ids:string[],actor:Identity){
  if(actor.kind!=="admin")throw fail("forbidden",403);
  const unique=Array.from(new Set((ids||[]).map(clean).filter(Boolean)));
  if(!unique.length)throw fail("Chưa có đơn đã giao để hoàn");
  if(unique.length>500)throw fail("Phạm vi hoàn đơn quá lớn");
  const {data,error}=await db.rpc("getlink_sales_return_delivered_scope",{
    p_actor_id:actor.id,p_ids:unique
  });
  if(error)throw error;
  return Number(data||0);
}

'''
    at=text.find('async function syncState(')
    if at<0: raise SystemExit('syncState anchor missing')
    text=text[:at]+batch+text[at:]

    old='''    const orderIdMatch=path.match(/^\\/orders\\/([^/]+)$/);
    if(req.method==="PUT"&&orderIdMatch){
      const id=decodeURIComponent(orderIdMatch[1]);
      const body=await req.json().catch(()=>({}));
      const order=await updatePendingOrder(id,body,actor);
      return json(req,{ok:true,order});
    }
    if(req.method==="DELETE"&&orderIdMatch){
      await deletePendingOrder(decodeURIComponent(orderIdMatch[1]),actor);
      return json(req,{ok:true});
    }
'''
    new='''    if(req.method==="POST"&&path==="/orders/return-batch"){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      const body=await req.json().catch(()=>({}));
      const ids=Array.isArray(body?.ids)?body.ids.map((value:any)=>clean(value)).filter(Boolean):[];
      const returned=await returnDeliveredScope(ids,actor);
      return json(req,{ok:true,returned});
    }
    const orderIdMatch=path.match(/^\\/orders\\/([^/]+)$/);
    if(req.method==="GET"&&orderIdMatch){
      const id=decodeURIComponent(orderIdMatch[1]);
      return json(req,{ok:true,order:await readOrder(id,actor)});
    }
    if(req.method==="PUT"&&orderIdMatch){
      const id=decodeURIComponent(orderIdMatch[1]);
      const body=await req.json().catch(()=>({}));
      const existing=await readOrder(id,actor);
      let order;
      if(existing.status==="pending")order=await updatePendingOrder(id,body,actor);
      else if(existing.status==="delivered"){
        if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
        order=await updateDeliveredOrder(id,body,actor);
      }else throw fail("Đơn đã hoàn không thể sửa");
      return json(req,{ok:true,order});
    }
    if(req.method==="DELETE"&&orderIdMatch){
      await deletePendingOrder(decodeURIComponent(orderIdMatch[1]),actor);
      return json(req,{ok:true});
    }
'''
    if old not in text: raise SystemExit('order route block missing')
    text=text.replace(old,new,1)
    text=text.replace('const ORDER_STATUSES=["pending","delivered","returned"] as const;',f'// {MARK}\nconst ORDER_STATUSES=["pending","delivered","returned"] as const;',1)
    EDGE.write_text(text,'utf-8')


def patch_order():
    text=ORDER.read_text('utf-8')
    if MARK in text:
        return

    old='''  let expandedOrderId="";
  let editingOrderId="";
  let ordersVersion="";
'''
    new='''  let expandedOrderId="";
  let editingOrderId="";
  let editingOrderStatus="";
  let orderReportFilter={mode:"all",from:localDateKey(new Date()),to:localDateKey(new Date()),search:""};
  let sourceDrillSource="";
  let sourceDrillMode="detail";
  let debtLinkedOrder=null;
  let ordersVersion="";
'''
    if old not in text: raise SystemExit('state anchor missing')
    text=text.replace(old,new,1)

    old='''                <button id="orderDeleteAllPendingButton" type="button" data-order-batch="delete-pending" hidden>Xóa tất cả</button>
                <button id="orderCustomerPickerButton" type="button" hidden>Chọn khách hàng</button>'''
    new='''                <button id="orderDeleteAllPendingButton" type="button" data-order-batch="delete-pending" hidden>Xóa tất cả</button>
                <button id="orderReturnAllDeliveredButton" type="button" data-order-batch="return-delivered" hidden>Xóa tất cả đã giao</button>
                <button id="orderCustomerPickerButton" type="button" hidden>Chọn khách hàng</button>'''
    if old not in text: raise SystemExit('manager batch button anchor missing')
    text=text.replace(old,new,1)

    text=text.replace('''      if(update)update.hidden=!editing;''','''      if(update){update.hidden=!editing;update.textContent=editingOrderStatus==="delivered"?"Cập nhật đã giao":"Cập nhật đơn";}''',1)

    sync='''  function syncBatchControls(filtered=null){
    const pendingButton=document.getElementById("orderDeleteAllPendingButton");
    const deliveredButton=document.getElementById("orderReturnAllDeliveredButton");
    const pendingCount=orders.filter(order=>order.status==="pending").length;
    const filteredRows=Array.isArray(filtered)?filtered:filterOrdersForReport(orders);
    const deliveredCount=filteredRows.filter(order=>order.status==="delivered").length;
    if(pendingButton)pendingButton.hidden=activeView!=="orders"||activeStatus!=="pending"||pendingCount===0;
    if(deliveredButton)deliveredButton.hidden=activeView!=="orders"||activeStatus!=="delivered"||currentRole()!=="admin"||deliveredCount===0;
  }
'''
    text=replace_between(text,'  function syncBatchControls(){','  function syncCustomerControls(){',sync)

    old_delivered='''    if(order.status==="delivered"&&admin)return `
      <div class="order-card-actions">
        <button type="button" class="order-action-danger" data-order-action="return" data-order-id="${escapeHtml(order.id)}">Đã hoàn</button>
      </div>`;'''
    new_delivered='''    if(order.status==="delivered"&&admin)return `
      <div class="order-card-actions">
        <button type="button" class="order-action-secondary" data-order-action="edit" data-order-id="${escapeHtml(order.id)}">Sửa</button>
        <button type="button" class="order-action-danger" data-order-action="return" data-order-id="${escapeHtml(order.id)}">Xóa</button>
      </div>`;'''
    if old_delivered not in text: raise SystemExit('delivered actions anchor missing')
    text=text.replace(old_delivered,new_delivered,1)

    order_block=r'''  function orderRef(order){return order.orderNo?"#"+order.orderNo:String(order.id||"")}
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

'''
    text=replace_between(text,'  function orderRef(order){','  async function loadDebtSummaries(){',order_block)

    debt_block=r'''  async function openDebtLinkedOrder(id){
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
'''
    text=replace_between(text,'  function renderDebtDetail(){','  async function refreshDebts(){',debt_block)

    edit_block=r'''  async function startEditOrder(id){
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

'''
    text=replace_between(text,'  async function startEditOrder(id){','  async function submitQuickSale(){',edit_block)

    batch_block=r'''  async function deleteAllPendingOrders(){
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

'''
    text=replace_between(text,'  async function deleteAllPendingOrders(){','  async function checkRemoteRevision(',batch_block)

    text=text.replace('''      expandedOrderId="";
      await refreshManager();''','''      expandedOrderId="";
      if(debtLinkedOrder&&String(debtLinkedOrder.id)===String(id))debtLinkedOrder=null;
      await refreshManager();''',1)

    click_start='''  document.addEventListener("click",async event=>{
    const target=event.target;'''
    click_end='''

  document.addEventListener("submit",async event=>{'''
    click_block=r'''  document.addEventListener("click",async event=>{
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
  });'''
    text=replace_between(text,click_start,click_end,click_block)

    old_input='''  document.addEventListener("input",event=>{
    if(event.target?.id==="orderCustomerSearch"&&!pickerBusy)renderCustomerList();
  });'''
    new_input='''  document.addEventListener("input",event=>{
    if(event.target?.id==="orderCustomerSearch"&&!pickerBusy){renderCustomerList();return;}
    if(event.target?.matches?.("[data-order-report-search]")){
      orderReportFilter={...orderReportFilter,search:String(event.target.value||"")};sourceDrillSource="";renderOrders();
      const input=document.querySelector("[data-order-report-search]");input?.focus();input?.setSelectionRange(orderReportFilter.search.length,orderReportFilter.search.length);return;
    }
    const range=event.target?.closest?.("[data-order-report-range]");
    if(range){const side=String(range.dataset.orderReportRange||"from"),value=String(range.value||"");let next={...orderReportFilter,mode:"range",[side]:value};if(next.from&&next.to&&next.from>next.to){if(side==="from")next.to=next.from;else next.from=next.to;}orderReportFilter=next;sourceDrillSource="";renderOrders();}
  });'''
    if old_input not in text: raise SystemExit('input listener anchor missing')
    text=text.replace(old_input,new_input,1)

    text=text.replace('''  window.GETLINK_ACCESS_CONTEXT={states:ACCESS_STATES,snapshot:accessSnapshot};''',f'''  // {MARK}\n  window.GETLINK_ACCESS_CONTEXT={{states:ACCESS_STATES,snapshot:accessSnapshot}};''',1)
    ORDER.write_text(text,'utf-8')


def patch_css():
    text=CSS.read_text('utf-8')
    if MARK in text:
        return
    text += r'''

/* TAPHOA_FULL_ORDER_DEBT_PARITY_20260911 */
#orderReturnAllDeliveredButton{border-color:#e4c9c9;color:#963f3f;background:#fff8f8}
.order-report-controls{display:grid;gap:7px;padding:10px;border:1px solid #e1e5e9;border-radius:11px;background:#fff}
.order-report-search input{width:100%;min-height:44px;padding:0 11px;border:1px solid #d7dde4;border-radius:9px;background:#fff;color:#27313d;font-size:13px;outline:0}
.order-report-search input:focus,.order-report-time input:focus{border-color:#9dbce0;box-shadow:0 0 0 2px rgba(54,109,174,.08)}
.order-report-time,.order-report-quick{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.order-report-time button,.order-report-quick button,.order-source-detail button,.debt-linked-back{min-height:44px;padding:0 10px;border:1px solid #d9dfe5;border-radius:8px;background:#fff;color:#4c5a68;font:650 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
.order-report-time button[aria-pressed="true"],.order-report-quick button:active,.order-source-detail nav button[aria-pressed="true"]{border-color:#b7cff3;background:#eef5ff;color:#1f5ca8}
.order-report-time label{min-height:44px;display:inline-flex;align-items:center;gap:5px;color:#697383;font-size:11px}
.order-report-time input{height:36px;padding:0 6px;border:1px solid #d7dde4;border-radius:8px;background:#fff;color:#34404d;font-size:12px;outline:0}
.order-source-summary{border:1px solid #e1e5e9;border-radius:11px;background:#fff;overflow:hidden}
.order-source-grid{display:grid;grid-template-columns:minmax(90px,1.4fr) .55fr .9fr .9fr .9fr;align-items:center;gap:6px;padding:7px 9px;font-variant-numeric:tabular-nums}
.order-source-grid>span:not(:first-child){text-align:right}
.order-source-head{min-height:34px;background:#f7f8fa;color:#77818e;font-size:10px;font-weight:700}
.order-source-row{width:100%;min-height:44px;border:0;border-top:1px solid #eef0f2;background:#fff;color:#34404d;text-align:left;font-size:11.5px;cursor:pointer}
.order-source-row:hover{background:#fafbfd}
.order-source-total{min-height:38px;border-top:1px solid #dfe3e8;background:#fafbfc;color:#303b47;font-size:11px;font-weight:700}
.order-source-empty{padding:14px;color:#77818e;font-size:12px;text-align:center}
.order-source-detail{border:1px solid #ccd9e8;border-radius:11px;background:#fff;overflow:hidden}
.order-source-detail header{min-height:52px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #e8ebef}
.order-source-detail header strong{display:block;color:#25303d;font-size:13px}.order-source-detail header small{display:block;margin-top:3px;color:#7a8491;font-size:11px}.order-source-detail header>div:last-child{display:flex;gap:5px}
.order-source-detail nav{display:grid;grid-template-columns:1fr 1fr;gap:0;border-bottom:1px solid #e8ebef}.order-source-detail nav button{border:0;border-radius:0}
.order-source-lines,.order-source-combined{display:grid}.order-source-lines>div,.order-source-combined>div{min-height:42px;padding:7px 10px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;border-bottom:1px solid #eef0f2;color:#3c4754;font-size:12px}.order-source-lines>div:last-child,.order-source-combined>div:last-child{border-bottom:0}.order-source-lines span{min-width:0}.order-source-lines b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.order-source-lines small{display:block;margin-top:3px;color:#7a8491;font-size:10.5px}.order-source-lines strong,.order-source-combined strong{font-variant-numeric:tabular-nums;white-space:nowrap}
.order-lifecycle-list{display:grid;gap:8px}
.debt-txn{width:100%;padding:0;text-align:left;font:inherit}.debt-txn[data-debt-order-id]{cursor:pointer}.debt-txn[data-debt-order-id]:hover{background:#fbfcfd}.debt-txn:disabled{cursor:default;color:inherit}
.debt-linked-order{display:grid;gap:8px}.debt-linked-back{justify-self:start}.debt-linked-head,.debt-linked-total{min-height:58px;padding:10px 12px;border:1px solid #e1e5e9;border-radius:11px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:12px}.debt-linked-head strong{display:block;color:#202936;font-size:15px}.debt-linked-head small{display:block;margin-top:3px;color:#7a8491;font-size:11px}.debt-linked-head>b,.debt-linked-total strong{font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap}.debt-linked-lines{border:1px solid #e1e5e9;border-radius:11px;background:#fff;overflow:hidden}.debt-linked-lines>div{min-height:44px;padding:7px 10px;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;border-bottom:1px solid #eef0f2;font-size:11.5px}.debt-linked-lines>div:last-child{border-bottom:0}.debt-linked-lines span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.debt-linked-lines small{margin-right:5px;color:#89929d}.debt-linked-lines strong{font-variant-numeric:tabular-nums;white-space:nowrap}.debt-linked-total{min-height:48px;font-size:12px}
@media(max-width:639px){.order-report-controls{padding:8px;gap:6px}.order-report-time,.order-report-quick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.order-report-time label{display:grid;grid-template-columns:auto 1fr}.order-report-time input{width:100%;min-width:0}.order-source-grid{grid-template-columns:minmax(72px,1.2fr) .45fr .8fr .8fr .8fr;padding:6px;font-size:10.5px}.order-source-head{font-size:9px}.debt-linked-lines>div{grid-template-columns:minmax(0,1fr) auto}.debt-linked-lines>div>strong{grid-column:2}.debt-linked-lines>div>span:nth-child(2){font-size:10px;color:#78838f}}
'''
    CSS.write_text(text,'utf-8')

patch_edge()
patch_order()
patch_css()
print('TAPHOA full order/debt parity patch applied')
