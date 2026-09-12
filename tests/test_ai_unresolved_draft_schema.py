from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260912013700_getlink_ai_unresolved_draft_lines.sql"


class AiUnresolvedDraftSchemaTest(unittest.TestCase):
    def migration_text(self):
        self.assertTrue(MIGRATION.exists(), "unresolved draft migration must exist")
        return MIGRATION.read_text(encoding="utf-8")

    def test_unresolved_draft_is_service_only_and_idempotent(self):
        text = self.migration_text()
        lower = text.lower()

        self.assertIn("create table if not exists public.getlink_ai_unresolved_draft_lines", lower)
        self.assertRegex(lower, r"session_id\s+uuid\s+not null\s+references\s+public\.getlink_ai_order_sessions\(id\)\s+on delete cascade")
        self.assertRegex(lower, r"source_message_id\s+uuid\s+references\s+public\.v21_messages\(id\)")
        self.assertRegex(lower, r"resolved_product_code\s+text\s+references\s+public\.getlink_supplier_products\(product_code\)")
        self.assertIn("candidate_product_codes jsonb not null default '[]'::jsonb", lower)
        self.assertRegex(lower, r"quantity\s+numeric\s+check\s*\(quantity is null or quantity > 0\)")
        self.assertRegex(lower, r"reason\s+text\s+not null[\s\S]*not_in_catalog[\s\S]*ambiguous[\s\S]*size_mismatch[\s\S]*needs_owner_confirmation[\s\S]*other")
        self.assertRegex(lower, r"status\s+text\s+not null[\s\S]*pending[\s\S]*resolved[\s\S]*dismissed")
        self.assertRegex(lower, r"unique\s*\(session_id\s*,\s*line_key\)")
        self.assertRegex(lower, r"create index[\s\S]*getlink_ai_unresolved_pending[\s\S]*where status='pending'")
        self.assertIn("alter table public.getlink_ai_unresolved_draft_lines enable row level security", lower)
        self.assertIn("revoke all on table public.getlink_ai_unresolved_draft_lines from public, anon, authenticated", lower)
        self.assertIn("grant all on table public.getlink_ai_unresolved_draft_lines to service_role", lower)


if __name__ == "__main__":
    unittest.main()
