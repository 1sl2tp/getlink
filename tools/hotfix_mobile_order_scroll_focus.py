from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
TEST=ROOT/'tests/test_mobile_order_scroll_focus.py'
TEST.write_text('''from pathlib import Path\nimport unittest\nROOT=Path(__file__).resolve().parents[1]\nJS=ROOT.joinpath("order-management.js").read_text("utf-8")\nCSS=ROOT.joinpath("taphoa-mobile-standard.css").read_text("utf-8")\nclass MobileOrderScrollFocus(unittest.TestCase):\n    def test_search_control_is_never_detached_during_live_filter(self):\n        self.assertIn("function ensureOrderReportResultsHost(list)", JS)\n        self.assertIn("results.innerHTML=sourceSummaryMarkup(visible)", JS)\n        self.assertNotIn("if(controlsInList)controls.remove();", JS)\n    def test_order_list_is_forced_to_be_the_scroll_owner(self):\n        self.assertIn("height:0!important;", CSS)\n        self.assertIn("overflow-y:auto!important;", CSS)\n        self.assertIn("touch-action:pan-y!important;", CSS)\n    def test_ios_search_input_has_stable_text_focus_contract(self):\n        self.assertIn("font-size:16px!important;", CSS)\n        self.assertIn("-webkit-user-select:text!important;", CSS)\nif __name__=="__main__": unittest.main()\n''','utf-8')

red=subprocess.run([sys.executable,'-m','unittest','tests.test_mobile_order_scroll_focus','-v'],cwd=ROOT)
if red.returncode==0:
    raise SystemExit('Expected RED but contract already passes')
print('RED confirmed')

p=ROOT/'order-management.js'
s=p.read_text('utf-8')
old='''    const manager=document.getElementById("orderManager");
    const controls=manager?.querySelector(".order-report-controls");
    const controlsInList=controls?.parentElement===list;
    if(controlsInList)controls.remove();
    list.innerHTML=sourceSummaryMarkup(visible)+sourceDrillMarkup(visible)+`<div class="order-lifecycle-list">${cards}</div>`;
    if(controlsInList)list.prepend(controls);
    else if(!controls)list.insertAdjacentHTML("afterbegin",orderReportControlsMarkup());
  }
'''
new='''    const results=ensureOrderReportResultsHost(list);
    results.innerHTML=sourceSummaryMarkup(visible)+sourceDrillMarkup(visible)+`<div class="order-lifecycle-list">${cards}</div>`;
  }
  function ensureOrderReportResultsHost(list){
    let controls=list.querySelector(":scope > .order-report-controls");
    if(!controls){
      list.insertAdjacentHTML("afterbegin",orderReportControlsMarkup());
      controls=list.querySelector(":scope > .order-report-controls");
    }
    let results=list.querySelector(":scope > .order-report-results");
    if(!results){
      results=document.createElement("div");
      results.className="order-report-results";
      controls?.insertAdjacentElement("afterend",results);
    }
    return results;
  }
'''
if old not in s:
    raise SystemExit('renderOrders anchor not found')
p.write_text(s.replace(old,new,1),'utf-8')

c=ROOT/'taphoa-mobile-standard.css'
css=c.read_text('utf-8')
marker='''  #mobileUserWork[data-taphoa-view="orders"] .order-manager-list,
  #mobileUserWork[data-taphoa-view="debts"] .order-manager-list{
    flex:1 1 auto!important;
    min-height:0!important;
    overflow-y:auto!important;'''
repl='''  #mobileUserWork[data-taphoa-view="orders"] .order-manager-list,
  #mobileUserWork[data-taphoa-view="debts"] .order-manager-list{
    flex:1 1 0!important;
    height:0!important;
    min-height:0!important;
    overflow-y:auto!important;'''
if marker not in css:
    raise SystemExit('scroll owner anchor not found')
css=css.replace(marker,repl,1)
input_marker='''  #mobileUserWork .order-report-search input,
  #mobileUserWork .mobile-standard-debt-search input{
    touch-action:manipulation!important;'''
input_repl='''  #mobileUserWork .order-report-search input,
  #mobileUserWork .mobile-standard-debt-search input{
    font-size:16px!important;
    touch-action:manipulation!important;'''
if input_marker not in css:
    raise SystemExit('input focus anchor not found')
c.write_text(css.replace(input_marker,input_repl,1),'utf-8')
