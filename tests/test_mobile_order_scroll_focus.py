from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
JS=ROOT.joinpath("order-management.js").read_text("utf-8")
CSS=ROOT.joinpath("taphoa-mobile-standard.css").read_text("utf-8")
class MobileOrderScrollFocus(unittest.TestCase):
    def test_search_control_is_never_detached_during_live_filter(self):
        self.assertIn("function ensureOrderReportResultsHost(list)", JS)
        self.assertIn("results.innerHTML=sourceSummaryMarkup(visible)", JS)
        self.assertNotIn("if(controlsInList)controls.remove();", JS)
    def test_order_list_is_forced_to_be_the_scroll_owner(self):
        self.assertIn("height:0!important;", CSS)
        self.assertIn("overflow-y:auto!important;", CSS)
        self.assertIn("touch-action:pan-y!important;", CSS)
    def test_ios_search_input_has_stable_text_focus_contract(self):
        self.assertIn("font-size:16px!important;", CSS)
        self.assertIn("-webkit-user-select:text!important;", CSS)
if __name__=="__main__": unittest.main()
