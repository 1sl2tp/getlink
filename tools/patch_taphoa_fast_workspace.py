from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
ORDER=ROOT/"order-management.js"
CSS=ROOT/"order-management.css"
PICKER=ROOT/"order-customer-picker.css"
APP=ROOT/"app.js"
STYLE=ROOT/"style.css"


def replace_once(text, old, new, label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f"{label}: expected 1 exact match, got {count}")
    return text.replace(old,new,1)


def sub_once(text, pattern, repl, label, flags=0):
    out,count=re.subn(pattern,repl,text,count=1,flags=flags)
    if count!=1:
        raise SystemExit(f"{label}: expected 1 regex match, got {count}")
    return out


order=ORDER.read_text(encoding="utf-8")

order=replace_once(order,'  let activeView="orders";\n','  let activeView="orders";\n  let taphoaWorkView="sales";\n','workspace state')

order=sub_once(
    order,
    r'  function moneyVnd\(value\)\{\n    const n=Number\(value\|\|0\);\n    return Number\.isFinite\(n\)\?Math\.round\(n\)\.toLocaleString\("vi-VN"\)\+" ₫":"—";\n  \}',
    '  function compactMoney(value){\n    const n=Number(value||0);\n    if(!Number.isFinite(n))return "—";\n    const compact=Math.round(n/500)*.5;\n    return new Intl.NumberFormat("vi-VN",{minimumFractionDigits:0,maximumFractionDigits:1}).format(compact);\n  }',
    'compact money'
)
order=order.replace('moneyVnd(', 'compactMoney(')

order=replace_once(
    order,
    '  function emitAccessChange(){\n    syncWorkManagerNav();\n    syncCartActions();\n    document.dispatchEvent(new CustomEvent("getlink-access-change",{detail:accessSnapshot()}));\n  }',
    '  function emitAccessChange(){\n    ensureTaphoaWorkspaceNav();\n    syncTaphoaWorkspace();\n    syncCartActions();\n    document.dispatchEvent(new CustomEvent("getlink-access-change",{detail:accessSnapshot()}));\n  }',
    'access sync'
)

workspace_block='''  function taphoaWorkspaceNavMarkup(kind){
    return '<nav class="taphoa-work-nav '+kind+'" aria-label="Tạp hóa">'+
      '<button type="button" data-taphoa-work-view="sales">Bán</button>'+
      '<button type="button" data-taphoa-work-view="orders">Đơn</button>'+
      '<button type="button" data-taphoa-work-view="debts">Công nợ</button>'+
    '</nav>';
  }
  function isTaphoaWorkspaceActive(){
    const home=document.getElementById("userWorkHome");
    if(!home||home.hidden)return false;
    if(window.matchMedia("(max-width:639px)").matches){
      const buttons=[...document.querySelectorAll("#mobileUserSourceTabs button")];
      const active=buttons.find(button=>button.classList.contains("active")||button.getAttribute("aria-pressed")==="true");
      if(!active)return true;
      return normalizedSearch(active.textContent).includes("tap hoa");
    }
    const active=document.querySelector('.user-work-jump-button.active,.user-work-jump-button[aria-pressed="true"]');
    return !active||String(active.dataset.workTarget||"mine")==="mine";
  }
  function activeTaphoaWorkspaceHost(){
    return window.matchMedia("(max-width:639px)").matches
      ?document.getElementById("mobileUserWork")
      :document.querySelector(".user-work-desktop");
  }
  function renderSalesContext(){
    const panel=document.getElementById("taphoaSalesContext");
    const preview=document.getElementById("taphoaSalesPreview");
    if(!panel||!preview)return;
    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];
    preview.innerHTML=selected.length?selected.slice(0,12).map((item,index)=>{
      const row=item.row||{};
      const name=String(row.product_name||row.name||row.source_name||row.canonical_url||"Sản phẩm");
      return '<div class="taphoa-sales-preview-row"><span><small>'+(index+1)+'.</small>'+escapeHtml(name)+'</span><strong>×'+Number(item.qty||0)+'</strong></div>';
    }).join("")+(selected.length>12?'<div class="taphoa-sales-preview-more">+'+(selected.length-12)+' sản phẩm</div>':""):'<div class="taphoa-sales-preview-empty">Chưa chọn sản phẩm</div>';
    panel.classList.toggle("has-items",selected.length>0);
  }
  function ensureSalesContextPanel(){
    const mine=document.getElementById("userWorkMine");
    const wrap=mine?.querySelector(".user-work-order-wrap");
    const foot=mine?.querySelector(".user-work-order-foot");
    if(!mine||!wrap||!foot)return;
    mine.classList.add("taphoa-sales-grid");
    let panel=document.getElementById("taphoaSalesContext");
    if(!panel){
      panel=document.createElement("aside");
      panel.id="taphoaSalesContext";
      panel.className="taphoa-sales-context";
      panel.innerHTML='<div class="taphoa-sales-context-head"><strong>Xem đơn nhanh</strong><small>Khách · hàng đã chọn · thao tác</small></div><div id="taphoaSalesPreview" class="taphoa-sales-preview"></div>';
      wrap.insertAdjacentElement("afterend",panel);
    }
    if(foot.parentElement!==panel)panel.appendChild(foot);
    renderSalesContext();
  }
  function ensureTaphoaWorkspaceNav(){
    const desktopTop=document.querySelector(".user-work-top");
    if(desktopTop&&!desktopTop.parentElement?.querySelector(".taphoa-work-nav.desktop")){
      desktopTop.insertAdjacentHTML("afterend",taphoaWorkspaceNavMarkup("desktop"));
    }
    const mobileToolbar=document.querySelector(".mobile-user-toolbar");
    if(mobileToolbar&&!mobileToolbar.parentElement?.querySelector(".taphoa-work-nav.mobile")){
      mobileToolbar.insertAdjacentHTML("afterend",taphoaWorkspaceNavMarkup("mobile"));
    }
    ensureSalesContextPanel();
  }
  function syncTaphoaWorkspace(){
    const active=isTaphoaWorkspaceActive();
    const sales=taphoaWorkView==="sales";
    const mobile=window.matchMedia("(max-width:639px)").matches;
    document.querySelectorAll(".taphoa-work-nav").forEach(nav=>{
      nav.hidden=!active;
      nav.querySelectorAll("[data-taphoa-work-view]").forEach(button=>{
        const on=String(button.dataset.taphoaWorkView)===taphoaWorkView;
        button.classList.toggle("active",on);
        button.setAttribute("aria-pressed",on?"true":"false");
      });
    });
    const desktop=document.querySelector(".user-work-desktop");
    const mobileRoot=document.getElementById("mobileUserWork");
    if(desktop)desktop.dataset.taphoaView=active&&!mobile?taphoaWorkView:"sales";
    if(mobileRoot)mobileRoot.dataset.taphoaView=active&&mobile?taphoaWorkView:"sales";
    if(active&&!mobile){
      const mine=document.getElementById("userWorkMine");
      const categories=document.getElementById("userWorkDesktopCategories");
      if(mine)mine.hidden=!sales;
      if(categories)categories.hidden=!sales;
    }
    const manager=document.getElementById("orderManager");
    const host=activeTaphoaWorkspaceHost();
    if(manager&&host&&manager.parentElement!==host)host.appendChild(manager);
    if(manager){
      manager.hidden=!(active&&!sales);
      manager.setAttribute("aria-hidden",manager.hidden?"true":"false");
    }
    const title=document.getElementById("orderManagerTitle");
    if(title)title.textContent=taphoaWorkView==="debts"?"Công nợ":"Đơn hàng";
    renderSalesContext();
  }
'''
order=sub_once(
    order,
    r'  function workManagerNavMarkup\(kind\)\{[\s\S]*?\n  \}\n\n  function injectUi\(\)\{',
    workspace_block+'\n  function injectUi(){',
    'replace old work nav',
    re.M
)

order=replace_once(order,'    ensureWorkManagerNav();\n    ensureCartActions();','    ensureTaphoaWorkspaceNav();\n    ensureCartActions();','inject nav')
order=sub_once(
    order,
    r'    const roleSwitch=document\.querySelector\("\.role-switch"\);\n    if\(roleSwitch\)\{[\s\S]*?\n    \}\n    document\.body\.insertAdjacentHTML\("beforeend",`',
    '    document.body.insertAdjacentHTML("beforeend",`',
    'remove manager header entry',
    re.M
)

order=order.replace(
'''      <div id="orderManager" class="order-manager" hidden aria-hidden="true">
        <section class="order-manager-panel" role="dialog" aria-modal="true" aria-labelledby="orderManagerTitle">
          <header class="order-manager-head">
            <div><h2 id="orderManagerTitle">Bán hàng</h2><small id="orderManagerIdentity"></small></div>
            <button id="orderManagerClose" type="button" aria-label="Đóng">×</button>
          </header>''',
'''      <section id="orderManager" class="order-manager taphoa-workspace-panel" hidden aria-hidden="true" aria-labelledby="orderManagerTitle">
        <section class="order-manager-panel">
          <header class="order-manager-head">
            <div><h2 id="orderManagerTitle">Đơn hàng</h2><small id="orderManagerIdentity"></small></div>
          </header>''',1)
order=replace_once(
    order,
'''            <nav class="order-manager-modes" aria-label="Quản lý bán hàng">
              <button type="button" data-manager-view="orders" class="active">Đơn hàng</button>
              <button type="button" data-manager-view="debts">Công nợ</button>
            </nav>
''',
    '',
    'remove manager modes'
)
order=replace_once(order,'                <button id="orderCustomerPickerButton" type="button" hidden>Chọn khách hàng</button>\n','', 'remove duplicate picker button')
order=replace_once(order,'        </section>\n      </div>`);','        </section>\n      </section>`);','manager closing tag')
# Move picker out of manager after creation so Sales can open it without showing Orders/Debt.
order=replace_once(
    order,
    '    syncCustomerControls();\n    syncManagerView();\n  }',
    '    const picker=document.getElementById("orderCustomerPicker");\n    if(picker&&picker.parentElement!==document.body)document.body.appendChild(picker);\n    syncCustomerControls();\n    syncManagerView();\n    syncTaphoaWorkspace();\n  }',
    'picker detach'
)

# Add cart preview refresh after cart action creation.
order=replace_once(order,'    syncCartActions();\n  }\n  function syncCartActions(){','    syncCartActions();\n    renderSalesContext();\n  }\n  function syncCartActions(){','cart context refresh')

# Remove duplicate manager customer selector synchronization.
order=sub_once(
    order,
    r'    const picker=document\.getElementById\("orderCustomerPickerButton"\);\n    if\(picker\)\{[\s\S]*?\n    \}\n  \}',
    '  }',
    'remove manager customer selector',
    re.M
)

# Simplify manager view sync and keep the workspace as the only nav owner.
order=sub_once(
    order,
    r'  function syncManagerView\(\)\{[\s\S]*?\n  \}\n\n  function setMainStatus',
'''  function syncManagerView(){
    const tabs=document.getElementById("orderManagerTabs");
    if(tabs)tabs.hidden=activeView!=="orders";
    const back=document.getElementById("debtBackButton");
    if(back)back.hidden=activeView!=="debts"||currentRole()!=="admin"||!debtCustomerId;
    syncCustomerControls();
    syncBatchControls();
    syncCartActions();
    syncTaphoaWorkspace();
  }

  function setMainStatus''',
    'manager sync',
    re.M
)

# Manager is inline. Auth gate only opens it when Orders/Debt is the requested workspace.
order=sub_once(
    order,
    r'  function setManagerGate\(message\)\{[\s\S]*?\n  \}\n  function clearManagerGate',
'''  function setManagerGate(message){
    injectUi();
    if(taphoaWorkView==="sales"){setMainStatus(message);return;}
    const host=document.getElementById("orderManager");
    const gate=document.getElementById("orderManagerGate");
    const body=document.getElementById("orderManagerBody");
    if(host){host.hidden=false;host.setAttribute("aria-hidden","false");}
    if(gate){gate.hidden=false;gate.textContent=message;}
    if(body)body.hidden=true;
  }
  function clearManagerGate''',
    'manager gate',
    re.M
)
order=sub_once(
    order,
    r'  function openManager\(\)\{[\s\S]*?\n  \}\n  function closeManager\(\)\{[\s\S]*?\n  \}',
'''  function openManager(){
    injectUi();
    taphoaWorkView=activeView==="debts"?"debts":"orders";
    syncTaphoaWorkspace();
    void refreshManager();
  }
  function closeManager(){
    closeCustomerPicker();
    taphoaWorkView="sales";
    syncTaphoaWorkspace();
  }''',
    'inline open close',
    re.M
)

# Customer picker is an independent one-level picker, not a reason to show management.
order=replace_once(
    order,
'''    injectUi();
    const host=document.getElementById("orderManager");
    if(host?.hidden){host.hidden=false;host.setAttribute("aria-hidden","false");}
    clearManagerGate();
    const picker=document.getElementById("orderCustomerPicker");''',
'''    injectUi();
    const picker=document.getElementById("orderCustomerPicker");''',
    'picker no manager'
)

# Recency helpers after orderRef.
order=replace_once(
    order,
    '  function orderRef(order){return order.orderNo?"#"+order.orderNo:String(order.id||"")}\n',
'''  function orderRef(order){return order.orderNo?"#"+order.orderNo:String(order.id||"")}
  function orderRecency(order){
    if(order.status==="returned")return Date.parse(order.returnedAt||order.deliveredAt||order.orderedAt||0)||0;
    if(order.status==="delivered")return Date.parse(order.deliveredAt||order.orderedAt||0)||0;
    return Date.parse(order.submittedAt||order.orderedAt||0)||0;
  }
  function sortOrdersNewestFirst(rows){
    return [...(rows||[])].sort((a,b)=>orderRecency(b)-orderRecency(a)||Number(b.orderNo||0)-Number(a.orderNo||0));
  }
  function sortDebtCustomersNewestFirst(rows){
    return [...(rows||[])].sort((a,b)=>(Date.parse(b.lastOccurredAt||0)||0)-(Date.parse(a.lastOccurredAt||0)||0));
  }
  function newestDebtTimeline(rows){
    return [...(rows||[])].sort((a,b)=>(Date.parse(b.occurredAt||0)||0)-(Date.parse(a.occurredAt||0)||0));
  }
''',
    'recency helpers'
)
order=replace_once(order,'    const visible=filterOrdersForReport(orders),statusCount=orders.filter(order=>order.status===activeStatus).length;','    const visible=sortOrdersNewestFirst(filterOrdersForReport(orders)),statusCount=orders.filter(order=>order.status===activeStatus).length;','order recency render')
order=replace_once(order,'    list.innerHTML=debtSummaries.map(row=>`','    const recent=sortDebtCustomersNewestFirst(debtSummaries);\n    list.innerHTML=recent.map(row=>`','debt customer recency')
order=replace_once(order,'      <div class="debt-timeline">${timeline.length?timeline.map(row=>`','      <div class="debt-timeline">${timeline.length?newestDebtTimeline(timeline).map(row=>`','debt timeline recency')

# Add visible submit busy state helper before selectedOrderPayload.
busy_helper='''  function setSalesBusyState(kind,on){
    const labels={send:"Gửi đơn",quick:"Bán nhanh",update:editingOrderStatus==="delivered"?"Cập nhật đã giao":"Cập nhật đơn"};
    const busyLabels={send:"Đang gửi…",quick:"Đang bán…",update:"Đang cập nhật…"};
    const buttons=[...document.querySelectorAll('#userWorkSendOrder,#mobileUserSendOrder,[data-order-cart-action="clear"],[data-order-cart-action="quick"],[data-order-cart-action="cancel-edit"],[data-order-cart-action="update"]')];
    for(const button of buttons){
      const buttonKind=button.matches('[data-order-cart-action="quick"]')?"quick":button.matches('[data-order-cart-action="update"]')?"update":button.matches('#userWorkSendOrder,#mobileUserSendOrder')?"send":"other";
      const active=Boolean(on&&buttonKind===kind);
      button.disabled=Boolean(on);
      button.setAttribute("aria-busy",active?"true":"false");
      if(buttonKind==="send"){
        const label=button.querySelector("span");
        if(label)label.textContent=active?busyLabels.send:labels.send;
      }else if(buttonKind!=="other")button.textContent=active?busyLabels[buttonKind]:labels[buttonKind];
    }
    if(!on)syncCartActions();
  }

'''
order=replace_once(order,'\n\n  function selectedOrderPayload(){','\n\n'+busy_helper+'  function selectedOrderPayload(){','busy helper')

# Keep customer and Sales context through edit lifecycle.
order=replace_once(order,
'''    editingOrderId=String(order.id);editingOrderStatus=status;
    window.loadUserWorkOrderSelection(order);
    closeManager();syncCartActions();syncCustomerControls();''',
'''    editingOrderId=String(order.id);editingOrderStatus=status;
    window.loadUserWorkOrderSelection(order);
    taphoaWorkView="sales";syncTaphoaWorkspace();syncCartActions();syncCustomerControls();''',
'edit returns sales')
order=replace_once(order,
'''    editingOrderId="";editingOrderStatus="";clearCurrentCart();
    if(currentRole()==="admin")clearSelectedCustomer();
    syncCartActions();syncCustomerControls();setMainStatus("Đã hủy sửa đơn "+label+".");''',
'''    editingOrderId="";editingOrderStatus="";clearCurrentCart();
    taphoaWorkView="sales";syncTaphoaWorkspace();
    syncCartActions();syncCustomerControls();setMainStatus("Đã hủy sửa đơn "+label+".");''',
'cancel keeps customer')

# Update order: keep customer, stay Sales, explicit busy state.
order=replace_once(order,'    busy=true;setMainStatus("Đang cập nhật đơn...");','    busy=true;setSalesBusyState("update",true);setMainStatus("Đang cập nhật đơn...");','update busy start')
order=replace_once(order,
'''      editingOrderId="";editingOrderStatus="";clearCurrentCart();
      if(currentRole()==="admin")clearSelectedCustomer();
      const label=data?.order?.orderNo?"#"+data.order.orderNo:String(id);
      setMainStatus("Đã cập nhật đơn "+label+".");
      expandedOrderId=String(id);activeView="orders";activeStatus=String(data?.order?.status||previousStatus);debtLinkedOrder=null;
      openManager();''',
'''      editingOrderId="";editingOrderStatus="";clearCurrentCart();
      const label=data?.order?.orderNo?"#"+data.order.orderNo:String(id);
      setMainStatus("Đã cập nhật đơn "+label+".");
      expandedOrderId=String(id);activeView="orders";activeStatus=String(data?.order?.status||previousStatus);debtLinkedOrder=null;
      taphoaWorkView="sales";syncTaphoaWorkspace();''',
'update stay sales')
order=replace_once(order,'    finally{busy=false;syncCartActions();syncCustomerControls();}\n  }\n\n  async function submitQuickSale(){','    finally{busy=false;setSalesBusyState("update",false);syncCartActions();syncCustomerControls();}\n  }\n\n  async function submitQuickSale(){','update busy end')

# Quick sale: keep customer, stay Sales.
order=replace_once(order,'    busy=true;setMainStatus("Đang bán nhanh...");','    busy=true;setSalesBusyState("quick",true);setMainStatus("Đang bán nhanh...");','quick busy start')
order=replace_once(order,
'''      clearCurrentCart();
      const label=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");
      clearSelectedCustomer();
      setMainStatus("Đã bán nhanh đơn "+label+" · Đã giao.");
      expandedOrderId="";activeView="orders";activeStatus="delivered";
      openManager();''',
'''      clearCurrentCart();
      const label=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");
      setMainStatus("Đã bán nhanh đơn "+label+" · Đã giao.");
      expandedOrderId="";activeView="orders";activeStatus="delivered";
      taphoaWorkView="sales";syncTaphoaWorkspace();''',
'quick stay sales')
order=replace_once(order,'    }finally{busy=false;syncCartActions();syncCustomerControls();}\n  }\n  async function deleteAllPendingOrders(){','    }finally{busy=false;setSalesBusyState("quick",false);syncCartActions();syncCustomerControls();}\n  }\n  async function deleteAllPendingOrders(){','quick busy end')

# Normal send: keep customer, stay Sales, visible busy state.
order=replace_once(order,'    busy=true;setMainStatus("Đang gửi đơn...");','    busy=true;setSalesBusyState("send",true);setMainStatus("Đang gửi đơn...");','send busy start')
order=replace_once(order,
'''      setMainStatus("Đã gửi đơn "+orderLabel+(customerName?" · "+customerName:"")+" · Đơn tạm.");
      expandedOrderId="";activeView="orders";activeStatus="pending";
      debtCustomerId="";debtDetail=null;
      if(currentRole()==="admin")clearSelectedCustomer();
      openManager();''',
'''      setMainStatus("Đã gửi đơn "+orderLabel+(customerName?" · "+customerName:"")+" · Đơn tạm.");
      expandedOrderId="";activeView="orders";activeStatus="pending";
      debtCustomerId="";debtDetail=null;
      taphoaWorkView="sales";syncTaphoaWorkspace();''',
'send stay sales')
order=replace_once(order,'    }finally{busy=false;}\n  }\n\n  async function performAdminAction','    }finally{busy=false;setSalesBusyState("send",false);}\n  }\n\n  async function performAdminAction','send busy end')

# Replace old click navigation with the single workspace owner.
order=sub_once(
    order,
    r'    const workView=target\.closest\?\.\("\[data-order-work-view\]"\);[\s\S]*?\n    if\(target\.closest\?\.\("#orderManagerButton"\)\)\{if\(await requireChatAuth\(\)\)openManager\(\);return;\}\n    if\(target\.closest\?\.\("#orderManagerClose"\)\)\{closeManager\(\);return;\}\n    if\(target\.id==="orderManager"\)\{closeManager\(\);return;\}',
'''    const workView=target.closest?.("[data-taphoa-work-view]");
    if(workView){
      taphoaWorkView=String(workView.dataset.taphoaWorkView||"sales");
      activeView=taphoaWorkView==="debts"?"debts":"orders";
      sourceDrillSource="";debtLinkedOrder=null;
      if(taphoaWorkView==="debts"&&currentRole()==="user")debtCustomerId=String(currentAccount()?.id||"");
      else if(taphoaWorkView!=="debts")debtCustomerId="";
      debtDetail=null;syncTaphoaWorkspace();syncManagerView();
      if(taphoaWorkView!=="sales"&&await requireChatAuth())await refreshManager();
      return;
    }''',
    'workspace click nav',
    re.M
)
# Remove obsolete inner manager mode click branch.
order=sub_once(order,r'    const mode=target\.closest\?\.\("\[data-manager-view\]"\);\n    if\(mode\)\{[^\n]*\}\n','', 'remove manager mode event')

# Customer picker trigger no longer includes manager duplicate.
order=order.replace('#orderCustomerPickerButton,[data-order-customer-select]','[data-order-customer-select]')

# After global source changes, reconcile Tạp hóa-only nav without intercepting app.js ownership.
order=replace_once(
    order,
    '    const action=target.closest?.("[data-order-action]");if(action)await performOrderAction(String(action.dataset.orderAction||""),String(action.dataset.orderId||""));\n  });',
'''    const action=target.closest?.("[data-order-action]");if(action){await performOrderAction(String(action.dataset.orderAction||""),String(action.dataset.orderId||""));return;}
    if(target.closest?.(".user-work-jump-button,#mobileUserSourceTabs button"))window.setTimeout(()=>{if(!isTaphoaWorkspaceActive())taphoaWorkView="sales";ensureTaphoaWorkspaceNav();syncTaphoaWorkspace();},0);
  });''',
    'global source reconciliation'
)

# Update bootstrap maintenance and add immediate cart-preview contract.
order=replace_once(order,
'  injectUi();\n  emitAccessChange();\n  requestChatAuth();\n  window.setInterval(()=>{ensureWorkManagerNav();ensureInlineCustomerButtons();ensureCartActions();syncCustomerControls();},1500);',
'  injectUi();\n  emitAccessChange();\n  requestChatAuth();\n  document.addEventListener("getlink-cart-change",()=>{ensureSalesContextPanel();renderSalesContext();});\n  window.addEventListener("resize",()=>{ensureTaphoaWorkspaceNav();syncTaphoaWorkspace();});\n  window.setInterval(()=>{ensureTaphoaWorkspaceNav();ensureInlineCustomerButtons();ensureCartActions();syncCustomerControls();syncTaphoaWorkspace();},1500);',
'bootstrap workspace maintenance')

ORDER.write_text(order,encoding="utf-8")

# app.js exposes one small cart-change event; it remains the cart/storage owner.
app=APP.read_text(encoding="utf-8")
app=replace_once(app,
'''  if(send)send.setAttribute("aria-disabled",unavailable?"true":"false");
  if(mobileSend)mobileSend.setAttribute("aria-disabled",unavailable?"true":"false");
}''',
'''  if(send)send.setAttribute("aria-disabled",unavailable?"true":"false");
  if(mobileSend)mobileSend.setAttribute("aria-disabled",unavailable?"true":"false");
  document.dispatchEvent(new CustomEvent("getlink-cart-change",{detail:{count:selected.length}}));
}''',
'cart change event')
APP.write_text(app,encoding="utf-8")

# Convert management to inline and replace obsolete work-nav presentation.
css=CSS.read_text(encoding="utf-8")
css=replace_once(css,
'.order-manager{position:fixed;inset:0;z-index:12000;background:rgba(18,24,33,.28);display:flex;justify-content:flex-end;align-items:stretch}',
'.order-manager{position:relative;inset:auto;z-index:auto;width:100%;min-width:0;background:transparent;display:block}',
'manager inline css')
css=replace_once(css,
'.order-manager-panel{width:min(600px,100%);height:100%;background:#fff;box-shadow:-10px 0 34px rgba(25,33,45,.16);display:flex;flex-direction:column;overflow:hidden}',
'.order-manager-panel{width:100%;height:auto;min-height:0;background:#fff;box-shadow:none;display:flex;flex-direction:column;overflow:visible}',
'manager panel css')
css=replace_once(css,'.order-manager-list{min-height:0;overflow:auto;overscroll-behavior:contain;padding:10px 12px 20px;display:grid;align-content:start;gap:9px;background:#f6f7f9}',
'.order-manager-list{min-height:0;overflow:visible;padding:10px 12px 20px;display:grid;align-content:start;gap:9px;background:#f6f7f9}',
'manager list css')
css=sub_once(css,r'/\* Visible order/debt navigation inside Chat Công việc \*/[\s\S]*?(?=/\* Order list is summary-first; product lines are detail\. \*/)','', 'remove old nav css')
css=css.replace('.order-manager,\n.order-work-nav,\n.order-cart-actions{','.order-manager,\n.taphoa-work-nav,\n.order-cart-actions{')
css=css.replace('.order-work-nav button,','.taphoa-work-nav button,')
css=css.replace('.order-work-nav button,\n.order-cart-actions button,','.taphoa-work-nav button,\n.order-cart-actions button,')
# Add final overrides and new workspace hierarchy.
css+='''\n\n/* TAPHOA fast workspace — UI UX Pro Max + Taste Scan→Diagnose→Fix */
.taphoa-work-nav[hidden]{display:none!important}
.taphoa-work-nav{
  min-height:52px;display:flex;align-items:center;gap:8px;padding:6px 10px;
  border-bottom:1px solid #e8ece9;background:#fff;
}
.taphoa-work-nav button{
  min-width:72px;min-height:var(--order-touch);padding:0 14px;border:1px solid transparent;
  border-radius:9px;background:transparent;color:#596472;font:650 13px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  cursor:pointer;white-space:nowrap;
}
.taphoa-work-nav button:hover{background:#f6f8f7}
.taphoa-work-nav button.active{border-color:#a9d4ba;background:#edf8f2;color:#087a40}
.taphoa-work-nav button:active,.order-card-detail-toggle:active,.debt-customer-card:active{transform:translateY(1px)}
.taphoa-work-nav button:focus-visible,.order-card-detail-toggle:focus-visible,.debt-customer-card:focus-visible{
  outline:2px solid var(--order-focus);outline-offset:2px;
}
.order-manager-head{min-height:54px;padding:10px 12px;border-bottom:1px solid #e8ece9}
.order-manager-head h2{font-size:17px}
.order-manager-body{width:100%}
.order-manager-tool-actions button,.order-manager-tabs button,.order-card-actions button,.order-card-detail-toggle{min-height:var(--order-touch)}
.order-manager-modes,#orderManagerClose,.order-manager-entry{display:none!important}
.order-cart-actions button:disabled,#userWorkSendOrder:disabled,#mobileUserSendOrder:disabled{cursor:progress;opacity:.62}
.order-cart-actions button[aria-busy="true"],#userWorkSendOrder[aria-busy="true"],#mobileUserSendOrder[aria-busy="true"]{min-width:7.5em}
.order-card-head>b,.order-source-grid span:not(:first-child),.debt-customer-card>b,.debt-txn-main>b,.debt-balance-after strong{font-variant-numeric:tabular-nums;text-align:right}

.taphoa-sales-context{
  min-width:0;border:1px solid #e1e6e3;border-radius:11px;background:#fff;overflow:hidden;
}
.taphoa-sales-context-head{padding:11px 12px 9px;border-bottom:1px solid #edf0ee}
.taphoa-sales-context-head strong{display:block;color:#26322c;font-size:13px}
.taphoa-sales-context-head small{display:block;margin-top:2px;color:#7a847f;font-size:11px}
.taphoa-sales-preview{max-height:280px;overflow:auto;padding:6px 10px}
.taphoa-sales-preview-row{min-height:34px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;border-bottom:1px solid #f0f2f1}
.taphoa-sales-preview-row:last-child{border-bottom:0}
.taphoa-sales-preview-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3e4944;font-size:12px}
.taphoa-sales-preview-row small{margin-right:5px;color:#98a19d;font-size:10px}
.taphoa-sales-preview-row strong{font-size:12px;font-variant-numeric:tabular-nums;color:#1f633e}
.taphoa-sales-preview-empty,.taphoa-sales-preview-more{padding:12px 2px;color:#89928e;font-size:11px}
.taphoa-sales-context .user-work-order-foot{margin:0;padding:10px;border-top:1px solid #e8ece9;display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.taphoa-sales-context .user-work-order-foot>#userWorkSelectedCount{width:100%;color:#6d7772;font-size:11px}
.taphoa-sales-context .order-customer-inline{order:2;max-width:none;flex:1 1 100%}
.taphoa-sales-context .order-cart-actions{order:3;display:flex;flex:1 1 auto}
.taphoa-sales-context .user-work-send-order{order:4;min-height:var(--order-touch);flex:1 1 92px}

@media(min-width:1000px){
  .user-work-mine.taphoa-sales-grid{display:grid;grid-template-columns:minmax(0,1fr) 286px;align-items:start;gap:12px;min-width:0}
  .user-work-mine.taphoa-sales-grid>.user-work-section-head{grid-column:1/-1}
  .user-work-mine.taphoa-sales-grid>.user-work-order-wrap{grid-column:1;min-width:0}
  .user-work-mine.taphoa-sales-grid>.taphoa-sales-context{grid-column:2;position:sticky;top:8px}
  .order-lifecycle-list:has(.order-card.expanded){display:grid;grid-template-columns:minmax(300px,.88fr) minmax(360px,1.12fr);align-items:start;gap:8px}
  .order-lifecycle-list:has(.order-card.expanded) .order-card{grid-column:1}
  .order-lifecycle-list:has(.order-card.expanded) .order-card.expanded{grid-column:2;grid-row:1/span 999;position:sticky;top:8px}
}
@media(max-width:999px) and (min-width:640px){
  .taphoa-sales-context{margin-top:10px}
}
@media(max-width:639px){
  .taphoa-work-nav{min-height:48px;padding:4px 8px;gap:6px;position:sticky;top:0;z-index:8}
  .taphoa-work-nav.desktop{display:none!important}
  .taphoa-work-nav.mobile button{min-width:0;flex:1;padding:0 9px;font-size:12px}
  #mobileUserWork[data-taphoa-view="orders"] .mobile-user-search,
  #mobileUserWork[data-taphoa-view="debts"] .mobile-user-search,
  #mobileUserWork[data-taphoa-view="orders"] #mobileUserResults,
  #mobileUserWork[data-taphoa-view="debts"] #mobileUserResults,
  #mobileUserWork[data-taphoa-view="orders"] #mobileUserEmpty,
  #mobileUserWork[data-taphoa-view="debts"] #mobileUserEmpty,
  #mobileUserWork[data-taphoa-view="orders"] .mobile-user-order-bar,
  #mobileUserWork[data-taphoa-view="debts"] .mobile-user-order-bar{display:none!important}
  .order-manager{width:100%;background:#fff}
  .order-manager-panel{width:100%;height:auto;border-radius:0;box-shadow:none;overflow:visible}
  .order-manager-list{padding:8px 8px 18px;overflow:visible}
  .taphoa-sales-context{display:none!important}
}
@media(min-width:640px){.taphoa-work-nav.mobile{display:none!important}}
@media(prefers-reduced-motion:reduce){
  .taphoa-work-nav button,.order-card-detail-toggle,.debt-customer-card{transition:none!important;transform:none!important}
}
'''
CSS.write_text(css,encoding="utf-8")

# Customer picker becomes an independent one-level picker/sheet.
picker=PICKER.read_text(encoding="utf-8")
picker=replace_once(picker,'.order-customer-picker{position:absolute;inset:0;z-index:4;background:#fff;display:flex;flex-direction:column;min-height:0}',
'.order-customer-picker{position:fixed;left:50%;top:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);z-index:13000;width:min(420px,calc(100vw - 24px));height:min(620px,72dvh);border:1px solid #dfe4e1;border-radius:14px;background:#fff;box-shadow:0 18px 48px rgba(25,33,45,.18);display:flex;flex-direction:column;min-height:0}',
'picker independent')
picker+='''\n@media(max-width:639px){\n  .order-customer-picker{left:0;right:0;bottom:0;top:auto;transform:none;width:100%;height:min(72dvh,620px);border-radius:16px 16px 0 0;}\n}\n'''
PICKER.write_text(picker,encoding="utf-8")

# Minimal layout hook; no app rewrite.
style=STYLE.read_text(encoding="utf-8")
style+='''\n\n/* Tạp hóa fast workspace host: keep global source navigation stable while child workspace changes. */\n.user-work-desktop[data-taphoa-view="orders"] .user-work-search,\n.user-work-desktop[data-taphoa-view="debts"] .user-work-search{visibility:hidden;pointer-events:none}\n.user-work-desktop[data-taphoa-view="orders"],\n.user-work-desktop[data-taphoa-view="debts"]{min-width:0}\n'''
STYLE.write_text(style,encoding="utf-8")

print("patched TAPHOA fast workspace")
