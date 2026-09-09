import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")
HTML=(ROOT/"index.html").read_text(encoding="utf-8")
EDGE=(ROOT/"supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")
MIGRATIONS="\n".join(
    p.read_text(encoding="utf-8")
    for p in (ROOT/"supabase/migrations").glob("*canonical_product*.sql")
)


class CanonicalProductLearningContractTest(unittest.TestCase):
    def test_canonical_identity_has_brand_size_and_best_code_source(self):
        for token in [
            "canonical_brand",
            "size_value",
            "size_unit",
            "primary_code",
            "primary_code_kind",
            "identity_source_url",
        ]:
            self.assertIn(token,MIGRATIONS)
        self.assertIn("canonicalIdentityFromRow",EDGE)
        self.assertRegex(EDGE,r"row\?\.barcode")
        self.assertRegex(EDGE,r"row\?\.sku")
        self.assertRegex(EDGE,r"row\?\.source_code")

    def test_existing_canonical_group_can_accept_more_related_members(self):
        self.assertNotIn("merge_member_already_grouped",EDGE)
        self.assertIn("existingCanonicalIds",EDGE)
        self.assertIn("targetCanonicalId",EDGE)
        self.assertRegex(EDGE,r'upsert\(memberRows,\{onConflict:"source_url"\}\)')
        self.assertRegex(EDGE,r'update\(productPatch\)\.eq\("id",targetCanonicalId\)')

    def test_mobile_can_select_an_existing_group_then_add_more_sources(self):
        self.assertIn("data-mobile-merge-group",APP)
        self.assertIn("toggleMobileMergeGroup",APP)
        self.assertIn("mobileMergeSelected",APP)
        self.assertNotRegex(APP,r"grouped\?'disabled")

    def test_merge_panel_has_identity_source_and_optional_name(self):
        self.assertIn('id="mobileMergeIdentitySource"',HTML)
        self.assertIn("Nhãn / dung tích / mã",HTML)
        self.assertIn("Tên chuẩn (có thể bỏ qua)",HTML)
        self.assertIn("mobileMergeIdentityScore",APP)
        self.assertIn("barcode",APP)
        self.assertIn("sku",APP)
        self.assertIn("source_code",APP)
        self.assertIn("identity_source_url",APP)

    def test_own_card_uses_canonical_image_pack_and_only_plain_own_price(self):
        block=re.search(r"function\s+mobileUserMergedCard\s*\(group\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("canonical_product_image",body)
        self.assertIn("canonicalProductQc",body)
        self.assertIn("mobileUserOwnRetail",body)
        self.assertNotIn("Giá bán",body)
        self.assertNotIn(">Tạp hóa<",body)

    def test_only_own_price_is_divided_to_retail(self):
        block=re.search(r"function\s+mobileUserOwnRetail\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("mobileUserSalePrice(row)",body)
        self.assertIn("canonicalLeafQty(row)",body)
        self.assertNotIn("userWorkPrimaryMarketPrice",body)

    def test_supermarket_suggestions_learn_confirmed_brand_and_size(self):
        self.assertIn("function mobileCanonicalSuggestionRank",APP)
        self.assertIn("canonical_brand",APP)
        self.assertIn("canonical_size_value",APP)
        self.assertIn("canonical_size_unit",APP)
        self.assertRegex(APP,r"mobileCanonicalSuggestionRank\(a\.row,profiles\)")
        self.assertRegex(APP,r"mobileCanonicalSuggestionRank\(b\.row,profiles\)")


if __name__=="__main__":
    unittest.main()
