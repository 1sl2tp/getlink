from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
JS = ROOT / "order-management.js"
CSS = ROOT / "order-management.css"
PICKER_CSS = ROOT / "order-customer-picker.css"
INDEX = ROOT / "index.html"


class OrderBackendContractTests(unittest.TestCase):
    def edge_text(self):
        self.assertTrue(EDGE.exists(), "getlink-orders edge function must exist")
        return EDGE.read_text(encoding="utf-8")

    def test_backend_uses_native_getlink_order_and_debt_core(self):
        text = self.edge_text()
        self.assertIn('db.from("getlink_sales_orders")', text)
        self.assertIn('db.from("getlink_sales_order_items")', text)
        self.assertIn('db.from("getlink_debt_ledger")', text)
        self.assertIn('db.rpc("getlink_sales_create_order"', text)
        self.assertIn('db.rpc("getlink_sales_deliver_order"', text)
        self.assertIn('db.rpc("getlink_sales_return_order"', text)
        self.assertNotIn('db.from("orders")', text)
        self.assertNotIn('db.from("debts")', text)
        self.assertNotIn('taphoa_', text)

    def test_customer_identity_is_chat_jwt_scoped(self):
        text = self.edge_text()
        self.assertIn('authorization', text)
        self.assertIn('db.auth.getUser(token)', text)
        self.assertIn('db.from("v21_accounts")', text)
        self.assertIn('.eq("auth_user_id",', text)
        self.assertRegex(text, r'role\s*!==\s*"user"|role\s*===\s*"user"')
        self.assertRegex(text, r'\.eq\("customer_account_id",\s*actor\.id\)')

    def test_admin_identity_comes_from_same_chat_account_table(self):
        text = self.edge_text()
        self.assertRegex(text, r'role\s*!==\s*"admin"|role\s*===\s*"admin"')
        self.assertNotIn('x-getlink-admin', text)
        self.assertNotIn('admin_session_hash', text)

    def test_create_uses_server_side_supplier_price_in_full_vnd(self):
        text = self.edge_text()
        self.assertIn('getlink_supplier_products', text)
        self.assertIn('product_code', text)
        self.assertIn('display_price_vnd', text)
        self.assertIn('input_price_vnd', text)
        self.assertNotIn('/1000', text.replace(' ', ''))
        self.assertIn('status:"pending"', text.replace(' ', ''))
        self.assertNotRegex(text, r'body\?\.(?:price|gia|customer_name|tenKH)')

    def test_admin_transitions_preserve_native_debt_rules(self):
        text = self.edge_text().replace(" ", "")
        self.assertIn('getlink_sales_deliver_order', text)
        self.assertIn('getlink_sales_return_order', text)
        self.assertIn('getlink_sales_record_payment', text)
        self.assertRegex(text, r'pending.*delivered.*returned|\["pending","delivered","returned"\]')
        self.assertIn('path==="/debts"', text)
        self.assertIn('debts\\/([^/]+)', text)
        self.assertIn('payments', text)


class OrderFrontendContractTests(unittest.TestCase):
    def js_text(self):
        self.assertTrue(JS.exists(), "order-management.js must exist")
        return JS.read_text(encoding="utf-8")

    def test_bootstrap_loads_order_module_and_customer_picker(self):
        text = INDEX.read_text(encoding="utf-8")
        self.assertIn('runtime.assetUrl("order-management.js",build)', text)
        self.assertIn('runtime.assetUrl("order-management.css",build)', text)
        self.assertIn('runtime.assetUrl("order-customer-picker.css",build)', text)

    def test_send_buttons_are_intercepted_before_other_handlers(self):
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
        for token in ("unit_price:", "gia:", "cost:", "von:"):
            self.assertNotIn(token, text)
        self.assertNotRegex(text, r'JSON\.stringify\(\{items(?:,customerId)?,customerName')

    def test_frontend_has_three_native_order_status_tabs(self):
        text = self.js_text()
        for label in ("Đơn tạm", "Đã giao", "Đã hoàn"):
            self.assertIn(label, text)
        for status in ('pending', 'delivered', 'returned'):
            self.assertIn(status, text)
        self.assertNotIn('data-order-status="done"', text)

    def test_customer_access_is_chat_sourced_and_admin_chooses_customer(self):
        text = self.js_text()
        self.assertIn("taphoa-chat-auth", text)
        self.assertIn("taphoa-getlink-auth-request", text)
        self.assertIn("authorization", text)
        self.assertIn("orderCustomerPicker", text)
        self.assertNotIn("/auth/v1/token?grant_type=password", text)
        self.assertNotIn("getlink:taphoa-order-session", text)

    def test_frontend_has_native_debt_management(self):
        text = self.js_text()
        self.assertIn('data-manager-view="debts"', text)
        self.assertIn('Công nợ', text)
        self.assertIn('Dư nợ sau giao dịch', text)
        self.assertIn('/payments', text)
        self.assertIn('moneyVnd', text)
        self.assertNotIn('moneyFromCore', text)

    def test_order_module_has_dedicated_responsive_styles(self):
        self.assertTrue(CSS.exists(), "order-management.css must exist")
        self.assertTrue(PICKER_CSS.exists(), "customer picker css must exist")
        text = CSS.read_text(encoding="utf-8") + PICKER_CSS.read_text(encoding="utf-8")
        self.assertIn("@media", text)
        self.assertIn("order-manager", text)
        self.assertIn("order-customer-picker", text)
        self.assertIn("debt-timeline", text)


if __name__ == "__main__":
    unittest.main()
