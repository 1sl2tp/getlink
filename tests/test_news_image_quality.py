import ast
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / ".github/scripts/build_news_snapshot.py"
SCRIPT = SCRIPT_PATH.read_text(encoding="utf-8")
APP = (ROOT / "app.js").read_text(encoding="utf-8")
EDGE = (ROOT / "supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")


def snapshot_ready_image_url():
    tree = ast.parse(SCRIPT)
    node = next(
        n for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "ready_image_url"
    )
    module = ast.Module(body=[node], type_ignores=[])
    namespace = {"re": re}
    exec(compile(module, str(SCRIPT_PATH), "exec"), namespace)
    return namespace["ready_image_url"]


class NewsImageQualityTest(unittest.TestCase):
    def test_snapshot_rejects_known_generic_publisher_images(self):
        usable = snapshot_ready_image_url()
        bad = [
            "https://cdnstatic.baotintuc.vn/web_images/google-news1.png",
            "https://static.mediacdn.vn/CongDanViet/images/img-author.png",
            "https://example.vn/assets/author-avatar.jpg",
            "https://example.vn/assets/no-image.png",
        ]
        for url in bad:
            with self.subTest(url=url):
                self.assertEqual(usable(url), "")

        real = "https://cdnmedia.baotintuc.vn/Upload/news/2026/09/trump10926.jpg"
        self.assertEqual(usable(real), real)

    def test_frontend_filters_bad_images_in_cards_and_reader(self):
        self.assertIn("const NEWS_BAD_IMAGE_FRAGMENTS=", APP)
        self.assertIn("function newsImageUrlUsable(value)", APP)
        self.assertIn("if(newsImageUrlUsable(url)&&!out.includes(url))out.push(url);", APP)
        self.assertIn('block.type==="image"&&newsImageUrlUsable(block.url)', APP)
        self.assertIn("newsImageUrlUsable(url)&&all.indexOf(url)===index", APP)

    def test_edge_reader_filters_the_same_generic_images(self):
        self.assertIn("const NEWS_BAD_IMAGE_FRAGMENTS=", EDGE)
        self.assertIn("function newsUsableImageUrl(value:unknown,base=\"\")", EDGE)
        self.assertIn("const url=newsUsableImageUrl(value);", EDGE)
        self.assertIn("return newsUsableImageUrl(url);", EDGE)
        for fragment in ["google-news", "img-author", "author-avatar", "no-image"]:
            self.assertIn('"' + fragment + '"', EDGE)


if __name__ == "__main__":
    unittest.main()
