from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER = ROOT.joinpath("order-management.js").read_text("utf-8")
MOBILE = ROOT.joinpath("taphoa-mobile-standard.js").read_text("utf-8")


class MobileOrderRowDetailAndSources(unittest.TestCase):
    def test_whole_order_row_opens_detail(self):
        self.assertIn('const orderCard=target.closest?.(".order-card[data-order-id]")', ORDER)
        self.assertIn('expandedOrderId=String(orderCard.dataset.orderId||"")', ORDER)
        self.assertIn('renderOrders();return;', ORDER)
        self.assertIn('#mobileUserWork .order-card[data-order-id]', MOBILE)

    def test_source_summary_seeds_all_supplier_sources(self):
        self.assertIn('function supplierSourceCatalog()', ORDER)
        self.assertIn('typeof mobileSupplierSources==="function"', ORDER)
        self.assertIn('for(const sourceRow of supplierSourceCatalog())', ORDER)
        self.assertIn('sourceLabel', ORDER)


if __name__ == "__main__":
    unittest.main()
