from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT.joinpath("taphoa-workspace-feedback.js").read_text("utf-8")


class MobileOrderDetailSourceOwner(unittest.TestCase):
    def test_source_summary_is_resolved_from_stable_results_owner(self):
        self.assertIn('const resultsOwner=source.closest(".order-report-results")||list', JS)
        self.assertIn('resultsOwner.querySelector(":scope > .order-source-summary")', JS)
        self.assertIn('resultsOwner.querySelector(":scope > .order-source-detail")', JS)
        self.assertNotIn('list.querySelector(":scope > .order-source-summary")', JS)

    def test_mobile_order_row_tap_selects_directly_without_synthetic_click_dependency(self):
        self.assertIn('function selectOrderWorkspaceItem(listItem)', JS)
        self.assertIn('function beginMobileOrderTap(event)', JS)
        self.assertIn('function finishMobileOrderTap(event)', JS)
        self.assertIn('selectOrderWorkspaceItem(tap.target)', JS)
        self.assertIn('document.addEventListener("pointerdown",beginMobileOrderTap,true)', JS)
        self.assertIn('document.addEventListener("pointerup",finishMobileOrderTap,true)', JS)

    def test_source_report_stays_expanded_on_mobile_index(self):
        self.assertIn('report.open=!window.matchMedia("(min-width:1000px)").matches', JS)


if __name__ == "__main__":
    unittest.main()
