from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "order-management.js"


class OrderManagerWorkNavContract(unittest.TestCase):
    def test_work_view_exposes_order_and_debt_management(self):
        text = JS.read_text(encoding="utf-8")

        self.assertIn("function ensureWorkManagerNav()", text)
        self.assertIn('document.querySelector(".user-work-jump")', text)
        self.assertIn('document.querySelector(".mobile-user-source-row")', text)
        self.assertIn('data-order-work-view="orders"', text)
        self.assertIn('data-order-work-view="debts"', text)
        self.assertIn("Đơn của tôi", text)
        self.assertIn("Công nợ", text)

    def test_work_nav_opens_existing_scoped_manager(self):
        text = JS.read_text(encoding="utf-8")

        self.assertIn('[data-order-work-view]', text)
        self.assertIn('activeView=String(workView.dataset.orderWorkView||"orders")', text)
        self.assertIn('debtCustomerId=String(currentAccount()?.id||"")', text)
        self.assertIn("openManager();", text)


if __name__ == "__main__":
    unittest.main()
