from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class OrderWorkspaceLayoutScrollFeedbackTest(unittest.TestCase):
    def test_sales_summary_distinguishes_lines_from_product_quantity(self):
        js = read("taphoa-workspace-feedback.js")
        self.assertIn("TAPHOA_ORDER_WORKSPACE_V2_20260913", js)
        self.assertIn("function orderSelectionCounts", js)
        self.assertRegex(js, r"Đã chọn[^\n]{0,120}dòng[^\n]{0,120}sản phẩm")
        self.assertIn("dòng khác", js)

    def test_desktop_nav_has_a_dedicated_bottom_grid_row(self):
        css = read("taphoa-workspace-feedback.css")
        self.assertRegex(
            css,
            r"\.user-work-desktop\s*\{[^}]*grid-template-rows\s*:\s*auto\s+minmax\(0,1fr\)\s+52px",
        )
        self.assertRegex(
            css,
            r"\.user-work-desktop>\.taphoa-work-nav\.desktop\s*\{[^}]*grid-row\s*:\s*3",
        )

    def test_order_list_uses_compact_index_and_invoice_detail(self):
        js = read("taphoa-workspace-feedback.js")
        self.assertIn("function orderIndexCardMarkup", js)
        self.assertIn("function orderInvoiceMarkup", js)
        self.assertIn("data-order-list-item", js)
        self.assertIn("data-order-back", js)
        self.assertIn("STT ", js)
        self.assertIn("Mã đơn ", js)
        self.assertIn("order-invoice-actions", js)
        self.assertNotIn('class="order-card-detail-toggle"', js)

    def test_order_index_keeps_line_and_product_count_visible(self):
        js = read("taphoa-workspace-feedback.js")
        css = read("taphoa-order-workspace-v2.css")
        config = read("config.js")
        self.assertRegex(js, r"dòng · [^\n]{0,60}SP")
        self.assertNotIn("taphoa-order-workspace-v2.css", config)
        self.assertIn("clip:auto!important", css)
        self.assertIn("overflow:visible!important", css)

    def test_order_detail_counts_lines_and_total_products(self):
        js = read("taphoa-workspace-feedback.js")
        self.assertIn("function orderProductCount", js)
        self.assertRegex(js, r"items\.length[^\n]{0,180}orderProductCount")
        self.assertRegex(js, r"dòng[^\n]{0,120}sản phẩm")

    def test_customer_can_be_reassigned_through_admin_only_rpc(self):
        edge = read("supabase/functions/getlink-order-customer/index.ts")
        migration = read("supabase/migrations/20260914001000_getlink_reassign_order_customer.sql")
        js = read("taphoa-workspace-feedback.js")
        self.assertIn("getlink_sales_reassign_order_customer", edge)
        self.assertIn("getlink_sales_reassign_order_customer", migration)
        self.assertIn("role='admin'", migration)
        self.assertIn("getlink_debt_ledger", migration)
        self.assertIn("service_role", migration)
        self.assertIn("data-order-customer-change", js)
        self.assertIn("getlink-order-customer", js)

    def test_order_scroll_owners_are_native_and_outer_shell_does_not_scroll(self):
        css = read("taphoa-workspace-feedback.css")
        self.assertIn(".order-index-scroll", css)
        self.assertIn(".order-invoice-scroll", css)
        self.assertRegex(css, r"\.order-index-scroll[^}]*overflow\s*:\s*auto")
        self.assertRegex(css, r"\.order-invoice-scroll[^}]*overflow\s*:\s*auto")
        self.assertGreaterEqual(css.count("scroll-behavior:auto"), 2)
        self.assertGreaterEqual(css.count("overscroll-behavior:auto"), 2)
        self.assertRegex(css, r"\.taphoa-workspace-panel \.order-manager-list[^}]*overflow\s*:\s*hidden")


if __name__ == "__main__":
    unittest.main()
