from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "order-management.js"


class OrderManagerWorkNavContract(unittest.TestCase):
    def test_taphoa_work_view_exposes_sales_orders_and_debt(self):
        text = JS.read_text(encoding="utf-8")

        self.assertIn("function ensureTaphoaWorkspaceNav()", text)
        self.assertIn("function isTaphoaWorkspaceActive()", text)
        self.assertIn('data-taphoa-work-view="sales"', text)
        self.assertIn('data-taphoa-work-view="orders"', text)
        self.assertIn('data-taphoa-work-view="debts"', text)
        self.assertIn(">Bán<", text)
        self.assertIn(">Đơn<", text)
        self.assertIn(">Công nợ<", text)
        self.assertNotIn("function ensureWorkManagerNav()", text)
        self.assertNotIn("workManagerNavMarkup", text)

    def test_taphoa_nav_reuses_existing_scoped_manager_state(self):
        text = JS.read_text(encoding="utf-8")

        self.assertIn('[data-taphoa-work-view]', text)
        self.assertIn('taphoaWorkView=String(workView.dataset.taphoaWorkView||"sales")', text)
        self.assertIn('activeView=taphoaWorkView==="debts"?"debts":"orders"', text)
        self.assertIn('debtCustomerId=String(currentAccount()?.id||"")', text)
        self.assertIn("syncTaphoaWorkspace();", text)


if __name__ == "__main__":
    unittest.main()
