from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT.joinpath("order-management.js").read_text("utf-8")
CSS = ROOT.joinpath("taphoa-mobile-standard.css").read_text("utf-8")
FEEDBACK_CSS = ROOT.joinpath("taphoa-workspace-feedback.css").read_text("utf-8")


class MobileOrdersScrollSearch(unittest.TestCase):
    def test_orders_list_owns_vertical_scroll_on_mobile(self):
        self.assertIn('#mobileUserWork[data-taphoa-view="orders"] .order-manager-list', CSS)
        self.assertIn('flex:1 1 0!important', CSS)
        self.assertIn('height:0!important', CSS)
        self.assertIn('overflow-y:auto!important', CSS)
        self.assertIn('-webkit-overflow-scrolling:touch', CSS)

    def test_order_search_keeps_the_same_input_node_while_typing(self):
        self.assertIn('function applyOrderReportSearch(input)', JS)
        self.assertIn('function ensureOrderReportResultsHost(list)', JS)
        self.assertIn('results.innerHTML=sourceSummaryMarkup(visible)', JS)
        self.assertNotIn('if(controlsInList)controls.remove()', JS)
        self.assertNotIn('if(controlsInList)list.prepend(controls)', JS)
        self.assertNotIn('setOrderReportFilter({search:String(event.target.value||"")});sourceDrillSource="";renderOrders();', JS)
        self.assertNotIn('const input=document.querySelector("[data-order-report-search]");input?.focus()', JS)

    def test_results_wrapper_is_layout_transparent_so_mobile_detail_keeps_height(self):
        compact = ''.join(FEEDBACK_CSS.split())
        self.assertIn('.order-report-results{display:contents}', compact)
        self.assertIn('.order-workspace-v2.has-selection.order-index-pane{display:none}', compact)
        self.assertIn('.order-workspace-v2.has-selection.order-detail-pane{display:block}', compact)


if __name__ == "__main__":
    unittest.main()
