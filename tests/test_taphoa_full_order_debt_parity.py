from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER = ROOT / "order-management.js"
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
MIGRATION = ROOT / "supabase/migrations/20260911010000_getlink_delivered_edit_batch_return.sql"


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


class TapHoaFullOrderDebtParity(unittest.TestCase):
    def test_delivered_edit_and_batch_return_are_atomic_service_role_rpcs(self):
        sql = text(MIGRATION)
        self.assertIn("getlink_sales_update_delivered_order", sql)
        self.assertIn("getlink_sales_return_delivered_scope", sql)
        self.assertIn("Only delivered orders can be edited", sql)
        self.assertIn("event_type='order_debt'", sql)
        self.assertIn("order_return_reversal", sql)
        self.assertIn("status='returned'", sql)
        self.assertIn("jsonb_array_elements_text", sql)
        self.assertGreaterEqual(sql.count("for update"), 2)
        self.assertGreaterEqual(sql.count("grant execute on function"), 2)
        self.assertNotIn("to anon", sql.lower())
        self.assertNotIn("to authenticated", sql.lower())

    def test_edge_has_scoped_order_detail_delivered_edit_and_batch_return(self):
        edge = text(EDGE)
        self.assertIn("async function updateDeliveredOrder", edge)
        self.assertIn('db.rpc("getlink_sales_update_delivered_order"', edge)
        self.assertIn("async function returnDeliveredScope", edge)
        self.assertIn('db.rpc("getlink_sales_return_delivered_scope"', edge)
        self.assertIn('if(req.method==="GET"&&orderIdMatch)', edge)
        self.assertIn('path==="/orders/return-batch"', edge)
        self.assertIn('if(actor.kind!=="admin")return json(req,{error:"forbidden"},403)', edge)
        self.assertIn("Array.isArray(body?.ids)", edge)

    def test_order_manager_has_time_search_source_summary_and_share(self):
        order = text(ORDER)
        for token in (
            "orderReportFilter",
            "filterOrdersForReport",
            "summarizeOrdersBySource",
            'data-order-report-search',
            'data-order-report-preset',
            'data-order-report-range',
            'data-order-source-open',
            'data-order-source-mode',
            "shareOrderSource",
            "navigator.share",
            "navigator.clipboard.writeText",
        ):
            self.assertIn(token, order)
        self.assertNotIn('data-order-report-today', order)
        self.assertNotIn('data-order-report-quick', order)
        self.assertIn("Hôm qua", order)
        self.assertIn("Tuần này", order)
        self.assertIn("Tháng này", order)
        self.assertIn("Năm nay", order)
        self.assertIn("Tùy chọn", order)
        self.assertIn("CHI", order)
        self.assertIn("THU", order)
        self.assertIn("LÃI", order)
        self.assertIn("Tổng SP", order)
        # Report accumulators may display server-returned cost to Admin, but the
        # browser must never introduce a client-authoritative `cost:` payload field.
        self.assertNotIn("cost:", order)

    def test_delivered_order_actions_include_edit_return_and_filtered_batch_return(self):
        order = text(ORDER)
        self.assertIn('data-order-batch="return-delivered"', order)
        self.assertIn("returnFilteredDeliveredOrders", order)
        self.assertIn('data-order-action="edit"', order)
        self.assertIn('data-order-action="return"', order)
        # The guard must refuse batch return outside the Delivered tab.
        self.assertIn('activeStatus!=="delivered"', order)
        self.assertIn('method:"POST",body:JSON.stringify({ids})', order)
        self.assertIn('"/orders/return-batch"', order)

    def test_debt_timeline_opens_linked_order_and_reuses_order_actions(self):
        order = text(ORDER)
        self.assertIn('data-debt-order-id=', order)
        self.assertIn("openDebtLinkedOrder", order)
        self.assertIn("debtLinkedOrder", order)
        self.assertIn("renderDebtLinkedOrder", order)
        self.assertIn('orderFetch("/orders/"+encodeURIComponent(id),{method:"GET"})', order)
        self.assertIn("orderActions(debtLinkedOrder)", order)
        self.assertIn('data-debt-order-back', order)

    def test_existing_pending_and_quick_sale_flows_remain_present(self):
        order = text(ORDER)
        self.assertIn("submitSelectedOrder", order)
        self.assertIn("submitQuickSale", order)
        self.assertIn("updateEditingOrder", order)
        self.assertIn("deleteAllPendingOrders", order)
        self.assertIn('data-order-cart-action="clear"', order)
        self.assertIn('data-order-cart-action="cancel-edit"', order)


if __name__ == "__main__":
    unittest.main()
