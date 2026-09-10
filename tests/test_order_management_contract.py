from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
JS = ROOT / "order-management.js"
CSS = ROOT / "order-management.css"
CONFIG = ROOT / "config.js"


class OrderBackendContractTests(unittest.TestCase):
    def edge_text(self):
        self.assertTrue(EDGE.exists(), "getlink-orders edge function must exist")
        return EDGE.read_text(encoding="utf-8")

    def test_backend_reuses_shop88_order_core(self):
        text = self.edge_text()
        self.assertIn('taphoa_create_order_with_debt', text)
        self.assertIn('taphoa_approve_order_with_debt', text)
        self.assertIn('taphoa_cancel_order', text)
        self.assertNotIn('create table', text.lower())

    def test_customer_identity_is_session_scoped(self):
        text = self.edge_text()
        self.assertIn('x-taphoa-session', text)
        self.assertIn('.from("sessions")', text)
        self.assertIn('.from("accounts")', text)
        self.assertRegex(text, r'role\s*!==\s*"customer"|role\s*===\s*"customer"')
        self.assertRegex(text, r'\.eq\("customer_id",\s*account\.id\)|\.eq\("customer_id",\s*identity\.id\)')

    def test_admin_identity_uses_existing_getlink_admin_session(self):
        text = self.edge_text()
        self.assertIn('x-getlink-admin', text)
        self.assertIn('admin_session_hash', text)
        self.assertIn('admin_session_expires_at', text)

    def test_create_uses_server_side_supplier_price_and_pending_status(self):
        text = self.edge_text()
        self.assertIn('getlink_supplier_products', text)
        self.assertIn('display_price_vnd', text)
        self.assertIn('input_price_vnd', text)
        self.assertRegex(text, r'display_price_vnd[^\n]{0,180}/\s*1000|/\s*1000[^\n]{0,180}display_price_vnd')
        self.assertIn('trangThai:"pending"', text.replace(" ", ""))
        self.assertNotRegex(text, r'body\?\.(?:price|gia|customer_id|maKH)')

    def test_admin_transitions_preserve_debt_rules(self):
        text = self.edge_text().replace(" ", "")
        self.assertIn('taphoa_approve_order_with_debt', text)
        self.assertIn('taphoa_cancel_order', text)
        self.assertIn('p_reverse_debt:true', text)
        self.assertRegex(text, r'pending.*done.*returned|\["pending","done","returned"\]')


class OrderFrontendContractTests(unittest.TestCase):
    def js_text(self):
        self.assertTrue(JS.exists(), "order-management.js must exist")
        return JS.read_text(encoding="utf-8")

    def test_config_loads_order_module(self):
        text = CONFIG.read_text(encoding="utf-8")
        self.assertIn("order-management.js", text)
        self.assertIn("order-management.css", text)

    def test_send_buttons_are_intercepted_before_legacy_draft_handler(self):
        text = self.js_text()
        self.assertIn("#userWorkSendOrder,#mobileUserSendOrder", text)
        self.assertRegex(text, r'addEventListener\(\s*["\']click["\'][\s\S]{0,120}true\s*\)')
        self.assertIn("stopImmediatePropagation", text)

    def test_frontend_sends_only_product_locator_and_quantity(self):
        text = self.js_text()
        self.assertRegex(text, r'items\s*:\s*selected\.map')
        self.assertRegex(text, r'url\s*:\s*item\.row\.canonical_url')
        self.assertRegex(text, r'qty\s*:\s*item\.qty')
        forbidden = ["customer_id:", "maKH:", "unit_price:", "gia:", "cost:", "von:"]
        for token in forbidden:
            self.assertNotIn(token, text)

    def test_frontend_has_three_order_status_tabs(self):
        text = self.js_text()
        for label in ("Đơn tạm", "Đã giao", "Đã hoàn"):
            self.assertIn(label, text)
        for status in ('pending', 'done', 'returned'):
            self.assertIn(status, text)

    def test_customer_login_is_demand_driven_and_admin_reuses_getlink_session(self):
        text = self.js_text()
        self.assertIn("taphoa-api", text)
        self.assertIn("getlink:update-admin-session", text)
        self.assertIn("getlink:taphoa-order-session", text)
        self.assertIn("Đăng nhập", text)

    def test_order_module_has_dedicated_responsive_styles(self):
        self.assertTrue(CSS.exists(), "order-management.css must exist")
        text = CSS.read_text(encoding="utf-8")
        self.assertIn("@media", text)
        self.assertIn("order-manager", text)


if __name__ == "__main__":
    unittest.main()
