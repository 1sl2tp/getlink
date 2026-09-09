import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "style.css").read_text(encoding="utf-8")
CONFIG = (ROOT / "config.js").read_text(encoding="utf-8")


class V44SearchAndOrderRegressionTest(unittest.TestCase):
    def test_user_work_row_resets_legacy_product_card_min_width(self):
        self.assertRegex(
            CSS,
            r"\.user-work-order-row\.product-card\s*\{[^}]*min-width\s*:\s*0",
        )

    def test_user_work_search_renders_every_input_in_core(self):
        block = re.search(
            r'const userWorkSearch=\$\("#userWorkSearch"\);[\s\S]*?'
            r'const mobileUserSearch=\$\("#mobileUserSearch"\);',
            APP,
        )
        self.assertIsNotNone(block)
        self.assertIn('userWorkSearch.addEventListener("input"', block.group(0))
        self.assertNotIn("if(e.isComposing)return", block.group(0))
        self.assertIn("renderUserWorkHome();", block.group(0))

    def test_user_work_search_has_and_then_specific_token_fallback(self):
        self.assertIn("function userWorkSearchMatches", APP)
        self.assertIn("function userWorkFallbackToken", APP)
        self.assertIn("const strict=mapped.filter", APP)
        self.assertIn("if(!strict.length&&tokens.length>1)", APP)
        self.assertIn("item.hay.includes(fallbackToken)", APP)

    def test_search_key_keeps_vietnamese_diacritic_insensitive_contract(self):
        self.assertIn('.normalize("NFD")', APP)
        self.assertIn('.replace(/[\\u0300-\\u036f]/g,"")', APP)
        self.assertIn('.replace(/đ/gi,"d")', APP)

    def test_runtime_hotfix_loader_is_retired(self):
        self.assertNotIn("v44-user-hotfix", CONFIG)


if __name__ == "__main__":
    unittest.main()
