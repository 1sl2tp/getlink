import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")

class MobileSourceHierarchyTest(unittest.TestCase):
    def test_entry_scope_is_supermarket_only(self):
        self.assertIn('const MOBILE_USER_SCOPES=["market"];', APP)
        self.assertIn('market:"Siêu thị"', APP)
        self.assertIn('const MOBILE_USER_SCOPE_LABELS={market:"Siêu thị"};', APP)
        self.assertIn('let mobileUserScope="market";', APP)

    def test_market_children_are_supermarkets(self):
        self.assertIn('const MOBILE_MARKET_SOURCES=["bhx","wm","go","vinamilk"];', APP)

    def test_supplier_child_uses_supplier_source_key(self):
        self.assertRegex(APP, r'function mobileSupplierSourceKey\(row\)[\s\S]*?supplier_source_key')

    def test_mobile_rows_filter_parent_then_child(self):
        m=re.search(r'function mobileUserRows\(\)\{([\s\S]*?)\n\}', APP)
        self.assertIsNotNone(m)
        body=m.group(1)
        self.assertIn('userWorkRowsForScope(mobileUserScope,mobileUserCategoryKey,userWorkSourceFilter)', body)
        self.assertIn('mobileUserScope==="market"', body)
        self.assertIn('userWorkMarketSortRows(baseRows)', body)

    def test_source_tabs_render_source_then_category(self):
        m=re.search(r'function renderMobileUserSourceTabs\(\)\{([\s\S]*?)\n\}', APP)
        self.assertIsNotNone(m)
        body=m.group(1)
        self.assertIn('mobile-user-source-level parent', body)
        self.assertIn('mobile-user-source-level child', body)
        self.assertIn('data-mobile-source-filter', body)
        self.assertIn('data-mobile-category', body)
        self.assertIn('renderUserWorkCategoryButtons(categoryHost,"market"', body)

if __name__=="__main__":
    unittest.main()
