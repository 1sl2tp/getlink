from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER_CSS = (ROOT / "order-management.css").read_text(encoding="utf-8")
APP_JS = (ROOT / "app.js").read_text(encoding="utf-8")


class TapHoaUiUxPassTests(unittest.TestCase):
    def test_order_surfaces_define_44px_touch_target(self):
        self.assertIn("--order-touch:44px", ORDER_CSS)
        for selector in (
            ".order-manager-tabs button",
            ".order-card-detail-toggle",
            ".order-card-actions button",
            ".order-work-nav button",
            ".order-cart-actions button",
            "#orderManagerClose",
        ):
            self.assertIn(selector, ORDER_CSS)
        self.assertIn("min-height:var(--order-touch)", ORDER_CSS)

    def test_order_controls_have_keyboard_and_pressed_feedback(self):
        self.assertIn(":focus-visible", ORDER_CSS)
        self.assertIn("outline:2px solid", ORDER_CSS)
        self.assertIn("button:active", ORDER_CSS)
        self.assertIn("transform:translateY(1px)", ORDER_CSS)
        self.assertIn("prefers-reduced-motion:reduce", ORDER_CSS)

    def test_selected_grocery_rows_have_explicit_visual_state(self):
        self.assertIn("is-selected", APP_JS)
        self.assertIn(".mobile-user-product-card.is-selected", ORDER_CSS)
        self.assertIn(".user-work-order-row.is-selected", ORDER_CSS)

    def test_order_number_is_the_primary_visual_anchor(self):
        self.assertIn(".order-card-head strong", ORDER_CSS)
        self.assertIn("font-variant-numeric:tabular-nums", ORDER_CSS)
        self.assertIn("letter-spacing:", ORDER_CSS)

    def test_dense_mobile_layout_keeps_touch_size_without_extra_card_noise(self):
        self.assertIn("@media(max-width:639px)", ORDER_CSS)
        self.assertIn("--order-list-gap:6px", ORDER_CSS)
        self.assertIn("box-shadow:none", ORDER_CSS)


if __name__ == "__main__":
    unittest.main()
