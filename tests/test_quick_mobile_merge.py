import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")
HTML=(ROOT/"index.html").read_text(encoding="utf-8")
EDGE=(ROOT/"supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")


class QuickMobileMergeContractTest(unittest.TestCase):
    def test_merge_panel_is_quick_target_status_not_attribute_form(self):
        self.assertIn('id="mobileMergeTarget"',HTML)
        self.assertIn('id="mobileMergeStatus"',HTML)
        self.assertIn('id="mobileMergePassword"',HTML)
        self.assertNotIn('id="mobileMergeIdentitySource"',HTML)
        self.assertNotIn('id="mobileMergeNameSource"',HTML)
        self.assertNotIn('id="mobileMergePackSource"',HTML)
        self.assertNotIn('id="mobileMergeImageSource"',HTML)
        self.assertNotIn('id="mobileMergeConfirm"',HTML)

    def test_merge_mode_has_one_persistent_own_target(self):
        self.assertIn("let mobileMergeTargetUrl",APP)
        self.assertIn("function setMobileMergeTarget",APP)
        self.assertIn("function mobileMergeTargetMembers",APP)
        self.assertIn("if(!isMineRow(row)&&id)",APP)
        self.assertIn("mobileMergeTargetUrl=canonical(row.canonical_url)",APP)

    def test_tapping_related_source_saves_immediately_and_keeps_mode_open(self):
        self.assertIn("async function quickAttachMobileMergeSource",APP)
        block=re.search(r"async function quickAttachMobileMergeSource\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn('"/api/product-merge"',body)
        self.assertIn("member_urls",body)
        self.assertIn("await fetchLibraryFromSupabase()",body)
        self.assertIn("renderUserWorkHome()",body)
        self.assertNotIn("mobileMergeMode=false",body)
        self.assertNotIn("mobileMergeTargetUrl=",body)

    def test_supermarket_rows_keep_original_source_rendering_after_link(self):
        market=re.search(r"function\s+mobileUserMarketCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(market)
        body=market.group(1)
        self.assertIn("canonicalDisplayName(row)",body)
        self.assertIn("rowPrimaryQc(row)",body)
        self.assertIn("sourceDisplayLabel(row)",body)
        self.assertNotIn("canonical_product_name",body)
        self.assertNotIn("canonicalProductQc",body)

    def test_own_linked_row_uses_canonical_enrichment_but_plain_own_price(self):
        self.assertIn("function mobileUserCanonicalMineCard",APP)
        block=re.search(r"function\s+mobileUserCanonicalMineCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("canonical_product_image",body)
        self.assertIn("canonicalProductQc(row)",body)
        self.assertIn("mobileUserSalePrice(row)",body)
        self.assertIn("mobileUserOwnRetail(row)",body)
        self.assertNotIn("mobileUserSourcePrice",body)
        self.assertNotIn("Giá bán",body)
        self.assertNotIn(">Tạp hóa<",body)

    def test_auto_pack_prefers_richer_confirmed_pack_source(self):
        self.assertIn("function canonicalPackRowScore",EDGE)
        self.assertRegex(EDGE,r"pack_label_1.*Thùng")
        self.assertRegex(EDGE,r"pack_qty_3")
        self.assertRegex(EDGE,r"canonicalPackRowScore\(b\)-canonicalPackRowScore\(a\)")

    def test_auto_identity_prefers_code_and_image_follows_best_identity_when_available(self):
        self.assertIn("canonicalIdentityRowScore",EDGE)
        self.assertRegex(EDGE,r"barcode.*1000")
        self.assertIn("identityRow",EDGE)
        self.assertRegex(EDGE,r"clean\(identityRow\?\.image\)")


if __name__=="__main__":
    unittest.main()
