from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
CONFIG = ROOT / "config.js"


class OrderRuntimeBootstrapContract(unittest.TestCase):
    def test_legacy_sales_runtime_is_not_loaded_by_getlink(self):
        text = INDEX.read_text(encoding="utf-8")
        config = CONFIG.read_text(encoding="utf-8")
        for asset in [
            "order-management.js",
            "order-management.css",
            "order-customer-picker.css",
            "taphoa-mobile-standard.js",
            "taphoa-mobile-standard.css",
        ]:
            self.assertNotIn(asset, text)
            self.assertNotIn(asset, config)

    def test_bootstrap_loads_only_config_then_catalog_app(self):
        text = INDEX.read_text(encoding="utf-8")
        config_load = text.index('runtime.assetUrl("config.js",build)')
        app_load = text.index('runtime.assetUrl("app.js",build)')
        self.assertLess(config_load, app_load)
        self.assertNotIn("getlinkTaphoa", CONFIG.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
