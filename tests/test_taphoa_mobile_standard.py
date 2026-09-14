from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TaphoaMobileStandardContract(unittest.TestCase):
    def test_mobile_standard_assets_exist_and_boot_after_order_manager(self):
        js = (ROOT / "taphoa-mobile-standard.js").read_text(encoding="utf-8")
        css = (ROOT / "taphoa-mobile-standard.css").read_text(encoding="utf-8")
        html = (ROOT / "index.html").read_text(encoding="utf-8")

        self.assertIn('taphoa-mobile-standard.css', html)
        self.assertIn('taphoa-mobile-standard.js', html)
        self.assertLess(html.index('order-management.js'), html.index('taphoa-mobile-standard.js'))
        self.assertIn('function ensureMobileSalesHead()', js)
        self.assertIn('function ensureMobileCartSheet()', js)
        self.assertIn('@media(max-width:639px)', css)

    def test_sales_head_matches_reference_flow_customer_time_cart(self):
        js = (ROOT / "taphoa-mobile-standard.js").read_text(encoding="utf-8")
        self.assertIn('id="mobileSalesHead"', js)
        self.assertIn('data-order-customer-select', js)
        self.assertIn('id="mobileSalesClock"', js)
        self.assertIn('id="mobileSalesCartButton"', js)
        self.assertIn('id="mobileSalesCartCount"', js)
        self.assertIn('id="mobileSalesCartTotal"', js)
        self.assertIn('mobileUserWork.insertBefore(head,toolbar)', js)

    def test_product_rows_are_dense_and_zero_quantity_is_single_add(self):
        css = (ROOT / "taphoa-mobile-standard.css").read_text(encoding="utf-8")
        self.assertIn('.mobile-user-product-image{display:none!important}', css)
        self.assertIn('.mobile-user-mine-card{grid-template-columns:minmax(0,1fr) auto', css)
        self.assertIn('.mobile-user-product-card:not(.is-selected) .mobile-user-qty button:first-child', css)
        self.assertIn('.mobile-user-product-card:not(.is-selected) .mobile-user-qty b', css)
        self.assertIn('.mobile-user-product-card:not(.is-selected) .mobile-user-qty{width:38px', css)
        self.assertIn('.mobile-user-product-card.is-selected .mobile-user-qty', css)

    def test_cart_is_modal_not_permanent_bottom_action_bar(self):
        js = (ROOT / "taphoa-mobile-standard.js").read_text(encoding="utf-8")
        css = (ROOT / "taphoa-mobile-standard.css").read_text(encoding="utf-8")
        for text in ('Giỏ hàng', 'Đ.GIÁ', 'SL', 'T.TIỀN', 'Xóa', 'Đặt', 'Bán'):
            self.assertIn(text, js)
        self.assertIn('id="mobileSalesCartSheet"', js)
        self.assertIn('data-order-cart-action="clear"', js)
        self.assertIn('data-order-cart-action="quick"', js)
        self.assertIn('id="mobileSalesCartPlace"', js)
        self.assertIn('.mobile-user-order-bar{display:none!important}', css)
        self.assertIn('.mobile-sales-cart-overlay[hidden]{display:none!important}', css)

    def test_mobile_navigation_is_compact_without_changing_desktop(self):
        js = (ROOT / "taphoa-mobile-standard.js").read_text(encoding="utf-8")
        css = (ROOT / "taphoa-mobile-standard.css").read_text(encoding="utf-8")
        self.assertIn('function standardizeMobileWorkNav()', js)
        self.assertIn('Bán hàng', js)
        self.assertIn('Đơn', js)
        self.assertIn('Công nợ', js)
        self.assertIn('.taphoa-work-nav.mobile', css)
        self.assertNotIn('.taphoa-work-nav.desktop{display:none', css)

    def test_static_build_tracks_mobile_standard_assets(self):
        stamp = (ROOT / "tools" / "stamp_static_build.py").read_text(encoding="utf-8")
        self.assertIn("'taphoa-mobile-standard.js'", stamp)
        self.assertIn("'taphoa-mobile-standard.css'", stamp)


if __name__ == "__main__":
    unittest.main()
