import importlib.util
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location("scraper_module",ROOT/"scraper"/"scraper.py")
scraper=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scraper)


class ScraperHelpersTest(unittest.TestCase):
    def test_money(self):
        self.assertEqual(scraper.parse_money("129.000₫"),129000)
        self.assertEqual(scraper.parse_money("230 000 đ"),230000)
        self.assertEqual(scraper.parse_money(115000),115000)

    def test_canonical_url(self):
        self.assertEqual(
            scraper.canonical_url("https://www.bachhoaxanh.com/mi/test/?utm_source=x#abc"),
            "https://bachhoaxanh.com/mi/test"
        )

    def test_packaging(self):
        p=scraper.packaging_info("Thùng 30 gói mì Hảo Hảo tôm chua cay 75g")
        self.assertEqual(p["pack_count"],30)
        self.assertEqual(p["pack_unit"],"gói")
        self.assertEqual(p["unit_size"],"75g")

    def test_promotion(self):
        p=scraper.promotion_info("Mua 2 thùng giảm còn 115.000đ mỗi thùng",129000)
        self.assertTrue(p["active"])
        self.assertEqual(p["price"],115000)

    def test_user_owned_fields_are_preserved(self):
        old={
            "url":"https://bachhoaxanh.com/mi/test",
            "my_price":110000,
            "watch":True,
            "short_name":"mì test",
            "history":[]
        }
        observed={
            "id":"x","source":{"name":"Bách Hóa XANH"},"group":"Mì","branch":"Mì",
            "name":"Mì test","packaging":{"text":"30 gói × 75g"},
            "price":{"current":129000,"original":None},
            "promotion":{"active":False,"price":None,"text":""},
            "url":"https://bachhoaxanh.com/mi/test","image":"","breadcrumbs":[],
            "last_checked_at":"2026-09-07T00:00:00+00:00"
        }
        merged=scraper.merge_product(old,observed)
        self.assertEqual(merged["my_price"],110000)
        self.assertTrue(merged["watch"])
        self.assertEqual(merged["short_name"],"mì test")
        self.assertEqual(len(merged["history"]),1)

    def test_result_type_product_and_category(self):
        product={
            "url":"https://bachhoaxanh.com/mi/mi-hao-hao-75g",
            "group":"Mì"
        }
        self.assertEqual(
            scraper.result_type(
                "https://www.bachhoaxanh.com/mi/mi-hao-hao-75g",
                [product]
            ),
            "product"
        )
        self.assertEqual(
            scraper.result_type(
                "https://www.bachhoaxanh.com/mi",
                [product]
            ),
            "category"
        )


if __name__=="__main__":
    unittest.main()
