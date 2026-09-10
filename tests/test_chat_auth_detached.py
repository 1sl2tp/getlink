from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER_UI = ROOT / "order-management.js"
ORDERS_FN = ROOT / "supabase/functions/getlink-orders/index.ts"
BHX_FN = ROOT / "supabase/functions/getlink-bhx-proxy/index.ts"


class ChatAuthDetachedContract(unittest.TestCase):
    def test_getlink_client_clears_cached_chat_token_and_hard_gates_bridge(self):
        text = ORDER_UI.read_text(encoding="utf-8")
        self.assertIn("const CHAT_AUTH_DETACHED=true;", text)
        self.assertIn('sessionStorage.removeItem("getlink:chat-order-auth")', text)
        self.assertIn("if(CHAT_AUTH_DETACHED)", text)
        self.assertIn("function requestChatAuth()", text)
        self.assertIn("async function requireChatAuth", text)

    def test_orders_endpoint_hard_rejects_before_chat_identity_use(self):
        text = ORDERS_FN.read_text(encoding="utf-8")
        self.assertIn("const CHAT_AUTH_DETACHED=true;", text)
        gate = 'if(CHAT_AUTH_DETACHED)return json(req,{error:"chat_auth_detached"},410);'
        self.assertIn(gate, text)
        self.assertLess(text.index(gate), text.index("const actor=await chatIdentity(req);"))

    def test_bhx_proxy_is_versioned_as_closed_endpoint(self):
        self.assertTrue(BHX_FN.exists(), "closed BHX proxy source must be versioned")
        text = BHX_FN.read_text(encoding="utf-8")
        self.assertIn('error:"chat_auth_detached"', text)
        self.assertIn(",410", text)
        self.assertIn("Deno.serve", text)


if __name__ == "__main__":
    unittest.main()
