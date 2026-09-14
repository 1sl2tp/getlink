import fs from "node:fs";
import assert from "node:assert/strict";

// Locks the desktop layout decisions that were visually audited at 1000/1280/1440 widths.
const read=name=>fs.readFileSync(new URL(`../${name}`,import.meta.url),"utf8");
const block=(text,start,end)=>{
  const a=text.indexOf(start);
  assert.ok(a>=0,`missing ${start}`);
  const b=text.indexOf(end,a+start.length);
  assert.ok(b>a,`missing ${end}`);
  return text.slice(a,b);
};

const workspace=read("taphoa-desktop-workspace.js");
const styles=read("taphoa-desktop-workspace.css");
const sales=read("taphoa-desktop-sales.js");
const orders=read("taphoa-desktop-orders.js");
const debts=read("taphoa-desktop-debts.js");

assert.ok(workspace.includes('id="taphoaTopNav"'),"desktop primary navigation must live at the top of the workspace");
assert.ok(!workspace.includes('id="taphoaBottomNav"'),"desktop must not keep the mobile-style bottom primary navigation");
assert.ok(styles.includes('#taphoaTopNav'),"top navigation needs a desktop layout owner");
assert.ok(styles.includes('grid-template-rows:44px minmax(0,1fr)'),"desktop shell must reserve its navigation row at the top");

const salesRow=block(sales,"function rowMarkup(row)","function manualAddMarkup");
assert.ok(!salesRow.includes("data-sales-note"),"product rows must prioritize name, price and quantity instead of always-on notes");
const salesDetail=block(sales,"function renderDetail()", "function updateQtyRow");
assert.ok(salesDetail.includes("data-sales-cart-note"),"selected-line notes must move into the order pane");
const editOrder=block(sales,"function editOrder(order)","function cancelEdit");
assert.ok(editOrder.includes('state.query=""'),"opening an order for edit must clear stale product search text");
assert.ok(editOrder.includes('state.sourceKey=""'),"opening an order for edit must clear stale source filtering");

assert.ok(orders.includes('id="taphoaOrderSource"'),"source must be a secondary Orders filter instead of a permanent desktop column");
assert.ok(styles.includes('#taphoaDesktopWorkspace[data-view="orders"] #taphoaLeftRail{display:none'),"Orders must collapse to a two-column list/detail workspace");
assert.ok(orders.includes("taphoa-order-customer-inline"),"customer reassignment belongs beside the customer name, not in a duplicated strip");
const orderDetail=block(orders,"function renderOrderDetail(id)","function selectOrder");
assert.ok(!orderDetail.includes('class="taphoa-detail-customer"'),"order detail must not duplicate customer identity in a second strip");
assert.ok(orderDetail.includes('class="taphoa-order-detail-footer"'),"order detail keeps a compact footer for line and quantity counts");
assert.ok(!orderDetail.includes("Tổng cộng"),"order footer must not repeat the same grand total already shown in the header");

assert.ok(debts.includes("function visibleDebtCustomers"),"debt customer rail needs a dedicated visibility rule");
const payment=block(debts,"function paymentMarkup()", "function renderLinkedOrder");
assert.ok(payment.includes("balanceVnd")&&payment.includes(">0"),"payment form must only appear when the customer actually owes money");
assert.ok(debts.includes("Không có công nợ"),"zero-debt empty state must be explicit instead of duplicating three empty columns");

assert.ok(styles.includes('.taphoa-manual-add input[name="name"]{grid-column:1/-1}'),"manual product add must give the product name a full row on narrow desktop");
assert.ok(styles.includes('grid-template-columns:minmax(0,1fr) auto'),"debt payment form must keep the primary action visible in a narrow detail pane");
assert.ok(styles.includes('.taphoa-debt-payment input[name="note"]{grid-column:1/-1;grid-row:2}'),"debt payment note must move to its own row instead of squeezing the action off-screen");

assert.ok(styles.includes("font-size:12px"),"desktop supporting text must not default to 9px-era sizing");

console.log("Tạp hóa desktop layout v2 contract PASS");
