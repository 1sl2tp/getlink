from pathlib import Path
import unittest


MIGRATION = Path("supabase/migrations/20260912061000_ai_training_bidirectional_trigger.sql")


class AiTrainingBidirectionalTriggerTest(unittest.TestCase):
    def test_training_trigger_accepts_admin_to_pilot_and_user_to_admin(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("v_customer_id", sql)
        self.assertIn("v_sender_role='admin' and v_other_role='user'", sql)
        self.assertIn("v_sender_role='user' and v_other_role='admin'", sql)
        self.assertIn("p.account_id=v_customer_id", sql)
        self.assertIn("coalesce(new.client_id,'') like 'ai:%'", sql)
        self.assertNotIn("if v_role is distinct from 'user'", sql)


if __name__ == "__main__":
    unittest.main()
