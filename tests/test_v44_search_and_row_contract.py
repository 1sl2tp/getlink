import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
CONFIG = (ROOT / "config.js").read_text(encoding="utf-8")
HOTFIX_JS = (ROOT / "v44-user-hotfix.js").read_text(encoding="utf-8")
HOTFIX_CSS = (ROOT / "v44-user-hotfix.css").read_text(encoding="utf-8")


class V44SearchAndRowContractTest(unittest.TestCase):
    def test_runtime_loads_v44_hotfix_assets(self):
        self.assertIn('v44-user-hotfix.css?v=', CONFIG)
        self.assertIn('v44-user-hotfix.js?v=', CONFIG)
        self.assertIn('data-getlink-v44-hotfix', CONFIG)

    def test_realtime_search_covers_normal_and_composing_input(self):
        # app.js handles ordinary input; the V44 hotfix fills Safari/IME composing input.
        self.assertIn('userWorkSearch.addEventListener("input"', APP)
        self.assertIn('if(e.isComposing)return;', APP)
        self.assertIn('userWorkSearch.addEventListener("input"', HOTFIX_JS)
        self.assertIn('if(!e.isComposing)return;', HOTFIX_JS)
        self.assertIn('renderUserWorkHome();', HOTFIX_JS)

    def test_search_normalization_is_diacritic_insensitive(self):
        self.assertIn('.normalize("NFD")', APP)
        self.assertIn('.replace(/[\\u0300-\\u036f]/g,"")', APP)
        self.assertIn('.replace(/đ/gi,"d")', APP)

    def test_multi_token_search_falls_back_to_specific_token(self):
        self.assertRegex(HOTFIX_JS, r'function\s+userWorkFallbackToken\s*\(')
        self.assertIn('const strict=mapped.filter', HOTFIX_JS)
        self.assertIn('if(!strict.length&&tokens.length>1)', HOTFIX_JS)
        self.assertIn('item.hay.includes(fallback)', HOTFIX_JS)
        self.assertIn('userWorkRows=function()', HOTFIX_JS)

    def test_v44_order_row_isolated_from_legacy_product_card_width(self):
        block = re.search(
            r'\.user-work-order-row\.product-card\s*\{([^}]*)\}',
            HOTFIX_CSS,
            re.S,
        )
        self.assertIsNotNone(block)
        self.assertRegex(block.group(1), r'min-width\s*:\s*0\s*!important')
        self.assertRegex(block.group(1), r'grid-template-columns\s*:\s*var\(--work-order-columns\)\s*!important')


if __name__ == "__main__":
    unittest.main()
