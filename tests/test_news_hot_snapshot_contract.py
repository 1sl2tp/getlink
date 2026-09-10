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
        self.assertIn("google-news-rss-only-snapshot",SCRIPT)
        self.assertIn('"database":False',SCRIPT)
        self.assertNotIn("supabase.table",SCRIPT.lower())
        self.assertNotIn("insert(",SCRIPT)
        self.assertNotIn("update(",SCRIPT)

    def test_snapshot_refreshes_at_fastest_github_schedule(self):
        self.assertIn('cron: "*/5 * * * *"',WORKFLOW)
        self.assertIn("workflow_dispatch:",WORKFLOW)
        self.assertIn("news-cache",WORKFLOW)
        self.assertIn("googlenewsdecoder==0.1.7",WORKFLOW)
        self.assertIn("ftfy==6.3.1",WORKFLOW)
        self.assertIn("Publish fast snapshot immediately",WORKFLOW)
        self.assertIn("Enrich top stories with original images and content",WORKFLOW)
        self.assertIn("Replace with enriched snapshot",WORKFLOW)
        self.assertGreaterEqual(WORKFLOW.count("git push --force origin HEAD:news-cache"),2)

    def test_hot_ranking_prefers_fresh_multi_source_rich_items(self):
        self.assertIn("def hot_score(item,now):",SCRIPT)
        self.assertIn("480-age",SCRIPT)
        self.assertIn('item.get("duplicate_count")',SCRIPT)
        self.assertIn('len(item.get("images") or [])',SCRIPT)
        self.assertIn("RICH_IMAGE_LIMIT=100",SCRIPT)
        self.assertIn("RICH_CONTENT_LIMIT=24",SCRIPT)
        self.assertIn("RICH_WORKERS=12",SCRIPT)
        self.assertIn("decode_google_url",SCRIPT)
        self.assertIn("gnewsdecoder(value,interval=0)",SCRIPT)
        self.assertIn("enrich_article",SCRIPT)
        self.assertIn("page_images",SCRIPT)
        self.assertIn('"content":"",',SCRIPT)
        self.assertIn('data["phase"]="rich"',SCRIPT)
        self.assertIn('"phase":"fast"',SCRIPT)
        self.assertNotIn("def fetch_source(",SCRIPT)
        self.assertIn("google_query_feed",SCRIPT)
        self.assertIn("google_top_feed",SCRIPT)
        self.assertIn("fetch_google_query",SCRIPT)
        self.assertIn('GOOGLE_HOT_QUERIES=[',SCRIPT)
        for phrase in ["Tin nóng","Tin hot","Tăng giá","Chiến tranh","công an","xét xử","vĩ mô","tạm giam","khởi tố","thuế","chứng khoán","lừa đảo"]:
            self.assertIn(f'"{phrase}"',SCRIPT)
        self.assertIn("feedparser.parse",SCRIPT)
        self.assertIn("process_items",SCRIPT)
        self.assertIn("ftfy_fix_text",SCRIPT)

    def test_frontend_has_static_snapshot_fast_path(self):
        self.assertIn("NEWS_HOT_SNAPSHOT_URL",APP)
        self.assertIn("fetchNewsHotSnapshot",APP)
        self.assertIn("backgroundRefreshLatestNews",APP)
        self.assertIn("NEWS_HOT_SNAPSHOT_BUCKET_MS=5*60*1000",APP)
        self.assertIn('cache:"force-cache"',APP)
        self.assertIn("prewarmLatestNews",APP)
        self.assertIn("https://wsrv.nl/",APP)
        self.assertIn("bindNewsCardImages",APP)


if __name__=="__main__":
    unittest.main()
