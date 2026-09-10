from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel, value):
    (ROOT / rel).write_text(value, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    out, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 regex match, found {count}")
    return out


# --- Migration: add a lightweight scoped revision RPC for Admin/User convergence. ---
migration_rel = "supabase/migrations/20260910224500_getlink_order_workflow_parity.sql"
sql = read(migration_rel)
if "getlink_sales_sync_state" not in sql:
    sync_sql = r'''

create or replace function public.getlink_sales_sync_state(
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_role text;
  v_orders_count bigint:=0;
  v_orders_max timestamptz;
  v_orders_versions bigint:=0;
  v_debt_count bigint:=0;
  v_debt_max timestamptz;
begin
  select role into v_actor_role
  from public.v21_accounts
  where id=p_actor_id
    and role in ('user','admin')
    and deleted_at is null
    and locked_at is null;
  if v_actor_role is null then raise exception 'Invalid GETLINK actor'; end if;

  if v_actor_role='user' then
    select count(*),max(updated_at),coalesce(sum(version),0)
      into v_orders_count,v_orders_max,v_orders_versions
    from public.getlink_sales_orders
    where customer_account_id=p_actor_id;

    select count(*),max(created_at)
      into v_debt_count,v_debt_max
    from public.getlink_debt_ledger
    where customer_account_id=p_actor_id;
  else
    select count(*),max(updated_at),coalesce(sum(version),0)
      into v_orders_count,v_orders_max,v_orders_versions
    from public.getlink_sales_orders;

    select count(*),max(created_at)
      into v_debt_count,v_debt_max
    from public.getlink_debt_ledger;
  end if;

  return jsonb_build_object(
    'ordersVersion',v_orders_count::text||':'||coalesce(v_orders_max::text,'')||':'||v_orders_versions::text,
    'debtVersion',v_debt_count::text||':'||coalesce(v_debt_max::text,'')
  );
end;
$function$;

revoke all on function public.getlink_sales_sync_state(uuid) from public, anon, authenticated;
grant execute on function public.getlink_sales_sync_state(uuid) to service_role;
'''
    sql += sync_sql
    write(migration_rel, sql)


# --- Edge Function ---
edge_rel = "supabase/functions/getlink-orders/index.ts"
edge = read(edge_rel)
edge = replace_once(
    edge,
    '"access-control-allow-methods":"GET,POST,DELETE,OPTIONS"',
    '"access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS"',
    "edge CORS PUT",
)

new_create_block = r'''async function readOrder(id:string,actor:Identity){
  let query=db.from("getlink_sales_orders")
    .select("id,order_no,customer_account_id,created_by_account_id,created_by_role,status,total_amount_vnd,total_cost_vnd,submitted_at,delivered_at,returned_at")
    .eq("id",id);
  if(actor.kind==="customer")query=query.eq("customer_account_id",actor.id);
  const {data:order,error}=await query.maybeSingle();
  if(error)throw error;
  if(!order)throw fail("Không tìm thấy đơn",404);
  const {data:itemRows,error:itemError}=await db.from("getlink_sales_order_items")
    .select("id,order_id,line_no,product_code,product_name,product_url,quantity,unit_price_vnd,unit_cost_vnd,source_key")
    .eq("order_id",id)
    .order("line_no")
    .order("id");
  if(itemError)throw itemError;
  const names=await accountNameMap([String(order.customer_account_id||"")]);
  return orderView(order,itemRows||[],names.get(String(order.customer_account_id))||"Khách hàng",actor.kind==="admin");
}

async function createOrder(body:any,actor:Identity,quick=false){
  if(quick&&actor.kind!=="admin")throw fail("forbidden",403);
  const customer=actor.kind==="customer"
    ?await selectedCustomer(actor.id)
    :await selectedCustomer(clean(body?.customerId));
  if(actor.kind==="admin"&&!clean(body?.customerId))throw fail("Chưa chọn khách hàng");
  const items=await resolveCreateItems(body?.items);
  const id=crypto.randomUUID();
  const submittedAt=new Date().toISOString();
  const rpcName=quick?"getlink_sales_create_quick_sale":"getlink_sales_create_order";
  const {error}=await db.rpc(rpcName,{
    p_order:{id,customerAccountId:customer.id,createdByAccountId:actor.id,submittedAt},
    p_items:items
  });
  if(error)throw error;
  return await readOrder(id,actor);
}

async function updatePendingOrder(id:string,body:any,actor:Identity){
  const items=await resolveCreateItems(body?.items);
  const {error}=await db.rpc("getlink_sales_update_pending_order",{
    p_id:id,p_actor_id:actor.id,p_items:items
  });
  if(error)throw error;
  return await readOrder(id,actor);
}

'''
edge = regex_once(
    edge,
    r'async function createOrder\(req:Request,actor:Identity\)\{.*?\n\}\n\n(?=async function deliverOrder)',
    new_create_block,
    "edge create/update block",
)

old_delete = r'''async function deletePendingOrder(id:string,actor:Identity){
  const {data,error}=await db.from("getlink_sales_orders")
    .select("id,status")
    .eq("id",id)
    .maybeSingle();
  if(error)throw error;
  if(!data)throw fail("Không tìm thấy đơn",404);
  if(data.status!=="pending")throw fail("Chỉ xóa được Đơn tạm",409);
  await returnOrder(id,actor);
}
'''
new_delete = r'''async function deletePendingOrder(id:string,actor:Identity){
  const {error}=await db.rpc("getlink_sales_delete_pending_order",{p_id:id,p_actor_id:actor.id});
  if(error)throw error;
}
async function deleteAllPending(actor:Identity){
  const {data,error}=await db.rpc("getlink_sales_delete_all_pending",{p_actor_id:actor.id});
  if(error)throw error;
  return Number(data||0);
}
async function syncState(actor:Identity){
  const {data,error}=await db.rpc("getlink_sales_sync_state",{p_actor_id:actor.id});
  if(error)throw error;
  return {
    ordersVersion:clean(data?.ordersVersion),
    debtVersion:clean(data?.debtVersion)
  };
}
'''
edge = replace_once(edge, old_delete, new_delete, "edge pending delete/sync helpers")

old_routes = r'''    if(req.method==="GET"&&path==="/orders"){
      return json(req,{ok:true,role:actor.kind,orders:await listOrders(actor)});
    }
    if(req.method==="POST"&&path==="/orders"){
      const order=await createOrder(req,actor);
      return json(req,{ok:true,order},201);
    }
    if(req.method==="GET"&&path==="/debts"){
      return json(req,{ok:true,role:actor.kind,debts:await listDebtSummaries(actor)});
    }
'''
new_routes = r'''    if(req.method==="GET"&&path==="/orders"){
      return json(req,{ok:true,role:actor.kind,orders:await listOrders(actor)});
    }
    if(req.method==="GET"&&path==="/sync"){
      return json(req,{ok:true,...await syncState(actor)});
    }
    if(req.method==="POST"&&path==="/orders"){
      const body=await req.json().catch(()=>({}));
      const quick=String(body?.mode)==="quick";
      if(quick&&actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      const order=await createOrder(body,actor,quick);
      return json(req,{ok:true,order},201);
    }
    if(req.method==="GET"&&path==="/debts"){
      return json(req,{ok:true,role:actor.kind,debts:await listDebtSummaries(actor)});
    }
'''
edge = replace_once(edge, old_routes, new_routes, "edge main order routes")

old_tail_routes = r'''    const match=path.match(/^\/orders\/([^/]+)\/(deliver|return)$/);
    if(req.method==="POST"&&match){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      const id=decodeURIComponent(match[1]);
      if(match[2]==="deliver")await deliverOrder(id,actor);else await returnOrder(id,actor);
      return json(req,{ok:true});
    }
    const deleteMatch=path.match(/^\/orders\/([^/]+)$/);
    if(req.method==="DELETE"&&deleteMatch){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      await deletePendingOrder(decodeURIComponent(deleteMatch[1]),actor);
      return json(req,{ok:true});
    }
'''
new_tail_routes = r'''    const match=path.match(/^\/orders\/([^/]+)\/(deliver|return)$/);
    if(req.method==="POST"&&match){
      if(actor.kind!=="admin")return json(req,{error:"forbidden"},403);
      const id=decodeURIComponent(match[1]);
      if(match[2]==="deliver")await deliverOrder(id,actor);else await returnOrder(id,actor);
      return json(req,{ok:true});
    }
    if(req.method==="DELETE"&&path==="/orders/pending"){
      const deleted=await deleteAllPending(actor);
      return json(req,{ok:true,deleted});
    }
    const orderIdMatch=path.match(/^\/orders\/([^/]+)$/);
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
edge = replace_once(edge, old_tail_routes, new_tail_routes, "edge mutation routes")
write(edge_rel, edge)


# --- app.js: cart owner API for editing an existing pending order. ---
app_rel = "app.js"
app = read(app_rel)
old_clear = r'''function clearUserWorkOrderSelection(){
  try{localStorage.removeItem(USER_WORK_QTY_KEY);}catch{}
  mobileUserScopeViewCache.delete("mine");
  renderUserWorkHome();
  updateUserWorkOrderSummary();
}
'''
new_clear = r'''function clearUserWorkOrderSelection(){
  try{localStorage.removeItem(USER_WORK_QTY_KEY);}catch{}
  mobileUserScopeViewCache.delete("mine");
  renderUserWorkHome();
  updateUserWorkOrderSummary();
}

function loadUserWorkOrderSelection(order){
  const map={};
  for(const item of Array.isArray(order?.items)?order.items:[]){
    const url=String(item?.url||"").trim();
    const qty=Math.max(0,Math.round(Number(item?.qty||0)));
    if(url&&qty>0)map[url]=qty;
  }
  writeUserWorkQtyMap(map);
  mobileUserScope="mine";
  userWorkDesktopScope="mine";
  mobileUserScopeViewCache.delete("mine");
  renderUserWorkHome();
  updateUserWorkOrderSummary();
  return map;
}
'''
app = replace_once(app, old_clear, new_clear, "app edit cart loader")
app = replace_once(
    app,
    "window.clearUserWorkOrderSelection=clearUserWorkOrderSelection;\nwindow.renderUserWorkHome=renderUserWorkHome;",
    "window.clearUserWorkOrderSelection=clearUserWorkOrderSelection;\nwindow.loadUserWorkOrderSelection=loadUserWorkOrderSelection;\nwindow.renderUserWorkHome=renderUserWorkHome;",
    "app export edit loader",
)
write(app_rel, app)


# --- order-management.js ---
om_rel = "order-management.js"
om = read(om_rel)
om = replace_once(
    om,
    '  const STATUS_LABELS={pending:"Đơn tạm",delivered:"Đã giao",returned:"Đã hoàn"};\n',
    '  const STATUS_LABELS={pending:"Đơn tạm",delivered:"Đã giao",returned:"Đã hoàn"};\n  const ORDER_SYNC_MS=3000;\n',
    "order sync constant",
)
om = replace_once(
    om,
    '  let expandedOrderId="";\n  let orders=[];\n',
    '  let expandedOrderId="";\n  let editingOrderId="";\n  let ordersVersion="";\n  let debtVersion="";\n  let syncBusy=false;\n  let orders=[];\n',
    "order workflow state",
)
om = replace_once(
    om,
    '  function emitAccessChange(){\n    syncWorkManagerNav();\n    document.dispatchEvent(new CustomEvent("getlink-access-change",{detail:accessSnapshot()}));\n  }',
    '  function emitAccessChange(){\n    syncWorkManagerNav();\n    syncCartActions();\n    document.dispatchEvent(new CustomEvent("getlink-access-change",{detail:accessSnapshot()}));\n  }',
    "access change cart sync",
)
om = replace_once(
    om,
    '  function injectUi(){\n    ensureWorkManagerNav();\n    if(document.getElementById("orderManager"))return;',
    '  function injectUi(){\n    ensureWorkManagerNav();\n    ensureCartActions();\n    if(document.getElementById("orderManager"))return;',
    "inject cart actions",
)
om = replace_once(
    om,
    '                <button id="debtBackButton" type="button" hidden>Khách hàng</button>\n                <button id="orderCustomerPickerButton" type="button" hidden>Chọn khách hàng</button>',
    '                <button id="debtBackButton" type="button" hidden>Khách hàng</button>\n                <button id="orderDeleteAllPendingButton" type="button" data-order-batch="delete-pending" hidden>Xóa tất cả</button>\n                <button id="orderCustomerPickerButton" type="button" hidden>Chọn khách hàng</button>',
    "pending delete-all control",
)

anchor = r'''  function ensureInlineCustomerButtons(){
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
'''
cart_code = anchor + r'''
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
      if(update)update.hidden=!editing;
      wrap.classList.toggle("editing",editing);
    });
  }
  function syncBatchControls(){
    const button=document.getElementById("orderDeleteAllPendingButton");
    if(!button)return;
    const pendingCount=orders.filter(order=>order.status==="pending").length;
    button.hidden=activeView!=="orders"||activeStatus!=="pending"||pendingCount===0;
  }
'''
om = replace_once(om, anchor, cart_code, "cart action controls")

om = replace_once(
    om,
    '    for(const button of document.querySelectorAll("[data-order-customer-select]")){\n      button.hidden=!admin;',
    '    for(const button of document.querySelectorAll("[data-order-customer-select]")){\n      button.hidden=!admin||Boolean(editingOrderId);',
    "lock inline customer during edit",
)
om = replace_once(
    om,
    '      picker.hidden=!(admin&&activeView==="orders");',
    '      picker.hidden=!(admin&&activeView==="orders"&&!editingOrderId);',
    "lock picker during edit",
)
om = replace_once(
    om,
    '    syncWorkManagerNav();\n    syncCustomerControls();\n  }\n\n  function setMainStatus',
    '    syncWorkManagerNav();\n    syncCustomerControls();\n    syncBatchControls();\n    syncCartActions();\n  }\n\n  function setMainStatus',
    "manager view workflow controls",
)

old_actions = r'''  function orderActions(order){
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
'''
new_actions = r'''  function orderActions(order){
    const admin=currentRole()==="admin";
    if(order.status==="pending")return `
      <div class="order-card-actions">
        <button type="button" class="order-action-secondary" data-order-action="edit" data-order-id="${escapeHtml(order.id)}">Sửa</button>
        ${admin?`<button type="button" class="order-action-primary" data-order-action="deliver" data-order-id="${escapeHtml(order.id)}">Đã giao</button>`:""}
        <button type="button" class="order-action-danger" data-order-action="delete" data-order-id="${escapeHtml(order.id)}">Xóa</button>
      </div>`;
    if(order.status==="delivered"&&admin)return `
      <div class="order-card-actions">
        <button type="button" class="order-action-danger" data-order-action="return" data-order-id="${escapeHtml(order.id)}">Đã hoàn</button>
      </div>`;
    return "";
  }
'''
om = replace_once(om, old_actions, new_actions, "scoped order actions")
om = replace_once(
    om,
    '    if(summary)summary.textContent=(STATUS_LABELS[activeStatus]||activeStatus)+" · "+visible.length+" đơn";',
    '    if(summary)summary.textContent=(STATUS_LABELS[activeStatus]||activeStatus)+" · "+visible.length+" đơn";\n    syncBatchControls();',
    "render batch controls",
)
om = replace_once(
    om,
    '        ${expanded?`<div class="order-card-items">${items.map(item=>`<div><span>${escapeHtml(item.name)}</span><small>${Number(item.qty||0)} × ${escapeHtml(moneyVnd(item.price))}</small></div>`).join("")}</div>`:""}\n        ${orderActions(order)}',
    '        ${expanded?`<div class="order-card-items">${items.map(item=>`<div><span>${escapeHtml(item.name)}</span><small>${Number(item.qty||0)} × ${escapeHtml(moneyVnd(item.price))}</small></div>`).join("")}</div>`:""}\n        ${expanded?orderActions(order):""}',
    "actions only in order detail",
)

workflow_functions = r'''
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
    const order=orders.find(row=>String(row.id)===String(id));
    if(!order||order.status!=="pending")return;
    if(typeof window.loadUserWorkOrderSelection!=="function"){
      alert("Không tải được đơn vào Tạp hóa.");
      return;
    }
    if(currentRole()==="admin"){
      selectedCustomerId=String(order.customerId||"");
      if(selectedCustomerId)sessionStorage.setItem(SELECTED_CUSTOMER_KEY,selectedCustomerId);
    }
    editingOrderId=String(order.id);
    window.loadUserWorkOrderSelection(order);
    closeManager();
    syncCartActions();syncCustomerControls();
    setMainStatus("Đang sửa đơn "+orderRef(order)+".");
  }
  function cancelEditOrder(){
    if(!editingOrderId)return;
    const label=orderRef(orders.find(row=>String(row.id)===String(editingOrderId))||{id:editingOrderId});
    editingOrderId="";
    clearCurrentCart();
    if(currentRole()==="admin")clearSelectedCustomer();
    syncCartActions();syncCustomerControls();
    setMainStatus("Đã hủy sửa đơn "+label+".");
  }
  async function updateEditingOrder(){
    if(busy||!editingOrderId)return;
    if(!(await requireChatAuth()))return;
    const items=selectedOrderPayload();
    if(!items){setMainStatus("Đơn phải có ít nhất một sản phẩm.");return;}
    const id=editingOrderId;
    busy=true;setMainStatus("Đang cập nhật đơn...");
    try{
      const data=await orderFetch("/orders/"+encodeURIComponent(id),{method:"PUT",body:JSON.stringify({items})});
      editingOrderId="";
      clearCurrentCart();
      if(currentRole()==="admin")clearSelectedCustomer();
      const label=data?.order?.orderNo?"#"+data.order.orderNo:String(id);
      setMainStatus("Đã cập nhật đơn "+label+".");
      expandedOrderId=String(id);activeView="orders";activeStatus="pending";
      openManager();
    }catch(error){
      handleAuthError(error);setMainStatus(String(error?.message||error));
    }finally{busy=false;syncCartActions();syncCustomerControls();}
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
    try{
      await orderFetch("/orders/pending",{method:"DELETE"});
      expandedOrderId="";
      await refreshManager();
    }catch(error){
      if(!handleAuthError(error))alert(String(error?.message||error));
    }finally{busy=false;}
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

'''
om = replace_once(om, "  async function submitSelectedOrder(){\n", workflow_functions + "  async function submitSelectedOrder(){\n", "workflow functions")

old_admin_action = r'''  async function performAdminAction(action,id){
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
'''
new_order_action = r'''  async function performOrderAction(action,id){
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
      await refreshManager();
    }catch(error){
      if(!handleAuthError(error))alert(String(error?.message||error));
    }finally{busy=false;}
  }
'''
om = replace_once(om, old_admin_action, new_order_action, "scope-aware order actions")

click_anchor = r'''  document.addEventListener("click",async event=>{
    const target=event.target;
    const workView=target.closest?.("[data-order-work-view]");
'''
click_new = r'''  document.addEventListener("click",async event=>{
    const target=event.target;
    const cartAction=target.closest?.("[data-order-cart-action]");
    if(cartAction){
      const action=String(cartAction.dataset.orderCartAction||"");
      if(action==="clear")clearCurrentCart();
      else if(action==="quick")await submitQuickSale();
      else if(action==="cancel-edit")cancelEditOrder();
      else if(action==="update")await updateEditingOrder();
      return;
    }
    const batch=target.closest?.("[data-order-batch]");
    if(batch?.dataset.orderBatch==="delete-pending"){await deleteAllPendingOrders();return;}
    const workView=target.closest?.("[data-order-work-view]");
'''
om = replace_once(om, click_anchor, click_new, "cart and batch click routes")
om = replace_once(
    om,
    '    const action=target.closest?.("[data-order-action]");\n    if(action)await performAdminAction(String(action.dataset.orderAction||""),String(action.dataset.orderId||""));',
    '    const action=target.closest?.("[data-order-action]");\n    if(action)await performOrderAction(String(action.dataset.orderAction||""),String(action.dataset.orderId||""));',
    "order action click handler",
)
om = replace_once(
    om,
    '  requestChatAuth();\n  window.setInterval(()=>{ensureWorkManagerNav();ensureInlineCustomerButtons();syncCustomerControls();},1500);\n})();',
    '  requestChatAuth();\n  window.setInterval(()=>{ensureWorkManagerNav();ensureInlineCustomerButtons();ensureCartActions();syncCustomerControls();},1500);\n  window.setInterval(()=>{void checkRemoteRevision();},ORDER_SYNC_MS);\n  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void checkRemoteRevision();});\n  window.addEventListener("focus",()=>{void checkRemoteRevision();});\n})();',
    "remote revision listeners",
)
write(om_rel, om)


# --- CSS: scoped additions only. ---
css_rel = "order-management.css"
css = read(css_rel)
if "/* Tạp hóa order workflow parity */" not in css:
    css += r'''

/* Tạp hóa order workflow parity */
.order-action-secondary{border:1px solid #d5dbe2;background:#fff;color:#4a5969}
#orderDeleteAllPendingButton{border-color:#e4c9c9;color:#963f3f;background:#fff8f8}
.order-cart-actions{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
.order-cart-actions[hidden],.order-cart-actions button[hidden]{display:none!important}
.order-cart-actions button{min-height:34px;padding:0 10px;border:1px solid #d9dfe5;border-radius:8px;background:#fff;color:#4e5a68;font:650 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}
.order-cart-actions [data-order-cart-action="quick"]{border-color:#b9d8c4;background:#f1f9f4;color:#17683b}
.order-cart-actions [data-order-cart-action="update"]{border-color:#afc8e6;background:#f2f7fd;color:#245f9e}
@media(max-width:639px){
  .order-cart-actions{gap:4px}
  .order-cart-actions button{min-height:32px;padding:0 8px;font-size:11px}
  .order-cart-actions.editing{flex:1}
  .order-cart-actions.editing button{flex:1}
}
'''
write(css_rel, css)

# Temporary patch machinery must never reach merge.
for rel in ["tools/apply_taphoa_order_workflow_once.py", ".github/workflows/apply-taphoa-order-workflow-once.yml"]:
    path=ROOT/rel
    if path.exists():
        path.unlink()

print("Applied Tạp hóa order workflow parity patch")
