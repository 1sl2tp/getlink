from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.js"
ORDER = ROOT / "order-management.js"
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
MIGRATION = ROOT / "supabase/migrations/20260910224500_getlink_order_workflow_parity.sql"


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


class TapHoaOrderWorkflowParity(unittest.TestCase):
    def test_backend_has_scoped_pending_commands_and_atomic_quick_sale(self):
        sql = text(MIGRATION)
        self.assertIn("getlink_sales_update_pending_order", sql)
        self.assertIn("getlink_sales_delete_pending_order", sql)
        self.assertIn("getlink_sales_delete_all_pending", sql)
        self.assertIn("getlink_sales_create_quick_sale", sql)
        self.assertIn("v_order.customer_account_id<>p_actor_id", sql)
        self.assertIn("v_actor_role='user'", sql)
        self.assertIn("getlink_sales_create_order(p_order,p_items)", sql)
        self.assertIn("getlink_sales_deliver_order(v_id,v_creator_id)", sql)
        self.assertGreaterEqual(sql.count("grant execute on function"), 4)
        self.assertGreaterEqual(sql.count("to service_role"), 4)
        self.assertNotRegex(sql, r"grant execute on function[^;]+to\s+(?:anon|authenticated)\b")

    def test_edge_exposes_update_delete_all_quick_sale_and_sync(self):
        edge = text(EDGE)
        self.assertIn('"access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS"', edge)
        self.assertIn('body?.mode)==="quick"', edge)
        self.assertIn('getlink_sales_create_quick_sale', edge)
        self.assertIn('async function updatePendingOrder', edge)
        self.assertIn('getlink_sales_update_pending_order', edge)
        self.assertIn('if(req.method==="PUT"&&orderIdMatch)', edge)
        self.assertIn('req.method==="DELETE"&&path==="/orders/pending"', edge)
        self.assertIn('getlink_sales_delete_all_pending', edge)
        self.assertIn('path==="/sync"', edge)
        self.assertIn('ordersVersion', edge)
        self.assertIn('debtVersion', edge)

    def test_app_is_the_only_cart_owner_and_can_load_an_order_for_edit(self):
        app = text(APP)
        order = text(ORDER)
        self.assertIn("function loadUserWorkOrderSelection(order)", app)
        self.assertIn("window.loadUserWorkOrderSelection=loadUserWorkOrderSelection", app)
        self.assertIn("writeUserWorkQtyMap(map)", app)
        self.assertIn("const key=canonical(url);", app)
        self.assertIn("map[key]=qty;", app)
        self.assertIn('writeOwnPrice(url,"bargain",bargain);', app)
        self.assertIn('mobileUserScope="mine"', app)
        self.assertIn('userWorkDesktopScope="mine"', app)
        self.assertNotIn('localStorage.removeItem(QTY_KEY)', order)
        self.assertNotIn('localStorage.setItem(QTY_KEY', order)

    def test_normal_cart_actions_follow_user_admin_permissions(self):
        order = text(ORDER)
        self.assertIn('data-order-cart-action="clear"', order)
        self.assertIn('data-order-cart-action="quick"', order)
        self.assertIn("Bán nhanh", order)
        self.assertIn("function syncCartActions()", order)
        self.assertRegex(order, r'currentRole\(\)==="admin"[\s\S]{0,1200}Bán nhanh')
        self.assertIn('data-order-cart-action="cancel-edit"', order)
        self.assertIn('data-order-cart-action="update"', order)
        self.assertIn("Cập nhật đơn", order)

    def test_pending_list_has_scoped_edit_delete_deliver_and_delete_all(self):
        order = text(ORDER)
        self.assertIn('data-order-action="edit"', order)
        self.assertIn('data-order-action="delete"', order)
        self.assertIn('data-order-action="deliver"', order)
        self.assertIn('data-order-batch="delete-pending"', order)
        self.assertIn("Xóa tất cả", order)
        self.assertIn("editingOrderId", order)
        self.assertIn('window.loadUserWorkOrderSelection(order)', order)
        self.assertIn('method:"PUT"', order)
        self.assertIn('/orders/pending",{method:"DELETE"}', order)
        # Product lines must still be conditional detail, not list-level output.
        self.assertIn('expanded?`<div class="order-card-items">', order)

    def test_multiple_pending_orders_are_not_client_gated(self):
        order = text(ORDER)
        submit = re.search(r"async function submitSelectedOrder\([\s\S]*?\n  }\n", order)
        self.assertIsNotNone(submit)
        body = submit.group(0)
        self.assertNotIn("pendingOrders", body)
        self.assertNotIn("orders.some", body)
        self.assertIn('orderFetch("/orders",{method:"POST",body})', body)

    def test_order_manager_reloads_when_server_revision_changes(self):
        order = text(ORDER)
        self.assertIn("const ORDER_SYNC_MS=3000", order)
        self.assertIn("async function checkRemoteRevision", order)
        self.assertIn('orderFetch("/sync",{method:"GET"})', order)
        self.assertIn("if(!syncBusy)await checkRemoteRevision(true);", order)
        self.assertIn('document.addEventListener("visibilitychange"', order)
        self.assertIn('window.addEventListener("focus"', order)
        self.assertIn("ordersVersion", order)
        self.assertIn("debtVersion", order)


if __name__ == "__main__":
    unittest.main()
