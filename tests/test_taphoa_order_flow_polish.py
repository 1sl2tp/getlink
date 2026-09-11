import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORDER = (ROOT / "order-management.js").read_text(encoding="utf-8")
CSS = (ROOT / "order-management.css").read_text(encoding="utf-8")


def function_block(name):
    match = re.search(r"(?:async )?function " + re.escape(name) + r"\([^)]*\)\{([\s\S]*?)\n  \}", ORDER)
    return match.group(1) if match else None


class TaphoaOrderFlowPolishTest(unittest.TestCase):
    def test_each_order_status_has_its_own_persisted_time_filter(self):
        self.assertIn('ORDER_REPORT_STATE_KEY="getlink:taphoa-order-report-state"', ORDER)
        self.assertIn("function defaultOrderReportFilter(status)", ORDER)
        self.assertIn("function loadOrderReportFilters()", ORDER)
        self.assertIn("function saveOrderReportFilters()", ORDER)
        self.assertIn("orderReportFilters", ORDER)
        self.assertIn("sessionStorage.getItem(ORDER_REPORT_STATE_KEY)", ORDER)
        self.assertIn("sessionStorage.setItem(ORDER_REPORT_STATE_KEY", ORDER)
        defaults = function_block("defaultOrderReportFilter")
        self.assertIsNotNone(defaults)
        self.assertRegex(defaults, r'pending[\s\S]*all')
        self.assertRegex(defaults, r'delivered[\s\S]*today|status!=="pending"[\s\S]*today')

    def test_time_filter_is_one_compact_preset_control_and_dates_only_show_for_custom(self):
        block = function_block("orderReportControlsMarkup")
        self.assertIsNotNone(block)
        self.assertIn("data-order-report-preset", block)
        for value in ("all", "today", "yesterday", "week", "month", "year", "custom"):
            self.assertIn(f'value="{value}"', block)
        self.assertIn('f.mode==="custom"', block)
        self.assertNotIn("data-order-report-all", block)
        self.assertNotIn("data-order-report-today", block)
        self.assertNotIn("data-order-report-quick", block)

    def test_switching_status_uses_the_status_scoped_filter(self):
        self.assertIn("function setActiveOrderStatus(status)", ORDER)
        block = function_block("setActiveOrderStatus")
        self.assertIsNotNone(block)
        self.assertIn("orderReportFilter=orderReportFilters[activeStatus]", block)
        self.assertIn("setActiveOrderStatus(String(tab.dataset.orderStatus", ORDER)

    def test_order_card_prioritizes_customer_and_keeps_order_number_as_metadata(self):
        block = function_block("renderOrders")
        self.assertIsNotNone(block)
        self.assertIn('class="order-card-customer"', block)
        self.assertIn('class="order-card-meta"', block)
        self.assertIn('class="order-card-preview"', block)
        self.assertRegex(block, r'order-card-customer[\s\S]*customerName[\s\S]*order-card-meta[\s\S]*orderRef\(order\)')
        self.assertRegex(CSS, r"\.order-card-customer")
        self.assertRegex(CSS, r"\.order-card-meta")
        self.assertRegex(CSS, r"\.order-card-preview")


if __name__ == "__main__":
    unittest.main()
