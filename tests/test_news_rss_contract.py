import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/"index.html").read_text(encoding="utf-8")
APP=(ROOT/"app.js").read_text(encoding="utf-8")
CSS=(ROOT/"style.css").read_text(encoding="utf-8")
EDGE=(ROOT/"supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")


class NewsRssContractTest(unittest.TestCase):
    def test_news_tab_exists_on_desktop_and_mobile_runtime(self):
        self.assertIn('data-work-target="news"',HTML)
        self.assertIn('<span>Tin tức</span>',HTML)
        self.assertIn('id="userWorkNews"',HTML)
        self.assertIn('const MOBILE_USER_SCOPES=["mine","market","news"]',APP)
        self.assertIn('news:"Tin tức"',APP)

    def test_requested_sources_are_declared(self):
        for token in [
            'name:"VnExpress"',
            'name:"Dân Trí"',
            'name:"Tuổi Trẻ"',
            'name:"Báo Mới"',
            'name:"VietnamNet"',
            'name:"Kênh14"',
            'name:"Zing News"',
            'name:"Báo Thanh Niên"',
            'name:"Lao Động"',
        ]:
            self.assertIn(token,EDGE)

    def test_common_topics_and_rss_fallback_exist(self):
        for key in ["latest","thoi-su","kinh-doanh","cong-nghe","the-thao","giai-tri","suc-khoe"]:
            self.assertIn('key:"'+key+'"',EDGE)
        self.assertIn("news.google.com/rss/search",EDGE)
        self.assertIn("newsFetchSource",EDGE)
        self.assertIn("newsDeduplicate",EDGE)
        self.assertIn('route==="/api/news"',EDGE)

    def test_official_rss_is_preferred_for_major_publishers(self):
        for url in [
            "https://vnexpress.net/rss/tin-moi-nhat.rss",
            "https://dantri.com.vn/rss/home.rss",
            "https://tuoitre.vn/home.rss",
            "https://kenh14.vn/rss/home.rss",
            "https://thanhnien.vn/rss/home.rss",
        ]:
            self.assertIn(url,EDGE)

    def test_quick_view_is_local_sanitized_ui_without_ad_iframe(self):
        self.assertIn('id="newsQuickView"',HTML)
        self.assertIn('id="newsQuickTitle"',HTML)
        self.assertIn('id="newsQuickSummary"',HTML)
        self.assertIn('id="newsQuickOriginal"',HTML)
        quick=HTML[HTML.index('id="newsQuickView"'):]
        self.assertNotIn("<iframe",quick.split("<script>")[0].lower())
        self.assertIn('if(e.target.id==="newsQuickView")closeNewsQuickView()',APP)
        self.assertIn('closeNewsQuickView()',APP)

    def test_news_ui_owns_its_scroll_and_mobile_rows(self):
        self.assertIn(".news-grid",CSS)
        self.assertIn(".news-quick-view",CSS)
        self.assertIn(".news-mobile-topics",CSS)
        self.assertIn(".news-mobile-sources",CSS)
        self.assertIn("grid-template-rows:auto auto auto!important",CSS)


if __name__=="__main__":
    unittest.main()
