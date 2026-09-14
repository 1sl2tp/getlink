from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER = (ROOT / "order-management.js").read_text(encoding="utf-8")
FEEDBACK = (ROOT / "taphoa-workspace-feedback.js").read_text(encoding="utf-8")


class MobileOrdersCanonicalSourceDetail(unittest.TestCase):
    def test_canonical_order_owner_already_renders_source_and_view_order(self):
        source_pos = ORDER.index("sourceSummaryMarkup(visible)")
        list_pos = ORDER.index('`<div class="order-lifecycle-list">${cards}</div>`')
        self.assertLess(source_pos, list_pos)
        self.assertIn('class="order-card-detail-toggle"', ORDER)
        self.assertIn('data-order-detail', ORDER)
        self.assertIn('"Xem đơn"', ORDER)

    def test_mobile_does_not_replace_canonical_order_workspace(self):
        self.assertIn('function mobileUsesCanonicalOrderOwner()', FEEDBACK)
        self.assertIn('if(mobileUsesCanonicalOrderOwner()){restoreCanonicalMobileOrders();return;}', FEEDBACK)
        self.assertIn('function restoreCanonicalMobileOrders()', FEEDBACK)

    def test_feedback_layer_has_no_synthetic_mobile_order_tap_owner(self):
        self.assertNotIn('function beginMobileOrderTap(event)', FEEDBACK)
        self.assertNotIn('function finishMobileOrderTap(event)', FEEDBACK)
        self.assertNotIn('document.addEventListener("pointerdown",beginMobileOrderTap,true)', FEEDBACK)
        self.assertNotIn('document.addEventListener("pointerup",finishMobileOrderTap,true)', FEEDBACK)


if __name__ == "__main__":
    unittest.main()
