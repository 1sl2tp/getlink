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

    def test_google_news_rss_is_the_only_runtime_discovery_path(self):
        for key in ["latest","thoi-su","kinh-doanh","cong-nghe","the-thao","giai-tri","suc-khoe"]:
            self.assertIn('key:"'+key+'"',EDGE)
        self.assertIn("newsGoogleTopFeed",EDGE)
        self.assertIn("newsGoogleQueryFeed",EDGE)
        self.assertIn("newsGoogleTopicFeeds",EDGE)
        self.assertIn("newsParseGoogleItems",EDGE)
        self.assertIn('discovery:"google-news-rss-only"',EDGE)
        self.assertIn("newsDeduplicate",EDGE)
        self.assertNotIn("async function newsFetchSource(",EDGE)
        self.assertNotIn("const NEWS_SOURCES:",EDGE)
        self.assertNotIn("type NewsSourceDef=",EDGE)
        self.assertNotIn("async function newsParseItems(",EDGE)
        self.assertNotIn("function newsGoogleFeed(",EDGE)
        self.assertIn('route==="/api/news"',EDGE)

    def test_quick_view_is_local_content_reader_without_ad_iframe(self):
        self.assertIn('id="newsQuickView"',HTML)
        self.assertIn('id="newsQuickContent"',HTML)
        self.assertIn('id="newsQuickTitle"',HTML)
        self.assertNotIn('id="newsQuickGallery"',HTML)
        self.assertNotIn('id="newsQuickOriginal"',HTML)
        self.assertNotIn('id="newsQuickMeta"',HTML)
        quick=HTML[HTML.index('id="newsQuickView"'):]
        self.assertNotIn("<iframe",quick.split("<script>")[0].lower())
        self.assertIn('if(e.target.id==="newsQuickView")closeNewsQuickView()',APP)
        self.assertIn('loadNewsQuickDetail(item,request)',APP)
        self.assertIn('/api/news-detail?reader=3&url=',APP)

    def test_news_ui_hides_publishers_and_mobile_is_two_columns(self):
        self.assertNotIn('id="newsSourceTabs"',HTML)
        self.assertIn(".news-source-tabs",CSS)
        self.assertIn("display:none!important",CSS)
        self.assertIn(".mobile-user-results.news-results",CSS)
        self.assertIn("grid-template-columns:repeat(2,minmax(0,1fr))!important",CSS)
        self.assertIn("@media(max-width:520px)",CSS)
        self.assertIn("grid-template-columns:minmax(0,1fr)!important",CSS)
        self.assertIn("grid-template-columns:92px minmax(0,1fr)!important",CSS)
        self.assertIn('results.classList.add("news-results")',APP)
        card=APP[APP.index("function newsCardHtml"):APP.index("function renderNewsDesktop")]
        self.assertNotIn("source_name",card)
        self.assertNotIn("also_sources",card)
        self.assertNotIn("news-card-summary",card)
        self.assertNotIn("news-card-time",card)
        self.assertNotIn("NEWS_SOURCE_LABELS",APP)
        self.assertNotIn("newsSourceButtons",APP)
        self.assertNotIn("data-news-source",APP)

    def test_news_prefers_richer_images_and_deduplicates_title_or_content(self):
        self.assertIn("images:string[]",EDGE)
        self.assertIn("content:string",EDGE)
        self.assertIn("newsImagesFromItem",EDGE)
        self.assertIn("newsItemQuality",EDGE)
        self.assertIn("newsMergeDuplicate",EDGE)
        self.assertIn("contentClose",EDGE)
        self.assertIn("titleSame",EDGE)

    def test_news_detail_endpoint_is_sanitized_and_host_limited(self):
        self.assertIn('route==="/api/news-detail"',EDGE)
        self.assertIn("newsAllowedDetailHost",EDGE)
        self.assertIn("articleBody",EDGE)
        self.assertIn("newsArticleParagraphs",EDGE)
        self.assertIn("newsArticleImages",EDGE)
        self.assertIn("newsArticleBlocks",EDGE)
        self.assertIn("newsArticleRoot",EDGE)
        self.assertIn("newsArticleTitle",EDGE)
        self.assertIn("newsArticleStripNoise",EDGE)
        self.assertIn("newsArticleNoiseText",EDGE)
        self.assertIn("newsResolveGoogleUrl",EDGE)
        self.assertIn("news_detail_unresolved_google_url",EDGE)
        self.assertIn('npm:he@1.2.0',EDGE)
        self.assertIn('npm:node-html-parser@7.0.1',EDGE)
        self.assertIn("blocks,",EDGE)
        self.assertIn("title:newsArticleTitle(html)",EDGE)
        self.assertIn('"accept-language":"vi-VN,vi;q=0.9,en-US;q=0.7,en;q=0.6"',EDGE)
        self.assertIn("semantic+=9000",EDGE)
        self.assertIn('String(data.title||"").trim()',APP)

    def test_news_storage_is_ephemeral_cache_only(self):
        news_block=EDGE[EDGE.index('type NewsTopicKey='):EDGE.index('const UPDATE_ADMIN_PIN_SHA256=')]
        self.assertNotIn('sb.',news_block)
        self.assertNotIn('.from(',news_block)
        self.assertIn('\"x-getlink-storage\":\"ephemeral-cache\"',EDGE)
        self.assertIn('stale-while-revalidate=300',EDGE)
        self.assertIn('stale-while-revalidate=900',EDGE)
        self.assertIn('storage:\"memory-cache\"',EDGE)

    def test_browser_keeps_ready_snapshot_while_refreshing(self):
        self.assertIn('NEWS_BROWSER_CACHE_KEY="getlink:news-cache:v3"',APP)
        self.assertIn('readNewsBrowserCache',APP)
        self.assertIn('writeNewsBrowserCache',APP)
        self.assertIn('if(API&&!newsItems.length)ensureNewsLoaded(false)',APP)
        self.assertIn('prewarmLatestNews();',APP)
        self.assertIn('NEWS_HOT_SNAPSHOT_BUCKET_MS=5*60*1000',APP)
        self.assertIn('fetchNewsHotSnapshot(force)',APP)
        self.assertIn('cache:force?"no-store":"force-cache"',APP)
        self.assertIn('news_snapshot_not_ready',APP)
        self.assertNotIn('backgroundRefreshLatestNews',APP)
        self.assertNotIn('/api/news?topic=latest&source=all&limit=80&refresh=1',APP)
        self.assertNotIn('newsCache.delete(newsTopic);',APP)
        self.assertIn('https://wsrv.nl/',APP)
        self.assertIn('const eager=index<(compact?6:12);',APP)

    def test_quick_reader_flows_images_through_article_and_swipes(self):
        self.assertNotIn('newsRenderQuickGallery',APP)
        self.assertIn('news-quick-inline',APP)
        self.assertIn('data.blocks||[]',APP)
        self.assertIn('function newsQuickMove(delta)',APP)
        self.assertIn('function newsUpdateQuickNav()',APP)
        self.assertIn('function newsPreloadAdjacent()',APP)
        self.assertIn('id="newsQuickBack"',HTML)
        self.assertIn('id="newsQuickPrev"',HTML)
        self.assertIn('id="newsQuickNext"',HTML)
        self.assertIn('id="newsQuickPosition"',HTML)
        self.assertIn('card.addEventListener(\"touchstart\"',APP)
        self.assertIn('card.addEventListener(\"touchend\"',APP)
        self.assertIn('newsQuickMove(dx<0?1:-1)',APP)
        self.assertIn('News reader v60',CSS)
        self.assertIn('touch-action:pan-y',CSS)
    def test_news_ui_owns_its_scroll_and_mobile_rows(self):
        self.assertIn(".news-grid",CSS)
        self.assertIn(".news-quick-view",CSS)
        self.assertIn(".news-mobile-topics",CSS)
        self.assertIn("grid-template-rows:auto auto!important",CSS)


if __name__=="__main__":
    unittest.main()
