import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
VERSION = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))


class StaticUpdateContractTest(unittest.TestCase):
    def test_assets_are_keyed_by_deterministic_runtime_build(self):
        match = re.search(r'<meta name="app-build-id" content="([0-9a-f]{64})">', HTML)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), VERSION["build_id"])
        self.assertIn('const BUILD_PARAM="__build"', HTML)
        self.assertIn('const VERSION_URL="./version.json"', HTML)
        style = re.search(r'<link rel="stylesheet" href="./style\.css\?v=([0-9a-f]{64})">', HTML)
        self.assertIsNotNone(style)
        self.assertEqual(style.group(1), VERSION["build_id"])
        self.assertNotIn("function loadStyle(", HTML)
        self.assertRegex(HTML, r'assetUrl\("config\.js",\s*build\)')
        self.assertRegex(HTML, r'assetUrl\("app\.js",\s*build\)')

    def test_update_check_is_same_origin_and_not_github_rate_limited(self):
        self.assertNotIn("api.github.com/repos/1sl2tp/getlink/commits/main", HTML)
        self.assertIn('{cache:"no-store",credentials:"same-origin"}', HTML)
        self.assertIn('VERSION_URL+"?t="+Date.now()', HTML)

    def test_open_tab_rechecks_and_defers_unsafe_reload(self):
        self.assertIn('document.addEventListener("visibilitychange"', HTML)
        self.assertIn("setInterval(checkForNewBuild,CHECK_MS)", HTML)
        self.assertIn("safeToReload", HTML)
        self.assertIn("RELOAD_GUARD_MS", HTML)
        self.assertIn("updateSettingsPanel", HTML)
        self.assertIn("__GETLINK_CAN_AUTO_RELOAD__", HTML)

    def test_new_build_reloads_html_with_build_query(self):
        self.assertRegex(HTML, r'searchParams\.set\(BUILD_PARAM,build\)')
        self.assertIn("location.replace(reloadUrl(pendingBuild))", HTML)


if __name__ == "__main__":
    unittest.main()
