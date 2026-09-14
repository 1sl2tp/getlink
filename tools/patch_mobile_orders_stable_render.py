from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
p = root / "order-management.js"
s = p.read_text("utf-8")
pattern = re.compile(
    r'  function renderOrderResultContent\(\)\{\n(?P<body>[\s\S]*?)\n  \}\n'
    r'  function renderOrders\(\)\{\n(?P<wrapper>[\s\S]*?)\n  \}\n'
    r'  function applyOrderReportSearch\(input\)\{\n(?P<apply>[\s\S]*?)\n  \}\n\n'
    r'  async function loadDebtSummaries'
)
m = pattern.search(s)
if not m:
    raise SystemExit("mobile order render block not found")
body = m.group("body")
old_tail = '''    const controls=list.querySelector(".order-report-controls");
    if(controls)controls.remove();
    list.innerHTML=sourceSummaryMarkup(visible)+sourceDrillMarkup(visible)+`<div class="order-lifecycle-list">${cards}</div>`;
    if(controls)list.prepend(controls);'''
new_tail = '''    const manager=document.getElementById("orderManager");
    const controls=manager?.querySelector(".order-report-controls");
    const controlsInList=controls?.parentElement===list;
    if(controlsInList)controls.remove();
    list.innerHTML=sourceSummaryMarkup(visible)+sourceDrillMarkup(visible)+`<div class="order-lifecycle-list">${cards}</div>`;
    if(controlsInList)list.prepend(controls);
    else if(!controls)list.insertAdjacentHTML("afterbegin",orderReportControlsMarkup());'''
if old_tail not in body:
    raise SystemExit("order render tail not found")
body = body.replace(old_tail, new_tail, 1)
replacement = '''  function renderOrders(){
    renderTabs();
''' + body + '''
  }
  function applyOrderReportSearch(input){
    setOrderReportFilter({search:String(input?.value||"")});
    sourceDrillSource="";
    renderOrders();
  }

  async function loadDebtSummaries'''
s = s[:m.start()] + replacement + s[m.end():]
p.write_text(s, "utf-8")
