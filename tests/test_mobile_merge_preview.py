import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")
HTML=(ROOT/"index.html").read_text(encoding="utf-8")
EDGE=(ROOT/"supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")


class MobileMergePreviewContractTest(unittest.TestCase):
    def test_merge_panel_has_preview_and_single_apply_action(self):
        for token in [
            'id="mobileMergePreview"',
            'id="mobileMergePreviewImage"',
            'id="mobileMergePreviewBrand"',
            'id="mobileMergePreviewSize"',
            'id="mobileMergePreviewPack"',
            'id="mobileMergePreviewCode"',
            'id="mobileMergePreviewSources"',
            'id="mobileMergeApply"',
        ]:
            self.assertIn(token,HTML)
        self.assertIn("Bản xem trước",HTML)

    def test_selecting_sources_only_stages_preview_and_does_not_write(self):
        self.assertIn("function toggleMobileMergeSource",APP)
        block=re.search(r"function\s+toggleMobileMergeSource\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("mobileMergeSelected",body)
        self.assertIn("renderUserWorkHome()",body)
        self.assertNotIn('"/api/product-merge"',body)
        self.assertNotIn("fetch(",body)

    def test_existing_links_are_visible_and_can_be_unselected_before_apply(self):
        self.assertIn("function resetMobileMergeSelectionForTarget",APP)
        self.assertIn("mobileMergeTargetMembers()",APP)
        self.assertRegex(APP,r"mobileMergeSelected\.add\(canonical\(item\.canonical_url\)\)")
        button=re.search(r"function\s+mobileMergeSelectButton\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(button)
        self.assertNotIn("alreadyLinked||blocked",button.group(1))
        self.assertIn("data-mobile-merge-source",button.group(1))

    def test_preview_explains_value_and_source_for_identity_pack_code_and_image(self):
        for token in [
            "function buildMobileMergePreview",
            "identitySource",
            "packSource",
            "imageSource",
            "mobileMergeIdentityCode",
            "sourceDisplayLabel",
        ]:
            self.assertIn(token,APP)
        self.assertIn("renderMobileMergePreview",APP)

    def test_apply_is_the_only_write_and_sends_confirmed_sources(self):
        block=re.search(r"async function\s+applyMobileMergePreview\s*\(\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn('"/api/product-merge"',body)
        self.assertIn("member_urls",body)
        self.assertIn("identity_source_url",body)
        self.assertIn("pack_source_url",body)
        self.assertIn("image_source_url",body)
        self.assertIn("replace_members:true",body)
        self.assertIn("await fetchLibraryFromSupabase()",body)

    def test_backend_replace_members_removes_unselected_links_only_on_apply(self):
        self.assertIn("replace_members",EDGE)
        self.assertIn("removedMemberUrls",EDGE)
        self.assertRegex(EDGE,r'\.delete\(\)\.eq\("canonical_product_id",targetCanonicalId\)')
        self.assertRegex(EDGE,r'\.in\("source_url",removedMemberUrls\)')

    def test_supermarket_source_card_stays_original(self):
        block=re.search(r"function\s+mobileUserMarketCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("canonicalDisplayName(row)",body)
        self.assertIn("rowPrimaryQc(row)",body)
        self.assertNotIn("canonical_product_name",body)
        self.assertNotIn("canonicalProductQc",body)


if __name__=="__main__":
    unittest.main()
