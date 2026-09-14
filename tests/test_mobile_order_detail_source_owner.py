from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT.joinpath("taphoa-workspace-feedback.js").read_text("utf-8")


class MobileOrderDetailSourceOwner(unittest.TestCase):
    def test_source_summary_is_resolved_from_stable_results_owner_for_wide_workspace(self):
        self.assertIn('const resultsOwner=source.closest(".order-report-results")||list', JS)
        self.assertIn('resultsOwner.querySelector(":scope > .order-source-summary")', JS)
        self.assertIn('resultsOwner.querySelector(":scope > .order-source-detail")', JS)
        self.assertNotIn('list.querySelector(":scope > .order-source-summary")', JS)

    def test_mobile_returns_to_canonical_order_owner(self):
        self.assertIn('function mobileUsesCanonicalOrderOwner()', JS)
        self.assertIn('function restoreCanonicalMobileOrders()', JS)
        self.assertIn('if(mobileUsesCanonicalOrderOwner()){restoreCanonicalMobileOrders();return;}', JS)
        self.assertNotIn('function beginMobileOrderTap(event)', JS)
        self.assertNotIn('function finishMobileOrderTap(event)', JS)

    def test_wide_source_report_remains_available(self):
        self.assertIn('report.open=!window.matchMedia("(min-width:1000px)").matches', JS)


if __name__ == "__main__":
    unittest.main()
