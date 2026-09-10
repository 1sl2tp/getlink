import ast
import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT_PATH=ROOT/'.github/scripts/build_news_snapshot.py'
SCRIPT=SCRIPT_PATH.read_text(encoding='utf-8')
EDGE=(ROOT/'supabase/functions/getlink-api/index.ts').read_text(encoding='utf-8')


def snapshot_ready_image_url():
    tree=ast.parse(SCRIPT)
    node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='ready_image_url')
    module=ast.Module(body=[node],type_ignores=[])
    namespace={'re':re}
    exec(compile(module,str(SCRIPT_PATH),'exec'),namespace)
    return namespace['ready_image_url']


class NewsImageRelevanceTest(unittest.TestCase):
    def test_snapshot_rejects_tiny_decorative_and_document_background_images(self):
        usable=snapshot_ready_image_url()
        bad=[
            'https://vphoto.vietnam.vn/thumb/48x48/vietnam/resource/IMAGE/2025/1/21/20cbebdf3db449b08e34d46109ec6999',
            'https://baovephapluat.vn/image/images/left.png',
            'https://baovephapluat.vn/image/images/center.png',
            'https://baovephapluat.vn/image/images/right.png',
            'https://image3.luatvietnam.vn/uploaded/docconvert/images/2026/09/09/bg1-134930.png',
            'https://example.vn/photo.jpg?w=64&h=64',
        ]
        for url in bad:
            with self.subTest(url=url):
                self.assertEqual(usable(url),'')

        real='https://vstatic.vietnam.vn/vietnam/resource/IMAGE/2026/09/10/1789014825295_giang-vo3.jpeg'
        self.assertEqual(usable(real),real)

    def test_snapshot_metadata_is_article_social_image_only(self):
        self.assertIn('def meta_images(text,base):',SCRIPT)
        self.assertNotIn('"image","thumbnail","thumbnailurl"',SCRIPT)
        self.assertNotIn('rel in {"image_src","preload"}',SCRIPT)

    def test_edge_rejects_tiny_and_decorative_image_urls(self):
        edge=EDGE.lower()
        # Assert the actual grouped rules instead of expanded URL strings. The
        # production regex intentionally groups left/center/right into one rule.
        self.assertIn('const tiny=low.match',edge)
        self.assertIn('docconvert',edge)
        self.assertIn('(?:left|center|right|top|bottom)',edge)

    def test_edge_reader_does_not_render_unqualified_bare_images(self):
        self.assertIn('function newsArticleBlocks',EDGE)
        self.assertIn('newsImageNodeIsArticleOwned',EDGE)
        self.assertIn('if(!newsImageNodeIsArticleOwned(node))continue;',EDGE)

    def test_edge_metadata_is_only_explicit_social_article_image(self):
        marker='function newsMetaImageValues(html:string,base:string)'
        start=EDGE.index(marker)
        end=EDGE.index('function newsArticleNoiseText',start)
        block=EDGE[start:end]
        self.assertIn('meta[property="og:image"]',block)
        self.assertIn('meta[name="twitter:image"]',block)
        self.assertNotIn('meta[itemprop="image"]',block)
        self.assertNotIn('link[rel="image_src"]',block)


if __name__=='__main__':
    unittest.main()
