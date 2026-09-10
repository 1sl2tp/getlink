from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.js"
ORDER = ROOT / "order-management.js"
INDEX = ROOT / "index.html"
SALES_TEST = ROOT / "tests/test_taphoa_sales_completion.py"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)


app = APP.read_text(encoding="utf-8")
app = replace_once(
    app,
    '''function setUserWorkQty(url,value){
  const key=canonical(url);
  if(!key)return 0;
  const map=readUserWorkQtyMap();
  const next=Math.max(0,Math.min(999,Math.round(Number(value)||0)));
  if(next)map[key]=next;
  else delete map[key];
  writeUserWorkQtyMap(map);
  return next;
}''',
    '''function setUserWorkQty(url,value){
  const key=canonical(url);
  if(!key)return 0;
  const map=readUserWorkQtyMap();
  const next=Math.max(0,Math.min(999,Math.round(Number(value)||0)));
  if(next)map[key]=next;
  else delete map[key];
  writeUserWorkQtyMap(map);
  mobileUserScopeViewCache.delete("mine");
  return next;
}''',
    "setUserWorkQty",
)

app = replace_once(
    app,
    '''function userWorkSelectedItems(){
  return libraryCache
    .filter(row=>String(row.preference_state||"normal")!=="hidden"&&isMineRow(row))
    .map(row=>({row,qty:userWorkQty(row.canonical_url)}))
    .filter(item=>item.qty>0);
}

function updateUserWorkOrderSummary(){''',
    '''function userWorkSelectedItems(){
  return libraryCache
    .filter(row=>String(row.preference_state||"normal")!=="hidden"&&isMineRow(row))
    .map(row=>({row,qty:userWorkQty(row.canonical_url)}))
    .filter(item=>item.qty>0);
}

function clearUserWorkOrderSelection(){
  try{localStorage.removeItem(USER_WORK_QTY_KEY);}catch{}
  mobileUserScopeViewCache.delete("mine");
  renderUserWorkHome();
  updateUserWorkOrderSummary();
}

function updateUserWorkOrderSummary(){''',
    "cart clear owner",
)

app = replace_once(
    app,
    '''  if(countHost)countHost.textContent=text;
  if(mobileCount)mobileCount.textContent=text;
  if(send)send.disabled=selected.length===0;
  if(mobileSend)mobileSend.disabled=selected.length===0;
}''',
    '''  if(countHost)countHost.textContent=text;
  if(mobileCount)mobileCount.textContent=text;
  const unavailable=selected.length===0;
  if(send)send.setAttribute("aria-disabled",unavailable?"true":"false");
  if(mobileSend)mobileSend.setAttribute("aria-disabled",unavailable?"true":"false");
}''',
    "order summary button state",
)

app = replace_once(
    app,
    '''window.userWorkSelectedItems=userWorkSelectedItems;
window.renderUserWorkHome=renderUserWorkHome;
window.updateUserWorkOrderSummary=updateUserWorkOrderSummary;''',
    '''window.userWorkSelectedItems=userWorkSelectedItems;
window.clearUserWorkOrderSelection=clearUserWorkOrderSelection;
window.renderUserWorkHome=renderUserWorkHome;
window.updateUserWorkOrderSummary=updateUserWorkOrderSummary;''',
    "cart owner export",
)
APP.write_text(app, encoding="utf-8")

order = ORDER.read_text(encoding="utf-8")
order = replace_once(
    order,
    '''      const data=await orderFetch("/orders",{method:"POST",body});
      localStorage.removeItem(QTY_KEY);
      if(typeof window.renderUserWorkHome==="function")window.renderUserWorkHome();
      if(typeof window.updateUserWorkOrderSummary==="function")window.updateUserWorkOrderSummary();''',
    '''      const data=await orderFetch("/orders",{method:"POST",body});
      if(typeof window.clearUserWorkOrderSelection==="function"){
        window.clearUserWorkOrderSelection();
      }''',
    "successful order cart clear",
)
ORDER.write_text(order, encoding="utf-8")

html = INDEX.read_text(encoding="utf-8")
for button_id in ("userWorkSendOrder", "mobileUserSendOrder"):
    pattern = re.compile(rf'(<button\b[^>]*\bid="{button_id}"[^>]*?)\s+disabled(?=[\s>])([^>]*>)')
    html, count = pattern.subn(r"\1\2", html, count=1)
    if count != 1:
        raise SystemExit(f"{button_id}: expected one native disabled attribute, found {count}")
INDEX.write_text(html, encoding="utf-8")

sales_test = SALES_TEST.read_text(encoding="utf-8")
sales_test = replace_once(
    sales_test,
    '''        self.assertIn('localStorage.removeItem(QTY_KEY)', body)
        self.assertLess(body.index('await orderFetch("/orders",{method:"POST",body})'), body.index('localStorage.removeItem(QTY_KEY)'))''',
    '''        self.assertIn('window.clearUserWorkOrderSelection();', body)
        self.assertNotIn('localStorage.removeItem(QTY_KEY)', body)
        self.assertLess(body.index('await orderFetch("/orders",{method:"POST",body})'), body.index('window.clearUserWorkOrderSelection();'))''',
    "sales completion ownership contract",
)
SALES_TEST.write_text(sales_test, encoding="utf-8")

print("Applied live cart owner fix")
