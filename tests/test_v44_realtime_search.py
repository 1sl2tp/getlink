import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "style.css").read_text(encoding="utf-8")


class V44RealtimeSearchContractTest(unittest.TestCase):
    def test_user_search_does_not_drop_composing_input_events(self):
        block = re.search(
            r'const userWorkSearch=\$\("#userWorkSearch"\);[\s\S]*?'
            r'const mobileUserSearch=\$\("#mobileUserSearch"\);',
            APP,
        )
        self.assertIsNotNone(block)
        self.assertNotIn("if(e.isComposing)return", block.group(0))
        self.assertIn('userWorkSearch.addEventListener("input"', block.group(0))
        self.assertIn("renderUserWorkHome()", block.group(0))

    def test_user_search_has_and_then_specific_token_fallback(self):
        self.assertIn("function userWorkSearchMatches", APP)
        self.assertRegex(APP, r"tokens\.every\(token=>hay\.includes\(token\)\)")
        self.assertRegex(APP, r"fallbackToken\s*=\s*tokens\[tokens\.length-1\]")
        self.assertRegex(APP, r"item\.hay\.includes\(fallbackToken\)")

    def test_vietnamese_search_normalization_remains_accent_insensitive(self):
        self.assertIn('.normalize("NFD")', APP)
        self.assertRegex(APP, r"replace\(/\[\\u0300-\\u036f\]/g")
        self.assertRegex(APP, r"replace\(/đ/gi,\s*[\"']d[\"']\)")


class V44OrderRowIsolationContractTest(unittest.TestCase):
    def test_v44_order_row_resets_legacy_product_card_min_width(self):
        self.assertRegex(
            CSS,
            r"\.user-work-order-row\.product-card\s*\{[^}]*min-width\s*:\s*0",
        )


if __name__ == "__main__":
    unittest.main()
