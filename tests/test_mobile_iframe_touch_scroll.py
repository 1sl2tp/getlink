from pathlib import Path
import unittest

CSS = Path(__file__).resolve().parents[1].joinpath("taphoa-mobile-standard.css").read_text("utf-8")


class MobileIframeTouchScroll(unittest.TestCase):
    def test_embed_has_definite_scroll_owner_and_search_is_interactive(self):
        self.assertIn('html[data-getlink-embed="1"] #mobileUserWork', CSS)
        self.assertIn('height:100%!important', CSS)
        self.assertIn('html[data-getlink-embed="1"] #mobileUserResults', CSS)
        self.assertIn('overflow-y:auto!important', CSS)
        self.assertIn('-webkit-overflow-scrolling:touch', CSS)
        self.assertIn('html[data-getlink-embed="1"] #mobileUserSearch', CSS)
        self.assertIn('pointer-events:auto!important', CSS)


if __name__ == "__main__":
    unittest.main()
