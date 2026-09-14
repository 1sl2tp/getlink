from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER_JS = (ROOT / "order-management.js").read_text(encoding="utf-8")
MOBILE_JS = (ROOT / "taphoa-mobile-standard.js").read_text(encoding="utf-8")
MOBILE_CSS = (ROOT / "taphoa-mobile-standard.css").read_text(encoding="utf-8")


# Canonical mobile contract: one owner for filters, picker actions, and scroll regions.
class MobileStandardOwnerAuditTest(unittest.TestCase):
    def test_order_filters_have_one_canonical_host_before_status_tabs(self):
        self.assertIn('id="orderManagerFilters"', ORDER_JS)
        self.assertLess(ORDER_JS.index('id="orderManagerFilters"'), ORDER_JS.index('id="orderManagerTabs"'))
        self.assertIn('function orderReportControlsHost()', ORDER_JS)
        self.assertNotIn('tabs.parentElement.insertBefore(controls,tabs)', MOBILE_JS)
        self.assertNotIn('function moveOrderReportControls()', MOBILE_JS)

    def test_customer_picker_is_called_through_direct_owner_api(self):
        self.assertIn('window.GETLINK_ORDER_UI', ORDER_JS)
        self.assertIn('openCustomerPicker', ORDER_JS)
        self.assertIn('window.GETLINK_ORDER_UI?.openCustomerPicker', MOBILE_JS)
        self.assertNotIn('(source||fallback)?.click()', MOBILE_JS)

    def test_debt_rows_include_standard_index_and_age_context(self):
        self.assertIn('function debtAgeDays(', ORDER_JS)
        self.assertIn('debt-customer-index', ORDER_JS)
        self.assertIn('debt-customer-age', ORDER_JS)
        self.assertIn('.debt-customer-index', MOBILE_CSS)
        self.assertIn('.debt-customer-age', MOBILE_CSS)

    def test_mobile_filters_and_lists_have_separate_scroll_ownership(self):
        self.assertIn('.order-manager-filters', MOBILE_CSS)
        self.assertIn('flex:0 0 auto', MOBILE_CSS)
        self.assertIn('.order-manager-list', MOBILE_CSS)
        self.assertIn('overflow-y:auto', MOBILE_CSS)


if __name__ == "__main__":
    unittest.main()
