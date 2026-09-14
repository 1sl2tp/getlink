from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
JS=ROOT.joinpath("taphoa-mobile-standard.js").read_text("utf-8")
CSS=ROOT.joinpath("taphoa-mobile-standard.css").read_text("utf-8")

class MobileInteractionOwner(unittest.TestCase):
    def test_nav_is_not_reparented(self):
        self.assertNotIn("host.appendChild(nav)", JS)
        self.assertIn('nav.classList.add("mobile-standard-nav-bottom")', JS)
        self.assertIn("order:99!important", CSS)
        self.assertIn("pointer-events:auto!important", CSS)

    def test_customer_button_uses_native_order_picker_owner(self):
        self.assertIn('data-order-customer-select', JS)
        self.assertNotIn('data-mobile-standard-action="customer-search"', JS)
        self.assertNotIn('(source||fallback)?.click()', JS)
        self.assertNotIn('IFRAME_TAP_SELECTOR', JS)
        self.assertNotIn('pointerdown', JS)
        self.assertNotIn('pointerup', JS)

if __name__=="__main__":
    unittest.main()
