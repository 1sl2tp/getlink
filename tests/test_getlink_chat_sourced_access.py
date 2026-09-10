from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "order-management.js"
EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"


class GetlinkChatSourcedAccessContract(unittest.TestCase):
    def js(self):
        return JS.read_text(encoding="utf-8")

    def edge(self):
        return EDGE.read_text(encoding="utf-8")

    def test_getlink_has_no_local_username_password_login(self):
        text = self.js()
        for forbidden in (
            "function chatLogin(",
            "/auth/v1/token?grant_type=password",
            "orderLoginUsername",
            "orderLoginPassword",
            "orderLoginSubmit",
        ):
            self.assertNotIn(forbidden, text)

    def test_embedded_protected_access_requests_chat_auth(self):
        text = self.js()
        self.assertIn("function isEmbeddedInChat()", text)
        self.assertIn("async function waitForChatAuth", text)
        self.assertIn("requestChatAuth()", text)
        self.assertIn("Đang xác thực qua Chat", text)

    def test_standalone_protected_access_goes_to_chat(self):
        text = self.js()
        self.assertIn("function goToChat()", text)
        self.assertIn('window.location.assign(CHAT_ORIGIN+"/")', text.replace(" ", ""))

    def test_backend_derives_getlink_role_from_verified_chat_account(self):
        text = self.edge()
        self.assertIn("db.auth.getUser(token)", text)
        self.assertIn('.from("v21_accounts")', text)
        self.assertIn('kind:role==="admin"?"admin":"customer"', text.replace(" ", ""))

    def test_getlink_never_mutates_chat_account_role(self):
        text = self.edge().replace(" ", "")
        self.assertNotIn('.from("v21_accounts").update(', text)
        self.assertNotIn('.from("v21_accounts").insert(', text)
        self.assertNotIn('.from("v21_accounts").upsert(', text)


if __name__ == "__main__":
    unittest.main()
