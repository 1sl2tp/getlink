from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = (ROOT / "supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")
APP = (ROOT / "app.js").read_text(encoding="utf-8")
MIGRATION = ROOT / "supabase/migrations/20260910143000_unified_sales_core.sql"


class UnifiedSalesOrderContractTest(unittest.TestCase):
    def test_sales_schema_exists_and_uses_v21_accounts_as_customer_identity(self):
        self.assertTrue(MIGRATION.exists(), "unified sales migration must exist")
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create table if not exists public.getlink_sales_orders", sql)
        self.assertIn("create table if not exists public.getlink_sales_order_items", sql)
        self.assertIn("create table if not exists public.getlink_debt_ledger", sql)
        self.assertIn("references public.v21_accounts(id)", sql)
        self.assertRegex(sql, r"status[^\n]+pending[^\n]+delivered[^\n]+reversed")
        self.assertIn("enable row level security", sql)

    def test_user_customer_is_server_owned_and_admin_customer_is_required(self):
        self.assertIn("function salesOrderCustomer", EDGE)
        self.assertIn('account.role==="user"', EDGE)
        self.assertIn("return account.id", EDGE)
        self.assertIn("sales_customer_required", EDGE)
        self.assertIn("sales_customer_invalid", EDGE)

    def test_order_lifecycle_matches_taphoa_pending_deliver_reverse(self):
        for route in (
            "/api/sales/orders",
            "/deliver",
            "/reverse",
        ):
            self.assertIn(route, EDGE)
        self.assertIn('status:"pending"', EDGE)
        self.assertIn('status:"delivered"', EDGE)
        self.assertIn('status:"reversed"', EDGE)
        self.assertIn('kind:"sale"', EDGE)
        self.assertIn('kind:"reversal"', EDGE)

    def test_tap_hoa_send_order_is_server_backed_not_localstorage_order_db(self):
        start = APP.index("function saveUserWorkOrderDraft")
        end = APP.find("\nfunction ", start + 10)
        block = APP[start : end if end > start else start + 9000]
        self.assertIn('/api/sales/orders', block)
        self.assertNotIn('localStorage.setItem("getlink:work-order-draft"', block)
        self.assertIn("customer_account_id", block)
        self.assertIn("pending", block)

    def test_admin_customer_selection_and_user_self_identity_are_explicit(self):
        self.assertIn("salesBootstrap", APP)
        self.assertIn("salesSelectedCustomerId", APP)
        self.assertIn("sharedAccountContext", APP)
        self.assertIn("Đã tạo đơn tạm", APP)


if __name__ == "__main__":
    unittest.main()
