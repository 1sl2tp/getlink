from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER_JS = (ROOT / "order-management.js").read_text("utf-8")
DESKTOP_JS = (ROOT / "taphoa-desktop-debts.js").read_text("utf-8")
MIGRATIONS = ROOT / "supabase" / "migrations"


class DebtPaymentCompactUnits(unittest.TestCase):
    def test_mobile_payment_input_uses_thousand_unit_and_only_when_debt_positive(self):
        self.assertIn("function parseCompactVnd", ORDER_JS)
        self.assertRegex(ORDER_JS, r"function parseCompactVnd\([^)]*\)\{[^}]*\*1000", re.S)
        self.assertIn('Số tiền khách trả (nghìn)', ORDER_JS)
        self.assertIn('Number(debtDetail?.balanceVnd||0)<=0', ORDER_JS)
        self.assertIn('const amountVnd=parseCompactVnd(', ORDER_JS)

    def test_desktop_debt_inputs_use_same_compact_thousand_contract(self):
        self.assertIn("function parseCompactVnd", DESKTOP_JS)
        self.assertRegex(DESKTOP_JS, r"function parseCompactVnd\([^)]*\)\{[^}]*\*1000", re.S)
        self.assertIn('Số tiền khách trả (nghìn)', DESKTOP_JS)
        self.assertIn('const amount=parseCompactVnd(', DESKTOP_JS)

    def test_payment_rpc_dedupes_same_receipt_for_short_retry_window(self):
        files = sorted(MIGRATIONS.glob("*_getlink_payment_dedupe_guard.sql"))
        self.assertTrue(files, "missing payment dedupe migration")
        sql = files[-1].read_text("utf-8")
        self.assertIn("pg_advisory_xact_lock", sql)
        self.assertIn("event_type='payment'", sql)
        self.assertIn("interval '30 seconds'", sql)
        self.assertIn("amount_vnd=p_amount_vnd", sql)
        self.assertIn("created_by_account_id=p_actor_id", sql)
        self.assertRegex(sql, r"if v_existing is not null then\s+return v_existing;", re.I)


if __name__ == "__main__":
    unittest.main()
