import json
import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/"app.js").read_text(encoding="utf-8")
SCRIPT=(ROOT/".github/scripts/build_news_snapshot.py").read_text(encoding="utf-8")
WORKFLOW=(ROOT/".github/workflows/news-snapshot.yml").read_text(encoding="utf-8")


class NewsHotSnapshotContractTest(unittest.TestCase):
    def test_snapshot_is_background_and_database_free(self):
        self.assertIn("background-hot-snapshot",SCRIPT)
        self.assertIn('"database": False',SCRIPT)
        self.assertNotIn("supabase.table",SCRIPT.lower())
        self.assertNotIn("insert(",SCRIPT)
        self.assertNotIn("update(",SCRIPT)

    def test_snapshot_refreshes_at_fastest_github_schedule(self):
        self.assertIn('cron: "*/5 * * * *"',WORKFLOW)
        self.assertIn("workflow_dispatch:",WORKFLOW)
        self.assertIn("news-cache",WORKFLOW)
        self.assertIn("git push --force origin HEAD:news-cache",WORKFLOW)

    def test_hot_ranking_prefers_fresh_multi_source_rich_items(self):
        self.assertIn("freshness =",SCRIPT)
        self.assertIn("duplicate_boost",SCRIPT)
        self.assertIn("image_boost",SCRIPT)
        self.assertIn("DETAIL_LIMIT = 24",SCRIPT)
        self.assertIn("/api/news-detail?url=",SCRIPT)

    def test_frontend_has_static_snapshot_fast_path(self):
        self.assertIn("NEWS_HOT_SNAPSHOT_URL",APP)
        self.assertIn("fetchNewsHotSnapshot",APP)
        self.assertIn("backgroundRefreshLatestNews",APP)


if __name__=="__main__":
    unittest.main()
