from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class TaphoaRemainingDocumentFeedbackTest(unittest.TestCase):
    def test_desktop_sales_columns_share_the_same_grid_row(self):
        css = read("taphoa-workspace-feedback.css")
        self.assertIn("TAPHOA_REMAINING_DOC_FEEDBACK_20260913", css)
        self.assertRegex(
            css,
            r"\.user-work-mine\.taphoa-sales-grid>\.user-work-order-wrap\s*\{[^}]*grid-row\s*:\s*2",
        )
        self.assertRegex(
            css,
            r"\.user-work-mine\.taphoa-sales-grid>\.taphoa-sales-context\s*\{[^}]*grid-row\s*:\s*2",
        )

    def test_sales_search_has_a_coalesced_results_only_fast_path(self):
        js = read("taphoa-workspace-feedback.js")
        self.assertIn("TAPHOA_FAST_SEARCH_20260913", js)
        self.assertIn("renderDesktopFastSearchResults", js)
        self.assertIn("renderMobileFastSearchResults", js)
        self.assertIn("captureFastSearch", js)
        self.assertIn('document.addEventListener("input",captureFastSearch,true)', js)

    def test_edit_mode_exposes_only_update_and_cancel(self):
        js = read("taphoa-workspace-feedback.js")
        self.assertIn("syncExactEditActions", js)
        self.assertIn('update.textContent="Cập nhật"', js)
        self.assertIn('cancel.textContent="Hủy"', js)

    def test_empty_product_search_offers_manual_add(self):
        js = read("taphoa-workspace-feedback.js")
        edge = read("supabase/functions/getlink-product-add/index.ts")
        migration = read("supabase/migrations/20260913235500_getlink_manual_product_add.sql")
        self.assertIn("data-taphoa-add-product", js)
        self.assertIn("getlink-product-add", js)
        self.assertIn("getlink_sales_create_manual_product", edge)
        self.assertIn("getlink_sales_create_manual_product", migration)
        self.assertIn("pg_advisory_xact_lock", migration)
        self.assertRegex(edge, r"role[^\n]{0,120}admin")


if __name__ == "__main__":
    unittest.main()
