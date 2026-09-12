import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"


class AiTrainingMemorySchemaTest(unittest.TestCase):
    def test_training_examples_are_service_only_and_customer_scoped(self):
        files = sorted(MIGRATIONS.glob("*_getlink_ai_training_examples.sql"))
        self.assertTrue(files, "missing getlink_ai_training_examples migration")
        sql = files[-1].read_text(encoding="utf-8").lower()
        self.assertIn("create table", sql)
        self.assertIn("getlink_ai_training_examples", sql)
        for column in [
            "customer_account_id", "conversation_id", "source_message_id",
            "raw_text", "product_name", "product_code", "quantity", "unit_hint",
            "status", "confidence", "created_at", "updated_at",
        ]:
            self.assertIn(column, sql)
        self.assertIn("enable row level security", sql)
        self.assertRegex(sql, r"revoke\s+all\s+on\s+table\s+public\.getlink_ai_training_examples\s+from\s+anon")
        self.assertRegex(sql, r"revoke\s+all\s+on\s+table\s+public\.getlink_ai_training_examples\s+from\s+authenticated")
        self.assertRegex(sql, r"grant\s+all\s+on\s+table\s+public\.getlink_ai_training_examples\s+to\s+service_role")
        self.assertTrue(
            re.search(r"unique\s*\([^)]*customer_account_id[^)]*raw_normalized", sql, re.S)
            or "unique_training_example" in sql,
            "training memory needs a customer-scoped normalized uniqueness key",
        )


if __name__ == "__main__":
    unittest.main()
