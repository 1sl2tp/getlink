import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")


class MobileScopeInstantCacheTest(unittest.TestCase):
    def test_news_cards_use_article_image_directly_before_proxy_fallback(self):
        self.assertIn('src="\'+escapeAttr(image)+\'"', APP)
        self.assertNotIn('src="\'+escapeAttr(newsThumbUrl(image,thumbWidth))+\'"', APP)
        self.assertIn('data-news-fallback-proxy="0"', APP)

    def test_mobile_scope_switch_preserves_existing_result_nodes(self):
        self.assertIn('const mobileUserScopeViewCache=new Map();', APP)
        self.assertIn('function stashMobileUserScopeView(scope){', APP)
        self.assertIn('function restoreMobileUserScopeView(scope){', APP)
        self.assertIn('stashMobileUserScopeView(mobileUserScope);', APP)
        self.assertIn('if(restoreMobileUserScopeView(mobileUserScope))', APP)

    def test_scope_click_uses_fast_switch_path_instead_of_full_home_rerender(self):
        start=APP.index('const mobileScope=e.target.closest("[data-mobile-scope]");')
        end=APP.index('const mobileCategory=e.target.closest("[data-mobile-category]");', start)
        block=APP[start:end]
        self.assertIn('switchMobileUserScope(next);', block)
        self.assertNotIn('renderUserWorkHome();', block)


if __name__=='__main__':
    unittest.main()
