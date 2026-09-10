from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.js"
ORDER = ROOT / "order-management.js"


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

    def test_successful_submit_clears_cart_then_opens_pending_order(self):
        text = ORDER.read_text(encoding="utf-8")
        start = text.index("async function submitSelectedOrder()")
        end = text.index("async function performAdminAction", start)
        submit = text[start:end]

        post = submit.index('await orderFetch("/orders",{method:"POST",body})')
        clear = submit.index("localStorage.removeItem(QTY_KEY)")
        pending = submit.index('activeView="orders";activeStatus="pending"')
        open_manager = submit.index("openManager();")

        self.assertLess(post, clear)
        self.assertLess(clear, pending)
        self.assertLess(pending, open_manager)
        self.assertNotIn("localStorage.removeItem(QTY_KEY)", submit[:post])


if __name__ == "__main__":
    unittest.main()
