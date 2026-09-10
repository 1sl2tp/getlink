from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = (ROOT / "supabase/functions/getlink-api/index.ts").read_text(encoding="utf-8")
APP = (ROOT / "app.js").read_text(encoding="utf-8")


class UnifiedSalesAuthContractTest(unittest.TestCase):
    def test_sales_cors_accepts_bearer_authorization(self):
        self.assertRegex(
            EDGE,
            r'access-control-allow-headers[^\n]+authorization',
            "GETLINK sales API must allow the Chat Supabase Bearer token through CORS",
        )

    def test_sales_account_is_resolved_server_side_from_v21_accounts(self):
        self.assertIn("async function salesAccount(req:Request)", EDGE)
        self.assertIn('req.headers.get("authorization")', EDGE.lower())
        self.assertIn('.from("v21_accounts")', EDGE)
        self.assertIn('.eq("auth_user_id"', EDGE)
        self.assertNotIn("body?.role", self._sales_route_block())

    def test_sales_routes_have_role_guards(self):
        block = self._sales_route_block()
        self.assertIn('route==="/api/sales/bootstrap"', block)
        self.assertIn('route==="/api/sales/orders"', block)
        self.assertIn('salesAdminRequired', block)
        self.assertIn('customer_account_id', block)
        self.assertIn('account.role==="user"', block)

    def test_getlink_accepts_auth_context_only_from_trusted_chat_origin(self):
        self.assertIn("taphoa-auth-context", APP)
        self.assertIn("GETLINK_CHAT_ORIGINS", APP)
        self.assertIn("https://chat.taphoa.xyz", APP)
        self.assertRegex(APP, r'GETLINK_CHAT_ORIGINS\.has\(event\.origin\)')
        self.assertIn('Authorization', APP)
        self.assertIn('Bearer ', APP)

    def _sales_route_block(self):
        start = EDGE.find('route==="/api/sales/bootstrap"')
        if start < 0:
            return ""
        return EDGE[start : start + 24000]


if __name__ == "__main__":
    unittest.main()
