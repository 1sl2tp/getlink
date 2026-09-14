from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def write(name, text):
    (ROOT / name).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 exact match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text, pattern, repl, label):
    new, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, found {count}")
    return new


# order-management.js: give order filters a stable owner above tabs, expose picker owner,
# and add debt row index/age context from the canonical debt summary data.
order = read("order-management.js")
order = replace_once(
    order,
    '          <div id="orderManagerBody" class="order-manager-body">\n            <nav id="orderManagerTabs" class="order-manager-tabs" aria-label="Trạng thái đơn">',
    '          <div id="orderManagerBody" class="order-manager-body">\n            <div id="orderManagerFilters" class="order-manager-filters"></div>\n            <nav id="orderManagerTabs" class="order-manager-tabs" aria-label="Trạng thái đơn">',
    "order filter host",
)
order = regex_once(
    order,
    r'  function ensureOrderReportResultsHost\(list\)\{.*?\n  \}\n  function applyOrderReportSearch',
    '''  function orderReportControlsHost(){
    const list=document.getElementById("orderManagerList");
    if(!list)return null;
    if(window.matchMedia("(max-width:639px)").matches){
      return document.getElementById("orderManagerFilters")||list;
    }
    return list;
  }
  function ensureOrderReportResultsHost(list){
    const controlsHost=orderReportControlsHost()||list;
    let controls=document.querySelector("#orderManager .order-report-controls");
    if(!controls){
      controlsHost.insertAdjacentHTML("afterbegin",orderReportControlsMarkup());
      controls=controlsHost.querySelector(":scope > .order-report-controls");
    }else if(controls.parentElement!==controlsHost){
      controlsHost.insertAdjacentElement("afterbegin",controls);
    }
    document.querySelectorAll("#orderManager .order-report-controls").forEach(node=>{if(node!==controls)node.remove();});
    let results=list.querySelector(":scope > .order-report-results");
    if(!results){
      results=document.createElement("div");
      results.className="order-report-results";
      list.appendChild(results);
    }
    return results;
  }
  function applyOrderReportSearch''',
    "order report controls owner",
)
order = replace_once(
    order,
    '  function debtEventSign(row){return row.direction==="decrease"?"−":"+"}\n',
    '  function debtEventSign(row){return row.direction==="decrease"?"−":"+"}\n  function debtAgeDays(value){\n    const at=new Date(value||0);\n    if(!Number.isFinite(at.getTime()))return null;\n    return Math.max(0,Math.floor((Date.now()-at.getTime())/86400000));\n  }\n',
    "debt age helper",
)
old_debt = '''    const recent=sortDebtCustomersNewestFirst(debtSummaries);
    list.innerHTML=recent.map(row=>`
      <button type="button" class="debt-customer-card" data-debt-customer-id="${escapeHtml(row.customerId)}">
        <span><strong>${escapeHtml(row.customerName||row.username||"Khách hàng")}</strong><small>${row.username?"@"+escapeHtml(row.username):""}${row.lastOccurredAt?" · "+escapeHtml(dateTime(row.lastOccurredAt)):""}</small></span>
        <b>${escapeHtml(compactMoney(row.balanceVnd))}</b>
      </button>`).join("");'''
new_debt = '''    const recent=sortDebtCustomersNewestFirst(debtSummaries);
    list.innerHTML=recent.map((row,index)=>{
      const age=debtAgeDays(row.lastOccurredAt);
      return `
      <button type="button" class="debt-customer-card" data-debt-customer-id="${escapeHtml(row.customerId)}">
        <span class="debt-customer-index">${index+1}</span>
        <span class="debt-customer-copy"><strong>${escapeHtml(row.customerName||row.username||"Khách hàng")}</strong><small>${row.username?"@"+escapeHtml(row.username):""}${row.lastOccurredAt?" · "+escapeHtml(dateTime(row.lastOccurredAt)):""}${age===null?"":" · "+age+" ngày"}</small></span>
        <span class="debt-customer-age">${age===null?"":age+" ngày"}</span>
        <b>${escapeHtml(compactMoney(row.balanceVnd))}</b>
      </button>`;
    }).join("");'''
order = replace_once(order, old_debt, new_debt, "debt summary rows")
order = replace_once(
    order,
    '  window.GETLINK_ACCESS_CONTEXT={states:ACCESS_STATES,snapshot:accessSnapshot};',
    '  window.GETLINK_ORDER_UI=Object.freeze({openCustomerPicker,closeCustomerPicker});\n  window.GETLINK_ACCESS_CONTEXT={states:ACCESS_STATES,snapshot:accessSnapshot};',
    "order ui owner api",
)
write("order-management.js", order)


# Mobile presentation owner: stop moving order filters and call the picker owner directly.
mobile = read("taphoa-mobile-standard.js")
mobile = regex_once(
    mobile,
    r'\n  function moveOrderReportControls\(\)\{.*?\n  \}\n\n  function syncCustomer',
    '\n\n  function syncCustomer',
    "remove order filter reparent",
)
mobile = replace_once(
    mobile,
    '    moveWorkNavToBottom();configureOrderTabs();moveOrderReportControls();syncDebtSearch();',
    '    moveWorkNavToBottom();configureOrderTabs();syncDebtSearch();',
    "sync view filter reparent call",
)
old_customer = '''      if(name==="customer-search"){
        event.preventDefault();
        const source=document.querySelector('[data-order-customer-for="mobileUserSendOrder"][data-order-customer-select]')||document.querySelector('[data-order-customer-for="mobileUserSendOrder"]');
        const fallback=document.querySelector("#"+CUSTOMER_ID+" [data-order-customer-select]");
        (source||fallback)?.click();
        queueAfterAsyncOwner();
        return;
      }'''
new_customer = '''      if(name==="customer-search"){
        event.preventDefault();
        const picker=window.GETLINK_ORDER_UI?.openCustomerPicker;
        if(typeof picker==="function")void picker();
        queueAfterAsyncOwner();
        return;
      }'''
mobile = replace_once(mobile, old_customer, new_customer, "direct customer picker owner")
write("taphoa-mobile-standard.js", mobile)


# Mobile CSS: filters are fixed context, results own scroll; debt rows show STT + age without adding card height.
css = read("taphoa-mobile-standard.css")
marker = "/* MOBILE_OWNER_AUDIT_20260914 */"
if marker not in css:
    css += '''

/* MOBILE_OWNER_AUDIT_20260914 */
@media(max-width:639px){
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-filters{
    display:block!important;
    flex:0 0 auto!important;
    min-height:0!important;
    background:#fff!important;
    border-bottom:1px solid #e7eaed!important;
  }
  #mobileUserWork[data-taphoa-view="debts"] .order-manager-filters{display:none!important}
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-filters .order-report-controls{
    margin:0!important;
    border-bottom:0!important;
  }
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-list,
  #mobileUserWork[data-taphoa-view="debts"] .order-manager-list{
    overflow-y:auto!important;
  }
  #mobileUserWork[data-taphoa-view="debts"] .debt-customer-card{
    display:grid!important;
    grid-template-columns:24px minmax(0,1fr) auto!important;
    grid-template-rows:auto auto!important;
    column-gap:7px!important;
    align-items:center!important;
  }
  .debt-customer-index{
    grid-column:1;grid-row:1/3;align-self:center;text-align:center;
    font-size:10px;font-weight:700;color:#87919d;
  }
  .debt-customer-copy{grid-column:2;grid-row:1/3;min-width:0}
  .debt-customer-copy strong,.debt-customer-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .debt-customer-age{display:none}
  #mobileUserWork[data-taphoa-view="debts"] .debt-customer-card>b{grid-column:3;grid-row:1/3}
}
'''
write("taphoa-mobile-standard.css", css)


# Replace old tests that locked the previous DOM-reparent/click-through hacks.
test_path = ROOT / "tests" / "test_mobile_standard_document_layout.py"
test = test_path.read_text(encoding="utf-8")
old_test = '''        self.assertIn('function moveWorkNavToBottom()', js)
        self.assertIn('function moveOrderReportControls()', js)
        self.assertIn('tabs.parentElement.insertBefore(controls,tabs)', js)
        self.assertIn('orderTabs.insertBefore(delivered,pending)', js)'''
new_test = '''        self.assertIn('function moveWorkNavToBottom()', js)
        self.assertNotIn('function moveOrderReportControls()', js)
        self.assertNotIn('tabs.parentElement.insertBefore(controls,tabs)', js)
        self.assertIn('orderTabs.insertBefore(delivered,pending)', js)'''
test = replace_once(test, old_test, new_test, "update mobile standard owner test")
test_path.write_text(test, encoding="utf-8")

interaction_path = ROOT / "tests" / "test_mobile_interaction_owner.py"
interaction = interaction_path.read_text(encoding="utf-8")
old_interaction = '''    def test_customer_search_calls_original_picker_owner(self):
        self.assertIn('data-order-customer-for="mobileUserSendOrder"', JS)
        self.assertIn('(source||fallback)?.click()', JS)'''
new_interaction = '''    def test_customer_search_calls_original_picker_owner(self):
        self.assertIn('window.GETLINK_ORDER_UI?.openCustomerPicker', JS)
        self.assertNotIn('(source||fallback)?.click()', JS)'''
interaction = replace_once(interaction, old_interaction, new_interaction, "update customer picker owner test")
interaction_path.write_text(interaction, encoding="utf-8")
