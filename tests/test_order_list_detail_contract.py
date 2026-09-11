from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "order-management.js"


class OrderListDetailContract(unittest.TestCase):
    def text(self):
        return JS.read_text(encoding="utf-8")

    def test_order_list_makes_customer_primary_and_items_secondary(self):
        text = self.text()
        render = re.search(r"function renderOrders\(\)\{[\s\S]*?\n  }\n\n  async function loadDebtSummaries", text)
        self.assertIsNotNone(render)
        body = render.group(0)
        self.assertIn('data-order-detail', body)
        self.assertIn('Xem đơn', body)
        self.assertIn('items.length+" dòng"', body)
        self.assertIn('class="order-card-customer"', body)
        self.assertIn('class="order-card-meta"', body)
        self.assertIn('orderRef(order)', body)
        self.assertLess(body.index('order.customerName'), body.index('orderRef(order)'))
        self.assertIn('expandedOrderId===String(order.id)', body)
        self.assertRegex(body, r'expanded\?`<div class="order-card-items">')

    def test_order_items_do_not_render_for_every_order_by_default(self):
        text = self.text()
        self.assertIn('let expandedOrderId="";', text)
        self.assertIn('expandedOrderId=expandedOrderId===id?"":id;', text)
        self.assertIn('renderOrders();', text)
        self.assertIn('expandedOrderId="";activeView="orders";setActiveOrderStatus("pending");', text)


if __name__ == "__main__":
    unittest.main()
