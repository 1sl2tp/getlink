from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
JS = ROOT / "order-management.js"
MIGRATION = ROOT / "supabase/migrations/20260910113000_getlink_native_sales_core.sql"


class NativeSalesSchemaContractTests(unittest.TestCase):
    def test_native_schema_exists_and_owns_orders_items_and_debt(self):
        self.assertTrue(MIGRATION.exists(), "native GETLINK sales migration must exist")
        text = MIGRATION.read_text(encoding="utf-8")
        for name in (
            "getlink_sales_orders",
            "getlink_sales_order_items",
            "getlink_debt_ledger",
            "getlink_sales_create_order",
            "getlink_sales_deliver_order",
            "getlink_sales_return_order",
            "getlink_sales_record_payment",
        ):
            self.assertIn(name, text)
        self.assertIn("enable row level security", text.lower())
        self.assertIn("grant execute", text.lower())
        self.assertIn("service_role", text)

    def test_native_schema_uses_chat_identity_not_legacy_customer_registry(self):
        text = MIGRATION.read_text(encoding="utf-8") if MIGRATION.exists() else ""
        self.assertIn("references public.v21_accounts", text)
        self.assertNotIn("references public.accounts", text)


class NativeSalesEdgeContractTests(unittest.TestCase):
    def edge_text(self):
        return EDGE.read_text(encoding="utf-8")

    def test_edge_uses_only_native_sales_business_objects(self):
        text = self.edge_text()
        for required in (
            'db.from("getlink_sales_orders")',
            'db.from("getlink_sales_order_items")',
            'db.from("getlink_debt_ledger")',
            'db.rpc("getlink_sales_create_order"',
            'db.rpc("getlink_sales_deliver_order"',
            'db.rpc("getlink_sales_return_order"',
            'db.rpc("getlink_sales_record_payment"',
        ):
            self.assertIn(required, text)

        for banned in (
            'db.from("orders")',
            'db.from("order_items")',
            'db.from("debts")',
            'db.from("products")',
            "taphoa_",
            "getlink_create_v21_order",
            "getlink_approve_v21_order",
            "getlink_cancel_v21_order",
        ):
            self.assertNotIn(banned, text)

    def test_edge_keeps_chat_identity_and_getlink_product_authority(self):
        text = self.edge_text()
        self.assertIn('db.auth.getUser(token)', text)
        self.assertIn('db.from("v21_accounts")', text)
        self.assertIn('db.from("getlink_supplier_products")', text)
        self.assertIn("product_code", text)
        self.assertIn("display_price_vnd", text)
        self.assertNotIn("/1000", text.replace(" ", ""))

    def test_edge_exposes_native_order_and_debt_routes(self):
        text = self.edge_text()
        self.assertIn('/deliver', text)
        self.assertIn('/return', text)
        self.assertIn('/debts', text)
        self.assertIn('/payments', text)


class NativeSalesFrontendContractTests(unittest.TestCase):
    def js_text(self):
        return JS.read_text(encoding="utf-8")

    def test_frontend_uses_native_status_and_deliver_route(self):
        text = self.js_text()
        self.assertIn('delivered:"Đã giao"', text.replace(" ", ""))
        self.assertIn('/deliver', text)
        self.assertNotIn('/approve', text)

    def test_frontend_money_is_full_vnd(self):
        text = self.js_text()
        self.assertIn("moneyVnd", text)
        self.assertNotIn("moneyFromCore", text)
        self.assertNotIn("Number(value||0)*1000", text.replace(" ", ""))

    def test_frontend_has_debt_view_contract(self):
        text = self.js_text()
        self.assertIn("Công nợ", text)
        self.assertIn("Dư nợ sau giao dịch", text)
        self.assertIn('/debts', text)
        self.assertIn('/payments', text)


if __name__ == "__main__":
    unittest.main()
