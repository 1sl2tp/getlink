from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
JS = ROOT / "order-management.js"
CSS = ROOT / "order-management.css"
PICKER_CSS = ROOT / "order-customer-picker.css"
CONFIG = ROOT / "config.js"


class OrderBackendContractTests(unittest.TestCase):
    def edge_text(self):
        self.assertTrue(EDGE.exists(), "getlink-orders edge function must exist")
        return EDGE.read_text(encoding="utf-8")

    def test_backend_reuses_shop88_tables_with_v21_atomic_order_core(self):
        text = self.edge_text()
        self.assertIn('getlink_create_v21_order', text)
        self.assertIn('getlink_approve_v21_order', text)
        self.assertIn('getlink_cancel_v21_order', text)
        self.assertIn('.from("orders")', text)
        self.assertIn('.from("order_items")', text)
        self.assertNotIn('create table', text.lower())

    def test_customer_identity_is_chat_jwt_scoped(self):
        text = self.edge_text()
        self.assertIn('authorization', text)
        self.assertIn('db.auth.getUser(token)', text)
        self.assertIn('.from("v21_accounts")', text)
        self.assertIn('.eq("auth_user_id",', text)
        self.assertRegex(text, r'role\s*!==\s*"user"|role\s*===\s*"user"')
        self.assertRegex(text, r'\.eq\("chat_account_id",\s*actor\.id\)')

    def test_admin_identity_comes_from_same_chat_account_table(self):
        text = self.edge_text()
        self.assertRegex(text, r'role\s*!==\s*"admin"|role\s*===\s*"admin"')
        self.assertNotIn('x-getlink-admin', text)
        self.assertNotIn('admin_session_hash', text)

    def test_create_uses_server_side_supplier_price_and_pending_status(self):
        text = self.edge_text()
        self.assertIn('getlink_supplier_products', text)
        self.assertIn('display_price_vnd', text)
        self.assertIn('input_price_vnd', text)
        self.assertRegex(text, r'display_price_vnd[^\n]{0,180}/\s*1000|/\s*1000[^\n]{0,180}display_price_vnd')
        self.assertIn('trangThai:"pending"', text.replace(" ", ""))
        self.assertNotRegex(text, r'body\?\.(?:price|gia|customer_name|tenKH)')

    def test_admin_transitions_preserve_debt_rules(self):
        text = self.edge_text().replace(" ", "")
        self.assertIn('getlink_approve_v21_order', text)
        self.assertIn('getlink_cancel_v21_order', text)
        self.assertIn('p_reverse_debt:true', text)
        self.assertRegex(text, r'pending.*done.*returned|\["pending","done","returned"\]')


class OrderFrontendContractTests(unittest.TestCase):
    def js_text(self):
        self.assertTrue(JS.exists(), "order-management.js must exist")
        return JS.read_text(encoding="utf-8")

    def test_config_loads_order_module_and_customer_picker(self):
        text = CONFIG.read_text(encoding="utf-8")
        self.assertIn("order-management.js", text)
        self.assertIn("order-management.css", text)
        self.assertIn("order-customer-picker.css", text)

    def test_send_buttons_are_intercepted_before_legacy_draft_handler(self):
        text = self.js_text()
        self.assertIn("#userWorkSendOrder,#mobileUserSendOrder", text)
        capture_listener = re.search(
            r'document\.addEventListener\("click",async event=>\{[\s\S]*?'
            r'#userWorkSendOrder,#mobileUserSendOrder[\s\S]*?'
            r'stopImmediatePropagation\(\);[\s\S]*?'
            r'\},true\);',
            text,
        )
        self.assertIsNotNone(capture_listener, "send-order click must be intercepted in capture phase")

    def test_frontend_sends_server_trusted_product_locator_and_quantity(self):
        text = self.js_text()
        self.assertRegex(text, r'const\s+items\s*=\s*selected\.map')
        self.assertRegex(text, r'url\s*:\s*item\.row\.canonical_url')
        self.assertRegex(text, r'qty\s*:\s*item\.qty')
        self.assertIn('JSON.stringify({items})', text)
        self.assertIn('JSON.stringify({items,customerId})', text)
        # Local display variables such as customerName are allowed; they must not
        # be serialized into the create-order payload. Price/cost fields are also
        # forbidden because the server owns those values.
        for token in ("unit_price:", "gia:", "cost:", "von:"):
            self.assertNotIn(token, text)
        self.assertNotRegex(text, r'JSON\.stringify\(\{items(?:,customerId)?,customerName')
        self.assertNotRegex(text, r'JSON\.stringify\(\{items[^}]*?(?:price|gia|cost|von)')

    def test_frontend_has_three_order_status_tabs(self):
        text = self.js_text()
        for label in ("Đơn tạm", "Đã giao", "Đã hoàn"):
            self.assertIn(label, text)
        for status in ('pending', 'done', 'returned'):
            self.assertIn(status, text)

    def test_customer_access_is_chat_sourced_and_admin_chooses_customer(self):
        text = self.js_text()
        self.assertIn("taphoa-chat-auth", text)
        self.assertIn("taphoa-getlink-auth-request", text)
        self.assertIn("authorization", text)
        self.assertIn("orderCustomerPicker", text)
        self.assertNotIn("/auth/v1/token?grant_type=password", text)
        self.assertNotIn("getlink:taphoa-order-session", text)

    def test_order_module_has_dedicated_responsive_styles(self):
        self.assertTrue(CSS.exists(), "order-management.css must exist")
        self.assertTrue(PICKER_CSS.exists(), "customer picker css must exist")
        text = CSS.read_text(encoding="utf-8") + PICKER_CSS.read_text(encoding="utf-8")
        self.assertIn("@media", text)
        self.assertIn("order-manager", text)
        self.assertIn("order-customer-picker", text)


if __name__ == "__main__":
    unittest.main()
