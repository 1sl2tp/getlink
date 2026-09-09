import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")
HTML=(ROOT/"index.html").read_text(encoding="utf-8")
EDGE=(ROOT/"supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")
MIGRATIONS=list((ROOT/"supabase/migrations").glob("*canonical_product_merge*.sql"))
MIGRATION="\n".join(p.read_text(encoding="utf-8") for p in MIGRATIONS)


class CanonicalProductMergeContractTest(unittest.TestCase):
    def test_schema_keeps_canonical_product_separate_from_source_rows(self):
        self.assertTrue(MIGRATIONS,"canonical product merge migration must exist")
        self.assertIn("getlink_canonical_products",MIGRATION)
        self.assertIn("getlink_canonical_product_members",MIGRATION)
        self.assertIn("canonical_name",MIGRATION)
        self.assertIn("image_url",MIGRATION)
        self.assertIn("pack_label_1",MIGRATION)
        self.assertIn("source_url",MIGRATION)
        self.assertRegex(MIGRATION,r"enable\s+row\s+level\s+security",re.I)

    def test_merge_write_is_admin_protected_and_persists_members(self):
        self.assertIn('route==="/api/product-merge"',EDGE)
        self.assertRegex(
            EDGE,
            r'if\(req\.method==="POST"&&route==="/api/product-merge"\)\{\s*'
            r'if\(!\(await adminSessionAuthorized\(req\)\)\)'
        )
        self.assertIn("saveCanonicalProductMerge",EDGE)
        self.assertIn("member_urls",EDGE)
        self.assertIn("canonical_name",EDGE)
        self.assertIn("image_source_url",EDGE)
        self.assertIn("pack_source_url",EDGE)

    def test_public_catalog_exposes_canonical_metadata_without_overwriting_source_price(self):
        for token in [
            "canonical_product_id",
            "canonical_product_name",
            "canonical_product_image",
            "canonical_pack_label_1",
            "canonical_pack_qty_1",
            "canonical_pack_label_2",
            "canonical_pack_qty_2",
            "canonical_pack_label_3",
            "canonical_pack_qty_3",
        ]:
            self.assertIn(token,EDGE)
        self.assertIn("current_price:Number(row?.current_price",EDGE)

    def test_mobile_has_quick_merge_mode(self):
        for token in [
            'id="mobileMergeToggle"',
            'id="mobileMergePanel"',
            'id="mobileMergeTarget"',
            'id="mobileMergePassword"',
            'id="mobileMergeStatus"',
        ]:
            self.assertIn(token,HTML)
        self.assertNotIn('id="mobileMergeConfirm"',HTML)

    def test_mobile_merge_previews_then_posts_only_on_apply(self):
        for token in [
            "mobileMergeMode",
            "mobileMergeTargetUrl",
            "renderMobileMergePanel",
            "toggleMobileMergeSource",
            "renderMobileMergePreview",
            "applyMobileMergePreview",
            '"/api/product-merge"',
            "member_urls",
        ]:
            self.assertIn(token,APP)
        self.assertIn("canonicalIdentityRowScore",EDGE)
        self.assertIn("canonicalPackRowScore",EDGE)

    def test_source_rows_stay_separate_and_only_own_row_uses_canonical_enrichment(self):
        self.assertIn("function mobileUserCanonicalMineCard",APP)
        self.assertIn("function mobileUserMarketCard",APP)
        market=re.search(r"function\s+mobileUserMarketCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(market)
        self.assertNotIn("canonical_product_name",market.group(1))
        self.assertNotIn("canonicalProductQc",market.group(1))


if __name__=="__main__":
    unittest.main()
