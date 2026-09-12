from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "supabase/migrations/20260912013600_fix_getlink_ai_claim_turn_ambiguity.sql"


class AiClaimTurnSqlContractTest(unittest.TestCase):
    def test_claim_turn_qualifies_inbox_columns_that_overlap_return_fields(self):
        self.assertTrue(FIX.exists(), "claim-turn ambiguity fix migration must exist")
        text = FIX.read_text(encoding="utf-8").lower().replace(" ", "")
        self.assertIn("updatepublic.getlink_ai_message_inboxi", text)
        self.assertIn("wherei.conversation_id=p_conversation_id", text)
        self.assertIn("andi.status='claimed'", text)
        self.assertIn("andi.claimed_at<now()-interval'5minutes'", text)
        self.assertIn("createorreplacefunctionpublic.getlink_ai_claim_turn", text)


if __name__ == "__main__":
    unittest.main()
