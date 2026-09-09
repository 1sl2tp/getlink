import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
EDGE=(ROOT/"supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")
APP=(ROOT/"app.js").read_text(encoding="utf-8")


class CanonicalSupplierUrlCaseContractTest(unittest.TestCase):
    def test_canonical_member_map_uses_canonical_urls(self):
        self.assertRegex(
            EDGE,
            r"canonicalMemberByUrl=new Map\(canonicalMembers\.map\(\(x:any\)=>\[canonical\(clean\(x\.source_url\)\),x\]\)\)"
        )

    def test_canonical_fields_lookup_normalizes_supplier_url_before_lookup(self):
        block=re.search(
            r"const canonicalFields=\(sourceUrl:string\)=>\{([\s\S]*?)\n\s*\};",
            EDGE,
        )
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertRegex(body,r"canonicalMemberByUrl\.get\(canonical\(clean\(sourceUrl\)\)\)")

    def test_supplier_rows_still_keep_their_original_source_url(self):
        self.assertIn("canonical_url:clean(s.canonical_url)",EDGE)
        self.assertIn("...canonicalFields(clean(s.canonical_url))",EDGE)

    def test_mobile_own_card_reads_canonical_image_and_pack(self):
        block=re.search(r"function\s+mobileUserCanonicalMineCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("canonical_product_image",body)
        self.assertIn("canonicalProductQc(row)",body)


if __name__=="__main__":
    unittest.main()
