from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
STAMP = (ROOT / "tools" / "stamp_static_build.py").read_text(encoding="utf-8")
MOBILE_JS_PATH = ROOT / "taphoa-mobile-standard.js"
MOBILE_CSS_PATH = ROOT / "taphoa-mobile-standard.css"


class MobileStandardDocumentLayoutTest(unittest.TestCase):
    def test_mobile_standard_assets_exist_and_boot_after_order_owner(self):
        self.assertTrue(MOBILE_JS_PATH.exists())
        self.assertTrue(MOBILE_CSS_PATH.exists())
        self.assertIn('runtime.assetUrl("taphoa-mobile-standard.css",build)', INDEX)
        self.assertIn('runtime.assetUrl("taphoa-mobile-standard.js",build)', INDEX)
        self.assertLess(INDEX.index('await loadScript(orderManagementUrl,build)'), INDEX.index('await loadScript(mobileStandardJsUrl,build)'))

    def test_mobile_owner_is_event_driven_not_dom_observer_driven(self):
        js = MOBILE_JS_PATH.read_text(encoding="utf-8")
        self.assertIn('function mountMobileStandard()', js)
        self.assertIn('document.addEventListener("click"', js)
        self.assertIn('document.addEventListener("getlink-access-change"', js)
        self.assertNotIn('MutationObserver', js)
        self.assertNotIn('setInterval(', js)

    def test_sales_is_customer_search_products_cart_then_place_sell(self):
        js = MOBILE_JS_PATH.read_text(encoding="utf-8")
        css = MOBILE_CSS_PATH.read_text(encoding="utf-8")
        for token in [
            'const CUSTOMER_ID="mobileStandardCustomer"',
            'Tìm khách: tên / SĐT / mã',
            'data-mobile-standard-action="customer-search"',
            'data-order-customer-select',
            'const CART_BAR_ID="mobileStandardCartBar"',
            'const CART_SHEET_ID="mobileStandardCartSheet"',
            'data-mobile-standard-action="cart"',
            'data-mobile-standard-action="place"',
            'data-mobile-standard-action="sell"',
        ]:
            self.assertIn(token, js)
        self.assertIn('#mobileUserWork[data-taphoa-view="sales"] .mobile-user-order-bar', css)
        self.assertRegex(css, r'mobile-user-order-bar[^}]*display\s*:\s*none')
        self.assertIn('.mobile-user-mine-card .mobile-user-product-image', css)
        self.assertRegex(css, r'mobile-user-mine-card \.mobile-user-product-image\s*\{[^}]*display\s*:\s*none')
        self.assertIn('.mobile-user-mine-card:not(.is-selected) .mobile-user-qty [data-work-qty="-1"]', css)
        self.assertIn('.mobile-user-mine-card:not(.is-selected) .mobile-user-qty > b', css)

    def test_cart_sheet_reuses_existing_quantity_and_order_actions(self):
        js = MOBILE_JS_PATH.read_text(encoding="utf-8")
        self.assertIn('window.userWorkSelectedItems', js)
        self.assertIn('data-work-qty="-1"', js)
        self.assertIn('data-work-qty="1"', js)
        self.assertIn('#mobileUserSendOrder', js)
        self.assertIn('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="quick"]', js)
        self.assertIn('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="clear"]', js)
        self.assertIn('[data-order-cart-for="mobileUserSendOrder"] [data-order-cart-action="update"]', js)

    def test_mobile_work_nav_is_bottom_owned_and_orders_prioritize_delivered_pending(self):
        js = MOBILE_JS_PATH.read_text(encoding="utf-8")
        css = MOBILE_CSS_PATH.read_text(encoding="utf-8")
        self.assertIn('function moveWorkNavToBottom()', js)
        self.assertIn('function moveOrderReportControls()', js)
        self.assertIn('tabs.parentElement.insertBefore(controls,tabs)', js)
        self.assertIn('orderTabs.insertBefore(delivered,pending)', js)
        self.assertIn('.taphoa-work-nav.mobile', css)
        self.assertRegex(css, r'taphoa-work-nav\.mobile[^}]*bottom\s*:\s*0')
        self.assertIn('.order-manager-tabs [data-order-status="returned"]', css)
        self.assertRegex(css, r'\[data-order-status="returned"\][^}]*display\s*:\s*none')

    def test_debt_has_mobile_search_and_keeps_history_detail_owner(self):
        js = MOBILE_JS_PATH.read_text(encoding="utf-8")
        self.assertIn('const DEBT_SEARCH_ID="mobileStandardDebtSearch"', js)
        self.assertIn('function syncDebtSearch()', js)
        self.assertIn('.debt-customer-card', js)
        self.assertIn('data-debt-order-id', js)

    def test_mobile_assets_are_part_of_static_build_hash(self):
        self.assertIn("'taphoa-mobile-standard.js'", STAMP)
        self.assertIn("'taphoa-mobile-standard.css'", STAMP)


if __name__ == "__main__":
    unittest.main()
