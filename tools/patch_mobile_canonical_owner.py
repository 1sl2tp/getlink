from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def read(name): return (ROOT/name).read_text(encoding='utf-8')
def write(name,text): (ROOT/name).write_text(text,encoding='utf-8')
def replace_once(text,old,new,label):
    if old not in text: raise SystemExit(f'missing patch anchor: {label}')
    return text.replace(old,new,1)

# 1) Mobile presentation: native click only, one customer control, one action set.
name='taphoa-mobile-standard.js'
s=read(name)
old='''  function customerMarkup(){\n    return '<section id="'+CUSTOMER_ID+'" class="mobile-standard-customer" aria-label="Khách hàng">'+\n      '<button type="button" class="mobile-standard-customer-search" data-mobile-standard-action="customer-search">Tìm khách: tên / SĐT / mã</button>'+\n      '<button type="button" class="mobile-standard-customer-selected" data-order-customer-select aria-label="Khách đã chọn">Chọn khách</button>'+\n    '</section>';\n  }'''
new='''  function customerMarkup(){\n    return '<section id="'+CUSTOMER_ID+'" class="mobile-standard-customer" aria-label="Khách hàng">'+\n      '<button type="button" class="mobile-standard-customer-selected" data-order-customer-select aria-label="Chọn hoặc đổi khách hàng">Chọn khách</button>'+\n    '</section>';\n  }'''
s=replace_once(s,old,new,'customer markup')

old='''  function cartBarMarkup(){\n    return '<section id="'+CART_BAR_ID+'" class="mobile-standard-cart-bar" aria-label="Giỏ hàng và thao tác bán">'+\n      '<button type="button" class="mobile-standard-cart-open" data-mobile-standard-action="cart">'+\n        '<span>Giỏ <b data-mobile-standard-cart-qty>0</b></span><small data-mobile-standard-cart-money>0</small>'+\n      '</button>'+\n      '<div class="mobile-standard-cart-total" aria-label="Tổng số lượng"><small>SL</small><strong data-mobile-standard-total-qty>0</strong></div>'+\n      '<button type="button" class="mobile-standard-place" data-mobile-standard-action="place">Đặt</button>'+\n      '<button type="button" class="mobile-standard-sell" data-mobile-standard-action="sell">Bán</button>'+\n    '</section>';\n  }'''
new='''  function cartBarMarkup(){\n    return '<section id="'+CART_BAR_ID+'" class="mobile-standard-cart-bar" aria-label="Giỏ hàng và thao tác bán">'+\n      '<button type="button" class="mobile-standard-cart-open" data-mobile-standard-action="cart">'+\n        '<span>Giỏ <b data-mobile-standard-cart-lines>0</b></span><small><b data-mobile-standard-cart-qty>0</b> SP · <b data-mobile-standard-cart-money>0</b></small>'+\n      '</button>'+\n      '<button type="button" class="mobile-standard-place" data-mobile-standard-action="place">Đặt</button>'+\n      '<button type="button" class="mobile-standard-sell" data-mobile-standard-action="sell">Bán</button>'+\n    '</section>';\n  }'''
s=replace_once(s,old,new,'cart bar')

old='''        '<footer class="mobile-standard-cart-actions">'+\n          '<button type="button" data-mobile-standard-action="clear">Xóa</button>'+\n          '<button type="button" data-mobile-standard-action="place">Đặt</button>'+\n          '<button type="button" class="primary" data-mobile-standard-action="sell">Bán</button>'+\n        '</footer>'+'''
new='''        '<footer class="mobile-standard-cart-actions">'+\n          '<button type="button" data-mobile-standard-action="clear">Xóa giỏ</button>'+\n          '<button type="button" class="primary" data-mobile-standard-action="close">Đóng</button>'+\n        '</footer>'+'''
s=replace_once(s,old,new,'cart sheet actions')

old='''    const search=document.querySelector("#"+CUSTOMER_ID+" [data-mobile-standard-action=\\"customer-search\\"]");\n    if(!standard)return;'''
s=replace_once(s,old,'''    if(!standard)return;''','customer sync search var')
s=s.replace('''    if(search)search.hidden=standard.hidden;\n''','',1)

# Include cart line count in the single cart button.
old='''    const qty=bar.querySelector("[data-mobile-standard-cart-qty]");\n    const totalQty=bar.querySelector("[data-mobile-standard-total-qty]");\n    const amount=bar.querySelector("[data-mobile-standard-cart-money]");\n    if(qty)qty.textContent=String(sum.qty);\n    if(totalQty)totalQty.textContent=String(sum.qty);'''
new='''    const lines=bar.querySelector("[data-mobile-standard-cart-lines]");\n    const qty=bar.querySelector("[data-mobile-standard-cart-qty]");\n    const amount=bar.querySelector("[data-mobile-standard-cart-money]");\n    if(lines)lines.textContent=String(sum.lines);\n    if(qty)qty.textContent=String(sum.qty);'''
s=replace_once(s,old,new,'cart summary')

# Remove the iOS capture-phase synthetic-click shim. Native semantic buttons + one delegated owner only.
pattern=r'''\n  const IFRAME_TAP_SELECTOR=.*?\n  document\.addEventListener\("click",event=>\{\n    const action=event\.target\.closest\?\.\("\[data-mobile-standard-action\]"\);'''
m=re.search(pattern,s,re.S)
if not m: raise SystemExit('missing synthetic pointer fallback block')
s=s[:m.start()]+'''\n  document.addEventListener("click",event=>{\n    const action=event.target.closest?.("[data-mobile-standard-action]");'''+s[m.end():]

# Remove obsolete customer-search relay; the visible button itself has data-order-customer-select.
s=re.sub(r'''\n      if\(name==="customer-search"\)\{.*?\n        return;\n      \}''','',s,count=1,flags=re.S)
write(name,s)

# 2) Order/debt owner: four-item mobile nav, contextual destructive mode, denser canonical rows.
name='order-management.js'
s=read(name)
s=replace_once(s,'let pickerBusy=false;','let pickerBusy=false;\n  let orderSelectMode=false;','select mode state')

old='''  function taphoaWorkspaceNavMarkup(kind){\n    return '<nav class="taphoa-work-nav '+kind+'" aria-label="Tạp hóa">'+\n      '<button type="button" data-taphoa-work-view="sales">Bán</button>'+\n      '<button type="button" data-taphoa-work-view="orders">Đơn</button>'+\n      '<button type="button" data-taphoa-work-view="debts">Công nợ</button>'+\n    '</nav>';\n  }'''
new='''  function taphoaWorkspaceNavMarkup(kind){\n    return '<nav class="taphoa-work-nav '+kind+'" aria-label="Tạp hóa">'+\n      '<button type="button" data-taphoa-work-view="sales">Bán</button>'+\n      '<button type="button" data-taphoa-work-view="orders">Đơn</button>'+\n      '<button type="button" data-taphoa-work-view="debts">Công nợ</button>'+\n      (kind==="mobile"?'<button type="button" data-taphoa-work-view="more">Khác</button>':'')+\n    '</nav>';\n  }'''
s=replace_once(s,old,new,'four-item nav')

# Add an explicit select-mode entry before destructive batch actions.
old='''                <button id="debtBackButton" type="button" hidden>Khách hàng</button>\n                <button id="orderDeleteAllPendingButton" type="button" data-order-batch="delete-pending" hidden>Xóa tất cả</button>'''
new='''                <button id="debtBackButton" type="button" hidden>Khách hàng</button>\n                <button id="orderSelectModeButton" type="button" data-order-select-mode hidden>Chọn</button>\n                <button id="orderDeleteAllPendingButton" type="button" data-order-batch="delete-pending" hidden>Xóa tất cả</button>'''
s=replace_once(s,old,new,'select mode button')

old='''  function syncBatchControls(filtered=null){\n    const pendingButton=document.getElementById("orderDeleteAllPendingButton");\n    const deliveredButton=document.getElementById("orderReturnAllDeliveredButton");\n    const pendingCount=orders.filter(order=>order.status==="pending").length;\n    const filteredRows=Array.isArray(filtered)?filtered:filterOrdersForReport(orders);\n    const deliveredCount=filteredRows.filter(order=>order.status==="delivered").length;\n    if(pendingButton)pendingButton.hidden=activeView!=="orders"||activeStatus!=="pending"||pendingCount===0;\n    if(deliveredButton)deliveredButton.hidden=activeView!=="orders"||activeStatus!=="delivered"||currentRole()!=="admin"||deliveredCount===0;\n  }'''
new='''  function syncBatchControls(filtered=null){\n    const selectButton=document.getElementById("orderSelectModeButton");\n    const pendingButton=document.getElementById("orderDeleteAllPendingButton");\n    const deliveredButton=document.getElementById("orderReturnAllDeliveredButton");\n    const pendingCount=orders.filter(order=>order.status==="pending").length;\n    const filteredRows=Array.isArray(filtered)?filtered:filterOrdersForReport(orders);\n    const deliveredCount=filteredRows.filter(order=>order.status==="delivered").length;\n    const selectable=activeView==="orders"&&((activeStatus==="pending"&&pendingCount>0)||(activeStatus==="delivered"&&currentRole()==="admin"&&deliveredCount>0));\n    if(selectButton){selectButton.hidden=!selectable;selectButton.textContent=orderSelectMode?"Xong":"Chọn";}\n    if(pendingButton)pendingButton.hidden=activeView!=="orders"||activeStatus!=="pending"||pendingCount===0||!orderSelectMode;\n    if(deliveredButton)deliveredButton.hidden=activeView!=="orders"||activeStatus!=="delivered"||currentRole()!=="admin"||deliveredCount===0||!orderSelectMode;\n  }'''
s=replace_once(s,old,new,'batch controls')

# Explicit select-mode toggle owns visibility of destructive actions.
old='''    const cartAction=target.closest?.("[data-order-cart-action]");\n    if(cartAction){const action=String(cartAction.dataset.orderCartAction||"");if(action==="clear")clearCurrentCart();else if(action==="quick")await submitQuickSale();else if(action==="cancel-edit")cancelEditOrder();else if(action==="update")await updateEditingOrder();return;}\n    const batch=target.closest?.("[data-order-batch]");'''
new='''    const cartAction=target.closest?.("[data-order-cart-action]");\n    if(cartAction){const action=String(cartAction.dataset.orderCartAction||"");if(action==="clear")clearCurrentCart();else if(action==="quick")await submitQuickSale();else if(action==="cancel-edit")cancelEditOrder();else if(action==="update")await updateEditingOrder();return;}\n    if(target.closest?.("[data-order-select-mode]")){orderSelectMode=!orderSelectMode;syncBatchControls();return;}\n    const batch=target.closest?.("[data-order-batch]");'''
s=replace_once(s,old,new,'batch toggle handler')

# Reset selection mode when status changes.
s=replace_once(s,'const tab=target.closest?.("[data-order-status]");if(tab){expandedOrderId="";sourceDrillSource="";setActiveOrderStatus(String(tab.dataset.orderStatus||"pending"));renderOrders();return;}',
'''const tab=target.closest?.("[data-order-status]");if(tab){orderSelectMode=false;expandedOrderId="";sourceDrillSource="";setActiveOrderStatus(String(tab.dataset.orderStatus||"pending"));renderOrders();return;}''','status select reset')

# More is a real mobile destination. Keep it lightweight and route only through existing safe actions.
insert='''\n  function ensureMobileMorePanel(){\n    const host=document.getElementById("mobileUserWork");\n    if(!host||document.getElementById("taphoaMobileMore"))return;\n    host.insertAdjacentHTML("beforeend",'<section id="taphoaMobileMore" class="taphoa-mobile-more" hidden aria-label="Khác"><header><strong>Khác</strong><small>Tiện ích Tạp hóa</small></header><div class="taphoa-mobile-more-grid"><button type="button" data-mobile-more-action="customer">Khách hàng</button><button type="button" data-mobile-more-action="products">Sản phẩm</button><button type="button" data-mobile-more-action="orders">Đơn hàng</button><button type="button" data-mobile-more-action="settings">Cài đặt cập nhật</button></div></section>');\n  }\n'''
anchor='''  function syncTaphoaWorkspace(){'''
if anchor not in s: raise SystemExit('missing more panel anchor')
s=s.replace(anchor,insert+'\n'+anchor,1)

# Show/hide More independently; do not feed it to order renderer.
s=replace_once(s,'const sales=taphoaWorkView==="sales";','const sales=taphoaWorkView==="sales";\n    const more=taphoaWorkView==="more";','more state')
s=replace_once(s,'const manager=document.getElementById("orderManager");\n    const host=activeTaphoaWorkspaceHost();',
'''ensureMobileMorePanel();\n    const morePanel=document.getElementById("taphoaMobileMore");\n    if(morePanel)morePanel.hidden=!(active&&mobile&&more);\n    const manager=document.getElementById("orderManager");\n    const host=activeTaphoaWorkspaceHost();''','more panel sync')
s=replace_once(s,'manager.hidden=!(active&&!sales);','manager.hidden=!(active&&!sales&&!more);','manager hidden more')
s=replace_once(s,'if(title)title.textContent=taphoaWorkView==="debts"?"Công nợ":"Đơn hàng";',
'''if(title)title.textContent=taphoaWorkView==="debts"?"Công nợ":"Đơn hàng";''','title keep')

# Work-view handler: More does not refresh order/debt data.
old='''      debtDetail=null;syncTaphoaWorkspace();syncManagerView();\n      if(taphoaWorkView!=="sales"&&await requireChatAuth())await refreshManager();\n      return;'''
new='''      debtDetail=null;syncTaphoaWorkspace();syncManagerView();\n      if(taphoaWorkView!=="sales"&&taphoaWorkView!=="more"&&await requireChatAuth())await refreshManager();\n      return;'''
s=replace_once(s,old,new,'more work view refresh')

# More panel uses existing native owners; no synthetic pointer bridge.
old='''    if(target.closest?.("#orderCustomerPickerClose")){closeCustomerPicker();return;}'''
new='''    const moreAction=target.closest?.("[data-mobile-more-action]");\n    if(moreAction){\n      const action=String(moreAction.dataset.mobileMoreAction||"");\n      if(action==="customer"){await openCustomerPicker();return;}\n      if(action==="products"){taphoaWorkView="sales";syncTaphoaWorkspace();return;}\n      if(action==="orders"){taphoaWorkView="orders";activeView="orders";syncTaphoaWorkspace();syncManagerView();if(await requireChatAuth())await refreshManager();return;}\n      if(action==="settings"){document.getElementById("openUpdateSettings")?.click();return;}\n    }\n    if(target.closest?.("#orderCustomerPickerClose")){closeCustomerPicker();return;}'''
s=replace_once(s,old,new,'more actions')

# Cap mobile/order DOM to 40 rows; summary still reports the full filtered count.
old='''    const visible=sortOrdersNewestFirst(filterOrdersForReport(orders)),statusCount=orders.filter(order=>order.status===activeStatus).length;'''
new='''    const visibleAll=sortOrdersNewestFirst(filterOrdersForReport(orders)),visible=window.matchMedia("(max-width:639px)").matches?visibleAll.slice(0,40):visibleAll,statusCount=orders.filter(order=>order.status===activeStatus).length;'''
s=replace_once(s,old,new,'order cap')
s=replace_once(s,'if(summary)summary.textContent=(STATUS_LABELS[activeStatus]||activeStatus)+" · "+visible.length+(visible.length!==statusCount?" / "+statusCount:"")+" đơn";',
'''if(summary)summary.textContent=(STATUS_LABELS[activeStatus]||activeStatus)+" · "+visibleAll.length+(visibleAll.length!==statusCount?" / "+statusCount:"")+" đơn";''','order summary count')

# Debt list: STT + last transaction + age + balance, whole row remains the action target.
insert='''  function debtAgeDays(value){\n    const at=Date.parse(value||0);\n    if(!at)return "";\n    return Math.max(0,Math.floor((Date.now()-at)/86400000));\n  }\n'''
anchor='''  function debtEventSign(row){return row.direction==="decrease"?"−":"+"}\n'''
if anchor not in s: raise SystemExit('missing debt helper anchor')
s=s.replace(anchor,anchor+insert,1)
old='''    list.innerHTML=recent.map(row=>`\n      <button type="button" class="debt-customer-card" data-debt-customer-id="${escapeHtml(row.customerId)}">\n        <span><strong>${escapeHtml(row.customerName||row.username||"Khách hàng")}</strong><small>${row.username?"@"+escapeHtml(row.username):""}${row.lastOccurredAt?" · "+escapeHtml(dateTime(row.lastOccurredAt)):""}</small></span>\n        <b>${escapeHtml(compactMoney(row.balanceVnd))}</b>\n      </button>`).join("");'''
new='''    list.innerHTML=recent.map((row,index)=>{\n      const days=debtAgeDays(row.lastOccurredAt);\n      return `\n      <button type="button" class="debt-customer-card" data-debt-customer-id="${escapeHtml(row.customerId)}">\n        <span class="debt-customer-stt">${index+1}</span>\n        <span class="debt-customer-copy"><strong>${escapeHtml(row.customerName||row.username||"Khách hàng")}</strong><small>${row.lastOccurredAt?"GD "+escapeHtml(dateTime(row.lastOccurredAt)):"Chưa có giao dịch"}${days!==""?" · "+days+" ngày":""}</small></span>\n        <b>${escapeHtml(compactMoney(row.balanceVnd))}</b>\n      </button>`;\n    }).join("");'''
s=replace_once(s,old,new,'debt summary row')
write(name,s)

# 3) CSS: canonical geometry, one scroll owner, 44px targets, 16px form inputs.
name='taphoa-mobile-standard.css'
s=read(name)
# Remove obsolete two-column customer geometry and obsolete cart total geometry by authoritative final override.
append=r'''

/* CANONICAL_MOBILE_OWNER_20260914: final mobile geometry/interaction contract. */
@media(max-width:639px){
  .mobile-standard-customer:not([hidden]){
    display:block!important;
    padding:8px 8px 0!important;
  }
  .mobile-standard-customer-selected{
    display:block!important;width:100%!important;max-width:none!important;min-height:44px!important;
    padding:0 12px!important;text-align:left!important;font-size:16px!important;font-weight:650!important;
  }
  #mobileUserSearch,
  #orderCustomerSearch,
  .order-report-search input,
  .mobile-standard-debt-search input{font-size:16px!important}

  .mobile-user-mine-card .mobile-user-qty{min-height:44px!important;height:44px!important;grid-template-columns:44px auto 44px!important}
  .mobile-user-mine-card .mobile-user-qty button{width:44px!important;height:44px!important;min-height:44px!important}
  .mobile-user-mine-card:not(.is-selected) .mobile-user-qty{grid-template-columns:44px!important;min-width:44px!important}

  .mobile-standard-cart-bar:not([hidden]){
    grid-template-columns:minmax(0,1.55fr) minmax(72px,.72fr) minmax(72px,.78fr)!important;
    gap:6px!important;padding:7px 8px!important;
  }
  .mobile-standard-cart-bar button{min-height:48px!important}
  .mobile-standard-cart-open small{display:flex;align-items:center;gap:3px;font-size:11px!important}
  .mobile-standard-cart-open small b{font-weight:700;color:#34404d}
  .mobile-standard-cart-actions{grid-template-columns:1fr 1fr!important}
  .mobile-standard-cart-actions button{min-height:44px!important}

  .taphoa-work-nav.mobile{grid-template-columns:repeat(4,minmax(0,1fr))!important;display:grid!important}
  .taphoa-work-nav.mobile button{min-height:48px!important;height:48px!important}

  .order-manager-tabs button,
  .order-report-time,
  .mobile-standard-debt-search button,
  #orderSelectModeButton,
  .order-manager-tool-actions button{min-height:44px!important}

  .debt-customer-card{
    display:grid!important;grid-template-columns:28px minmax(0,1fr) auto!important;align-items:center!important;gap:8px!important;
    min-height:58px!important;text-align:left!important;
  }
  .debt-customer-stt{font-size:11px;color:#7a8490;text-align:center;font-variant-numeric:tabular-nums}
  .debt-customer-copy{min-width:0;display:grid;gap:2px}
  .debt-customer-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  .taphoa-mobile-more:not([hidden]){display:flex;flex:1 1 0;min-height:0;flex-direction:column;background:#fff;overflow:auto;-webkit-overflow-scrolling:touch}
  .taphoa-mobile-more header{padding:12px;border-bottom:1px solid #e4e8eb;display:grid;gap:2px}
  .taphoa-mobile-more header strong{font-size:18px}.taphoa-mobile-more header small{font-size:12px;color:#75808d}
  .taphoa-mobile-more-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:10px}
  .taphoa-mobile-more-grid button{min-height:52px;border:1px solid #dce2e7;border-radius:9px;background:#fff;font-size:14px;font-weight:650;color:#34404d}

  #mobileUserResults,
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-list,
  #mobileUserWork[data-taphoa-view="debts"] .order-manager-list,
  .taphoa-mobile-more:not([hidden]){
    overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior-y:contain!important;
    -webkit-overflow-scrolling:touch;touch-action:pan-y!important;
  }

  /* While typing, give the result list the viewport. */
  #mobileUserWork:focus-within .taphoa-work-nav.mobile,
  #mobileUserWork:focus-within #mobileStandardCartBar{display:none!important}
}

@media(max-width:360px){
  .mobile-standard-cart-bar:not([hidden]){grid-template-columns:minmax(0,1.35fr) minmax(62px,.7fr) minmax(62px,.75fr)!important}
}
'''
if 'CANONICAL_MOBILE_OWNER_20260914' not in s:s+=append
write(name,s)

print('canonical mobile owner patch applied')
