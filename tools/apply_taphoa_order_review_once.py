from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


def write(rel, value):
    (ROOT / rel).write_text(value, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


app_rel = "app.js"
app = read(app_rel)
app = replace_once(
    app,
    '''    const url=String(item?.url||"").trim();
    const qty=Math.max(0,Math.round(Number(item?.qty||0)));
    if(url&&qty>0)map[url]=qty;''',
    '''    const url=String(item?.url||"").trim();
    const qty=Math.max(0,Math.round(Number(item?.qty||0)));
    const key=canonical(url);
    if(key&&qty>0)map[key]=qty;''',
    "canonical edit-cart key",
)
write(app_rel, app)

order_rel = "order-management.js"
order = read(order_rel)
order = replace_once(
    order,
    '''      if(activeView==="debts")await refreshDebts();
      else {await loadOrders();renderOrders();}''',
    '''      if(activeView==="debts")await refreshDebts();
      else {await loadOrders();renderOrders();}
      if(!syncBusy)await checkRemoteRevision(true);''',
    "seed manager sync baseline",
)
write(order_rel, order)

for rel in [
    "tools/apply_taphoa_order_review_once.py",
    ".github/workflows/apply-taphoa-order-review-once.yml",
]:
    path = ROOT / rel
    if path.exists():
        path.unlink()

print("Applied final Tạp hóa workflow review fixes")
