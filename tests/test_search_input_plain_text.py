import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
INDEX=(ROOT/"index.html").read_text(encoding="utf-8")

class SearchInputPlainTextTest(unittest.TestCase):
    def _tag(self, input_id):
        m=re.search(r'<input[^>]*id="'+re.escape(input_id)+r'"[^>]*>', INDEX)
        self.assertIsNotNone(m, input_id)
        return m.group(0)

    def test_mobile_search_disables_browser_text_assists(self):
        tag=self._tag("mobileUserSearch")
        for attr in (
            'autocomplete="new-password"',
            'autocorrect="off"',
            'autocapitalize="none"',
            'spellcheck="false"',
            'role="searchbox"',
            'data-1p-ignore="true"',
            'data-lpignore="true"',
        ):
            self.assertIn(attr, tag)

    def test_desktop_search_disables_browser_text_assists(self):
        tag=self._tag("userWorkSearch")
        for attr in (
            'autocomplete="new-password"',
            'autocorrect="off"',
            'autocapitalize="none"',
            'spellcheck="false"',
            'role="searchbox"',
        ):
            self.assertIn(attr, tag)

    def test_merge_password_input_is_not_exposed(self):
        self.assertNotIn('id="mobileMergePassword"', INDEX)

if __name__=="__main__":
    unittest.main()
