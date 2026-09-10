from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
JS = ROOT / "order-management.js"
MIGRATION = ROOT / "supabase/migrations/20260910092000_v21_order_identity.sql"


class ChatIdentityOrderMigrationContract(unittest.TestCase):
    def text(self):
        self.assertTrue(MIGRATION.exists(), "v21 order identity migration must exist")
        return MIGRATION.read_text(encoding="utf-8")

    def test_migration_is_additive_for_historical_orders(self):
        text = self.text().lower()
        self.assertIn("add column if not exists chat_account_id uuid", text)
        self.assertIn("references public.v21_accounts", text)
        self.assertNotRegex(text, r"delete\s+from\s+public\.(?:orders|debts)")
        self.assertNotRegex(text, r"truncate\s+(?:table\s+)?public\.(?:orders|debts)")
        self.assertNotIn("insert into public.accounts", text)

    def test_v21_orders_have_their_own_atomic_order_debt_rpcs(self):
        text = self.text()
        for name in (
            "getlink_create_v21_order",
            "getlink_approve_v21_order",
            "getlink_cancel_v21_order",
        ):
            self.assertIn(name, text)
        self.assertIn("chat_account_id", text)
        self.assertIn("order_debt", text)
        self.assertIn("order_return_reversal", text)

    def test_legacy_debt_identity_is_preserved_without_shadow_accounts(self):
        text = self.text().lower()
        self.assertIn("debts_customer_fkey_safety", text)
        self.assertIn("getlink_validate_debt_customer_identity", text)
        self.assertIn("v21:", text)
        self.assertNotIn("insert into public.accounts", text)


class ChatIdentityOrderBackendContract(unittest.TestCase):
    def text(self):
        return EDGE.read_text(encoding="utf-8")

    def test_chat_jwt_is_the_primary_order_identity(self):
        text = self.text()
        self.assertIn('db.auth.getUser(token)', text)
        self.assertIn('.from("v21_accounts")', text)
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
        self.assertIn('trangThai:"pending"', text.replace(" ", ""))

    def test_normal_user_can_only_create_order_for_self(self):
        text = self.text()
        self.assertRegex(text, r'actor\.kind\s*===\s*"customer"')
        self.assertRegex(text, r'\.eq\("chat_account_id",\s*actor\.id\)')
        self.assertRegex(text, r'actor\.kind\s*===\s*"customer"[\s\S]{0,300}selectedCustomer')

    def test_v21_manager_does_not_mix_legacy_orders(self):
        text = self.text()
        self.assertIn('.not("chat_account_id","is",null)', text.replace(" ", ""))


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

    def test_direct_login_uses_same_chat_supabase_account(self):
        text = self.text()
        self.assertIn('/auth/v1/token?grant_type=password', text)
        self.assertIn('@taphoa.chat', text)
        self.assertNotIn('replace(/\\/getlink-api$/,"/taphoa-api")', text)

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
