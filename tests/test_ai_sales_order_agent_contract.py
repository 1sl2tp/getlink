from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260912013000_getlink_ai_sales_order_agent.sql"
PILOT_GATE_MIGRATION = ROOT / "supabase/migrations/20260912013300_getlink_ai_pilot_gate.sql"
RUNTIME_CONFIG_MIGRATION = ROOT / "supabase/migrations/20260912013400_getlink_ai_runtime_config.sql"
AGENT_DIR = ROOT / "supabase/functions/getlink-order-agent"
AGENT_INDEX = AGENT_DIR / "index.ts"
AGENT_TYPES = AGENT_DIR / "types.ts"
AGENT_NORMALIZE = AGENT_DIR / "normalize.ts"
AGENT_RULES = AGENT_DIR / "rules.ts"
AGENT_MATCHER = AGENT_DIR / "matcher.ts"
AGENT_COMMERCE = AGENT_DIR / "commerce.ts"
ORDERS_EDGE = ROOT / "supabase/functions/getlink-orders/index.ts"
GETLINK_API = ROOT / "supabase/functions/getlink-api/index.ts"
PRICE_LIST_HTML = ROOT / "price-list.html"
PRICE_LIST_JS = ROOT / "price-list.js"
PRICE_LIST_CSS = ROOT / "price-list.css"
VERIFY = ROOT / ".github/workflows/verify.yml"
SMOKE = ROOT / ".github/workflows/smoke-supabase.yml"


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

    def test_inbox_is_gated_to_explicit_pilot_customers(self):
        self.assertTrue(PILOT_GATE_MIGRATION.exists(), "pilot gate migration must exist")
        text = PILOT_GATE_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("getlink_ai_pilot_customers", text)
        self.assertIn("enable row level security", text)
        self.assertRegex(text, r"exists\s*\([\s\S]*getlink_ai_pilot_customers[\s\S]*account_id\s*=\s*new\.sender_account_id")
        self.assertIn("if not v_is_pilot then", text)
        self.assertNotIn("username='test'", text.replace(" ", ""))
        self.assertNotIn('username="test"', text.replace(" ", ""))

    def test_runtime_config_is_service_only_and_reads_vault(self):
        self.assertTrue(RUNTIME_CONFIG_MIGRATION.exists(), "runtime config migration must exist")
        text = RUNTIME_CONFIG_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("getlink_ai_runtime_settings", text)
        self.assertIn("getlink_ai_runtime_config", text)
        self.assertIn("vault.decrypted_secrets", text)
        self.assertIn("getlink_order_agent_webhook_secret", text)
        self.assertIn("getlink_order_agent_openai_api_key", text)
        self.assertIn("getlink_ai_pilot_customers", text)
        self.assertIn("grant execute on function public.getlink_ai_runtime_config() to service_role", text)
        self.assertRegex(text, r"revoke all on function public\.getlink_ai_runtime_config\(\) from public, anon, authenticated")
        self.assertRegex(text, r"mode text not null default 'off'[\s\S]*check \(mode in \('off','pilot'\)\)")


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

    def test_agent_reads_rollout_config_from_service_rpc(self):
        text = AGENT_INDEX.read_text(encoding="utf-8")
        self.assertIn('db.rpc("getlink_ai_runtime_config")', text)
        self.assertNotIn('Deno.env.get("ORDER_AGENT_MODE")', text)
        self.assertNotIn('Deno.env.get("ORDER_AGENT_PILOT_CUSTOMER_IDS")', text)
        self.assertNotIn('Deno.env.get("ORDER_AGENT_WEBHOOK_SECRET")', text)

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

    def test_smoke_workflow_reads_order_agent_health_only(self):
        text = SMOKE.read_text(encoding="utf-8")
        self.assertIn('supabase/functions/getlink-order-agent/**', text)
        self.assertIn('getlink-order-agent/health', text)
        self.assertIn("model_configured", text)
        self.assertIn("webhook_configured", text)
        self.assertNotIn('-X POST "$AGENT', text)

    def test_price_list_static_surface_exists(self):
        for path in (PRICE_LIST_HTML, PRICE_LIST_JS, PRICE_LIST_CSS):
            self.assertTrue(path.exists(), f"missing price-list asset: {path.name}")
        html = PRICE_LIST_HTML.read_text(encoding="utf-8")
        js = PRICE_LIST_JS.read_text(encoding="utf-8")
        self.assertIn("price-list.css", html)
        self.assertIn("price-list.js", html)
        self.assertIn("/api/library?view=search", js)
        self.assertIn("scope", js)
        self.assertIn("group", js)
        self.assertRegex(js, r"P\$\{String\(index\+1\)\.padStart\(2,\s*[\"']0[\"']\)\}")

    def test_public_catalog_excludes_internal_supplier_commercial_fields(self):
        text = GETLINK_API.read_text(encoding="utf-8")
        match = re.search(r"function publicCatalogRow\(row:any\)\{([\s\S]*?)\n\}\n\nfunction publicCatalogRows", text)
        self.assertIsNotNone(match, "publicCatalogRow sanitizer must exist")
        public_block = match.group(1)
        for forbidden in (
            "supplier_input_price_vnd",
            "supplier_margin_thousand",
            "supplier_actual_profit_vnd",
            "supplier_expected_profit_percent",
            "supplier_expected_profit_vnd",
            "supplier_applied_profit_vnd",
            "supplier_selected_profit_vnd",
            "raw_row",
        ):
            self.assertNotIn(forbidden, public_block)


if __name__ == "__main__":
    unittest.main()
