from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TaphoaHotPathPerformanceContract(unittest.TestCase):
    def test_runtime_loads_before_feedback_layer(self):
        config = (ROOT / "config.js").read_text(encoding="utf-8")
        hot = config.find("taphoa-hot-path-runtime.js")
        feedback = config.find("taphoa-workspace-feedback.js")
        self.assertGreaterEqual(hot, 0, "hot-path runtime must be loaded")
        self.assertGreater(feedback, hot, "hot-path runtime must install capture/filter guards before feedback runtime")

    def test_taphoa_search_uses_own_ram_index(self):
        js = (ROOT / "taphoa-hot-path-runtime.js").read_text(encoding="utf-8")
        self.assertIn("TAPHOA_HOT_PATHS_V1", js)
        self.assertIn("buildTaphoaIndex", js)
        self.assertIn("taphoaRowsForQuery", js)
        self.assertIn("userWorkDesktopScope!==\"mine\"", js)
        self.assertIn("event.stopImmediatePropagation()", js)

    def test_qty_click_is_row_local_and_summary_is_ram_backed(self):
        js = (ROOT / "taphoa-hot-path-runtime.js").read_text(encoding="utf-8")
        self.assertIn("qtyState", js)
        self.assertIn("updateQtyDom", js)
        self.assertIn("updateSummaryFast", js)
        self.assertNotIn("userWorkSelectedItems()", js)

    def test_infinite_scroll_appends_without_full_workspace_render(self):
        js = (ROOT / "taphoa-hot-path-runtime.js").read_text(encoding="utf-8")
        self.assertIn("appendTaphoaRows", js)
        self.assertIn('insertAdjacentHTML("beforeend"', js)
        block = js[js.index("function appendTaphoaRows"):js.index("function installTaphoaAutoload")]
        self.assertNotIn("renderUserWorkHome", block)
        self.assertNotIn("scrollTop=0", block)

    def test_feedback_observer_ignores_invoice_self_render_loop(self):
        js = (ROOT / "taphoa-hot-path-runtime.js").read_text(encoding="utf-8")
        self.assertIn("filterFeedbackObserverRecords", js)
        self.assertIn(".order-detail-pane", js)
        self.assertIn("NativeMutationObserver", js)

    def test_quick_add_inserts_returned_product_without_catalog_reload(self):
        js = (ROOT / "taphoa-hot-path-runtime.js").read_text(encoding="utf-8")
        self.assertIn("insertManualProduct", js)
        self.assertIn("data?.product", js)
        self.assertNotIn("fetchLibraryFromSupabase", js)

    def test_order_source_report_moves_to_left_rail(self):
        js = (ROOT / "taphoa-hot-path-runtime.js").read_text(encoding="utf-8")
        css = (ROOT / "taphoa-hot-path-runtime.css").read_text(encoding="utf-8")
        self.assertIn("taphoa-source-left-slot", js)
        self.assertIn("order-source-report", js)
        self.assertIn(".taphoa-source-left-slot", css)


if __name__ == "__main__":
    unittest.main()
