from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
JS = ROOT / "order-management.js"
LEGACY_TRANSITION_MIGRATION = ROOT / "supabase/migrations/20260910092000_v21_order_identity.sql"
NATIVE_MIGRATION = ROOT / "supabase/migrations/20260910113000_getlink_native_sales_core.sql"


class ChatIdentityHistoricalMigrationContract(unittest.TestCase):
    def test_old_transition_migration_remains_historical_only(self):
        self.assertTrue(LEGACY_TRANSITION_MIGRATION.exists())
        text = LEGACY_TRANSITION_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("add column if not exists chat_account_id uuid", text)
        self.assertNotRegex(text, r"delete\s+from\s+public\.(?:orders|debts)\s*;")
        self.assertNotRegex(text, r"truncate\s+(?:table\s+)?public\.(?:orders|debts)")

    def test_native_migration_does_not_copy_legacy_business_rows(self):
        self.assertTrue(NATIVE_MIGRATION.exists())
        text = NATIVE_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("getlink_sales_orders", text)
        self.assertIn("references public.v21_accounts", text)
        self.assertNotRegex(text, r"insert\s+into\s+public\.getlink_sales_orders[\s\S]{0,300}\bfrom\s+public\.orders\b")
        self.assertNotRegex(text, r"insert\s+into\s+public\.getlink_debt_ledger[\s\S]{0,300}\bfrom\s+public\.debts\b")
        self.assertNotIn("insert into public.accounts", text)


class ChatIdentityOrderBackendContract(unittest.TestCase):
    def text(self):
        return EDGE.read_text(encoding="utf-8")

    def test_chat_jwt_is_the_primary_order_identity(self):
        text = self.text()
        self.assertIn('db.auth.getUser(token)', text)
        self.assertIn('db.from("v21_accounts")', text)
        self.assertIn('.eq("auth_user_id",', text)
        self.assertRegex(text, r'role\s*===\s*"admin"|role\s*!==\s*"admin"')
        self.assertRegex(text, r'role\s*===\s*"user"|role\s*!==\s*"user"')

    def test_admin_customer_list_comes_from_chat_accounts(self):
        text = self.text()
        self.assertIn('GET"&&path==="/customers"', text.replace(" ", ""))
        self.assertIn('.eq("role","user")', text.replace(" ", ""))
        self.assertIn('display_name', text)
        self.assertIn('deleted_at', text)
        self.assertIn('locked_at', text)

    def test_admin_must_choose_chat_user_before_creating_pending_order(self):
        text = self.text()
        self.assertIn('customerId', text)
        self.assertIn('selectedCustomer', text)
        self.assertRegex(text, r'actor\.kind\s*===\s*"admin"')
        self.assertIn('Chưa chọn khách hàng', text)
        self.assertIn('status:"pending"', text.replace(" ", ""))

    def test_normal_user_can_only_create_and_read_for_self(self):
        text = self.text()
        self.assertRegex(text, r'actor\.kind\s*===\s*"customer"')
        self.assertRegex(text, r'\.eq\("customer_account_id",\s*actor\.id\)')
        self.assertRegex(text, r'actor\.kind\s*===\s*"customer"[\s\S]{0,200}selectedCustomer\(actor\.id\)')

    def test_manager_reads_only_native_getlink_orders(self):
        text = self.text()
        self.assertIn('db.from("getlink_sales_orders")', text)
        self.assertNotIn('db.from("orders")', text)
        self.assertNotIn('chat_account_id', text)


class ChatIdentityOrderFrontendContract(unittest.TestCase):
    def text(self):
        return JS.read_text(encoding="utf-8")

    def test_getlink_accepts_chat_auth_bridge_from_exact_origin(self):
        text = self.text()
        self.assertIn('https://chat.taphoa.xyz', text)
        self.assertIn('taphoa-chat-auth', text)
        self.assertIn('window.addEventListener("message"', text)
        self.assertIn('event.origin!==CHAT_ORIGIN', text.replace(" ", ""))
        self.assertIn('accessToken', text)

    def test_order_api_uses_chat_bearer_token(self):
        text = self.text()
        self.assertRegex(text, r'authorization["\']?\s*,\s*["\']Bearer ')

    def test_getlink_does_not_own_chat_password_login(self):
        text = self.text()
        self.assertNotIn('/auth/v1/token?grant_type=password', text)
        self.assertNotIn('function chatLogin(', text)
        self.assertNotIn('orderLoginPassword', text)

    def test_admin_send_requires_customer_picker(self):
        text = self.text()
        self.assertIn('/customers', text)
        self.assertIn('orderCustomerPicker', text)
        self.assertIn('selectedCustomerId', text)
        self.assertIn('Chọn khách hàng', text)
        self.assertRegex(text, r'JSON\.stringify\(\{items,customerId')

    def test_user_send_does_not_supply_another_customer(self):
        text = self.text()
        self.assertRegex(text, r'currentRole\(\)===?"admin"')
        self.assertRegex(text, r'JSON\.stringify\(\{items\}\)')


if __name__ == "__main__":
    unittest.main()
