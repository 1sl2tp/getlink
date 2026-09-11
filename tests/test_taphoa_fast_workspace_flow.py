import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
ORDER = (ROOT / "order-management.js").read_text(encoding="utf-8")
CSS = (ROOT / "order-management.css").read_text(encoding="utf-8")
STYLE = (ROOT / "style.css").read_text(encoding="utf-8")


def function_block(name):
    match = re.search(r"(?:async )?function " + re.escape(name) + r"\([^)]*\)\{([\s\S]*?)\n  \}", ORDER)
    return match.group(1) if match else None


class TaphoaFastWorkspaceFlowTest(unittest.TestCase):
    def test_workspace_nav_is_taphoa_only_and_has_sales_orders_debt(self):
        self.assertIn('data-taphoa-work-view="sales"', ORDER)
        self.assertIn('data-taphoa-work-view="orders"', ORDER)
        self.assertIn('data-taphoa-work-view="debts"', ORDER)
        self.assertIn("function isTaphoaWorkspaceActive()", ORDER)

    def test_success_paths_do_not_clear_selected_customer_or_open_manager(self):
        for name in ("submitSelectedOrder", "submitQuickSale", "updateEditingOrder", "cancelEditOrder"):
            block = function_block(name)
            self.assertIsNotNone(block, name)
            self.assertNotIn("clearSelectedCustomer()", block, name)
        for name in ("submitSelectedOrder", "submitQuickSale"):
            block = function_block(name)
            self.assertIsNotNone(block, name)
            self.assertNotIn("openManager()", block, name)

    def test_busy_state_is_rendered_on_sales_actions(self):
        self.assertIn("function setSalesBusyState(", ORDER)
        self.assertIn("aria-busy", ORDER)
        self.assertRegex(ORDER, r"Đang gửi…|Đang gửi\.\.\.")
        self.assertRegex(ORDER, r"Đang bán…|Đang bán\.\.\.")
        self.assertRegex(ORDER, r"Đang cập nhật…|Đang cập nhật\.\.\.")

    def test_compact_business_money_formatter(self):
        self.assertIn("function compactMoney(", ORDER)
        self.assertIn("Math.round(n/500)*.5", ORDER)
        self.assertNotIn('toLocaleString("vi-VN")+" ₫"', ORDER)

    def test_recency_sort_helpers_exist(self):
        self.assertIn("function sortOrdersNewestFirst(", ORDER)
        self.assertIn("function sortDebtCustomersNewestFirst(", ORDER)
        self.assertIn("function newestDebtTimeline(", ORDER)

    def test_desktop_manager_is_inline_not_fixed_overlay(self):
        self.assertRegex(CSS, r"\.order-manager\{[^}]*position:(?:relative|static|absolute)")
        self.assertNotRegex(CSS, r"\.order-manager\{[^}]*position:fixed")
        self.assertIn("taphoa-workspace", CSS + STYLE)

    def test_touch_and_focus_contracts_remain(self):
        self.assertIn("--order-touch:44px", CSS)
        self.assertRegex(CSS, r":focus-visible")
        self.assertRegex(CSS, r":active")

    def test_no_duplicate_old_work_nav_owner(self):
        self.assertNotIn("workManagerNavMarkup", ORDER)
        self.assertNotIn("ensureWorkManagerNav", ORDER)

    def test_business_money_surfaces_use_compact_formatter(self):
        for name in ("renderOrders", "renderDebtSummaries", "renderDebtLinkedOrder", "renderDebtDetail"):
            block = function_block(name)
            self.assertIsNotNone(block, name)
            self.assertNotIn("moneyVnd(", block, name)


if __name__ == "__main__":
    unittest.main()
