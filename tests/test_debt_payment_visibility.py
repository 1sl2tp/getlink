from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER_JS = (ROOT / "order-management.js").read_text("utf-8")
ORDER_CSS = (ROOT / "order-management.css").read_text("utf-8")


class DebtPaymentVisibility(unittest.TestCase):
    def test_mobile_admin_always_sees_payment_control(self):
        self.assertIn('const canCollect=Number(debtDetail?.balanceVnd||0)>0;', ORDER_JS)
        self.assertNotIn('Number(debtDetail?.balanceVnd||0)<=0)return "";', ORDER_JS)
        self.assertIn('data-debt-payment-disabled', ORDER_JS)
        self.assertIn('>Thu tiền</button>', ORDER_JS)

    def test_non_positive_balance_is_visible_but_locked(self):
        self.assertIn('Khách đang dư', ORDER_JS)
        self.assertIn('Không còn nợ để thu', ORDER_JS)
        self.assertIn('if(!canCollect)return;', ORDER_JS)
        self.assertIn('.debt-payment-form[data-debt-payment-disabled="true"]', ORDER_CSS)
        self.assertIn('.debt-payment-state', ORDER_CSS)


if __name__ == "__main__":
    unittest.main()
