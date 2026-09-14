from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "taphoa-workspace-feedback.css").read_text(encoding="utf-8")


class MobileOrderSourceVisibility(unittest.TestCase):
    def test_mobile_canonical_orders_override_desktop_v2_shell(self):
        pattern = re.compile(
            r"@media\(max-width:639px\)\{\s*"
            r"/\* MOBILE_CANONICAL_ORDER_OWNER_20260914 \*/.*?"
            r"#mobileUserWork\[data-taphoa-view=\"orders\"\] \.order-manager-list\s*\{"
            r"[^}]*display:grid!important;[^}]*overflow:visible!important;[^}]*\}.*?"
            r"#mobileUserWork\[data-taphoa-view=\"orders\"\] \.order-report-results\s*\{"
            r"[^}]*display:block!important;[^}]*\}.*?"
            r"#mobileUserWork\[data-taphoa-view=\"orders\"\] \.order-source-summary\s*\{"
            r"[^}]*display:block!important;[^}]*flex:none!important;[^}]*\}",
            re.S,
        )
        self.assertRegex(CSS, pattern)

    def test_source_summary_is_still_emitted_before_order_cards(self):
        order_js = (ROOT / "order-management.js").read_text(encoding="utf-8")
        self.assertIn(
            'results.innerHTML=sourceSummaryMarkup(visible)+sourceDrillMarkup(visible)+`<div class="order-lifecycle-list">${cards}</div>`;',
            order_js,
        )


if __name__ == "__main__":
    unittest.main()
