import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/"index.html").read_text(encoding="utf-8")
APP=(ROOT/"app.js").read_text(encoding="utf-8")
CSS=(ROOT/"style.css").read_text(encoding="utf-8")


class MobileUserWorkV46ContractTest(unittest.TestCase):
    def test_mobile_has_one_search_source_and_result_workspace(self):
        self.assertIn('id="mobileUserWork"',HTML)
        self.assertIn('id="mobileUserSearch"',HTML)
        self.assertIn('id="mobileUserSourceTabs"',HTML)
        self.assertIn('id="mobileUserResults"',HTML)
        self.assertIn('id="mobileUserSendOrder"',HTML)

    def test_mobile_is_a_separate_layout_below_640(self):
        self.assertRegex(CSS,r"\.mobile-user-work\s*\{[^}]*display\s*:\s*none")
        self.assertRegex(CSS,r"@media\s*\(max-width\s*:\s*639px\)")
        self.assertRegex(
            CSS,
            r"@media\s*\(max-width\s*:\s*639px\)[\s\S]*?"
            r"\.mobile-user-work\s*\{[^}]*display\s*:\s*flex"
        )
        self.assertRegex(
            CSS,
            r"@media\s*\(max-width\s*:\s*639px\)[\s\S]*?"
            r"\.user-work-desktop\s*\{[^}]*display\s*:\s*none"
        )

    def test_480_to_639_uses_two_market_columns_but_mine_spans_full_width(self):
        self.assertRegex(CSS,r"@media\s*\(min-width\s*:\s*480px\)\s*and\s*\(max-width\s*:\s*639px\)")
        self.assertRegex(
            CSS,
            r"@media\s*\(min-width\s*:\s*480px\)\s*and\s*\(max-width\s*:\s*639px\)"
            r"[\s\S]*?grid-template-columns\s*:\s*repeat\(2,minmax\(0,1fr\)\)"
        )
        self.assertRegex(CSS,r"\.mobile-user-mine-card\s*,\s*\n\s*\.mobile-user-merged-card\.has-own\s*\{[^}]*grid-column\s*:\s*1\s*/\s*-1")

    def test_mobile_uses_two_parent_scopes_with_child_sources(self):
        self.assertIn('const MOBILE_USER_SCOPES=["mine","market"]',APP)
        self.assertIn('const MOBILE_MARKET_SOURCES=["bhx","wm","go"]',APP)
        self.assertIn('mine:"Tạp hóa"',APP)
        self.assertIn('market:"Siêu thị"',APP)
        self.assertIn('let mobileUserScope="mine"',APP)
        self.assertIn('let mobileUserCategoryKey=""',APP)
        self.assertIn('userWorkCategories(scope)',APP)

    def test_market_pack_rank_uses_hierarchy_not_supplier_fallback(self):
        block=re.search(r"function\s+mobileUserPackRank\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("rowPackHierarchy(row)",body)
        self.assertRegex(body,r'h\.label1\s*===\s*"Thùng"')
        self.assertNotIn("rowIsCarton(row)",body)

    def test_mobile_mine_and_market_cards_share_information_geometry(self):
        mine=re.search(r"function\s+mobileUserMineCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        market=re.search(r"function\s+mobileUserMarketCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(mine)
        self.assertIsNotNone(market)
        mine_body=mine.group(1)
        market_body=market.group(1)
        for token in ["mobile-user-product-image","mobile-user-product-copy","mobile-user-product-name","mobile-user-product-qc","mobile-user-product-bottom","mobile-user-product-price"]:
            self.assertIn(token,mine_body)
            self.assertIn(token,market_body)
        self.assertNotIn(">Tạp hóa<",mine_body)
        self.assertIn("source-'+escapeAttr(sourceKey)",market_body)
        self.assertIn("data-work-qty",mine_body)
        self.assertNotIn("data-work-qty",market_body)

    def test_mobile_mine_card_keeps_plain_unlabeled_price(self):
        block=re.search(r"function\s+mobileUserMineCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("mobile-user-product-price",body)
        self.assertNotIn("Giá bán",body)
        self.assertNotIn(">Tạp hóa<",body)
        self.assertNotIn("Giá thùng",body)
        self.assertNotIn("Giá lẻ",body)

    def test_all_results_prioritize_mine_then_supermarket_carton_middle_retail(self):
        self.assertRegex(APP,r"function\s+mobileUserPackRank\s*\(")
        self.assertRegex(APP,r'h\.label1\s*===\s*"Thùng"')
        self.assertRegex(APP,r"if\(h\.label2\)return 1")
        self.assertRegex(APP,r"return 2")
        self.assertRegex(APP,r"isMineRow\(a\.row\)\?0:1")
        self.assertRegex(APP,r"mobileUserPackRank\(a\.row\)-mobileUserPackRank\(b\.row\)")

    def test_mobile_sale_price_uses_official_catalog_sell_price(self):
        block=re.search(r"function\s+mobileUserSalePrice\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("row&&row.current_price",body)
        self.assertNotIn("rowOwnPriceParts",body)

    def test_mobile_mine_card_is_sale_price_and_quantity_only(self):
        block=re.search(r"function\s+mobileUserMineCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn("mobile-user-product-price",body)
        self.assertNotIn("Giá bán",body)
        self.assertNotIn(">Tạp hóa<",body)
        self.assertIn("data-work-qty",body)
        self.assertNotIn("Giá thùng",body)
        self.assertNotIn("Giá lẻ",body)
        self.assertNotIn("data-work-bargain",body)

    def test_supermarket_card_keeps_name_image_price_qc_source(self):
        block=re.search(r"function\s+mobileUserMarketCard\s*\(row\)\{([\s\S]*?)\n\}",APP)
        self.assertIsNotNone(block)
        body=block.group(1)
        for token in ["image","canonicalDisplayName","userWorkPrimaryMarketPrice","rowPrimaryQc","sourceDisplayLabel"]:
            self.assertIn(token,body)

    def test_mobile_search_updates_on_every_input_including_ime(self):
        block=re.search(
            r'const mobileUserSearch=\$\("#mobileUserSearch"\);([\s\S]*?)\n\}',
            APP
        )
        self.assertIsNotNone(block)
        body=block.group(1)
        self.assertIn('addEventListener("input"',body)
        self.assertNotIn("isComposing",body)
        self.assertIn("renderUserWorkHome()",body)
        self.assertIn("resetMobileUserResultsScroll()",body)


if __name__=="__main__":
    unittest.main()
