from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"


class OrderRuntimeBootstrapContract(unittest.TestCase):
    def test_order_management_assets_are_loaded_after_app(self):
        text = INDEX.read_text(encoding="utf-8")

        self.assertIn('href="./order-management.css', text)
        self.assertIn('runtime.assetUrl("order-management.js",build)', text)
        self.assertIn('await loadScript(orderManagementUrl,build)', text)

        app_load = text.index('await loadScript(appUrl,build)')
        order_load = text.index('await loadScript(orderManagementUrl,build)')
        self.assertLess(app_load, order_load, "order management must bind after app.js defines Tạp hóa UI")


if __name__ == "__main__":
    unittest.main()
