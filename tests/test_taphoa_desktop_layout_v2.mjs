import fs from "node:fs";
import assert from "node:assert/strict";

// Desktop baseline from “giao diện chuẩn”: when PC/iframe width allows it,
// supporting panels stay visible instead of collapsing the workflow into mobile-like popups.
// Final branch verification runs this contract after all one-time patch workflows are removed.
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

assert.ok(workspace.includes('id="taphoaTopNav"'),"desktop primary navigation must stay at the top of the workspace");
assert.ok(!workspace.includes('id="taphoaBottomNav"'),"desktop must not keep the mobile-style bottom primary navigation");
assert.ok(styles.includes('#taphoaTopNav'),"top navigation needs a desktop layout owner");
assert.ok(styles.includes('grid-template-rows:44px minmax(0,1fr)'),"desktop shell must reserve its navigation row at the top");

const salesCategories=block(sales,"function renderCategories()","function rowMarkup(row)");
assert.ok(salesCategories.includes("taphoa-sales-customer-rail"),"Sales must start with customer selection before product/source browsing");
assert.ok(salesCategories.includes("customerControl"),"Sales customer control belongs in the first/left workflow region");
const salesRow=block(sales,"function rowMarkup(row)","function manualAddMarkup");
assert.ok(!salesRow.includes("data-sales-note"),"product rows must prioritize name, price and quantity instead of always-on notes");
const salesDetail=block(sales,"function renderDetail()", "function updateQtyRow");
assert.ok(salesDetail.includes("data-sales-cart-note"),"selected-line notes must live in the always-visible cart/order pane");
assert.ok(!salesDetail.includes("taphoa-detail-customer"),"customer selection must not be duplicated after the cart header");
assert.ok(sales.includes('slots.left.addEventListener("change"'),"customer selection must be owned by the left Sales region");
const editOrder=block(sales,"function editOrder(order)","function cancelEdit");
assert.ok(editOrder.includes('state.query=""'),"opening an order for edit must clear stale product search text");
assert.ok(editOrder.includes('state.sourceKey=""'),"opening an order for edit must clear stale source filtering");

const orderSource=block(orders,"function renderSourceRail()","function sourceReportMarkup()");
assert.ok(orderSource.includes("Theo nguồn")&&orderSource.includes("data-td-order-source"),"Orders desktop must keep source/summary as its supporting first column");
assert.ok(!styles.includes('#taphoaDesktopWorkspace[data-view="orders"] #taphoaLeftRail{display:none'),"Orders must not hide its source column on desktop");
const orderList=block(orders,"function renderOrderList()","function actionMarkup");
assert.ok(!orderList.includes('id="taphoaOrderSource"'),"source selection must not be duplicated as a dropdown when the PC source column is visible");
assert.ok(styles.includes('.taphoa-order-filter-row{display:grid;grid-template-columns:minmax(0,1fr) 104px;gap:6px}'),"Orders filter geometry must match its two visible controls after source moves back to the rail");
assert.ok(orders.includes("taphoa-order-customer-inline"),"customer reassignment belongs beside the customer name");
const orderDetail=block(orders,"function renderOrderDetail(id)","function selectOrder");
assert.ok(!orderDetail.includes('class="taphoa-detail-customer"'),"order detail must not duplicate customer identity in a second strip");
assert.ok(orderDetail.includes('class="taphoa-order-detail-footer"'),"order detail keeps a compact footer for line and quantity counts");
assert.ok(!orderDetail.includes("Tổng cộng"),"order footer must not repeat the same grand total already shown in the header");

assert.ok(debts.includes("function visibleDebtCustomers"),"debt customer rail needs a dedicated visibility rule");
assert.ok(debts.includes("function debtTotals"),"Debt must expose total debt/credit overview before drill-down");
assert.ok(debts.includes("taphoa-debt-overview"),"Debt overview cards must be rendered in the first column");
assert.ok(debts.includes("data-td-debt-quick-payment"),"Debt must expose the supported quick receipt flow before customer drill-down");
assert.ok(debts.includes("function quickPayment"),"quick receipt must have a real API-backed handler, not decorative UI");
const payment=block(debts,"function paymentMarkup()", "function renderLinkedOrder");
assert.ok(payment.includes("balanceVnd")&&payment.includes(">0"),"detail payment form must only appear when the customer actually owes money");
assert.ok(debts.includes("Không có công nợ"),"zero-debt empty state must remain explicit");

assert.ok(styles.includes('.taphoa-sales-customer-rail'),"Sales customer-first region needs a desktop layout owner");
assert.ok(styles.includes('.taphoa-debt-overview'),"Debt overview needs a desktop layout owner");
assert.ok(styles.includes('.taphoa-manual-add input[name="name"]{grid-column:1/-1}'),"manual product add must give the product name a full row on narrow desktop");
assert.ok(styles.includes('.taphoa-debt-payment{margin:12px 0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}'),"debt payment form must keep the primary action visible in a narrow detail pane");
assert.ok(styles.includes('.taphoa-debt-payment input[name="note"]{grid-column:1/-1;grid-row:2}'),"debt payment note must move to its own row instead of squeezing the action off-screen");
assert.ok(styles.includes("font-size:12px"),"desktop supporting text must not default to 9px-era sizing");

console.log("Tạp hóa desktop standard-flow contract PASS");
