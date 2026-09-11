from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
GROQ_RUNTIME_MIGRATION = ROOT / "supabase/migrations/20260912013500_getlink_ai_groq_runtime_config.sql"
AGENT_INDEX = ROOT / "supabase/functions/getlink-order-agent/index.ts"
AGENT_LLM = ROOT / "supabase/functions/getlink-order-agent/llm.ts"


class GroqOrderAgentContractTests(unittest.TestCase):
    def test_runtime_migration_reads_groq_key_from_vault_service_only(self):
        self.assertTrue(GROQ_RUNTIME_MIGRATION.exists(), "Groq runtime migration must exist")
        text = GROQ_RUNTIME_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("getlink_order_agent_groq_api_key", text)
        self.assertIn("groq_api_key text", text)
        self.assertIn("vault.decrypted_secrets", text)
        self.assertIn("grant execute on function public.getlink_ai_runtime_config() to service_role", text)
        self.assertIn("revoke all on function public.getlink_ai_runtime_config() from public, anon, authenticated", text)

    def test_agent_fail_closes_pilot_on_missing_groq_key(self):
        text = AGENT_INDEX.read_text(encoding="utf-8").replace(" ", "")
        self.assertIn("constgroqApiKey=clean(row?.groq_api_key)", text)
        self.assertIn("modelName&&webhookSecret&&groqApiKey&&pilotCustomerIds.size>0", text)
        self.assertIn("model_configured:Boolean(config.groqApiKey&&config.modelName)", text)
        self.assertNotIn("config.openaiApiKey", text)

    def test_model_client_targets_groq_not_openai(self):
        text = AGENT_LLM.read_text(encoding="utf-8")
        self.assertIn("https://api.groq.com/openai/v1/responses", text)
        self.assertIn('Deno.env.get("GROQ_API_KEY")', text)
        self.assertNotIn("https://api.openai.com/v1/responses", text)

    def test_no_groq_secret_is_added_to_static_frontend(self):
        static_text = "\n".join(
            path.read_text(encoding="utf-8", errors="ignore")
            for path in (ROOT / "app.js", ROOT / "order-management.js", ROOT / "config.js", ROOT / "index.html")
        )
        self.assertNotIn("GROQ_API_KEY", static_text)
        self.assertNotIn("getlink_order_agent_groq_api_key", static_text)


if __name__ == "__main__":
    unittest.main()
