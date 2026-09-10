from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
APP = ROOT / "app.js"
CONFIG = ROOT / "config.js"


class OrderRuntimeBootstrapContract(unittest.TestCase):
    def test_order_management_assets_are_loaded_once_after_app(self):
        text = INDEX.read_text(encoding="utf-8")
        config = CONFIG.read_text(encoding="utf-8")

        self.assertIn('runtime.assetUrl("order-management.css",build)', text)
        self.assertIn('runtime.assetUrl("order-customer-picker.css",build)', text)
        self.assertIn('runtime.assetUrl("order-management.js",build)', text)
        self.assertIn('await loadScript(orderManagementUrl,build)', text)

        app_load = text.index('await loadScript(appUrl,build)')
        order_load = text.index('await loadScript(orderManagementUrl,build)')
        self.assertLess(app_load, order_load, "order management must bind after app.js defines Tạp hóa UI")

        self.assertNotIn('order-management.js', config, "config.js must not inject a second/early order runtime")
        self.assertNotIn('order-management.css', config, "order CSS has one bootstrap owner")
        self.assertNotIn('order-customer-picker.css', config, "customer picker CSS has one bootstrap owner")

    def test_app_exports_the_live_selected_cart_to_order_runtime(self):
        text = APP.read_text(encoding="utf-8")
        self.assertIn('window.userWorkSelectedItems=userWorkSelectedItems', text)
        self.assertIn('window.renderUserWorkHome=renderUserWorkHome', text)
        self.assertIn('window.updateUserWorkOrderSummary=updateUserWorkOrderSummary', text)


if __name__ == "__main__":
    unittest.main()
