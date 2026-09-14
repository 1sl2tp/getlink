from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]

def read(path): return (ROOT/path).read_text(encoding='utf-8')
def write(path,text): (ROOT/path).write_text(text,encoding='utf-8')
def once(text,old,new,label):
    n=text.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1 match, got {n}')
    return text.replace(old,new,1)
def regex_once(text,pattern,repl,label):
    out,n=re.subn(pattern,repl,text,count=1,flags=re.S)
    if n!=1: raise SystemExit(f'{label}: expected 1 regex match, got {n}')
    return out

order=read('order-management.js')
order=once(order,
'''          <div id="orderManagerBody" class="order-manager-body">
            <nav id="orderManagerTabs" class="order-manager-tabs" aria-label="Trạng thái đơn">''',
'''          <div id="orderManagerBody" class="order-manager-body">
            <div id="orderManagerFilters" class="order-manager-filters"></div>
            <nav id="orderManagerTabs" class="order-manager-tabs" aria-label="Trạng thái đơn">''',
'filter host')
order=regex_once(order,
r'''  function ensureOrderReportResultsHost\(list\)\{.*?\n  \}\n  function applyOrderReportSearch''',
'''  function orderReportControlsHost(){
    const list=document.getElementById("orderManagerList");
    if(!list)return null;
    if(window.matchMedia("(max-width:639px)").matches)return document.getElementById("orderManagerFilters")||list;
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
'canonical order filter owner')
write('order-management.js',order)

mobile=read('taphoa-mobile-standard.js')
mobile=regex_once(mobile,r'''\n  function moveOrderReportControls\(\)\{.*?\n  \}\n\n  function syncCustomer''','''

  function syncCustomer''','remove presentation reparent')
mobile=once(mobile,
'    moveWorkNavToBottom();configureOrderTabs();moveOrderReportControls();syncDebtSearch();',
'    moveWorkNavToBottom();configureOrderTabs();syncDebtSearch();',
'remove reparent call')
write('taphoa-mobile-standard.js',mobile)

css=read('taphoa-mobile-standard.css')
marker='/* FINAL_MOBILE_ORDER_FILTER_OWNER_20260914 */'
if marker not in css:
    css += '''

/* FINAL_MOBILE_ORDER_FILTER_OWNER_20260914 */
@media(max-width:639px){
  .order-manager-filters{display:none!important}
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-filters{
    display:block!important;
    flex:0 0 auto!important;
    min-height:0!important;
    background:#fff!important;
    border-bottom:1px solid #e7eaed!important;
  }
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-filters .order-report-controls{
    margin:0!important;
    border-bottom:0!important;
  }
  #mobileUserWork[data-taphoa-view="orders"] .order-manager-list{
    overflow-y:auto!important;
    -webkit-overflow-scrolling:touch!important;
  }
}
'''
write('taphoa-mobile-standard.css',css)

path=ROOT/'tests/test_mobile_standard_document_layout.py'
test=path.read_text(encoding='utf-8')
test=once(test,
'''        self.assertIn('function moveWorkNavToBottom()', js)
        self.assertIn('function moveOrderReportControls()', js)
        self.assertIn('tabs.parentElement.insertBefore(controls,tabs)', js)
        self.assertIn('orderTabs.insertBefore(delivered,pending)', js)''',
'''        self.assertIn('function moveWorkNavToBottom()', js)
        self.assertNotIn('function moveOrderReportControls()', js)
        self.assertNotIn('tabs.parentElement.insertBefore(controls,tabs)', js)
        self.assertIn('orderTabs.insertBefore(delivered,pending)', js)''',
'update standard owner regression test')
path.write_text(test,encoding='utf-8')
