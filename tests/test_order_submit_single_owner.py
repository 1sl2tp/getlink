from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.js"
ORDER = ROOT / "order-management.js"
INDEX = ROOT / "index.html"


class OrderSubmitSingleOwnerContract(unittest.TestCase):
    def test_legacy_work_surface_no_longer_owns_send_order(self):
        text = APP.read_text(encoding="utf-8")
        legacy = '''    const send=e.target.closest("#userWorkSendOrder,#mobileUserSendOrder");
    if(send&&!send.disabled){
      saveUserWorkOrderDraft();
      return;
    }
'''
        self.assertNotIn(
            legacy,
            text,
            "app.js must not save a local draft when the real order runtime owns Gửi đơn",
        )

    def test_send_buttons_are_clickable_even_if_cart_summary_was_stale(self):
        html = INDEX.read_text(encoding="utf-8")
        for button_id in ("userWorkSendOrder", "mobileUserSendOrder"):
            match = re.search(rf'<button\b[^>]*\bid="{button_id}"[^>]*>', html)
            self.assertIsNotNone(match, f"missing {button_id}")
            self.assertNotRegex(
                match.group(0),
                r"\sdisabled(?:\s|=|>)",
                f"{button_id} must not use native disabled because a stale cart render swallows clicks",
            )

    def test_app_is_single_owner_for_cart_clear_and_cache_refresh(self):
        text = APP.read_text(encoding="utf-8")
        self.assertIn("function clearUserWorkOrderSelection(){", text)
        start = text.index("function clearUserWorkOrderSelection(){")
        end = text.index("\n}", start) + 2
        clear = text[start:end]
        self.assertIn("localStorage.removeItem(USER_WORK_QTY_KEY)", clear)
        self.assertIn('mobileUserScopeViewCache.delete("mine")', clear)
        self.assertIn("renderUserWorkHome()", clear)
        self.assertIn("updateUserWorkOrderSummary()", clear)
        self.assertIn(
            "window.clearUserWorkOrderSelection=clearUserWorkOrderSelection;",
            text,
        )

    def test_quantity_change_invalidates_cached_mine_rows(self):
        text = APP.read_text(encoding="utf-8")
        start = text.index("function setUserWorkQty(url,value){")
        end = text.index("\n}", start) + 2
        block = text[start:end]
        self.assertIn(
            'mobileUserScopeViewCache.delete("mine")',
            block,
            "cached Tạp hóa rows must not keep old quantities after +/- changes",
        )

    def test_summary_never_native_disables_send_button(self):
        text = APP.read_text(encoding="utf-8")
        start = text.index("function updateUserWorkOrderSummary(){")
        end = text.index("\n}", start) + 2
        block = text[start:end]
        self.assertNotIn(".disabled=", block)
        self.assertIn('setAttribute("aria-disabled"', block)

    def test_successful_submit_asks_cart_owner_to_clear_then_opens_pending_order(self):
        text = ORDER.read_text(encoding="utf-8")
        start = text.index("async function submitSelectedOrder()")
        end = text.index("async function performAdminAction", start)
        submit = text[start:end]

        self.assertIn(
            "openManager();",
            submit,
            "successful Gửi đơn must immediately open the pending-order manager",
        )
        self.assertNotIn(
            "localStorage.removeItem(QTY_KEY)",
            submit,
            "order-management must not mutate app.js cart storage directly",
        )
        self.assertIn("window.clearUserWorkOrderSelection();", submit)

        post = submit.index('await orderFetch("/orders",{method:"POST",body})')
        clear = submit.index("window.clearUserWorkOrderSelection();")
        pending = submit.index('activeView="orders";activeStatus="pending"')
        open_manager = submit.index("openManager();")

        self.assertLess(post, clear)
        self.assertLess(clear, pending)
        self.assertLess(pending, open_manager)
        self.assertNotIn("clearUserWorkOrderSelection", submit[:post])


if __name__ == "__main__":
    unittest.main()
