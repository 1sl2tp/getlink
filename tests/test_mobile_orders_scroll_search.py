from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT.joinpath("order-management.js").read_text("utf-8")
CSS = ROOT.joinpath("taphoa-mobile-standard.css").read_text("utf-8")


class MobileOrdersScrollSearch(unittest.TestCase):
    def test_orders_list_owns_vertical_scroll_on_mobile(self):
        self.assertIn('#mobileUserWork[data-taphoa-view="orders"] .order-manager-list', CSS)
        self.assertIn('overflow-y:auto!important', CSS)
        self.assertIn('-webkit-overflow-scrolling:touch', CSS)

    def test_order_search_does_not_replace_input_while_typing(self):
        self.assertIn('function applyOrderReportSearch(input)', JS)
        self.assertIn('renderOrderResultContent()', JS)
        self.assertNotIn('setOrderReportFilter({search:String(event.target.value||"")});sourceDrillSource="";renderOrders();', JS)


if __name__ == "__main__":
    unittest.main()
