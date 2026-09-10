import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/".github/scripts/build_news_snapshot.py"

# The quality rules are pure functions. CI does not install feedparser for the
# main test job, so provide only the import-time module shell; these tests never
# call RSS/network code.
if "feedparser" not in sys.modules:
    feedparser=types.ModuleType("feedparser")
    feedparser.parse=lambda *_args,**_kwargs: None
    sys.modules["feedparser"]=feedparser

spec=importlib.util.spec_from_file_location("build_news_snapshot_quality",SCRIPT)
NEWS=importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(NEWS)


def item(title, source_name="Báo Dân trí", url="https://dantri.com.vn/a.htm", source_key="bao-dan-tri", images=None):
    return {
        "id":title,
        "title":title,
        "summary":"",
        "content":"",
        "url":url,
        "source_name":source_name,
        "source_key":source_key,
        "published_at":"2026-09-10T05:00:00Z",
        "images":list(images or []),
        "image":(images or [""])[0],
        "duplicate_count":1,
    }


class NewsSnapshotQualityRulesTest(unittest.TestCase):
    def test_video_cards_are_rejected_but_real_news_with_location_is_kept(self):
        self.assertTrue(NEWS.is_noise_item(item("Video bóng đá PSG - Slovan Bratislava: Nhà vua thị uy")))
        self.assertTrue(NEWS.is_noise_item(item("Clip: Bàn thắng đẹp nhất vòng đấu")))
        self.assertFalse(NEWS.is_noise_item(item("Hà Nội: Khởi tố 5 đối tượng trong đường dây buôn bán gas giả")))

    def test_obvious_local_portal_noise_is_rejected(self):
        self.assertTrue(NEWS.is_noise_item(item("Trang địa phương - 09/10/2026: Xã Tân Hòa nâng cao chất lượng chăm sóc sức khỏe nhân dân")))
        self.assertTrue(NEWS.is_noise_item(item(
            "Công an xã Quy Đức tăng cường phòng, chống dịch tả lợn châu Phi",
            source_name="Công an tỉnh Phú Thọ",
            url="https://congan.phutho.gov.vn/article/32255",
            source_key="cong-an-tinh-phu-tho",
        )))

    def test_reused_template_image_is_dropped_before_article_image(self):
        generic="https://example.gov.vn/small/photo-library-shared.jpg"
        a="https://example.gov.vn/articles/a-real.jpg"
        b="https://example.gov.vn/articles/b-real.jpg"
        c="https://example.gov.vn/articles/c-real.jpg"
        rows=[
            item("Tin pháp luật A", images=[generic,a]),
            item("Tin pháp luật B", images=[generic,b]),
            item("Tin pháp luật C", images=[generic,c]),
        ]
        cleaned=NEWS.suppress_reused_news_images(rows)
        self.assertEqual([x["image"] for x in cleaned],[a,b,c])

    def test_final_selection_caps_one_publisher_flood(self):
        rows=[
            item(f"Tin khác nhau số {i} về pháp luật", source_name="Cổng Thông tin điện tử Bộ Công an", source_key="bo-cong-an")
            for i in range(5)
        ]
        selected=NEWS.diversify_news_sources(rows, limit=10, max_per_source=2)
        self.assertEqual(len(selected),2)


if __name__=="__main__":
    unittest.main()
