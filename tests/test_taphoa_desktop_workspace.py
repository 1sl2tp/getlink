from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TaphoaDesktopWorkspaceContract(unittest.TestCase):
    def test_shell_has_three_permanent_slots_and_bottom_nav(self):
        js = (ROOT / "taphoa-desktop-workspace.js").read_text("utf-8")
        for token in [
            "taphoaDesktopWorkspace",
            "taphoaLeftRail",
            "taphoaMasterList",
            "taphoaDetailPane",
            "taphoaBottomNav",
        ]:
            self.assertIn(token, js)

    def test_shell_does_not_use_mutation_observer_or_cross_column_reparenting(self):
        js = (ROOT / "taphoa-desktop-workspace.js").read_text("utf-8")
        self.assertNotIn("MutationObserver", js)
        self.assertNotIn("replaceChildren(fresh", js)

    def test_config_loads_new_workspace_assets(self):
        config = (ROOT / "config.js").read_text("utf-8")
        self.assertIn("taphoa-desktop-workspace.css", config)
        self.assertIn("taphoa-desktop-workspace.js", config)

    def test_build_stamp_tracks_new_workspace_assets(self):
        stamp = (ROOT / "tools" / "stamp_static_build.py").read_text("utf-8")
        self.assertIn("taphoa-desktop-workspace.js", stamp)
        self.assertIn("taphoa-desktop-workspace.css", stamp)

    def test_desktop_data_owns_taphoa_only_product_index(self):
        js = (ROOT / "taphoa-desktop-data.js").read_text("utf-8")
        self.assertIn("buildProductIndex", js)
        self.assertIn("searchProducts", js)
        self.assertIn("upsertProduct", js)
        self.assertIn("isMineRow", js)
        self.assertNotIn("renderUserWorkHome", js)
        self.assertNotIn("fetchLibraryFromSupabase", js)

    def test_desktop_data_exposes_existing_backend_adapters_only(self):
        js = (ROOT / "taphoa-desktop-data.js").read_text("utf-8")
        self.assertIn("orderRequest", js)
        self.assertIn("productAddRequest", js)
        self.assertIn("getlink:chat-order-auth", js)
        self.assertIn("/getlink-orders", js)
        self.assertIn("/getlink-product-add", js)


if __name__ == "__main__":
    unittest.main()
