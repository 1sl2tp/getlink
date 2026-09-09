import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "style.css").read_text(encoding="utf-8")


class V44SearchAndRowContractTest(unittest.TestCase):
    def test_user_work_input_does_not_skip_composing_input(self):
        block = re.search(
            r'const userWorkSearch=\$\("#userWorkSearch"\);.*?\n}\n',
            APP,
            re.S,
        )
        self.assertIsNotNone(block)
        self.assertNotIn("if(e.isComposing)return;", block.group(0))
        self.assertIn('userWorkSearch.addEventListener("input"', block.group(0))

    def test_search_normalization_is_diacritic_insensitive(self):
        self.assertIn('.normalize("NFD")', APP)
        self.assertIn('.replace(/[\\u0300-\\u036f]/g,"")', APP)
        self.assertIn('.replace(/đ/gi,"d")', APP)

    def test_user_work_search_has_specific_token_fallback(self):
        self.assertRegex(APP, r'function\s+userWorkFallbackToken\s*\(')
        self.assertRegex(APP, r'function\s+userWorkRows\s*\(\).*?userWorkFallbackToken', re.S)

    def test_v44_order_row_resets_legacy_product_card_width(self):
        block = re.search(r'\.user-work-order-row\s*\{([^}]*)\}', CSS, re.S)
        self.assertIsNotNone(block)
        self.assertRegex(block.group(1), r'min-width\s*:\s*0')


if __name__ == "__main__":
    unittest.main()
