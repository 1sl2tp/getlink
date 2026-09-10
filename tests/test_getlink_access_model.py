from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER_UI = ROOT / "order-management.js"
APP = ROOT / "app.js"


class GetlinkAccessModelContract(unittest.TestCase):
    def test_sales_identity_has_exactly_guest_user_admin_states(self):
        text = ORDER_UI.read_text(encoding="utf-8")
        self.assertIn('const ACCESS_STATES=Object.freeze(["guest","user","admin"]);', text)
        self.assertIn('function currentAccessState()', text)
        self.assertIn('if(!auth)return "guest";', text)
        self.assertIn('return auth.account?.role==="admin"?"admin":"user";', text)

    def test_chat_identity_is_reused_not_logged_in_again(self):
        text = ORDER_UI.read_text(encoding="utf-8")
        self.assertIn('source:"chat"', text)
        self.assertIn('window.GETLINK_ACCESS_CONTEXT=', text)
        for forbidden in (
            'signInWithPassword',
            '/auth/v1/token?grant_type=password',
            'createClient(',
            'getlink-auth-user',
        ):
            self.assertNotIn(forbidden, text)

    def test_catalog_ui_role_is_documented_as_presentation_not_identity(self):
        text = APP.read_text(encoding="utf-8")
        self.assertIn('GETLINK_ACCESS_CONTEXT', text)
        self.assertIn('appRole is UI presentation only', text)


if __name__ == "__main__":
    unittest.main()
