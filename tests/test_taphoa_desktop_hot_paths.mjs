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

assert.ok(workspace.includes("taphoa-new-desktop-active"),"fresh shell must suppress legacy desktop visual owners");
assert.ok(workspace.includes("event.stopImmediatePropagation()"),"fresh shell events must not fall through to legacy document handlers");
assert.ok(!workspace.includes("MutationObserver"),"fresh shell must not coordinate with mutation observers");
assert.ok(!workspace.includes("root.remove()"),"view switching must preserve shell node identity");

const legacy=block(config,"const loadLegacyMobile=", "const mobileMedia=");
assert.ok(legacy.includes("taphoa-hot-path-runtime.js"));
assert.ok(legacy.includes("taphoa-workspace-feedback.js"));
assert.ok(config.includes('(max-width:999px)'),"legacy patch runtime must be mobile-only for the fresh desktop path");

console.log("Tạp hóa desktop hot paths PASS");
