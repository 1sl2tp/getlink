import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
ORCHESTRATOR = ROOT / "supabase" / "functions" / "getlink-order-agent" / "orchestrator.ts"


class AiTrainingModeWiringTest(unittest.TestCase):
    def test_pilot_routes_each_message_to_groq_training_flow_before_legacy_order_flow(self):
        text = ORCHESTRATOR.read_text(encoding="utf-8")
        self.assertIn('processDbTrainingMessage', text)
        self.assertIn('processPilotTrainingRows', text)
        self.assertIn('if(mode==="pilot")', text)
        self.assertIn('processPilotTrainingRows(db,rows,modelCredentials)', text)
        self.assertIn('for(const row of rows)', text)
        self.assertIn('`${row.turn_key}:${row.message_id}`', text)
        pilot_at = text.index('if(mode==="pilot")')
        legacy_at = text.index('result=await processTurn')
        self.assertLess(pilot_at, legacy_at, "pilot must branch before legacy session parser")


if __name__ == "__main__":
    unittest.main()
