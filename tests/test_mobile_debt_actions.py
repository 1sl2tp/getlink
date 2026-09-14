from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MOBILE_JS = (ROOT / "taphoa-mobile-standard.js").read_text("utf-8")


class MobileDebtActionsTests(unittest.TestCase):
    def test_mobile_debt_detail_keeps_both_actions_visible(self):
        self.assertIn("data-mobile-standard-debt-entry", MOBILE_JS)
        self.assertIn('data-mobile-debt-action="payment"', MOBILE_JS)
        self.assertIn('data-mobile-debt-action="debt"', MOBILE_JS)
        self.assertIn("Khách đang dư ", MOBILE_JS)
        self.assertIn("Khách không còn nợ", MOBILE_JS)

    def test_payment_is_disabled_when_customer_has_no_positive_debt(self):
        self.assertIn("payment.disabled=!positive", MOBILE_JS)
        self.assertIn("legacy?.remove()", MOBILE_JS)

    def test_mobile_debt_actions_use_thousand_unit_and_sales_api(self):
        self.assertIn("function parseCompactVnd", MOBILE_JS)
        self.assertIn("*1000", MOBILE_JS)
        self.assertIn('action==="debt"?"adjustments":"payments"', MOBILE_JS)
        self.assertIn('const DEBT_AUTH_KEY="getlink:chat-order-auth";', MOBILE_JS)
        self.assertIn('const DEBT_ORDER_API=', MOBILE_JS)
        self.assertIn('headers.set("apikey",DEBT_API_KEY)', MOBILE_JS)
        self.assertIn('headers.set("authorization","Bearer "+auth.accessToken)', MOBILE_JS)
        self.assertIn('await debtRequest("/debts/"', MOBILE_JS)
        self.assertNotIn("TaphoaDesktopData.orderRequest", MOBILE_JS)


if __name__ == "__main__":
    unittest.main()
