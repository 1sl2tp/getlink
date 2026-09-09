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
        block=re.search(
            r'if\(req\.method==="POST"&&route==="/api/product-merge"\)([\s\S]*?)\n\s*if\(',
            EDGE,
        )
        self.assertIsNotNone(block)
        self.assertIn("adminSessionAuthorized(req)",block.group(1))
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

    def test_mobile_has_merge_mode_and_inline_confirmation_panel(self):
        for token in [
            'id="mobileMergeToggle"',
            'id="mobileMergePanel"',
            'id="mobileMergeNameSource"',
            'id="mobileMergePackSource"',
            'id="mobileMergeImageSource"',
            'id="mobileMergePassword"',
            'id="mobileMergeConfirm"',
        ]:
            self.assertIn(token,HTML)

    def test_mobile_merge_selects_sources_and_posts_selected_standard_fields(self):
        for token in [
            "mobileMergeMode",
            "mobileMergeSelected",
            "renderMobileMergePanel",
            "saveMobileCanonicalMerge",
            '"/api/product-merge"',
            "member_urls",
            "name_source_url",
            "pack_source_url",
            "image_source_url",
        ]:
            self.assertIn(token,APP)

    def test_merged_members_render_as_one_canonical_card(self):
        self.assertIn("function mobileUserResultGroups",APP)
        self.assertIn("function mobileUserMergedCard",APP)
        self.assertIn("canonical_product_id",APP)
        self.assertIn("canonical_product_name",APP)
        self.assertIn("canonical_product_image",APP)
        self.assertIn("mobile-user-source-price",APP)


if __name__=="__main__":
    unittest.main()
