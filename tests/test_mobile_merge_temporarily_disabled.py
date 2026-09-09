import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")
INDEX=(ROOT/"index.html").read_text(encoding="utf-8")


class MobileMergeTemporarilyDisabledTest(unittest.TestCase):
    def test_merge_feature_flag_is_off(self):
        self.assertIn("const MOBILE_MERGE_ENABLED=false;", APP)

    def test_merge_entry_button_is_hidden(self):
        self.assertRegex(
            INDEX,
            r'<button id="mobileMergeToggle"[^>]*\bhidden\b[^>]*>Hợp nhất</button>'
        )

    def test_render_forces_merge_ui_off(self):
        block=re.search(r"function renderMobileMergePanel\(\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("if(!MOBILE_MERGE_ENABLED)",body)
        self.assertIn("mobileMergeMode=false",body)
        self.assertIn("panel.hidden=true",body)
        self.assertIn("toggle.hidden=true",body)

    def test_merge_card_controls_are_not_rendered_while_disabled(self):
        block=re.search(r"function mobileMergeSelectButton\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        self.assertIn("!MOBILE_MERGE_ENABLED",block.group(1))

    def test_apply_is_blocked_while_disabled(self):
        block=re.search(r"async function applyMobileMergePreview\(\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        self.assertIn("if(!MOBILE_MERGE_ENABLED)return;",block.group(1))


if __name__=="__main__":
    unittest.main()
