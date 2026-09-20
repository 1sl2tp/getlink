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

    def test_shared_catalog_search_disables_browser_text_assists(self):
        tag=self._tag("librarySearch")
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
        self.assertNotIn('id="mobileUserSearch"', INDEX)
        self.assertNotIn('id="userWorkSearch"', INDEX)

    def test_merge_password_input_is_not_exposed(self):
        self.assertNotIn('id="mobileMergePassword"', INDEX)

if __name__=="__main__":
    unittest.main()
