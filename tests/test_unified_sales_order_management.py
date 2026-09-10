from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
STYLE = (ROOT / "style.css").read_text(encoding="utf-8")
EDGE = (ROOT / "supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")


class UnifiedSalesOrderManagementTest(unittest.TestCase):
    def test_taphoa_has_order_management_surface(self):
        for token in (
            'id="salesOrderManager"',
            'id="salesOrderTabs"',
            'id="salesOrderList"',
            'data-sales-order-tab="pending"',
            'data-sales-order-tab="delivered"',
            'data-sales-order-tab="reversed"',
            'Đơn tạm',
            'Đã giao',
            'Đã hoàn',
        ):
            self.assertIn(token, INDEX)

    def test_order_manager_loads_canonical_server_orders(self):
        for token in (
            'let salesOrderTab="pending"',
            'async function loadSalesOrders',
            'function renderSalesOrders',
            'apiFetch("/api/sales/orders',
            'salesOrderList',
        ):
            self.assertIn(token, APP)

    def test_admin_actions_match_taphoa_lifecycle(self):
        for token in (
            'async function deliverSalesOrder',
            'async function reverseSalesOrder',
            'async function deleteSalesOrder',
            '"/deliver"',
            '"/reverse"',
            'method:"DELETE"',
        ):
            self.assertIn(token, APP)
        self.assertIn('account?.role==="admin"', APP)

    def test_user_order_manager_is_read_only_and_server_scoped(self):
        self.assertIn('salesOrderCanAdmin', APP)
        self.assertIn('if(!salesOrderCanAdmin())return', APP)
        self.assertIn('account.role==="user"', EDGE)
        self.assertIn('.eq("customer_account_id",account.id)', EDGE)

    def test_order_cards_show_customer_total_and_status_without_popups(self):
        for token in (
            'sales-order-card',
            'sales-order-customer',
            'sales-order-total',
            'sales-order-actions',
        ):
            self.assertIn(token, STYLE)
        self.assertNotIn('alert("Đã giao', APP)
        self.assertNotIn('alert("Đã hoàn', APP)


if __name__ == "__main__":
    unittest.main()
