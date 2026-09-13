# Chat Order Source Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Công việc iframe consume the selected Chat customer/order-source context safely and notify Chat only after a real order has been created successfully.

**Architecture:** Chat remains the source of customer/message context. This repository remains the owner of catalog, quantities, cart and order submission. The iframe keeps a transient Chat work context, applies the customer only when doing so cannot overwrite an in-progress cart, and posts an exact-origin completion event after the existing order backend confirms creation.

**Tech Stack:** Vanilla JavaScript, Python `unittest`, Node syntax checks, existing Supabase `getlink-orders` backend, GitHub Actions, GitHub Pages.

**Spec:** `1sl2tp/chat:docs/superpowers/specs/2026-09-13-customer-order-source-timeline-design.md`

## Global Constraints

- Product UX remains `Trò chuyện | Công việc`; do not expose “GETLINK” as a user workflow concept.
- Chat supplies `contactId`, `customerName`, selected source-message ids and time window.
- This repository remains the only owner of product/cart/order-entry state.
- Never silently switch customer while the current cart contains items.
- Never clear/replace a cart because Chat changes contact.
- Never report source messages as imported before existing `POST /orders` succeeds.
- Failed submission preserves cart and source context and emits no completion event.
- Source-message ids are cross-frame correlation metadata only; do not add them to the order backend schema in this slice.
- Cross-frame communication accepts only exact `https://chat.taphoa.xyz` origin and posts back only to that origin.
- Standalone protected behavior remains unchanged; work context is active only when embedded in Chat.
- Do not modify Chat/Call code in this repository.
- Production remains GitHub Pages; do not introduce Vercel.

---

### Task 1: Lock the bridge/customer-safety contract with RED tests

**Files:**
- Create: `tests/test_chat_order_source_handoff.py`
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Inbound: `{type:'taphoa-chat-work-context',contactId,customerName,sourceMessageIds,preset,from,to}`.
- Outbound: `{type:'taphoa-work-order-created',contactId,sourceMessageIds,orderId,orderNo}`.
- New transient state: `chatWorkContext`, `pendingChatWorkContext`.

- [ ] **Step 1: Write failing contract**

```python
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
```

- [ ] **Step 2: Run RED**

Run: `python -m unittest tests.test_chat_order_source_handoff -v`

Expected: FAIL on missing context/callback behavior.

- [ ] **Step 3: Add targeted CI step**

In `.github/workflows/verify.yml`, before full discovery:

```yaml
- run: python -m unittest tests.test_chat_order_source_handoff -v
```

- [ ] **Step 4: Commit RED contract**

```bash
git add tests/test_chat_order_source_handoff.py .github/workflows/verify.yml
git commit -m "test: lock chat order source handoff"
```

---

### Task 2: Accept Chat context and defer unsafe customer switches

**Files:**
- Modify: `order-management.js`
- Modify: `tests/test_chat_order_source_handoff.py`

**Interfaces:**
- `normalizeChatWorkContext(message)`.
- `currentSelectedCart()` uses the existing cart owner `window.userWorkSelectedItems()`.
- `applyChatWorkContext(context) -> 'applied'|'deferred'|'ignored'`.
- `applyPendingChatWorkContextIfSafe() -> boolean`.

- [ ] **Step 1: Extend RED test for normalization and deduplication**

Require:

```python
self.assertIn('function normalizeChatWorkContext(',self.text)
self.assertIn('Array.from(new Set(',self.text)
self.assertIn('.slice(0,100)',self.text)
self.assertIn('function applyPendingChatWorkContextIfSafe(',self.text)
```

- [ ] **Step 2: Add transient state and normalizer**

Near existing order state:

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

- [ ] **Step 3: Add one cart-state helper**

```js
function currentSelectedCart(){
  const selected=typeof window.userWorkSelectedItems==="function"
    ?window.userWorkSelectedItems()
    :[];
  return Array.isArray(selected)?selected:[];
}
```

Do not read cart localStorage directly for this guard.

- [ ] **Step 4: Implement safe application**

```js
function applyChatWorkContext(context){
  if(!context?.contactId)return "ignored";
  const cart=currentSelectedCart();
  const changingCustomer=selectedCustomerId&&String(selectedCustomerId)!==String(context.contactId);
  if(changingCustomer&&cart.length){
    pendingChatWorkContext=context;
    setMainStatus("Không đổi khách vì đơn đang có hàng. Gửi/xóa đơn hiện tại rồi chuyển khách.");
    renderChatWorkContext();
    return "deferred";
  }
  chatWorkContext=context;
  pendingChatWorkContext=null;
  if(currentRole()==="admin"){
    selectedCustomerId=context.contactId;
    sessionStorage.setItem(SELECTED_CUSTOMER_KEY,selectedCustomerId);
    syncCustomerControls();
  }
  renderChatWorkContext();
  return "applied";
}
```

For non-admin accounts, preserve context for callback correlation but do not override backend-derived customer scope.

- [ ] **Step 5: Extend existing exact-origin message listener**

Keep `taphoa-chat-auth` unchanged. After the existing `event.origin!==CHAT_ORIGIN` guard:

```js
if(message?.type==="taphoa-chat-work-context"){
  const context=normalizeChatWorkContext(message);
  if(context)applyChatWorkContext(context);
  return;
}
```

- [ ] **Step 6: Implement deferred application**

```js
function applyPendingChatWorkContextIfSafe(){
  if(!pendingChatWorkContext||currentSelectedCart().length)return false;
  const next=pendingChatWorkContext;
  pendingChatWorkContext=null;
  return applyChatWorkContext(next)==="applied";
}
```

Call it only after an existing flow has successfully emptied the cart (successful order submission or explicit cart clear). Never poll and never clear the cart in this helper.

- [ ] **Step 7: Verify and commit**

```bash
python -m unittest tests.test_chat_order_source_handoff -v
node --check order-management.js
git add order-management.js tests/test_chat_order_source_handoff.py
git commit -m "feat: accept chat work context safely"
```

---

### Task 3: Notify Chat only after confirmed `POST /orders`

**Files:**
- Modify: `order-management.js`
- Modify: `tests/test_chat_order_source_handoff.py`
- Modify: `tests/test_order_submit_single_owner.py`

**Interfaces:**
- `notifyChatOrderCreated({orderId,orderNo,contactId}) -> boolean`.
- Callback uses the exact context matching the customer captured before the async network request.

- [ ] **Step 1: Add RED ordering assertions**

Slice `submitSelectedOrder()` and require:

```python
post=submit.index('await orderFetch("/orders",{method:"POST",body})')
notify=submit.index('notifyChatOrderCreated(')
self.assertLess(post,notify)
self.assertNotIn('notifyChatOrderCreated(',submit[:post])
```

Also assert the `catch` branch contains no completion callback and no source-context clearing.

- [ ] **Step 2: Implement completion helper**

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

- [ ] **Step 3: Capture submitted customer before await**

Inside `submitSelectedOrder()`:

```js
const submittedCustomerId=currentRole()==="admin"
  ?String(selectedCustomerId||"").trim()
  :String(currentAccount()?.id||"").trim();
```

Do not reread a possibly changed `selectedCustomerId` after the network call.

- [ ] **Step 4: Emit after backend success, then use existing clear-cart path**

After successful `orderFetch`:

```js
const notified=notifyChatOrderCreated({
  orderId:String(data?.order?.id||""),
  orderNo:String(data?.order?.orderNo||""),
  contactId:submittedCustomerId,
});
if(notified)chatWorkContext=null;
```

After the existing cart owner confirms the cart is cleared, call `applyPendingChatWorkContextIfSafe()`.

- [ ] **Step 5: Preserve everything on failure**

No callback, no source-context clearing, and no cart clearing before a successful backend response.

- [ ] **Step 6: Verify and commit**

```bash
python -m unittest tests.test_chat_order_source_handoff -v
python -m unittest tests.test_order_submit_single_owner -v
node --check order-management.js
git add order-management.js tests/test_chat_order_source_handoff.py tests/test_order_submit_single_owner.py
git commit -m "feat: report created work orders to chat"
```

---

### Task 4: Show applied/deferred Chat customer context in the existing work UI

**Files:**
- Modify: `order-management.js`
- Modify: `style.css`
- Modify: `tests/test_chat_order_source_handoff.py`

**Interfaces:**
- Reuses `taphoaSalesContext` and existing customer controls.
- Presentation only; no click action changes order/customer state.

- [ ] **Step 1: Add RED copy/host assertions**

```python
self.assertIn('taphoaChatOrderContext',self.text)
self.assertIn('Nguồn Chat',self.text)
self.assertIn('Đang chờ chuyển sang',self.text)
self.assertIn('chatWorkContext.customerName',self.text)
```

- [ ] **Step 2: Add compact context host**

In `ensureSalesContextPanel()`:

```html
<div id="taphoaChatOrderContext" class="taphoa-chat-order-context" hidden></div>
```

- [ ] **Step 3: Implement presentation renderer**

Applied context: `Nguồn Chat · {customerName}`.

Deferred context: `Đang chờ chuyển sang · {customerName}`.

Keep actual selected-customer UI unchanged while deferred.

- [ ] **Step 4: Add minimal CSS**

The row wraps, stays inside the iframe work header/context area, and causes no horizontal overflow. Do not change outer Chat three-column geometry here.

- [ ] **Step 5: Verify and commit**

```bash
python -m unittest tests.test_chat_order_source_handoff -v
node --check order-management.js
git add order-management.js style.css tests/test_chat_order_source_handoff.py
git commit -m "feat: show chat order context in work panel"
```

---

### Task 5: Full GETLINK verification and production gate

**Files:**
- Build metadata only via `tools/stamp_static_build.py`: `index.html`, `version.json`.

- [ ] **Step 1: Run focused tests**

```bash
python -m unittest tests.test_chat_order_source_handoff -v
python -m unittest tests.test_order_submit_single_owner -v
node --check order-management.js
```

- [ ] **Step 2: Run full suite**

Run: `python -m unittest discover -s tests -v`

Expected: PASS.

- [ ] **Step 3: Run workflow-equivalent checks**

```bash
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

- [ ] **Step 4: Regenerate static build stamp, then verify it**

```bash
python tools/stamp_static_build.py
python tools/stamp_static_build.py --check
```

Do not hand-edit build ids.

- [ ] **Step 5: Rerun full suite after stamping**

Run: `python -m unittest discover -s tests -v`

Expected: PASS.

- [ ] **Step 6: Open/update implementation PR and require `Verify GETLINK` GREEN**

Do not merge based only on focused tests.

- [ ] **Step 7: Merge only after GREEN and verify exact merge SHA on main + GitHub Pages**

Confirm `Verify GETLINK` success on main and GitHub Pages success before asking the user to test through `chat.taphoa.xyz`.