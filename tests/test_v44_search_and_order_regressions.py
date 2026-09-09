import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "style.css").read_text(encoding="utf-8")


class V44SearchAndOrderRegressionTest(unittest.TestCase):
    def test_user_work_row_resets_legacy_product_card_min_width(self):
        self.assertRegex(
            CSS,
            r"\.user-work-order-row\s*\{[^}]*min-width\s*:\s*0",
            "V44 order rows must override the legacy .product-card min-width",
        )

    def test_user_work_search_renders_during_ime_input(self):
        block = re.search(
            r'const userWorkSearch=\$\("#userWorkSearch"\);(.*?)(?:\n\n\n|\$\("#toggleMatchAudit")',
            APP,
            re.S,
        )
        self.assertIsNotNone(block)
        code = block.group(1)
        self.assertNotIn("if(e.isComposing)return", code)
        self.assertRegex(code, r'addEventListener\("input"[\s\S]*renderUserWorkHome\(\)')

    def test_user_work_search_has_and_then_specific_token_fallback(self):
        self.assertIn("function userWorkSearchMatches", APP)
        self.assertIn("function userWorkFallbackToken", APP)
        rows = re.search(r"function userWorkRows\(\)\{(.*?)\n\}", APP, re.S)
        self.assertIsNotNone(rows)
        code = rows.group(1)
        self.assertIn("userWorkSearchMatches", code)
        self.assertIn("userWorkFallbackToken", code)

    def test_search_key_keeps_vietnamese_diacritic_insensitive_contract(self):
        self.assertIn('.normalize("NFD")', APP)
        self.assertIn('.replace(/[\\u0300-\\u036f]/g,"")', APP)
        self.assertIn('.replace(/đ/gi,"d")', APP)


if __name__ == "__main__":
    unittest.main()
