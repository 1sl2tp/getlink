import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")

class SourceExternalProductUrlContractTest(unittest.TestCase):
    def test_go_open_url_uses_public_product_route_id(self):
        block=re.search(r"function sourceExternalProductUrl\(product\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn('sourceKey==="go"',body)
        self.assertIn('identity.source_product_id',body)
        self.assertIn('"-i."+encodeURIComponent(id)',body)

    def test_vinamilk_open_url_uses_pack_and_size_not_variant(self):
        block=re.search(r"function sourceExternalProductUrl\(product\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn('sourceKey==="vinamilk"',body)
        self.assertIn('u.searchParams.set("pack",packChoice)',body)
        self.assertIn('u.searchParams.set("size",sizeChoice)',body)
        self.assertIn('u.search=""',body)

    def test_admin_and_user_share_external_url_builder(self):
        self.assertIn('syncProductSourceLink({...p,open_url:',APP)
        self.assertIn('function rowExternalProductUrl(row)',APP)
        self.assertGreaterEqual(APP.count('window.open(href,"_blank","noopener")'),2)

    def test_other_sources_keep_verified_original_url(self):
        block=re.search(r"function sourceExternalProductUrl\\(product\\)\\{([\\s\\S]*?)\\n\\}",APP)
        self.assertIsNotNone(block)
        self.assertIn('return verifiedSourceOpenUrl(raw)',block.group(1))

    def test_internal_store_rows_are_not_opened_as_external_products(self):
        self.assertIn('if(row&&!isMineRow(row))',APP)

if __name__=="__main__":
    unittest.main()
