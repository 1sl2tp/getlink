import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")
CSS=(ROOT/"style.css").read_text(encoding="utf-8")


class ScrollOwnershipContractTest(unittest.TestCase):
    def test_no_document_level_auto_scroll_or_fake_category_spacer(self):
        self.assertNotIn("scrollIntoView(",APP)
        self.assertNotIn("window.scrollTo(",APP)
        self.assertNotIn("category-scroll-end-spacer",APP)
        self.assertNotIn("category-scroll-end-spacer",CSS)

    def test_dataset_changes_reset_only_the_active_result_owner(self):
        self.assertIn("function resetActiveCatalogScroll()",APP)
        for name in ("selectCategoryChip","queueLibrarySearch"):
            block=re.search(r"function "+name+r"\([^)]*\)\{([\s\S]*?)\n\}",APP)
            self.assertIsNotNone(block,name)
            self.assertIn("resetActiveCatalogScroll()",block.group(1))

        brand=re.search(r'\$\("#brandTabs"\)\.addEventListener\("click",e=>\{([\s\S]*?)\n\}\);',APP)
        pack=re.search(r'\$\("#packTabs"\)\.addEventListener\("click",e=>\{([\s\S]*?)\n\}\);',APP)
        self.assertIsNotNone(brand)
        self.assertIsNotNone(pack)
        self.assertIn("resetActiveCatalogScroll()",brand.group(1))
        self.assertIn("resetActiveCatalogScroll()",pack.group(1))

    def test_selection_lock_is_scoped_to_controls_not_product_content(self):
        self.assertRegex(CSS,r"Interaction selection \+ scroll ownership")
        self.assertRegex(CSS,r"\.mobile-user-source-level,[\s\S]*?user-select:none")
        self.assertRegex(CSS,r"\.mobile-user-results,[\s\S]*?user-select:text")


if __name__=="__main__":
    unittest.main()
