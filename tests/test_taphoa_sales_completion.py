from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
JS = ROOT / "order-management.js"


class TapHoaSalesCompletionContract(unittest.TestCase):
    def edge_text(self):
        return EDGE.read_text(encoding="utf-8")

    def js_text(self):
        return JS.read_text(encoding="utf-8")

    def test_create_returns_authoritative_numeric_order_number(self):
        text = self.edge_text()
        create = re.search(
            r"async function createOrder\([\s\S]*?\n}\n\nasync function deliverOrder",
            text,
        )
        self.assertIsNotNone(create, "createOrder implementation must exist")
        body = create.group(0)
        self.assertIn('db.rpc("getlink_sales_create_order"', body)
        self.assertIn('db.from("getlink_sales_orders")', body)
        self.assertIn('order_no', body)
        self.assertRegex(body, r'\.eq\("id",\s*id\)')
        self.assertRegex(body, r'orderNo\s*:\s*Number\(')

    def test_purchase_submit_is_pending_and_only_clears_cart_after_success(self):
        text = self.js_text()
        submit = re.search(
            r"async function submitSelectedOrder\(\)[\s\S]*?\n  }\n\n  async function performAdminAction",
            text,
        )
        self.assertIsNotNone(submit)
        body = submit.group(0)
        self.assertIn('orderFetch("/orders",{method:"POST",body})', body)
        self.assertIn('localStorage.removeItem(QTY_KEY)', body)
        self.assertLess(body.index('await orderFetch("/orders",{method:"POST",body})'), body.index('localStorage.removeItem(QTY_KEY)'))
        self.assertIn('activeStatus="pending"', body)
        self.assertIn('data?.order?.orderNo', body)

    def test_manager_covers_order_lifecycle_and_debt(self):
        text = self.js_text()
        for token in (
            'pending:"Đơn tạm"',
            'delivered:"Đã giao"',
            'returned:"Đã hoàn"',
            'data-manager-view="debts"',
            '/deliver',
            '/return',
            '/payments',
            'Dư nợ sau giao dịch',
        ):
            self.assertIn(token, text)

    def test_browser_never_sends_price_or_customer_name_as_order_authority(self):
        text = self.js_text()
        self.assertRegex(text, r'const\s+items\s*=\s*selected\.map\(item=>\(\{url:item\.row\.canonical_url,qty:item\.qty\}\)\)')
        self.assertNotRegex(text, r'JSON\.stringify\(\{items(?:,customerId)?,(?:price|cost|customerName)')


if __name__ == "__main__":
    unittest.main()
