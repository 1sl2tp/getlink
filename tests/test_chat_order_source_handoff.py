from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
ORDER=ROOT/'order-management.js'
STYLE=ROOT/'style.css'

class ChatOrderSourceHandoffContract(unittest.TestCase):
    def setUp(self):
        self.text=ORDER.read_text(encoding='utf-8')
        self.compact=''.join(self.text.split())

    def test_exact_origin_and_message_types(self):
        self.assertIn('const CHAT_ORIGIN="https://chat.taphoa.xyz"',self.text)
        self.assertIn('event.origin!==CHAT_ORIGIN',self.compact)
        self.assertIn('message?.type==="taphoa-chat-work-context"',self.compact)
        self.assertIn('type:"taphoa-work-order-created"',self.compact)

    def test_context_normalization_and_cart_guard(self):
        self.assertIn('chatWorkContext',self.text)
        self.assertIn('pendingChatWorkContext',self.text)
        self.assertIn('function normalizeChatWorkContext(',self.text)
        self.assertIn('Array.from(new Set(',self.text)
        self.assertIn('.slice(0,100)',self.text)
        self.assertIn('function currentSelectedCart(',self.text)
        self.assertIn('userWorkSelectedItems',self.text)
        self.assertIn('function applyChatWorkContext(',self.text)
        self.assertIn('function applyPendingChatWorkContextIfSafe(',self.text)
        self.assertIn('Không đổi khách vì đơn đang có hàng',self.text)

    def test_completion_callback_is_after_confirmed_create(self):
        start=self.text.index('async function submitSelectedOrder()')
        end=self.text.index('async function performAdminAction',start)
        submit=self.text[start:end]
        post=submit.index('await orderFetch("/orders",{method:"POST",body})')
        notify=submit.index('notifyChatOrderCreated(')
        self.assertLess(post,notify)
        self.assertNotIn('notifyChatOrderCreated(',submit[:post])
        catch=submit.index('}catch(error)')
        self.assertLess(notify,catch)
        self.assertNotIn('notifyChatOrderCreated(',submit[catch:])
        self.assertIn('const submittedCustomerId=',submit)

    def test_context_presentation_is_compact_and_non_authoritative(self):
        self.assertIn('taphoaChatOrderContext',self.text)
        self.assertIn('Nguồn Chat',self.text)
        self.assertIn('Đang chờ chuyển sang',self.text)
        self.assertIn('chatWorkContext.customerName',self.text)
        style=STYLE.read_text(encoding='utf-8')
        self.assertIn('.taphoa-chat-order-context',style)

if __name__=='__main__':
    unittest.main()
