from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
JS=ROOT.joinpath("taphoa-mobile-standard.js").read_text("utf-8")
class MobileIframeTapFallback(unittest.TestCase):
    def test_touch_pointer_is_promoted_to_programmatic_click(self):
        self.assertIn("IFRAME_TAP_SELECTOR", JS)
        self.assertIn("event.pointerType!==\"touch\"", JS)
        self.assertIn("tap.target.click()", JS)
        self.assertIn("window.parent!==window", JS)
    def test_scroll_gesture_is_not_promoted_to_click(self):
        self.assertIn("Math.hypot(event.clientX-tap.x,event.clientY-tap.y)", JS)
        self.assertIn("moved>10", JS)
        self.assertIn("pointercancel", JS)
    def test_native_followup_click_is_deduplicated(self):
        self.assertIn("event.isTrusted&&target===guard.target", JS)
        self.assertIn("stopImmediatePropagation()", JS)
if __name__=="__main__": unittest.main()
