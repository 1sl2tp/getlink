import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")


class SourceSwitchHotPathTest(unittest.TestCase):
    def test_catalog_keeps_dom_cache_per_filter_state(self):
        self.assertIn("const productViewDomCache={", APP)
        self.assertIn("PRODUCT_VIEW_DOM_CACHE_LIMIT=8", APP)
        self.assertIn("function stashRenderedProductView(view){", APP)
        self.assertIn("function restoreRenderedProductView(view,key,viewProducts){", APP)
        self.assertIn("document.createDocumentFragment()", APP)
        self.assertIn("host.replaceChildren(cached.fragment)", APP)

    def test_cached_view_preserves_decoded_images_and_scroll_position(self):
        self.assertIn("while(host.firstChild)fragment.appendChild(host.firstChild);", APP)
        self.assertIn("scrollTop=Number(scrollHost?.scrollTop)||0", APP)
        self.assertIn("scrollHost.scrollTop=Number(cached.scrollTop)||0", APP)

    def test_source_switch_does_not_zero_old_scroll_before_stashing(self):
        block=APP.split("function setActiveSourceFilter(",1)[1].split("function nextTableSourceFilter",1)[0]
        self.assertNotIn("resetActiveCatalogScroll()", block)
        self.assertIn("renderLibraryProducts();", block)

    def test_first_visit_starts_at_top_but_returning_source_restores_cache(self):
        block=APP.split("function renderActiveProductView(products){",1)[1].split("function initCatalogLocalObserver",1)[0]
        self.assertIn("stashRenderedProductView(view);", block)
        self.assertIn("restoreRenderedProductView(view,key,viewProducts)", block)
        self.assertIn("if(scrollHost)scrollHost.scrollTop=0;", block)


if __name__=="__main__":
    unittest.main()
