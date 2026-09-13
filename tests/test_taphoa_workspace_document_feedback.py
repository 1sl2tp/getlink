import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class TaphoaWorkspaceDocumentFeedbackContract(unittest.TestCase):
    def read(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_feedback_runtime_is_loaded_from_config(self):
        config = self.read("config.js")
        self.assertIn("taphoa-workspace-feedback.css", config)
        self.assertIn("taphoa-workspace-feedback.js", config)

    def test_sales_surface_is_four_columns_with_one_price_and_note(self):
        js = self.read("taphoa-workspace-feedback.js")
        css = self.read("taphoa-workspace-feedback.css")
        self.assertIn('const SALES_HEADERS=["Sản phẩm","Giá","Số lượng","Ghi chú"]', js)
        self.assertIn("data-work-note", js)
        self.assertIn("pickSingleSalePrice", js)
        self.assertIn("grid-template-columns:minmax(0,1fr) 96px 118px minmax(120px,168px)", css)

    def test_order_report_search_and_time_share_one_row_and_list_owns_scroll(self):
        css = self.read("taphoa-workspace-feedback.css")
        self.assertIn(".order-report-controls", css)
        self.assertIn("grid-template-columns:minmax(0,1fr) auto", css)
        self.assertIn(".order-manager-list", css)
        self.assertIn("overflow:auto", css)
        self.assertIn(".user-work-category-panel", css)

    def test_customer_picker_is_server_filtered_to_chat_customer_group(self):
        edge = self.read("supabase/functions/getlink-orders/index.ts")
        self.assertIn('contact_group', edge)
        self.assertIn('.eq("contact_group","customer")', edge)

    def test_line_note_is_a_persisted_order_item_snapshot(self):
        edge = self.read("supabase/functions/getlink-orders/index.ts")
        migration = self.read("supabase/migrations/20260913233000_getlink_order_item_notes.sql")
        self.assertIn("line_note", migration)
        self.assertIn("lineNote", edge)
        self.assertIn("note:clean(row.line_note)", edge)
        self.assertIn("lineNote:clean(entry?.lineNote)", edge)
        self.assertIn("lineNote:request.lineNote", edge)


if __name__ == "__main__":
    unittest.main()
