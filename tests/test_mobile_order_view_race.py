from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORDER = (ROOT / "order-management.js").read_text(encoding="utf-8")


class MobileOrderViewRace(unittest.TestCase):
    def test_manager_refresh_uses_generation_guard(self):
        self.assertIn("let managerRefreshSeq=0;", ORDER)
        self.assertIn("const refreshSeq=++managerRefreshSeq;", ORDER)
        self.assertIn('const requestedView=activeView;', ORDER)
        self.assertIn('if(refreshSeq!==managerRefreshSeq||activeView!==requestedView)return;', ORDER)

    def test_debt_and_order_render_are_guarded_by_requested_view(self):
        self.assertIn('if(requestedView==="debts")await refreshDebts(refreshSeq,requestedView);', ORDER)
        self.assertIn('else {await loadOrders();if(refreshSeq!==managerRefreshSeq||activeView!==requestedView)return;renderOrders();}', ORDER)

    def test_refresh_debts_does_not_render_after_view_changes(self):
        self.assertIn('async function refreshDebts(refreshSeq=managerRefreshSeq,requestedView="debts")', ORDER)
        self.assertIn('if(refreshSeq!==managerRefreshSeq||activeView!==requestedView)return;', ORDER)

    def test_debt_loader_does_not_reclaim_navigation_owner(self):
        start = ORDER.index('async function loadDebtDetail(customerId)')
        end = ORDER.index('\n  }', start) + 4
        block = ORDER[start:end]
        self.assertNotIn('debtCustomerId=', block)

    def test_payment_completion_cannot_render_debt_inside_orders(self):
        start = ORDER.index('async function submitPayment(form)')
        end = ORDER.index('\n  }', start) + 4
        block = ORDER[start:end]
        self.assertIn('const requestedDebtCustomerId=String(debtCustomerId||"");', block)
        self.assertIn('if(activeView!=="debts"||String(debtCustomerId||"")!==requestedDebtCustomerId)return;', block)
        self.assertLess(block.index('if(activeView!=="debts"'), block.index('renderDebtDetail();'))

    def test_linked_order_completion_cannot_render_after_leaving_debt(self):
        start = ORDER.index('async function openDebtLinkedOrder(id)')
        end = ORDER.index('\n  }', start) + 4
        block = ORDER[start:end]
        self.assertIn('const requestedDebtCustomerId=String(debtCustomerId||"");', block)
        self.assertIn('if(activeView!=="debts"||String(debtCustomerId||"")!==requestedDebtCustomerId)return;', block)
        self.assertLess(block.index('if(activeView!=="debts"'), block.index('renderDebtLinkedOrder();'))


if __name__ == "__main__":
    unittest.main()
