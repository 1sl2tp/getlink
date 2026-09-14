from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]
MOBILE_JS=(ROOT/'taphoa-mobile-standard.js').read_text(encoding='utf-8')
MOBILE_CSS=(ROOT/'taphoa-mobile-standard.css').read_text(encoding='utf-8')
ORDER_JS=(ROOT/'order-management.js').read_text(encoding='utf-8')

class MobileCanonicalOwnerAudit(unittest.TestCase):
    def test_no_global_synthetic_pointer_click_fallback(self):
        self.assertNotIn('IFRAME_TAP_SELECTOR', MOBILE_JS)
        self.assertNotIn('pointerdown', MOBILE_JS)
        self.assertNotIn('pointerup', MOBILE_JS)
        self.assertNotIn('tap.target.click()', MOBILE_JS)

    def test_sales_customer_is_one_control_and_search_lives_in_picker(self):
        self.assertNotIn('Tìm khách: tên / SĐT / mã', MOBILE_JS)
        self.assertIn('data-order-customer-select', MOBILE_JS)
        self.assertIn('id="orderCustomerSearch"', ORDER_JS)

    def test_mobile_nav_has_four_primary_destinations(self):
        block=re.search(r'function taphoaWorkspaceNavMarkup\(kind\)\{(.+?)\n  \}', ORDER_JS, re.S)
        self.assertIsNotNone(block)
        text=block.group(1)
        for view,label in [('sales','Bán'),('orders','Đơn'),('debts','Công nợ'),('more','Khác')]:
            self.assertIn(f'data-taphoa-work-view="{view}"', text)
            self.assertIn(label, text)

    def test_more_view_hides_sales_legacy_controls(self):
        self.assertIn('data-taphoa-view="more"', MOBILE_CSS)
        for token in ['.mobile-user-toolbar','#mobileUserResults','#mobileStandardCustomer','#mobileStandardCartBar']:
            self.assertIn(token, MOBILE_CSS)

    def test_cart_has_only_one_action_set(self):
        bar=re.search(r'function cartBarMarkup\(\)\{(.+?)\n  \}', MOBILE_JS, re.S)
        sheet=re.search(r'function cartSheetMarkup\(\)\{(.+?)\n  \}', MOBILE_JS, re.S)
        self.assertIsNotNone(bar); self.assertIsNotNone(sheet)
        self.assertNotIn('mobile-standard-cart-total', bar.group(1))
        self.assertIn('data-mobile-standard-action="place"', bar.group(1))
        self.assertIn('data-mobile-standard-action="sell"', bar.group(1))
        self.assertNotIn('data-mobile-standard-action="place"', sheet.group(1))
        self.assertNotIn('data-mobile-standard-action="sell"', sheet.group(1))

    def test_destructive_batch_actions_are_not_permanent(self):
        self.assertIn('orderSelectMode', ORDER_JS)
        self.assertRegex(ORDER_JS, r'pendingButton\.hidden=.*!orderSelectMode')
        self.assertRegex(ORDER_JS, r'deliveredButton\.hidden=.*!orderSelectMode')

    def test_mobile_geometry_contract(self):
        compact=MOBILE_CSS.replace(' ','')
        self.assertIn('font-size:16px', compact)
        self.assertRegex(compact, r'min-height:44px|min-block-size:44px')
        self.assertIn('-webkit-overflow-scrolling:touch', compact)

if __name__=='__main__':
    unittest.main()
