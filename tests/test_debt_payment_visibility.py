from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MOBILE_JS = (ROOT / "taphoa-mobile-standard.js").read_text("utf-8")


class DebtPaymentVisibility(unittest.TestCase):
    def test_mobile_admin_uses_shared_sales_access_context(self):
        self.assertIn("window.GETLINK_ACCESS_CONTEXT?.snapshot?.()?.state", MOBILE_JS)
        self.assertNotIn("window.TaphoaDesktopData?.readAuth", MOBILE_JS)

    def test_mobile_debt_actions_do_not_depend_on_desktop_data_module(self):
        self.assertIn('const DEBT_AUTH_KEY="getlink:chat-order-auth";', MOBILE_JS)
        self.assertIn('const DEBT_ORDER_API=', MOBILE_JS)
        self.assertIn("async function debtRequest(", MOBILE_JS)
        self.assertIn('await debtRequest("/debts/"', MOBILE_JS)
        self.assertNotIn("window.TaphoaDesktopData.orderRequest", MOBILE_JS)

    def test_payment_control_stays_visible_and_locks_when_no_debt(self):
        self.assertIn('data-mobile-debt-action="payment">Thu tiền</button>', MOBILE_JS)
        self.assertIn("payment.disabled=!positive||debtActionBusy", MOBILE_JS)
        self.assertIn('negative?"Khách đang dư "+absolute', MOBILE_JS)
        self.assertIn(':"Khách không còn nợ"', MOBILE_JS)


if __name__ == "__main__":
    unittest.main()
