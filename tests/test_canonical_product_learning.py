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

    def test_mobile_can_reopen_existing_own_target_then_add_more_sources(self):
        self.assertIn("mobileMergeTargetUrl",APP)
        self.assertIn("mobileMergeTargetMembers",APP)
        self.assertIn("setMobileMergeTarget",APP)
        self.assertIn("toggleMobileMergeSource",APP)
        self.assertIn("applyMobileMergePreview",APP)
        self.assertIn("canonical_product_id",APP)

    def test_merge_panel_is_quick_and_identity_is_learned_automatically(self):
        self.assertIn('id="mobileMergeTarget"',HTML)
        self.assertIn('id="mobileMergePassword"',HTML)
        self.assertNotIn('id="mobileMergeIdentitySource"',HTML)
        self.assertNotIn('id="mobileMergeConfirm"',HTML)
        self.assertIn("canonicalIdentityRowScore",EDGE)
        self.assertIn("barcode",EDGE)
        self.assertIn("sku",EDGE)
        self.assertIn("source_code",EDGE)
        self.assertIn("identity_source_url",EDGE)

    def test_own_card_uses_canonical_image_pack_and_only_plain_own_price(self):
        block=re.search(r"function\s+mobileUserCanonicalMineCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
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
