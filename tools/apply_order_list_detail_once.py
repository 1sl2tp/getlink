from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "order-management.js"
CSS = ROOT / "order-management.css"

js = JS.read_text(encoding="utf-8")

anchor = '  let activeStatus="pending";\n'
if '  let expandedOrderId="";\n' not in js:
    assert anchor in js, 'activeStatus anchor changed'
    js = js.replace(anchor, anchor + '  let expandedOrderId="";\n', 1)

pattern = re.compile(r'  function renderOrders\(\)\{[\s\S]*?\n  \}\n\n  async function loadDebtSummaries')
match = pattern.search(js)
assert match, 'renderOrders block changed'
new_render = '''  function renderOrders(){
    renderTabs();
    const visible=orders.filter(order=>order.status===activeStatus);
    const list=document.getElementById("orderManagerList");
    const empty=document.getElementById("orderManagerEmpty");
    const summary=document.getElementById("orderManagerSummary");
    if(summary)summary.textContent=(STATUS_LABELS[activeStatus]||activeStatus)+" · "+visible.length+" đơn";
    if(empty){empty.hidden=visible.length!==0;empty.textContent="Chưa có đơn ở trạng thái này.";}
    if(!list)return;
    list.innerHTML=visible.map(order=>{
      const items=Array.isArray(order.items)?order.items:[];
      const id=String(order.id||"");
      const expanded=expandedOrderId===String(order.id);
      const secondary=currentRole()==="admin"
        ?String(order.customerName||"Khách hàng")+" · "+dateTime(order.orderedAt)
        :dateTime(order.orderedAt);
      return `<article class="order-card ${expanded?"expanded":""}" data-order-id="${escapeHtml(order.id)}">
        <div class="order-card-head">
          <div><strong>${escapeHtml(orderRef(order))}</strong><small>${escapeHtml(secondary)} · ${items.length+" dòng"}</small></div>
          <b>${escapeHtml(moneyVnd(order.total))}</b>
        </div>
        <button type="button" class="order-card-detail-toggle" data-order-detail data-order-id="${escapeHtml(id)}">${expanded?"Thu gọn":"Xem đơn"}</button>
        ${expanded?`<div class="order-card-items">${items.map(item=>`<div><span>${escapeHtml(item.name)}</span><small>${Number(item.qty||0)} × ${escapeHtml(moneyVnd(item.price))}</small></div>`).join("")}</div>`:""}
        ${orderActions(order)}
      </article>`;
    }).join("");
  }

  async function loadDebtSummaries'''
js = js[:match.start()] + new_render + js[match.end():]

old_submit = '      activeView="orders";activeStatus="pending";\n'
new_submit = '      expandedOrderId="";activeView="orders";activeStatus="pending";\n'
assert old_submit in js, 'submit pending anchor changed'
js = js.replace(old_submit, new_submit, 1)

old_click = '''    const tab=target.closest?.("[data-order-status]");
    if(tab){activeStatus=String(tab.dataset.orderStatus||"pending");renderOrders();return;}
    const action=target.closest?.("[data-order-action]");
'''
new_click = '''    const tab=target.closest?.("[data-order-status]");
    if(tab){expandedOrderId="";activeStatus=String(tab.dataset.orderStatus||"pending");renderOrders();return;}
    const detail=target.closest?.("[data-order-detail]");
    if(detail){
      const id=String(detail.dataset.orderId||"");
      expandedOrderId=expandedOrderId===id?"":id;
      renderOrders();
      return;
    }
    const action=target.closest?.("[data-order-action]");
'''
assert old_click in js, 'order click anchor changed'
js = js.replace(old_click, new_click, 1)

JS.write_text(js, encoding="utf-8")

css = CSS.read_text(encoding="utf-8")
marker = '/* Order list is summary-first; product lines are detail. */'
if marker not in css:
    css += '''\n\n/* Order list is summary-first; product lines are detail. */
.order-card-detail-toggle{
  width:100%;min-height:34px;padding:0 12px;border:0;border-top:1px solid #eef0f2;
  background:#fff;color:#35648f;text-align:left;font:650 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer
}
.order-card-detail-toggle:hover{background:#f8fafc}
.order-card.expanded .order-card-detail-toggle{background:#f8fafc}
.order-card.expanded .order-card-items{border-top:1px solid #eef0f2}
@media(max-width:639px){.order-card-detail-toggle{min-height:32px;padding:0 10px;font-size:11.5px}}
'''
CSS.write_text(css, encoding="utf-8")

print('Separated order list summary from order detail')
