from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TaphoaStandardActionsContract(unittest.TestCase):
    def read(self, name: str) -> str:
        return (ROOT / name).read_text(encoding="utf-8")

    def test_sales_supports_order_line_name_price_quantity_edits(self):
        sales = self.read("taphoa-desktop-sales.js")
        orders = self.read("supabase/functions/getlink-orders/index.ts")
        self.assertIn("data-sales-name-edit", sales)
        self.assertIn("data-sales-price-edit", sales)
        self.assertIn("nameOverride", orders)
        self.assertIn("sellingPriceVnd", orders)
        self.assertIn('actor.kind==="admin"', orders)

    def test_debt_quick_entry_supports_payment_and_manual_debt(self):
        debt = self.read("taphoa-desktop-debts.js")
        orders = self.read("supabase/functions/getlink-orders/index.ts")
        self.assertIn("data-td-debt-quick-payment", debt)
        self.assertIn("data-td-debt-quick-debt", debt)
        self.assertIn("quickEntry", debt)
        self.assertIn("/adjustments", orders)
        self.assertIn("getlink_sales_record_debt_adjustment", orders)

    def test_manual_debt_rpc_is_additive_and_service_role_only(self):
        path = ROOT / "supabase/migrations/20260914050000_getlink_manual_debt_adjustment.sql"
        self.assertTrue(path.exists(), "manual debt adjustment migration must exist")
        sql = path.read_text(encoding="utf-8")
        self.assertIn("create or replace function public.getlink_sales_record_debt_adjustment", sql.lower())
        self.assertIn("'manual_adjustment'", sql)
        self.assertIn("'increase'", sql)
        self.assertIn("grant execute on function public.getlink_sales_record_debt_adjustment", sql.lower())
        self.assertIn("to service_role", sql.lower())


if __name__ == "__main__":
    unittest.main()
