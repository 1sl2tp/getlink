from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
JS=ROOT.joinpath("taphoa-mobile-standard.js").read_text("utf-8")
CSS=ROOT.joinpath("taphoa-mobile-standard.css").read_text("utf-8")

class MobileIframeTapFallback(unittest.TestCase):
    def test_native_click_is_not_replaced_by_pointer_promotion(self):
        self.assertNotIn("IFRAME_TAP_SELECTOR", JS)
        self.assertNotIn('addEventListener("pointerdown"', JS)
        self.assertNotIn('addEventListener("pointerup"', JS)
        self.assertNotIn("tap.target.click()", JS)
        self.assertNotIn("event.isTrusted&&target===guard.target", JS)

    def test_scroll_gesture_keeps_native_pan_owner(self):
        self.assertIn("touch-action:pan-y", CSS)
        self.assertIn("-webkit-overflow-scrolling:touch", CSS)
        self.assertNotIn("moved>10", JS)
        self.assertNotIn("pointercancel", JS)

    def test_semantic_mobile_actions_use_delegated_click(self):
        self.assertIn('document.addEventListener("click"', JS)
        self.assertIn("[data-order-customer-select]", JS)
        self.assertIn("[data-taphoa-work-view]", JS)
        self.assertNotIn("stopImmediatePropagation()", JS)

if __name__=="__main__":
    unittest.main()
