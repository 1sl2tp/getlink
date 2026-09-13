from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ORDER=ROOT/'order-management.js'
STYLE=ROOT/'style.css'

text=ORDER.read_text(encoding='utf-8')

def replace_once(old,new,label):
    global text
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    text=text.replace(old,new,1)

replace_once(
'  let bridgeSeq=0;\n',
'  let bridgeSeq=0;\n  let chatWorkContext=null;\n  let pendingChatWorkContext=null;\n',
'context state',
)

replace_once(
'  function selectedCustomer(){return customers.find(row=>String(row.id)===String(selectedCustomerId))||null}\n',
'''  function selectedCustomer(){return customers.find(row=>String(row.id)===String(selectedCustomerId))||null}\n  function normalizeChatWorkContext(message){\n    if(!message||message.type!=="taphoa-chat-work-context")return null;\n    const contactId=String(message.contactId||"").trim();\n    if(!contactId)return null;\n    const sourceMessageIds=Array.from(new Set(\n      (Array.isArray(message.sourceMessageIds)?message.sourceMessageIds:[])\n        .map(value=>String(value||"").trim())\n        .filter(Boolean)\n    )).slice(0,100);\n    return {\n      contactId,\n      customerName:String(message.customerName||"").trim(),\n      sourceMessageIds,\n      preset:String(message.preset||"today").trim()||"today",\n      from:String(message.from||"").trim(),\n      to:String(message.to||"").trim(),\n    };\n  }\n  function currentSelectedCart(){\n    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];\n    return Array.isArray(selected)?selected:[];\n  }\n  function applyChatWorkContext(context){\n    if(!context?.contactId)return "ignored";\n    const cart=currentSelectedCart();\n    const changingCustomer=selectedCustomerId&&String(selectedCustomerId)!==String(context.contactId);\n    if(changingCustomer&&cart.length){\n      pendingChatWorkContext=context;\n      setMainStatus("Không đổi khách vì đơn đang có hàng. Gửi/xóa đơn hiện tại rồi chuyển khách.");\n      renderChatWorkContext();\n      return "deferred";\n    }\n    chatWorkContext=context;\n    pendingChatWorkContext=null;\n    if(currentRole()==="admin"){\n      selectedCustomerId=context.contactId;\n      sessionStorage.setItem(SELECTED_CUSTOMER_KEY,selectedCustomerId);\n      syncCustomerControls();\n    }\n    renderChatWorkContext();\n    return "applied";\n  }\n  function applyPendingChatWorkContextIfSafe(){\n    if(!pendingChatWorkContext||currentSelectedCart().length)return false;\n    const next=pendingChatWorkContext;\n    pendingChatWorkContext=null;\n    return applyChatWorkContext(next)==="applied";\n  }\n  function notifyChatOrderCreated({orderId="",orderNo="",contactId=""}={}){\n    if(!isEmbeddedInChat()||!chatWorkContext)return false;\n    const targetContact=String(contactId||"").trim();\n    if(!targetContact||String(chatWorkContext.contactId)!==targetContact)return false;\n    if(!chatWorkContext.sourceMessageIds.length)return false;\n    window.parent.postMessage({\n      type:"taphoa-work-order-created",\n      contactId:targetContact,\n      sourceMessageIds:[...chatWorkContext.sourceMessageIds],\n      orderId:String(orderId||""),\n      orderNo:String(orderNo||""),\n    },CHAT_ORIGIN);\n    return true;\n  }\n''',
'context helpers',
)

replace_once(
'''  window.addEventListener("message",event=>{\n    if(event.origin!==CHAT_ORIGIN)return;\n    const message=event.data;\n    if(!message||message.type!=="taphoa-chat-auth")return;\n    void acceptChatBridge(message);\n  });\n''',
'''  window.addEventListener("message",event=>{\n    if(event.origin!==CHAT_ORIGIN)return;\n    const message=event.data;\n    if(message?.type==="taphoa-chat-auth"){\n      void acceptChatBridge(message);\n      return;\n    }\n    if(message?.type==="taphoa-chat-work-context"){\n      const context=normalizeChatWorkContext(message);\n      if(context)applyChatWorkContext(context);\n    }\n  });\n''',
'message listener',
)

replace_once(
'  function renderSalesContext(){\n',
'''  function renderChatWorkContext(){\n    const host=document.getElementById("taphoaChatOrderContext");\n    if(!host)return;\n    const context=pendingChatWorkContext||chatWorkContext;\n    if(!context){host.hidden=true;host.textContent="";return;}\n    host.hidden=false;\n    const waiting=Boolean(pendingChatWorkContext);\n    host.textContent=(waiting?"Đang chờ chuyển sang · ":"Nguồn Chat · ")+(context.customerName||"Khách hàng");\n    host.dataset.state=waiting?"deferred":"applied";\n  }\n  function renderSalesContext(){\n''',
'context renderer',
)

replace_once(
'''      panel.innerHTML='<div class="taphoa-sales-context-head"><strong>Xem đơn nhanh</strong><small>Khách · hàng đã chọn · thao tác</small></div><div id="taphoaSalesPreview" class="taphoa-sales-preview"></div>';\n''',
'''      panel.innerHTML='<div class="taphoa-sales-context-head"><strong>Xem đơn nhanh</strong><small>Khách · hàng đã chọn · thao tác</small></div><div id="taphoaChatOrderContext" class="taphoa-chat-order-context" hidden></div><div id="taphoaSalesPreview" class="taphoa-sales-preview"></div>';\n''',
'context host',
)

replace_once(
'''    panel.classList.toggle("has-items",selected.length>0);\n  }\n''',
'''    panel.classList.toggle("has-items",selected.length>0);\n    renderChatWorkContext();\n  }\n''',
'render context hook',
)

replace_once(
'''  function clearCurrentCart(){\n    if(typeof window.clearUserWorkOrderSelection==="function")window.clearUserWorkOrderSelection();\n    afterCartMutation();\n  }\n''',
'''  function clearCurrentCart(){\n    if(typeof window.clearUserWorkOrderSelection==="function")window.clearUserWorkOrderSelection();\n    applyPendingChatWorkContextIfSafe();\n    afterCartMutation();\n  }\n''',
'clear cart hook',
)

old_submit='''  async function submitSelectedOrder(){\n    if(busy)return;\n    if(!(await requireChatAuth()))return;\n    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];\n    if(!Array.isArray(selected)||selected.length===0){setMainStatus("Chưa chọn sản phẩm.");return;}\n    const items=selected.map(item=>({url:item.row.canonical_url,qty:item.qty}));\n    let body;\n    if(currentRole()==="admin"){\n      if(!selectedCustomerId){\n        setMainStatus("Chưa chọn khách hàng.");\n        await openCustomerPicker();\n        return;\n      }\n      const customerId=selectedCustomerId;\n      body=JSON.stringify({items,customerId});\n    }else body=JSON.stringify({items});\n\n    busy=true;setSalesBusyState("send",true);setMainStatus("Đang gửi đơn...");\n    try{\n      const data=await orderFetch("/orders",{method:"POST",body});\n      if(typeof window.clearUserWorkOrderSelection==="function"){\n        window.clearUserWorkOrderSelection();\n      }\n      const customerName=currentRole()==="admin"?(selectedCustomer()?.name||""):"";\n      const orderLabel=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");\n      setMainStatus("Đã gửi đơn "+orderLabel+(customerName?" · "+customerName:"")+" · Đơn tạm.");\n      expandedOrderId="";activeView="orders";setActiveOrderStatus("pending");\n      debtCustomerId="";debtDetail=null;\n      taphoaWorkView="sales";syncTaphoaWorkspace();\n    }catch(error){\n      handleAuthError(error);\n      setMainStatus(String(error?.message||error));\n    }finally{busy=false;setSalesBusyState("send",false);}\n  }\n'''
new_submit='''  async function submitSelectedOrder(){\n    if(busy)return;\n    if(!(await requireChatAuth()))return;\n    const selected=typeof window.userWorkSelectedItems==="function"?window.userWorkSelectedItems():[];\n    if(!Array.isArray(selected)||selected.length===0){setMainStatus("Chưa chọn sản phẩm.");return;}\n    const items=selected.map(item=>({url:item.row.canonical_url,qty:item.qty}));\n    const submittedCustomerId=currentRole()==="admin"\n      ?String(selectedCustomerId||"").trim()\n      :String(currentAccount()?.id||"").trim();\n    let body;\n    if(currentRole()==="admin"){\n      if(!submittedCustomerId){\n        setMainStatus("Chưa chọn khách hàng.");\n        await openCustomerPicker();\n        return;\n      }\n      body=JSON.stringify({items,customerId:submittedCustomerId});\n    }else body=JSON.stringify({items});\n\n    busy=true;setSalesBusyState("send",true);setMainStatus("Đang gửi đơn...");\n    try{\n      const data=await orderFetch("/orders",{method:"POST",body});\n      const notified=notifyChatOrderCreated({\n        orderId:String(data?.order?.id||""),\n        orderNo:String(data?.order?.orderNo||""),\n        contactId:submittedCustomerId,\n      });\n      if(notified)chatWorkContext=null;\n      if(typeof window.clearUserWorkOrderSelection==="function"){\n        window.clearUserWorkOrderSelection();\n      }\n      applyPendingChatWorkContextIfSafe();\n      const customerName=currentRole()==="admin"?(selectedCustomer()?.name||""):"";\n      const orderLabel=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");\n      setMainStatus("Đã gửi đơn "+orderLabel+(customerName?" · "+customerName:"")+" · Đơn tạm.");\n      expandedOrderId="";activeView="orders";setActiveOrderStatus("pending");\n      debtCustomerId="";debtDetail=null;\n      taphoaWorkView="sales";syncTaphoaWorkspace();\n    }catch(error){\n      handleAuthError(error);\n      setMainStatus(String(error?.message||error));\n    }finally{busy=false;setSalesBusyState("send",false);}\n  }\n'''
replace_once(old_submit,new_submit,'submitSelectedOrder')

ORDER.write_text(text,encoding='utf-8')

style=STYLE.read_text(encoding='utf-8')
marker='\n.taphoa-chat-order-context{display:flex;min-width:0;max-width:100%;align-items:center;gap:6px;padding:7px 9px;border:1px solid var(--line,#dfe5e2);border-radius:10px;background:#f7faf8;font-size:12px;line-height:1.25;overflow-wrap:anywhere}\n.taphoa-chat-order-context[data-state="deferred"]{font-style:italic}\n'
if '.taphoa-chat-order-context{' not in style:
    style+=marker
STYLE.write_text(style,encoding='utf-8')

print('chat order source handoff patch applied')
