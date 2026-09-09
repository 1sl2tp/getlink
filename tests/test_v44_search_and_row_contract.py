import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
CONFIG = (ROOT / "config.js").read_text(encoding="utf-8")
CSS = (ROOT / "style.css").read_text(encoding="utf-8")


class V44SearchAndRowContractTest(unittest.TestCase):
    def test_runtime_no_longer_depends_on_v44_hotfix_assets(self):
        self.assertNotIn("v44-user-hotfix.css", CONFIG)
        self.assertNotIn("v44-user-hotfix.js", CONFIG)

    def test_realtime_search_covers_normal_and_composing_input_in_core(self):
        block = re.search(
            r'const userWorkSearch=\$\("#userWorkSearch"\);[\s\S]*?'
            r'const mobileUserSearch=\$\("#mobileUserSearch"\);',
            APP,
        )
        self.assertIsNotNone(block)
        self.assertIn('userWorkSearch.addEventListener("input"', block.group(0))
        self.assertNotIn('if(e.isComposing)return;', block.group(0))
        self.assertIn('renderUserWorkHome();', block.group(0))

    def test_search_normalization_is_diacritic_insensitive(self):
        self.assertIn('.normalize("NFD")', APP)
        self.assertIn('.replace(/[\\u0300-\\u036f]/g,"")', APP)
        self.assertIn('.replace(/đ/gi,"d")', APP)

    def test_multi_token_search_falls_back_to_specific_token(self):
        self.assertRegex(APP, r'function\s+userWorkFallbackToken\s*\(')
        self.assertIn('const strict=mapped.filter', APP)
        self.assertIn('if(!strict.length&&tokens.length>1)', APP)
        self.assertIn('item.hay.includes(fallbackToken)', APP)

    def test_v44_order_row_isolated_from_legacy_product_card_width(self):
        block = re.search(
            r'\.user-work-order-row\.product-card\s*\{([^}]*)\}',
            CSS,
            re.S,
        )
        self.assertIsNotNone(block)
        self.assertRegex(block.group(1), r'min-width\s*:\s*0\s*!important')
        self.assertRegex(block.group(1), r'grid-template-columns\s*:\s*var\(--work-order-columns\)\s*!important')


if __name__ == "__main__":
    unittest.main()
