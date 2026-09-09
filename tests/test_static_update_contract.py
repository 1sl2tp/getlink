import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")


class StaticUpdateContractTest(unittest.TestCase):
    def test_assets_are_keyed_by_runtime_build_sha(self):
        self.assertNotIn("style.css?v=20260909-embedded-shell-v43", HTML)
        self.assertNotIn("app.js?v=20260909-embedded-shell-v43", HTML)
        self.assertIn('const BUILD_PARAM="__build"', HTML)
        self.assertRegex(HTML, r'assetUrl\("style\.css",\s*build\)')
        self.assertRegex(HTML, r'assetUrl\("config\.js",\s*build\)')
        self.assertRegex(HTML, r'assetUrl\("app\.js",\s*build\)')

    def test_latest_main_sha_is_checked_without_http_cache(self):
        self.assertIn("https://api.github.com/repos/1sl2tp/getlink/commits/main", HTML)
        self.assertRegex(HTML, r'fetch\([^\n]+\{cache:"no-store"')
        self.assertIn("DEPLOY_GRACE_MS", HTML)

    def test_open_tab_rechecks_when_visible_and_periodically(self):
        self.assertIn('document.addEventListener("visibilitychange"', HTML)
        self.assertIn("setInterval(checkForNewBuild", HTML)

    def test_new_build_reloads_html_with_sha_query(self):
        self.assertRegex(HTML, r'searchParams\.set\(BUILD_PARAM,\s*sha\)')
        self.assertRegex(HTML, r'location\.replace\(')


if __name__ == "__main__":
    unittest.main()
