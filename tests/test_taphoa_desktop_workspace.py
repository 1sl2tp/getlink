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
        for asset in [
            "taphoa-desktop-workspace.css",
            "taphoa-desktop-workspace.js",
            "taphoa-desktop-data.js",
            "taphoa-desktop-sales.js",
            "taphoa-desktop-orders.js",
            "taphoa-desktop-debts.js",
        ]:
            self.assertIn(asset, config)

    def test_build_stamp_tracks_new_workspace_assets(self):
        stamp = (ROOT / "tools" / "stamp_static_build.py").read_text("utf-8")
        for asset in [
            "taphoa-desktop-workspace.js",
            "taphoa-desktop-workspace.css",
            "taphoa-desktop-data.js",
            "taphoa-desktop-sales.js",
            "taphoa-desktop-orders.js",
            "taphoa-desktop-debts.js",
        ]:
            self.assertIn(asset, stamp)

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

    def test_sales_view_is_three_slot_and_row_local(self):
        js = (ROOT / "taphoa-desktop-sales.js").read_text("utf-8")
        self.assertIn("renderCategories", js)
        self.assertIn("renderMaster", js)
        self.assertIn("renderDetail", js)
        self.assertIn("updateQtyRow", js)
        self.assertIn("searchProducts", js)
        self.assertIn("upsertProduct", js)
        self.assertNotIn("renderUserWorkHome", js)
        self.assertNotIn("MutationObserver", js)
        self.assertNotIn("scrollTop=0", js)

    def test_orders_view_owns_source_list_and_detail_separately(self):
        js = (ROOT / "taphoa-desktop-orders.js").read_text("utf-8")
        self.assertIn("renderSourceRail", js)
        self.assertIn("renderOrderList", js)
        self.assertIn("renderOrderDetail", js)
        self.assertIn("selectOrder", js)
        self.assertNotIn("replaceWith", js)
        self.assertNotIn("replaceChildren", js)
        self.assertNotIn("MutationObserver", js)
        self.assertNotIn("scrollTop=0", js)

    def test_debt_view_maps_customer_timeline_and_detail(self):
        js = (ROOT / "taphoa-desktop-debts.js").read_text("utf-8")
        self.assertIn("renderCustomers", js)
        self.assertIn("renderTimeline", js)
        self.assertIn("renderDetail", js)
        self.assertIn("Dư nợ sau giao dịch", js)
        self.assertNotIn("MutationObserver", js)

    def test_workspace_switches_views_without_recreating_shell(self):
        js = (ROOT / "taphoa-desktop-workspace.js").read_text("utf-8")
        self.assertIn("activateView", js)
        self.assertIn("TaphoaDesktopSales", js)
        self.assertIn("TaphoaDesktopOrders", js)
        self.assertIn("TaphoaDesktopDebts", js)
        self.assertNotIn("root.remove()", js)


if __name__ == "__main__":
    unittest.main()
