from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER_JS = (ROOT / "order-management.js").read_text(encoding="utf-8")
MOBILE_JS = (ROOT / "taphoa-mobile-standard.js").read_text(encoding="utf-8")
MOBILE_CSS = (ROOT / "taphoa-mobile-standard.css").read_text(encoding="utf-8")


class MobileOrderFilterOwnerFinal(unittest.TestCase):
    def test_mobile_order_filter_has_one_stable_host_before_status_tabs(self):
        self.assertIn('id="orderManagerFilters"', ORDER_JS)
        self.assertLess(ORDER_JS.index('id="orderManagerFilters"'), ORDER_JS.index('id="orderManagerTabs"'))
        self.assertIn('function orderReportControlsHost()', ORDER_JS)

    def test_mobile_presentation_does_not_reparent_order_filter_controls(self):
        self.assertNotIn('function moveOrderReportControls()', MOBILE_JS)
        self.assertNotIn('tabs.parentElement.insertBefore(controls,tabs)', MOBILE_JS)

    def test_filter_is_fixed_context_and_list_is_scroll_owner(self):
        self.assertIn('.order-manager-filters', MOBILE_CSS)
        self.assertIn('flex:0 0 auto', MOBILE_CSS)
        self.assertIn('.order-manager-list', MOBILE_CSS)
        self.assertIn('overflow-y:auto', MOBILE_CSS)


if __name__ == "__main__":
    unittest.main()
