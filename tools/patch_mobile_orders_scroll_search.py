from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]

p = root / "order-management.js"
s = p.read_text("utf-8")
pattern = r'  function renderOrders\(\)\{\n    renderTabs\(\);\n(?P<body>.*?)\n  \}\n\n  async function loadDebtSummaries'
m = re.search(pattern, s, re.S)
if not m:
    raise SystemExit("renderOrders function anchor not found")
body = m.group("body")
old_line = '    list.innerHTML=orderReportControlsMarkup()+sourceSummaryMarkup(visible)+sourceDrillMarkup(visible)+`<div class="order-lifecycle-list">${cards}</div>`;'
new_line = '''    const controls=list.querySelector(".order-report-controls");
    if(controls)controls.remove();
    list.innerHTML=sourceSummaryMarkup(visible)+sourceDrillMarkup(visible)+`<div class="order-lifecycle-list">${cards}</div>`;
    if(controls)list.prepend(controls);'''
if old_line not in body:
    raise SystemExit("order list render anchor not found")
body = body.replace(old_line, new_line, 1)
replacement = '''  function renderOrderResultContent(){
''' + body + '''
  }
  function renderOrders(){
    renderTabs();
    const manager=document.getElementById("orderManager");
    const controls=manager?.querySelector(".order-report-controls");
    renderOrderResultContent();
    if(!controls){
      const list=document.getElementById("orderManagerList");
      list?.insertAdjacentHTML("afterbegin",orderReportControlsMarkup());
    }
  }
  function applyOrderReportSearch(input){
    setOrderReportFilter({search:String(input?.value||"")});
    sourceDrillSource="";
    renderOrderResultContent();
  }

  async function loadDebtSummaries'''
s = s[:m.start()] + replacement + s[m.end():]
old = '''    if(event.target?.matches?.("[data-order-report-search]")){
      setOrderReportFilter({search:String(event.target.value||"")});sourceDrillSource="";renderOrders();
      const input=document.querySelector("[data-order-report-search]");input?.focus();input?.setSelectionRange(orderReportFilter.search.length,orderReportFilter.search.length);return;
    }'''
new = '''    if(event.target?.matches?.("[data-order-report-search]")){
      applyOrderReportSearch(event.target);return;
    }'''
if old not in s:
    raise SystemExit("order search input handler anchor not found")
p.write_text(s.replace(old, new, 1), "utf-8")

c = root / "taphoa-mobile-standard.css"
css = c.read_text("utf-8")
marker = "/* Mobile orders/debts: list owns the scroll viewport inside the embedded workspace. */"
block = '''

/* Mobile orders/debts: list owns the scroll viewport inside the embedded workspace. */
@media(max-width:639px){
  #mobileUserWork[data-taphoa-view="orders"] .order-manager,
  #mobileUserWork[data-taphoa-view="debts"] .order-manager{
    flex:1 1 auto!important;
    min-height:0!important;
    overflow:hidden!important;
    display:flex!important;
    flex-direction:column!important;
  }
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-panel,
  #mobileUserWork[data-taphoa-view="debts"] .order-manager-panel,
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-body,
  #mobileUserWork[data-taphoa-view="debts"] .order-manager-body{
    flex:1 1 auto!important;
    min-height:0!important;
    height:100%!important;
    display:flex!important;
    flex-direction:column!important;
    overflow:hidden!important;
  }
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-list,
  #mobileUserWork[data-taphoa-view="debts"] .order-manager-list{
    flex:1 1 auto!important;
    min-height:0!important;
    overflow-y:auto!important;
    overflow-x:hidden!important;
    overscroll-behavior-y:contain!important;
    -webkit-overflow-scrolling:touch;
    touch-action:pan-y!important;
  }
  #mobileUserWork .order-report-search input,
  #mobileUserWork .mobile-standard-debt-search input{
    touch-action:manipulation!important;
    -webkit-user-select:text!important;
    user-select:text!important;
    pointer-events:auto!important;
  }
}
'''
if marker not in css:
    c.write_text(css + block, "utf-8")
