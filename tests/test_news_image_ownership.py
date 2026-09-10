# Regression coverage for article-image ownership across snapshot and quick reader.
import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT_PATH=ROOT/".github/scripts/build_news_snapshot.py"
EDGE=(ROOT/"supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")


def load_builder():
    stubs={}

    feedparser=types.ModuleType("feedparser")
    feedparser.parse=lambda *_args,**_kwargs: types.SimpleNamespace(entries=[])
    stubs["feedparser"]=feedparser

    decoder=types.ModuleType("googlenewsdecoder")
    decoder.gnewsdecoder=None
    stubs["googlenewsdecoder"]=decoder

    ftfy=types.ModuleType("ftfy")
    ftfy.fix_text=lambda value:value
    stubs["ftfy"]=ftfy

    bs4=types.ModuleType("bs4")
    bs4.BeautifulSoup=None
    bs4.UnicodeDammit=None
    stubs["bs4"]=bs4

    previous={name:sys.modules.get(name) for name in stubs}
    try:
        sys.modules.update(stubs)
        spec=importlib.util.spec_from_file_location("getlink_news_builder",SCRIPT_PATH)
        module=importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module
    finally:
        for name,value in previous.items():
            if value is None:sys.modules.pop(name,None)
            else:sys.modules[name]=value


BUILDER=load_builder()


class NewsImageOwnershipTest(unittest.TestCase):
    def test_google_rss_description_images_are_not_trusted(self):
        entry={
            "description":'<p>Tin</p><img src="https://example.vn/assets/homepage-generic.jpg">',
            "media_content":[],
            "media_thumbnail":[],
            "enclosures":[],
        }
        self.assertEqual(BUILDER.entry_images(entry,trust_html=False),[])

    def test_jsonld_only_collects_article_owned_images(self):
        page='''
        <script type="application/ld+json">
        {"@graph":[
          {"@type":"Organization","image":"https://example.vn/assets/publisher-brand.jpg"},
          {"@type":"NewsArticle","articleBody":"Nội dung bài viết hợp lệ và đủ dài để kiểm tra.","image":"https://example.vn/media/story-photo.jpg"}
        ]}
        </script>
        '''
        body,images=BUILDER.jsonld(page)
        self.assertIn("Nội dung bài viết",body)
        self.assertEqual(images,["https://example.vn/media/story-photo.jpg"])

    def test_duplicate_merge_never_borrows_loser_images(self):
        a={
            "title":"Một tiêu đề",
            "summary":"Tóm tắt",
            "content":"Nội dung",
            "image":"https://a.example/story-a.jpg",
            "images":["https://a.example/story-a.jpg"],
            "duplicate_count":1,
        }
        b={
            "title":"Một tiêu đề",
            "summary":"Tóm tắt",
            "content":"Nội dung",
            "image":"https://b.example/story-b.jpg",
            "images":["https://b.example/story-b.jpg"],
            "duplicate_count":1,
        }
        merged=BUILDER.merge(a,b)
        self.assertEqual(merged["images"],["https://a.example/story-a.jpg"])
        self.assertEqual(merged["image"],"https://a.example/story-a.jpg")

    def test_snapshot_prefers_article_metadata_then_body_then_meta(self):
        script=SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertIn("*ji,",script)
        self.assertIn("*page_images(text,final),",script)
        self.assertIn("*meta_images(text,final),",script)
        self.assertNotIn('*(item.get("images") or []),\n      *meta_images(text,final)',script)
        self.assertIn("entry_images(e,trust_html=False)",script)

    def test_edge_reader_filters_jsonld_and_author_media(self):
        self.assertIn("NEWS_JSONLD_ARTICLE_TYPES",EDGE)
        self.assertIn("newsJsonLdIsArticle",EDGE)
        self.assertIn('newsUsableImageUrl(value,base)',EDGE)
        for marker in ('[class*="author"]','[id*="author"]','[class*="avatar"]','[class*="profile"]','[class*="logo"]'):
            self.assertIn(marker,EDGE)


if __name__=="__main__":
    unittest.main()
