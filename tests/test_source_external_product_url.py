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

    def test_admin_detail_and_user_cards_share_external_url_builder(self):
        self.assertIn('$("#productLink").href=sourceExternalProductUrl(p)',APP)
        self.assertIn('function rowExternalProductUrl(row)',APP)
        self.assertIn('window.open(href,"_blank","noopener")',APP)

if __name__=="__main__":
    unittest.main()
