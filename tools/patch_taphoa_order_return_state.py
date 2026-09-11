from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "order-management.js"
CSS = ROOT / "order-management.css"


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, got {count}")
    return text.replace(old, new, 1)


js = JS.read_text(encoding="utf-8")
js = replace_once(
    js,
    '''      taphoaWorkView=String(workView.dataset.taphoaWorkView||"sales");
      activeView=taphoaWorkView==="debts"?"debts":"orders";
      sourceDrillSource="";debtLinkedOrder=null;''',
    '''      taphoaWorkView=String(workView.dataset.taphoaWorkView||"sales");
      activeView=taphoaWorkView==="debts"?"debts":"orders";
      debtLinkedOrder=null;''',
    "preserve order drill when leaving workspace",
)
JS.write_text(js, encoding="utf-8")

css = CSS.read_text(encoding="utf-8")
css = replace_once(
    css,
    "/* One order = one visual unit. The order number leads; amount is the second anchor. */",
    "/* One order = one visual unit. Customer leads; amount is the second anchor. */",
    "customer-first hierarchy comment",
)
CSS.write_text(css, encoding="utf-8")

print("TAPHOA order return-state patch applied")
