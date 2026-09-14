from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER = ROOT.joinpath("order-management.js").read_text("utf-8")


class MobileOrderRowDetailAndSources(unittest.TestCase):
    def test_whole_order_row_opens_detail(self):
        self.assertIn('const orderCard=target.closest?.(".order-card[data-order-id]")', ORDER)
        self.assertIn('expandedOrderId=String(orderCard.dataset.orderId||"")', ORDER)
        self.assertIn('renderOrders();return;', ORDER)

    def test_source_summary_ignores_text_search_but_keeps_status_and_time_scope(self):
        self.assertIn('function ordersForSourceSummary(rows=orders)', ORDER)
        self.assertIn('const sourceRows=ordersForSourceSummary(orders);', ORDER)
        self.assertIn('sourceSummaryMarkup(sourceRows)', ORDER)


if __name__ == "__main__":
    unittest.main()
