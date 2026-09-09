import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")

class MobileSourceHierarchyTest(unittest.TestCase):
    def test_parent_scope_has_only_mine_and_market(self):
        self.assertIn('const MOBILE_USER_SCOPES=["mine","market"];', APP)
        self.assertIn('mine:"Tạp hóa"', APP)
        self.assertIn('market:"Siêu thị"', APP)

    def test_market_children_are_supermarkets(self):
        self.assertIn('const MOBILE_MARKET_SOURCES=["bhx","wm","go"];', APP)

    def test_supplier_child_uses_supplier_source_key(self):
        self.assertRegex(APP, r'function mobileSupplierSourceKey\(row\)[\s\S]*?supplier_source_key')

    def test_mobile_rows_filter_parent_then_child(self):
        m=re.search(r'function mobileUserRows\(\)\{([\s\S]*?)\n\}', APP)
        self.assertIsNotNone(m)
        body=m.group(1)
        self.assertIn('mobileUserScope==="mine"', body)
        self.assertIn('mobileUserScope==="market"', body)
        self.assertIn('mobileUserChildSource', body)

    def test_source_tabs_render_parent_and_child_levels(self):
        m=re.search(r'function renderMobileUserSourceTabs\(\)\{([\s\S]*?)\n\}', APP)
        self.assertIsNotNone(m)
        body=m.group(1)
        self.assertIn('mobile-user-source-level parent', body)
        self.assertIn('mobile-user-source-level child', body)
        self.assertIn('data-mobile-scope', body)
        self.assertIn('data-mobile-source', body)

if __name__=="__main__":
    unittest.main()
