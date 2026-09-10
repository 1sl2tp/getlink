from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.js"
ORDER = ROOT / "order-management.js"

app = APP.read_text(encoding="utf-8")
legacy = '''    const send=e.target.closest("#userWorkSendOrder,#mobileUserSendOrder");
    if(send&&!send.disabled){
      saveUserWorkOrderDraft();
      return;
    }

'''
if legacy in app:
    app = app.replace(legacy, "", 1)
else:
    assert 'saveUserWorkOrderDraft();' not in app[app.index('const userWorkHome=$("#userWorkHome")'):], "legacy send owner changed"
APP.write_text(app, encoding="utf-8")

order = ORDER.read_text(encoding="utf-8")
old = '''      const data=await orderFetch("/orders",{method:"POST",body});
      localStorage.removeItem(QTY_KEY);
      if(typeof window.renderUserWorkHome==="function")window.renderUserWorkHome();
      if(typeof window.updateUserWorkOrderSummary==="function")window.updateUserWorkOrderSummary();
      const customerName=currentRole()==="admin"?(selectedCustomer()?.name||""):"";
      const orderLabel=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");
      setMainStatus("Đã gửi đơn "+orderLabel+(customerName?" · "+customerName:"")+" · Đơn tạm.");
      activeView="orders";activeStatus="pending";
      if(currentRole()==="admin")clearSelectedCustomer();
      if(!document.getElementById("orderManager")?.hidden)await refreshManager();
'''
new = '''      const data=await orderFetch("/orders",{method:"POST",body});
      localStorage.removeItem(QTY_KEY);
      if(typeof window.renderUserWorkHome==="function")window.renderUserWorkHome();
      if(typeof window.updateUserWorkOrderSummary==="function")window.updateUserWorkOrderSummary();
      const customerName=currentRole()==="admin"?(selectedCustomer()?.name||""):"";
      const orderLabel=data?.order?.orderNo?"#"+data.order.orderNo:String(data?.order?.id||"");
      setMainStatus("Đã gửi đơn "+orderLabel+(customerName?" · "+customerName:"")+" · Đơn tạm.");
      activeView="orders";activeStatus="pending";
      debtCustomerId="";debtDetail=null;
      if(currentRole()==="admin")clearSelectedCustomer();
      openManager();
'''
if old in order:
    order = order.replace(old, new, 1)
else:
    assert new in order, "submit success block changed"
ORDER.write_text(order, encoding="utf-8")

print("Applied single-owner Gửi đơn and immediate pending-order open")
