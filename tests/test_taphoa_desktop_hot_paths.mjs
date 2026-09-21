import fs from "node:fs";
import assert from "node:assert/strict";

const read=name=>fs.readFileSync(new URL(`../${name}`,import.meta.url),"utf8");
const block=(text,start,end)=>{
  const a=text.indexOf(start);
  assert.ok(a>=0,`missing ${start}`);
  const b=text.indexOf(end,a+start.length);
  assert.ok(b>a,`missing ${end}`);
  return text.slice(a,b);
};

const sales=read("taphoa-desktop-sales.js");
const orders=read("taphoa-desktop-orders.js");
const debts=read("taphoa-desktop-debts.js");
const data=read("taphoa-desktop-data.js");
const workspace=read("taphoa-desktop-workspace.js");
const styles=read("taphoa-desktop-workspace.css");
const config=read("config.js");

const salesResults=block(sales,"function renderMasterResults", "function renderMaster()");
assert.ok(salesResults.includes(".taphoa-sales-list"),"sales search must target the result list");
assert.ok(!salesResults.includes("slots.master.innerHTML='<section"),"sales search must not rebuild the master shell");
assert.ok(sales.includes('state.query=String(e.target.value||"");state.visible=PAGE_SIZE;renderMasterResults()'),"typing must use local result rendering");
assert.ok(sales.includes("function updateQtyRow"),"quantity hot path must update a row");
const qty=block(sales,"function updateQtyRow", "function changeQty");
assert.ok(!qty.includes("renderMaster"),"quantity click must not rebuild product results");
assert.ok(!qty.includes("searchProducts"),"quantity click must not re-run product search");
assert.ok(sales.includes("insertAdjacentHTML(\"beforeend\""),"infinite load must append rows");
assert.ok(!sales.includes("scrollTop=0"),"sales must not reset scroll position");

const price=block(sales,"function price(row)", "function qc(row)");
assert.ok(price.includes("row?.price_vnd"),"manual quick-add result must show its returned price immediately");
const editUpdate=block(sales,"async function updateEditing", "function editOrder");
assert.ok(editUpdate.includes('TaphoaDesktopWorkspace?.view==="sales"'),"edit completion must not repaint Sales after switching back to Orders");
const salesRail=block(sales,"function renderCategories()", "function rowMarkup");
assert.ok(salesRail.includes("<strong>Nguồn hàng</strong>"),"Sales left rail must be named Nguồn hàng, not Danh mục");
assert.ok(!salesRail.includes("<strong>Danh mục</strong>"),"Sales source rail must not present itself as a category list");

const ensureIndex=block(data,"function ensureProductIndex", "function allProducts");
assert.ok(ensureIndex.includes("currentLibraryRows"),"product index must notice when the app library cache arrives or changes");
assert.ok(ensureIndex.includes("indexSource"),"product index must track the source cache identity");

const select=block(orders,"function selectOrder", "async function loadCustomers");
assert.ok(select.includes("classList.remove"));
assert.ok(select.includes("classList.add"));
assert.ok(select.includes("renderOrderDetail(next)"));
assert.ok(!select.includes("renderOrderList"),"order selection must not rebuild the list");
assert.ok(!select.includes("innerHTML"),"order selection must not replace list DOM");
assert.ok(!select.includes("scrollTop"),"order selection must preserve list scroll");
const orderRows=block(orders,"function renderOrderRows", "function renderOrderList");
assert.ok(orderRows.includes(".taphoa-order-list"),"order filtering must target list body");
assert.ok(!orderRows.includes("slots.master.innerHTML"),"order search/filter must preserve toolbar input");
const orderInput=block(orders,'slots.master.addEventListener("input"','slots.master.addEventListener("change"');
assert.ok(orderInput.includes('e.target.id!=="taphoaOrderSearch"'),"order input handler must be scoped to the search field");
assert.ok(orderInput.includes('state.query=String(e.target.value||"")'),"order search must update only local query state");
assert.ok(orderInput.includes('state.source=""'),"order search must clear source drill-down scope");
assert.ok(orderInput.includes('state.sourceMode="orders"'),"order search must return source report to order mode");
assert.ok(orderInput.includes('state.selectedId=""'),"order search must clear stale selection");
assert.ok(orderInput.includes("renderSourceRail()")&&orderInput.includes("renderOrderRows()"),"order search must repaint only local source/list owners");
assert.ok(!orderInput.includes("refresh()"),"order search must not refetch orders");
assert.ok(!orderInput.includes("renderOrderList()"),"order search must not rebuild the toolbar shell");
assert.ok(!orderInput.includes("orderRequest("),"order search must not call the backend");

assert.ok(orders.includes('data-td-order-batch="pending"'),"pending tab must expose its Xóa tất cả action");
assert.ok(orders.includes('data-td-order-batch="delivered"'),"delivered tab must expose its scoped return-all action");
const batchOrders=block(orders,"async function batchCurrentOrders", "function bind");
assert.ok(batchOrders.includes('orderRequest("/orders/pending",{method:"DELETE"})'),"pending batch must use the existing delete-all endpoint");
assert.ok(batchOrders.includes('orderRequest("/orders/return-batch"'),"delivered batch must use the existing return-batch endpoint");
assert.ok(batchOrders.includes("visibleRows()"),"delivered batch must respect the current visible scope");
assert.ok(batchOrders.includes("map(o=>String(o.id"),"delivered batch must submit visible order ids");
assert.ok(batchOrders.includes('state.status==="returned"'),"returned history must not expose a destructive batch action");

const timeOptions=block(orders,"function timeOptions()", "function renderOrderList");
for(const [preset,label] of [["all","Tất cả"],["today","Hôm nay"],["yesterday","Hôm qua"],["week","Tuần này"],["month","Tháng này"],["year","Năm nay"],["custom","Tùy chọn"]]){
  assert.ok(timeOptions.includes(`['${preset}','${label}']`),`missing order time preset ${preset}`);
}
assert.ok(orders.includes("function orderMatchesTime"),"order report must have one time-filter owner");
assert.ok(orders.includes('id="taphoaOrderFrom"'),"custom report range needs a from date");
assert.ok(orders.includes('id="taphoaOrderTo"'),"custom report range needs a to date");
assert.ok(orders.includes("supplierSources"),"order source labels must use supplier display names when available");

assert.ok(orders.includes("function sourceSummary"),"fresh Orders must calculate source qty/revenue/cost/profit locally");
assert.ok(orders.includes("function sourceDetailRows"),"fresh Orders must expose source detail rows");
assert.ok(orders.includes("function combinedSourceRows"),"fresh Orders must group repeated products for a combined source report");
assert.ok(orders.includes('data-td-source-mode="detail"'),"source drill-down needs a detail mode");
assert.ok(orders.includes('data-td-source-mode="combined"'),"source drill-down needs a combined mode");
assert.ok(orders.includes("async function shareSourceReport"),"source report must support share/copy");
const share=block(orders,"async function shareSourceReport", "async function batchCurrentOrders");
assert.ok(share.includes("navigator.share"),"source report should use native share when available");
assert.ok(share.includes("navigator.clipboard.writeText"),"source report should fall back to clipboard copy");
for(const selector of [".taphoa-source-report-bar",".taphoa-source-report-actions",".taphoa-source-detail-row",".taphoa-source-combined-row"]){
  assert.ok(styles.includes(selector),`missing desktop source-report style ${selector}`);
}
assert.ok(styles.includes("grid-template-columns:32px minmax(0,1fr) 64px 86px"),"source detail rows must keep quantity and money columns aligned");

assert.ok(debts.includes('data-td-debt-order="'),"order-linked debt transactions must expose an order drill-down control");
assert.ok(debts.includes("async function loadLinkedOrder"),"debt workspace must fetch a linked order on demand");
const linked=block(debts,"async function loadLinkedOrder", "async function loadDetail");
assert.ok(linked.includes('orderRequest("/orders/"+encodeURIComponent'),"debt drill-down must use the scoped existing order endpoint");
assert.ok(debts.includes("function renderLinkedOrder"),"debt workspace must render the linked invoice in the detail column");
assert.ok(debts.includes('data-td-debt-order-back'),"linked invoice must return to the debt transaction without losing customer context");
assert.ok(debts.includes("TaphoaDesktopOrders?.performAction"),"debt lifecycle actions must reuse the fresh Orders owner");
assert.ok(orders.includes("performAction:mutate"),"Orders must expose its existing lifecycle owner instead of duplicating mutations");

assert.ok(workspace.includes("taphoa-new-desktop-active"),"fresh shell must suppress legacy desktop visual owners");
assert.ok(workspace.includes("event.stopImmediatePropagation()"),"fresh shell events must not fall through to legacy document handlers");
assert.ok(!workspace.includes("MutationObserver"),"fresh shell must not coordinate with mutation observers");
assert.ok(!workspace.includes("root.remove()"),"view switching must preserve shell node identity");

assert.ok(!config.includes("taphoa-hot-path-runtime.js"),"legacy hot-path runtime must stay out of GETLINK production");
assert.ok(!config.includes("taphoa-workspace-feedback.js"),"legacy feedback runtime must stay out of GETLINK production");
assert.ok(!config.includes("taphoa-desktop-workspace.js"),"legacy desktop workspace must stay out of GETLINK production");

console.log("Tạp hóa desktop hot paths PASS");