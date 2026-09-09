import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "style.css").read_text(encoding="utf-8")
PATCH_JS_PATH = ROOT / "v44-user-hotfix.js"
PATCH_CSS_PATH = ROOT / "v44-user-hotfix.css"
PATCH_JS = PATCH_JS_PATH.read_text(encoding="utf-8") if PATCH_JS_PATH.exists() else ""
PATCH_CSS = PATCH_CSS_PATH.read_text(encoding="utf-8") if PATCH_CSS_PATH.exists() else ""
JS = APP + "\n" + PATCH_JS
STYLES = CSS + "\n" + PATCH_CSS


class V44SearchAndOrderRegressionTest(unittest.TestCase):
    def test_user_work_row_resets_legacy_product_card_min_width(self):
        self.assertRegex(
            STYLES,
            r"\.user-work-order-row(?:\.product-card)?\s*\{[^}]*min-width\s*:\s*0",
            "V44 order rows must override the legacy .product-card min-width",
        )

    def test_user_work_search_renders_during_ime_input(self):
        self.assertIn('userWorkSearch.addEventListener("input"', JS)
        self.assertIn("e.isComposing", JS)
        self.assertRegex(PATCH_JS, r'e\.isComposing[\s\S]*libraryQuery[\s\S]*renderUserWorkHome\(\)')

    def test_user_work_search_has_and_then_specific_token_fallback(self):
        self.assertIn("userWorkSearchMatches", JS)
        self.assertIn("userWorkFallbackToken", JS)
        self.assertRegex(PATCH_JS, r"strict\.length[\s\S]*userWorkFallbackToken")
        self.assertRegex(PATCH_JS, r"fallback[\s\S]*item\.hay\.includes\(fallback\)")

    def test_search_key_keeps_vietnamese_diacritic_insensitive_contract(self):
        self.assertIn('.normalize("NFD")', APP)
        self.assertIn('.replace(/[\\u0300-\\u036f]/g,"")', APP)
        self.assertIn('.replace(/đ/gi,"d")', APP)

    def test_bootstrap_loads_v44_hotfix_assets(self):
        config = (ROOT / "config.js").read_text(encoding="utf-8")
        self.assertIn("v44-user-hotfix.css", config)
        self.assertIn("v44-user-hotfix.js", config)


if __name__ == "__main__":
    unittest.main()
