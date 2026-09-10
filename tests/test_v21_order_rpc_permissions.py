from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260910093500_lock_v21_order_rpc_permissions.sql"


class V21OrderRpcPermissionContract(unittest.TestCase):
    def text(self):
        self.assertTrue(MIGRATION.exists(), "v21 order RPC permission migration must exist")
        raw = MIGRATION.read_text(encoding="utf-8").lower()
        return re.sub(r"\s+", " ", raw).strip()

    def test_mutation_rpcs_are_not_directly_callable_by_browser_roles(self):
        text = self.text()
        for signature in (
            "public.getlink_create_v21_order(jsonb,jsonb)",
            "public.getlink_approve_v21_order(text,timestamptz,text)",
            "public.getlink_cancel_v21_order(text,boolean,text)",
        ):
            self.assertIn("revoke execute on function " + signature + " from public, anon, authenticated", text)
            self.assertIn("grant execute on function " + signature + " to service_role", text)

    def test_trigger_helper_is_not_exposed_as_public_rpc(self):
        text = self.text()
        self.assertIn(
            "revoke execute on function public.getlink_validate_debt_customer_identity() from public, anon, authenticated",
            text,
        )


if __name__ == "__main__":
    unittest.main()
