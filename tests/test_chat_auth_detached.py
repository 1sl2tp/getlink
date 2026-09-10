from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORDER_UI = ROOT / "order-management.js"
ORDERS_FN = ROOT / "supabase/functions/getlink-orders/index.ts"
BHX_FN = ROOT / "supabase/functions/getlink-bhx-proxy/index.ts"


def test_getlink_client_drops_old_chat_auth_cache_and_has_no_bridge_listener():
    text = ORDER_UI.read_text(encoding="utf-8")
    assert 'sessionStorage.removeItem("getlink:chat-order-auth")' in text
    assert 'taphoa-chat-auth' not in text
    assert 'taphoa-getlink-auth-request' not in text
    assert 'CHAT_ORIGIN' not in text


def test_orders_endpoint_no_longer_accepts_chat_bearer_tokens():
    text = ORDERS_FN.read_text(encoding="utf-8")
    assert 'chat_auth_detached' in text
    assert 'db.auth.getUser(token)' not in text
    assert 'https://chat.taphoa.xyz' not in text


def test_bhx_proxy_requires_no_chat_jwt_path():
    text = BHX_FN.read_text(encoding="utf-8")
    assert 'chat_auth_detached' in text
    assert 'Deno.serve' in text
