from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class MobileStandardSalesContract(unittest.TestCase):
    def test_mobile_standard_runtime_is_loaded_and_stamped(self):
        config=(ROOT/'config.js').read_text('utf-8')
        stamp=(ROOT/'tools/stamp_static_build.py').read_text('utf-8')
        self.assertIn('taphoa-mobile-standard.css',config)
        self.assertIn('taphoa-mobile-standard.js',config)
        self.assertIn("'taphoa-mobile-standard.js'",stamp)
        self.assertIn("'taphoa-mobile-standard.css'",stamp)

    def test_mobile_sales_matches_reference_flow(self):
        js=(ROOT/'taphoa-mobile-standard.js').read_text('utf-8')
        css=(ROOT/'taphoa-mobile-standard.css').read_text('utf-8')
        for token in [
            'mobileStandardCustomerButton',
            'mobileStandardCartButton',
            'mobileStandardCartSheet',
            'mobileStandardCartRows',
            'data-mobile-standard-action="clear"',
            'data-mobile-standard-action="order"',
            'data-mobile-standard-action="sell"',
        ]:
            self.assertIn(token,js)
        self.assertIn('.mobile-user-mine-card:not(.is-selected) .mobile-user-qty button:first-child',css)
        self.assertIn('.mobile-user-mine-card:not(.is-selected) .mobile-user-qty b',css)
        self.assertIn('.mobile-user-mine-card .mobile-user-product-image',css)
        self.assertIn('.mobile-user-order-bar',css)
        self.assertIn('.taphoa-work-nav.mobile',css)

    def test_desktop_contract_is_not_replaced(self):
        js=(ROOT/'taphoa-mobile-standard.js').read_text('utf-8')
        self.assertIn('(max-width:639px)',js)
        self.assertNotIn('user-work-desktop.innerHTML',js)

if __name__=='__main__':
    unittest.main()
