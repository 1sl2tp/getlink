from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260912013000_getlink_ai_sales_order_agent.sql"
AGENT_DIR = ROOT / "supabase/functions/getlink-order-agent"
AGENT_INDEX = AGENT_DIR / "index.ts"
AGENT_TYPES = AGENT_DIR / "types.ts"
AGENT_NORMALIZE = AGENT_DIR / "normalize.ts"
AGENT_RULES = AGENT_DIR / "rules.ts"
AGENT_MATCHER = AGENT_DIR / "matcher.ts"
AGENT_COMMERCE = AGENT_DIR / "commerce.ts"
ORDERS_EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
VERIFY = ROOT / ".github/workflows/verify.yml"


class AiSalesOrderAgentSchemaContractTests(unittest.TestCase):
    def migration_text(self):
        self.assertTrue(MIGRATION.exists(), "AI sales-agent migration must exist")
        return MIGRATION.read_text(encoding="utf-8")

    def test_ai_schema_and_rpc_names_exist(self):
        text = self.migration_text()
        for required in (
            "getlink_ai_order_sessions",
            "getlink_ai_order_draft_lines",
            "getlink_ai_product_aliases",
            "getlink_ai_corrections",
            "getlink_ai_product_hints",
            "getlink_ai_message_inbox",
            "getlink_ai_reply_outbox",
            "getlink_ai_enqueue_chat_message",
            "getlink_ai_send_chat_message",
            "getlink_ai_claim_turn",
        ):
            self.assertIn(required, text)
        self.assertIn("enable row level security", text.lower())
        self.assertIn("v21_messages", text)
        self.assertIn("v21_conversations", text)
        self.assertIn("v21_accounts", text)

    def test_inbox_outbox_are_idempotent(self):
        text = self.migration_text().lower()
        self.assertRegex(text, r"unique\s*\([^)]*message_id[^)]*\)")
        self.assertRegex(text, r"unique\s*\([^)]*session_id[^)]*turn_key[^)]*reply_kind[^)]*\)")
        self.assertIn("4 seconds", text)


class AiSalesOrderAgentRuntimeContractTests(unittest.TestCase):
    def agent_text(self):
        self.assertTrue(AGENT_INDEX.exists(), "getlink-order-agent Edge Function must exist")
        parts = []
        for path in AGENT_DIR.glob("*.ts"):
            parts.append(path.read_text(encoding="utf-8"))
        return "\n".join(parts)

    def test_agent_keeps_tap_hoa_as_only_sellable_authority(self):
        text = self.agent_text()
        self.assertIn('getlink_supplier_products', text)
        self.assertIn('getlink_sales_create_order', text)
        for forbidden in (
            'source:"winmart"',
            'source:"bachhoaxanh"',
            'source:"go"',
            '.from("getlink_sales_order_items").insert',
        ):
            self.assertNotIn(forbidden, text.replace(" ", ""))

    def test_agent_declares_locked_business_rules(self):
        text = self.agent_text().replace(" ", "")
        for required in (
            "TURN_DEBOUNCE_MS=4000",
            "MARKET_MAX_AGE_MS=24*60*60*1000",
            "STORE_ALIAS_PROMOTION_CUSTOMERS=3",
            "ROUND_STEP=5",
            "ROUND_MAX_GAP=3",
        ):
            self.assertIn(required, text)

    def test_existing_native_sales_edge_remains_authoritative(self):
        text = ORDERS_EDGE.read_text(encoding="utf-8")
        self.assertIn('db.from("getlink_supplier_products")', text)
        self.assertIn('db.rpc("getlink_sales_create_order"', text)
        self.assertNotIn("OPENAI_API_KEY", text)

    def test_no_ai_secret_is_added_to_static_frontend(self):
        static_text = "\n".join(
            path.read_text(encoding="utf-8", errors="ignore")
            for path in (ROOT / "app.js", ROOT / "order-management.js", ROOT / "config.js", ROOT / "index.html")
        )
        self.assertNotIn("OPENAI_API_KEY", static_text)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", static_text)

    def test_verify_workflow_runs_agent_tests_and_check(self):
        text = VERIFY.read_text(encoding="utf-8")
        self.assertIn("deno test -A tests/ai_sales_order_agent_test.ts", text)
        self.assertIn("deno check supabase/functions/getlink-order-agent/index.ts", text)


if __name__ == "__main__":
    unittest.main()
