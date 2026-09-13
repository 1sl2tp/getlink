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
assert.ok(orders.includes('state.query=String(e.target.value||"");state.source="";state.selectedId="";renderSourceRail();renderOrderRows()'),"order search must stay local");

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

const legacy=block(config,"const loadLegacyMobile=", "const mobileMedia=");
assert.ok(legacy.includes("taphoa-hot-path-runtime.js"));
assert.ok(legacy.includes("taphoa-workspace-feedback.js"));
assert.ok(config.includes('(max-width:999px)'),"legacy patch runtime must be mobile-only for the fresh desktop path");

console.log("Tạp hóa desktop hot paths PASS");