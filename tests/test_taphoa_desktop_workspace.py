from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TaphoaDesktopWorkspaceContract(unittest.TestCase):
    def test_shell_has_three_permanent_slots_and_bottom_nav(self):
        js = (ROOT / "taphoa-desktop-workspace.js").read_text("utf-8")
        for token in [
            "taphoaDesktopWorkspace",
            "taphoaLeftRail",
            "taphoaMasterList",
            "taphoaDetailPane",
            "taphoaBottomNav",
        ]:
            self.assertIn(token, js)

    def test_shell_does_not_use_mutation_observer_or_cross_column_reparenting(self):
        js = (ROOT / "taphoa-desktop-workspace.js").read_text("utf-8")
        self.assertNotIn("MutationObserver", js)
        self.assertNotIn("replaceChildren(fresh", js)

    def test_config_loads_new_workspace_assets(self):
        config = (ROOT / "config.js").read_text("utf-8")
        self.assertIn("taphoa-desktop-workspace.css", config)
        self.assertIn("taphoa-desktop-workspace.js", config)

    def test_build_stamp_tracks_new_workspace_assets(self):
        stamp = (ROOT / "tools" / "stamp_static_build.py").read_text("utf-8")
        self.assertIn("taphoa-desktop-workspace.js", stamp)
        self.assertIn("taphoa-desktop-workspace.css", stamp)


if __name__ == "__main__":
    unittest.main()
