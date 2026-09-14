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
    def test_customer_search_calls_original_picker_owner(self):
        self.assertIn('data-order-customer-for="mobileUserSendOrder"', JS)
        self.assertIn('(source||fallback)?.click()', JS)
if __name__=="__main__": unittest.main()
