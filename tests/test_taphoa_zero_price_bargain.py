from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
APP = ROOT / "app.js"
ORDER = ROOT / "order-management.js"
MIGRATION = ROOT / "supabase/migrations/20260911043000_getlink_order_bargain_snapshot.sql"


class TaphoaZeroPriceBargainContractTests(unittest.TestCase):
    def test_zero_selling_price_does_not_block_order_submission(self):
        text = EDGE.read_text(encoding="utf-8")
        self.assertNotIn('throw fail("Có sản phẩm chưa có giá bán")', text)
        self.assertIn(
            'const price=Math.max(0,Math.round(Number(row.display_price_vnd||0)))',
            text,
            "catalog selling price may be zero; quantity/product validity still gates submission",
        )

    def test_cart_payload_carries_bargain_as_separate_optional_value(self):
        app = APP.read_text(encoding="utf-8")
        order = ORDER.read_text(encoding="utf-8")
        edge = EDGE.read_text(encoding="utf-8")
        self.assertIn('bargain:readOwnPrice(row.canonical_url,"bargain")', app)
        self.assertIn("bargainPriceVnd", order)
        self.assertIn("bargainPriceVnd", edge)

    def test_order_snapshot_persists_bargain_without_replacing_sale_price(self):
        self.assertTrue(MIGRATION.exists(), "order bargain snapshot migration must exist")
        text = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("bargain_price_vnd bigint", text)
        self.assertIn("unit_price_vnd", text)
        self.assertIn("bargainPriceVnd", text)
        self.assertIn("unitPriceVnd", text)
        self.assertIn("sum((x.item->>'unitPriceVnd')", text)
        self.assertNotIn("sum((x.item->>'bargainPriceVnd')", text)

    def test_order_detail_displays_sale_and_bargain_when_bargain_exists(self):
        text = ORDER.read_text(encoding="utf-8")
        self.assertIn("orderItemPriceMarkup", text)
        self.assertIn("Giá bán", text)
        self.assertIn("Mặc cả", text)
        self.assertIn("bargainPrice", text)


if __name__ == "__main__":
    unittest.main()
