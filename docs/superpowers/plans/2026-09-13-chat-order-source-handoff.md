# Chat Order Source Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Công việc iframe consume the currently selected Chat customer/order-source context safely and notify Chat only after a real order has been created successfully.

**Architecture:** Chat remains the source of customer/message context and GETLINK remains the owner of product selection, quantities, cart and order submission. The iframe stores only a transient `taphoa-chat-work-context`, applies the customer automatically only when that cannot overwrite an in-progress cart, and posts an exact-origin completion event to Chat after the existing order backend confirms creation.

**Tech Stack:** Vanilla JavaScript, Python `unittest` contract tests, Node syntax checks, existing Supabase `getlink-orders` backend, GitHub Actions, GitHub Pages.

**Spec:** `1sl2tp/chat:docs/superpowers/specs/2026-09-13-customer-order-source-timeline-design.md`

## Global Constraints

- Product UX remains `Trò chuyện | Công việc`; do not expose “GETLINK” as a user workflow concept.
- Chat is the source of `contactId`, `customerName`, selected source message ids and time window.
- GETLINK remains the only owner of product/cart/order-entry business state.
- Never silently switch the selected customer while the current cart contains items.
- Never clear or replace a cart because Chat changes contact.
- Never report an order as imported until the existing `POST /orders` succeeds.
- Failed order submission must preserve both cart and source context and must not emit a completion event.
- Do not send Chat source-message ids to the order backend in this slice; they are cross-frame correlation metadata only.
- Both cross-frame directions must use exact origin checks: `https://chat.taphoa.xyz` and the existing iframe relationship.
- Standalone GETLINK behavior must remain usable as it is now; work-context behavior is only active when embedded in Chat.
- No changes to Chat/Call code in this repository.
- Production remains GitHub Pages; do not introduce Vercel.

---

### Task 1: Lock the work-context bridge contract with RED tests

**Files:**
- Create: `tests/test_chat_order_source_handoff.py`
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Consumes message: `{type:'taphoa-chat-work-context',contactId,customerName,sourceMessageIds,preset,from,to}` from exact `CHAT_ORIGIN`.
- Produces message: `{type:'taphoa-work-order-created',contactId,sourceMessageIds,orderId,orderNo}` to exact `CHAT_ORIGIN`.
- Requires transient state variable `chatWorkContext` in `order-management.js`.

- [ ] **Step 1: Write the failing contract**

```python
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
ORDER=ROOT/'order-management.js'

class ChatOrderSourceHandoffContract(unittest.TestCase):
    def setUp(self):
        self.text=ORDER.read_text(encoding='utf-8')
        self.compact=''.join(self.text.split())

    def test_accepts_only_exact_chat_origin_work_context(self):
        self.assertIn('const CHAT_ORIGIN="https://chat.taphoa.xyz"',self.text)
        self.assertIn('event.origin!==CHAT_ORIGIN',self.compact)
        self.assertIn('message.type==="taphoa-chat-work-context"',self.compact)
        self.assertIn('chatWorkContext',self.text)

    def test_order_created_callback_exists(self):
        self.assertIn('type:"taphoa-work-order-created"',self.compact)
        self.assertIn('window.parent.postMessage',self.text)
        self.assertIn('CHAT_ORIGIN',self.text)

    def test_customer_switch_is_guarded_by_cart_state(self):
        self.assertIn('pendingChatWorkContext',self.text)
        self.assertIn('userWorkSelectedItems',self.text)
        self.assertIn('Không đổi khách vì đơn đang có hàng',self.text)

if __name__=='__main__':
    unittest.main()
```

- [ ] **Step 2: Run the contract and confirm RED**

Run: `python -m unittest tests.test_chat_order_source_handoff -v`

Expected: FAIL because work-context handling and callback do not exist.

- [ ] **Step 3: Add the targeted test to existing CI**

Add to `.github/workflows/verify.yml` before the full discovery step:

```yaml
- run: python -m unittest tests.test_chat_order_source_handoff -v
```

- [ ] **Step 4: Commit the RED test only**

```bash
git add tests/test_chat_order_source_handoff.py .github/workflows/verify.yml
git commit -m "test: lock chat order source handoff"
```

---

### Task 2: Accept and stage Chat work context without disturbing an active cart

**Files:**
- Modify: `order-management.js`
- Modify: `tests/test_chat_order_source_handoff.py`

**Interfaces:**
- Produces `normalizeChatWorkContext(message) -> null | {contactId,customerName,sourceMessageIds,preset,from,to}`.
- Produces `applyChatWorkContext(context) -> 'applied' | 'deferred' | 'ignored'`.
- State: `let chatWorkContext=null; let pendingChatWorkContext=null;`.
- Reuses: `selectedCustomerId`, `customers`, `sessionStorage`, `userWorkSelectedItems()`, `syncCustomerControls()`, `setMainStatus()`.

- [ ] **Step 1: Extend RED tests for input normalization**

Add assertions that the implementation:

```python
self.assertIn('function normalizeChatWorkContext(',self.text)
self.assertIn('Array.from(new Set(',self.text)
self.assertIn('sourceMessageIds',self.text)
self.assertIn('contactId',self.text)
```

The normalizer must reject missing `contactId`, trim ids, deduplicate source ids, and cap source ids to 100.

- [ ] **Step 2: Implement context state and normalizer**

Add near existing order state:

```js
let chatWorkContext=null;
let pendingChatWorkContext=null;

function normalizeChatWorkContext(message){
  if(!message||message.type!=="taphoa-chat-work-context")return null;
  const contactId=String(message.contactId||"").trim();
  if(!contactId)return null;
  const sourceMessageIds=Array.from(new Set(
    (Array.isArray(message.sourceMessageIds)?message.sourceMessageIds:[])
      .map(value=>String(value||"").trim())
      .filter(Boolean)
  )).slice(0,100);
  return {
    contactId,
    customerName:String(message.customerName||"").trim(),
    sourceMessageIds,
    preset:String(message.preset||"today").trim()||"today",
    from:String(message.from||"").trim(),
    to:String(message.to||"").trim(),
  };
}
```

- [ ] **Step 3: Add a single cart-state helper**

```js
function currentSelectedCart(){
  const selected=typeof window.userWorkSelectedItems==="function"
    ?window.userWorkSelectedItems()
    :[];
  return Array.isArray(selected)?selected:[];
}
```

Do not inspect localStorage directly for this guard; use the current cart owner.

- [ ] **Step 4: Implement guarded context application**

```js
function applyChatWorkContext(context){
  if(!context?.contactId)return "ignored";
  const cart=currentSelectedCart();
  const changingCustomer=selectedCustomerId&&String(selectedCustomerId)!==String(context.contactId);
  if(changingCustomer&&cart.length){
    pendingChatWorkContext=context;
    setMainStatus("Không đổi khách vì đơn đang có hàng. Gửi/xóa đơn hiện tại rồi chuyển khách.");
    return "deferred";
  }
  chatWorkContext=context;
  pendingChatWorkContext=null;
  if(currentRole()==="admin"){
    selectedCustomerId=context.contactId;
    sessionStorage.setItem(SELECTED_CUSTOMER_KEY,selectedCustomerId);
    syncCustomerControls();
  }
  return "applied";
}
```

For non-admin embedded accounts, keep the context for callback correlation but do not override backend-derived customer scope.

- [ ] **Step 5: Extend the existing exact-origin `message` listener**

Keep the existing `taphoa-chat-auth` path unchanged and add:

```js
if(message?.type==="taphoa-chat-work-context"){
  const context=normalizeChatWorkContext(message);
  if(context)applyChatWorkContext(context);
  return;
}
```

This branch runs only after the existing `event.origin!==CHAT_ORIGIN` guard.

- [ ] **Step 6: Apply a deferred context only after the cart is empty**

Create:

```js
function applyPendingChatWorkContextIfSafe(){
  if(!pendingChatWorkContext||currentSelectedCart().length)return false;
  const next=pendingChatWorkContext;
  pendingChatWorkContext=null;
  return applyChatWorkContext(next)==="applied";
}
```

Call it only from existing points that already know the cart was cleared successfully, such as after successful order submission or explicit cart clear. Do not poll and do not clear the cart yourself.

- [ ] **Step 7: Run targeted tests and syntax check**

```bash
python -m unittest tests.test_chat_order_source_handoff -v
node --check order-management.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add order-management.js tests/test_chat_order_source_handoff.py
git commit -m "feat: accept chat work context safely"
```

---

### Task 3: Notify Chat only after a confirmed order create

**Files:**
- Modify: `order-management.js`
- Modify: `tests/test_chat_order_source_handoff.py`
- Modify: `tests/test_order_submit_single_owner.py`

**Interfaces:**
- Produces `notifyChatOrderCreated({orderId,orderNo,contactId}) -> boolean`.
- Callback only uses the context whose `contactId` matches the submitted customer.
- Callback is executed after `await orderFetch("/orders",{method:"POST",body})` returns successfully and before source context is cleared.

- [ ] **Step 1: Add RED ordering assertions**

In the test, slice `submitSelectedOrder()` and require the sequence:

```python
post=submit.index('await orderFetch("/orders",{method:"POST",body})')
notify=submit.index('notifyChatOrderCreated(')
self.assertLess(post,notify)
self.assertNotIn('notifyChatOrderCreated(',submit[:post])
```

Also require the `catch` branch not to call `notifyChatOrderCreated`.

- [ ] **Step 2: Implement exact-origin completion helper**

```js
function notifyChatOrderCreated({orderId="",orderNo="",contactId=""}={}){
  if(!isEmbeddedInChat()||!chatWorkContext)return false;
  const targetContact=String(contactId||"").trim();
  if(!targetContact||String(chatWorkContext.contactId)!==targetContact)return false;
  if(!chatWorkContext.sourceMessageIds.length)return false;
  window.parent.postMessage({
    type:"taphoa-work-order-created",
    contactId:targetContact,
    sourceMessageIds:[...chatWorkContext.sourceMessageIds],
    orderId:String(orderId||""),
    orderNo:String(orderNo||""),
  },CHAT_ORIGIN);
  return true;
}
```

- [ ] **Step 3: Capture the actual submitted customer before the network call**

Inside `submitSelectedOrder()`, determine once:

```js
const submittedCustomerId=currentRole()==="admin"
  ?String(selectedCustomerId||"").trim()
  :String(currentAccount()?.id||"").trim();
```

Use this same identity for both request validation and callback matching. Do not read a newly changed `selectedCustomerId` after the await.

- [ ] **Step 4: Emit only after successful order backend response**

Immediately after the successful create result is available:

```js
notifyChatOrderCreated({
  orderId:String(data?.order?.id||""),
  orderNo:String(data?.order?.orderNo||""),
  contactId:submittedCustomerId,
});
```

Then clear the cart using the existing owner path. If callback succeeded, clear only `chatWorkContext`; leave a deferred different-customer context intact and apply it after cart clear with `applyPendingChatWorkContextIfSafe()`.

- [ ] **Step 5: Preserve context on submit failure**

The existing `catch` keeps cart state. Add no source-context clearing and no callback there. Tests must assert both conditions.

- [ ] **Step 6: Run submission and handoff tests**

```bash
python -m unittest tests.test_chat_order_source_handoff -v
python -m unittest tests.test_order_submit_single_owner -v
node --check order-management.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add order-management.js tests/test_chat_order_source_handoff.py tests/test_order_submit_single_owner.py
git commit -m "feat: report created work orders to chat"
```

---

### Task 4: Make the active Chat customer visible in the work panel without adding another workflow

**Files:**
- Modify: `order-management.js`
- Modify: `style.css`
- Modify: `tests/test_chat_order_source_handoff.py`

**Interfaces:**
- Reuses existing `taphoaSalesContext`/customer controls.
- Displays `customerName` from `chatWorkContext` as context only; backend/customer picker remains authoritative for actual admin order target.
- Deferred customer context is visibly marked and cannot masquerade as the current cart customer.

- [ ] **Step 1: Add RED UI copy assertions**

Require:

```python
self.assertIn('Nguồn Chat',self.text)
self.assertIn('Đang chờ chuyển sang',self.text)
self.assertIn('chatWorkContext.customerName',self.text)
```

- [ ] **Step 2: Render a compact context row in the existing sales context panel**

Extend `ensureSalesContextPanel()` with:

```html
<div id="taphoaChatOrderContext" class="taphoa-chat-order-context" hidden></div>
```

Render applied context as `Nguồn Chat · {customerName}`. When deferred, render `Đang chờ chuyển sang · {customerName}` and keep the actual selected customer controls unchanged.

- [ ] **Step 3: Keep it presentation-only**

The context row must never call order APIs, alter quantities, or perform customer selection on click. `applyChatWorkContext()` remains the sole owner of safe customer synchronization.

- [ ] **Step 4: Add minimal responsive CSS**

The row must fit inside the existing iframe sales header/context area, wrap text when needed, and not add horizontal overflow. Do not change the outer Chat three-column geometry from this repository.

- [ ] **Step 5: Run targeted tests**

```bash
python -m unittest tests.test_chat_order_source_handoff -v
node --check order-management.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add order-management.js style.css tests/test_chat_order_source_handoff.py
git commit -m "feat: show chat order context in work panel"
```

---

### Task 5: Full GETLINK verification and production gate

**Files:**
- Modify generated/stamped files only via existing tool when required: `index.html`, `version.json` and cache-busted asset references.

**Interfaces:**
- Consumes: GREEN Tasks 1–4.
- Produces: iframe side ready for the Chat `taphoa-chat-work-context` / `taphoa-work-order-created` protocol.

- [ ] **Step 1: Run focused tests**

```bash
python -m unittest tests.test_chat_order_source_handoff -v
python -m unittest tests.test_order_submit_single_owner -v
node --check order-management.js
```

Expected: PASS.

- [ ] **Step 2: Run full GETLINK test suite**

Run: `python -m unittest discover -s tests -v`

Expected: PASS.

- [ ] **Step 3: Run all workflow syntax/static checks**

```bash
python tools/stamp_static_build.py --check
python -W error::SyntaxWarning -m py_compile scraper/scraper.py scraper/brightdata_bhx.py scraper/brightdata_go.py
node --check app.js
node --check order-management.js
node --check relay/src/index.js
deno check supabase/functions/getlink-api/index.ts
deno check supabase/functions/getlink-orders/index.ts
node tests/test_money_display.mjs
node tests/test_bhx_edge_contract.mjs
node tests/test_go_edge_contract.mjs
node tests/test_getlink_name_filter_contract.mjs
```

Expected: PASS.

- [ ] **Step 4: If the build stamp is stale, regenerate only through the existing stamp tool**

Run the repository’s non-check stamping command documented by `tools/stamp_static_build.py`, then rerun `python tools/stamp_static_build.py --check`. Do not hand-edit build ids.

- [ ] **Step 5: Open/update the implementation PR and require `Verify GETLINK` GREEN**

Do not merge based only on focused tests.

- [ ] **Step 6: Merge only after GREEN and verify main + GitHub Pages on the exact merge SHA**

Confirm `Verify GETLINK` success on `main` and Pages deployment success before asking the user to test `chat.taphoa.xyz` with the embedded Công việc panel.
