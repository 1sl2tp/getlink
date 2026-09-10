from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER_UI = ROOT / "order-management.js"
ORDERS_FN = ROOT / "supabase/functions/getlink-orders/index.ts"
BHX_FN = ROOT / "supabase/functions/getlink-bhx-proxy/index.ts"


class ChatAuthDetachedContract(unittest.TestCase):
    def test_getlink_client_drops_old_chat_auth_cache_and_has_no_bridge_listener(self):
        text = ORDER_UI.read_text(encoding="utf-8")
        self.assertIn('sessionStorage.removeItem("getlink:chat-order-auth")', text)
        self.assertNotIn('taphoa-chat-auth', text)
        self.assertNotIn('taphoa-getlink-auth-request', text)
        self.assertNotIn('CHAT_ORIGIN', text)

    def test_orders_endpoint_no_longer_accepts_chat_bearer_tokens(self):
        text = ORDERS_FN.read_text(encoding="utf-8")
        self.assertIn('chat_auth_detached', text)
        self.assertNotIn('db.auth.getUser(token)', text)
        self.assertNotIn('https://chat.taphoa.xyz', text)

    def test_bhx_proxy_is_closed_to_chat_jwt_use(self):
        text = BHX_FN.read_text(encoding="utf-8")
        self.assertIn('chat_auth_detached', text)
        self.assertIn('Deno.serve', text)


if __name__ == "__main__":
    unittest.main()
