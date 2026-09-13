from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
ORDER=ROOT/'order-management.js'

class ChatOrderSourceHandoffContract(unittest.TestCase):
    def setUp(self):
        self.text=ORDER.read_text(encoding='utf-8')
        self.compact=''.join(self.text.split())

    def test_exact_origin_and_message_types(self):
        self.assertIn('const CHAT_ORIGIN="https://chat.taphoa.xyz"',self.text)
        self.assertIn('event.origin!==CHAT_ORIGIN',self.compact)
        self.assertIn('message.type==="taphoa-chat-work-context"',self.compact)
        self.assertIn('type:"taphoa-work-order-created"',self.compact)

    def test_cart_guard_exists(self):
        self.assertIn('chatWorkContext',self.text)
        self.assertIn('pendingChatWorkContext',self.text)
        self.assertIn('userWorkSelectedItems',self.text)
        self.assertIn('Không đổi khách vì đơn đang có hàng',self.text)

if __name__=='__main__':
    unittest.main()
