from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 exact match, found {count}")
    return text.replace(old, new, 1)


js = read("taphoa-workspace-feedback.js")
js = replace_once(js, '  let mobileOrderTap=null;\n', '', 'remove mobile tap state')

marker = '  function syncOrderWorkspaceV2(){\n'
helpers = '''  function mobileUsesCanonicalOrderOwner(){return window.matchMedia("(max-width:639px)").matches}\n  function restoreCanonicalMobileOrders(){\n    const list=document.getElementById("orderManagerList");\n    if(!list)return;\n    const workspace=list.querySelector(".order-workspace-v2");\n    const source=list.querySelector(".order-lifecycle-list");\n    if(workspace){\n      const report=workspace.querySelector(".order-source-report");\n      const sourceSummary=report?.querySelector(".order-source-summary");\n      const sourceDrill=report?.querySelector(".order-source-detail");\n      if(source){\n        if(sourceSummary)source.insertAdjacentElement("beforebegin",sourceSummary);\n        if(sourceDrill)source.insertAdjacentElement("beforebegin",sourceDrill);\n      }\n      workspace.remove();\n    }\n    if(source){delete source.dataset.taphoaV2Source;source.hidden=false;}\n    orderWorkspaceSelectedId="";\n  }\n  function syncOrderWorkspaceV2(){\n    if(mobileUsesCanonicalOrderOwner()){restoreCanonicalMobileOrders();return;}\n'''
js = replace_once(js, marker, helpers, 'mobile canonical owner guard')

pattern = re.compile(
    r'  function beginMobileOrderTap\(event\)\{.*?'
    r'  document\.addEventListener\("pointercancel",\(\)=>\{mobileOrderTap=null;\},true\);\n',
    re.S,
)
js, count = pattern.subn('', js, count=1)
if count != 1:
    raise SystemExit(f"remove synthetic mobile tap owner: expected 1 block, found {count}")
write("taphoa-workspace-feedback.js", js)

old_test = '''from pathlib import Path\nimport unittest\n\nROOT = Path(__file__).resolve().parents[1]\nJS = ROOT.joinpath("taphoa-workspace-feedback.js").read_text("utf-8")\n\n\nclass MobileOrderDetailSourceOwner(unittest.TestCase):\n    def test_source_summary_is_resolved_from_stable_results_owner(self):\n        self.assertIn('const resultsOwner=source.closest(".order-report-results")||list', JS)\n        self.assertIn('resultsOwner.querySelector(":scope > .order-source-summary")', JS)\n        self.assertIn('resultsOwner.querySelector(":scope > .order-source-detail")', JS)\n        self.assertNotIn('list.querySelector(":scope > .order-source-summary")', JS)\n\n    def test_mobile_order_row_tap_selects_directly_without_synthetic_click_dependency(self):\n        self.assertIn('function selectOrderWorkspaceItem(listItem)', JS)\n        self.assertIn('function beginMobileOrderTap(event)', JS)\n        self.assertIn('function finishMobileOrderTap(event)', JS)\n        self.assertIn('selectOrderWorkspaceItem(tap.target)', JS)\n        self.assertIn('document.addEventListener("pointerdown",beginMobileOrderTap,true)', JS)\n        self.assertIn('document.addEventListener("pointerup",finishMobileOrderTap,true)', JS)\n\n    def test_source_report_stays_expanded_on_mobile_index(self):\n        self.assertIn('report.open=!window.matchMedia("(min-width:1000px)").matches', JS)\n\n\nif __name__ == "__main__":\n    unittest.main()\n'''
new_test = '''from pathlib import Path\nimport unittest\n\nROOT = Path(__file__).resolve().parents[1]\nJS = ROOT.joinpath("taphoa-workspace-feedback.js").read_text("utf-8")\n\n\nclass MobileOrderDetailSourceOwner(unittest.TestCase):\n    def test_source_summary_is_resolved_from_stable_results_owner_for_wide_workspace(self):\n        self.assertIn('const resultsOwner=source.closest(".order-report-results")||list', JS)\n        self.assertIn('resultsOwner.querySelector(":scope > .order-source-summary")', JS)\n        self.assertIn('resultsOwner.querySelector(":scope > .order-source-detail")', JS)\n        self.assertNotIn('list.querySelector(":scope > .order-source-summary")', JS)\n\n    def test_mobile_returns_to_canonical_order_owner(self):\n        self.assertIn('function mobileUsesCanonicalOrderOwner()', JS)\n        self.assertIn('function restoreCanonicalMobileOrders()', JS)\n        self.assertIn('if(mobileUsesCanonicalOrderOwner()){restoreCanonicalMobileOrders();return;}', JS)\n        self.assertNotIn('function beginMobileOrderTap(event)', JS)\n        self.assertNotIn('function finishMobileOrderTap(event)', JS)\n\n    def test_wide_source_report_remains_available(self):\n        self.assertIn('report.open=!window.matchMedia("(min-width:1000px)").matches', JS)\n\n\nif __name__ == "__main__":\n    unittest.main()\n'''
current = read("tests/test_mobile_order_detail_source_owner.py")
if current != old_test:
    raise SystemExit("legacy source owner test changed unexpectedly")
write("tests/test_mobile_order_detail_source_owner.py", new_test)
