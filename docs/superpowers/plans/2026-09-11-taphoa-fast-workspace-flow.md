# TAPHOA Fast Workspace Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor GETLINK Tạp hóa into one fast Sales / Orders / Debt workspace that preserves customer context, removes the duplicate management overlay, sorts chronological work newest-first, and uses compact-thousand money display without changing Chat identity or backend business semantics.

**Architecture:** Keep the existing vanilla `app.js` catalog/sales rendering and `order-management.js` order/debt API/state functions. Convert the order manager from a fixed overlay into an inline Tạp hóa workspace surface, add a single Tạp hóa sub-navigation owner, persist the selected customer across successful sales actions, expose explicit busy state on submit controls, and sort/render order/debt data at the UI boundary. No new backend tables, no second sales state tree, and no changes to Chat/Call auth.

**Tech Stack:** Vanilla HTML/JavaScript/CSS, Python `unittest` contract tests, GitHub Actions verify pipeline, existing Supabase Edge Functions unchanged.

**Spec:** `docs/superpowers/specs/2026-09-11-taphoa-fast-workspace-flow-design.md`

## Global Constraints

- Scope is GETLINK Tạp hóa only. No Chat/Call auth change, no Siêu thị/Tin tức business UI, no backend table redesign.
- `Đơn` and `Công nợ` appear only inside Tạp hóa.
- Normal Sales actions share one owner: `Xóa / Bán nhanh / Gửi đơn`; editing changes the same region to `Hủy / Cập nhật`.
- Successful Gửi/Bán/Cập nhật/Hủy sửa does not clear the selected customer unless the Chat identity changes or the customer becomes invalid.
- Busy submit state must be visible and disabled; repeated taps must not fail silently.
- Order/debt chronological views default to newest/recent first.
- Dense business money display uses compact thousands: `475000 → 475`, `475500 → 475.5`, `1000000 → 1.000`, `1250000 → 1.250`; no `đ` or `₫` suffix in Tạp hóa Sales / Orders / Debt.
- Meaningful touch controls remain about 44×44px with visible focus/pressed states; density comes from reduced non-interactive whitespace, not tiny targets.
- Existing order semantics stay locked: pending Xóa = delete pending; delivered Xóa = return/reversal.
- Existing business/auth contracts must continue to pass.

---

### Task 1: Lock fast-workspace contracts with RED tests

**Files:**
- Create: `tests/test_taphoa_fast_workspace_flow.py`
- Read: `app.js`
- Read: `order-management.js`
- Read: `order-management.css`
- Read: `style.css`

**Interfaces:**
- Consumes: existing DOM ids `userWorkSendOrder`, `mobileUserSendOrder`; current order/debt state variables and render functions.
- Produces: regression contracts for workspace ownership, customer persistence, busy feedback, recency ordering, compact money formatting, and no modal-only desktop manager.

- [ ] **Step 1: Write the failing contract test**

```python
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
ORDER = (ROOT / "order-management.js").read_text(encoding="utf-8")
CSS = (ROOT / "order-management.css").read_text(encoding="utf-8")
STYLE = (ROOT / "style.css").read_text(encoding="utf-8")

class TaphoaFastWorkspaceFlowTest(unittest.TestCase):
    def test_workspace_nav_is_taphoa_only_and_has_sales_orders_debt(self):
        self.assertIn('data-taphoa-work-view="sales"', ORDER)
        self.assertIn('data-taphoa-work-view="orders"', ORDER)
        self.assertIn('data-taphoa-work-view="debts"', ORDER)
        self.assertIn('function isTaphoaWorkspaceActive()', ORDER)

    def test_success_paths_do_not_clear_selected_customer_or_open_manager(self):
        for name in ("submitSelectedOrder", "submitQuickSale", "updateEditingOrder", "cancelEditOrder"):
            block = re.search(r"(?:async )?function " + name + r"\([^)]*\)\{([\s\S]*?)\n  \}", ORDER)
            self.assertIsNotNone(block, name)
            self.assertNotIn("clearSelectedCustomer()", block.group(1), name)
        for name in ("submitSelectedOrder", "submitQuickSale"):
            block = re.search(r"async function " + name + r"\([^)]*\)\{([\s\S]*?)\n  \}", ORDER)
            self.assertNotIn("openManager()", block.group(1), name)

    def test_busy_state_is_rendered_on_sales_actions(self):
        self.assertIn("function setSalesBusyState(", ORDER)
        self.assertIn('aria-busy', ORDER)
        self.assertRegex(ORDER, r'Đang gửi…|Đang gửi\.\.\.')
        self.assertRegex(ORDER, r'Đang bán…|Đang bán\.\.\.')
        self.assertRegex(ORDER, r'Đang cập nhật…|Đang cập nhật\.\.\.')

    def test_compact_business_money_formatter(self):
        self.assertIn("function compactMoney(", ORDER)
        self.assertIn("Math.round(n/500)*.5", ORDER)
        self.assertNotIn('toLocaleString("vi-VN")+" ₫"', ORDER)

    def test_recency_sort_helpers_exist(self):
        self.assertIn("function sortOrdersNewestFirst(", ORDER)
        self.assertIn("function sortDebtCustomersNewestFirst(", ORDER)
        self.assertIn("function newestDebtTimeline(", ORDER)

    def test_desktop_manager_is_inline_not_fixed_overlay(self):
        self.assertRegex(CSS, r"\.order-manager\{[^}]*position:(?:relative|static|absolute)")
        self.assertNotRegex(CSS, r"\.order-manager\{[^}]*position:fixed")
        self.assertIn("taphoa-workspace", CSS + STYLE)

    def test_touch_and_focus_contracts_remain(self):
        self.assertIn("--order-touch:44px", CSS)
        self.assertRegex(CSS, r":focus-visible")
        self.assertRegex(CSS, r":active")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:
```bash
python -m unittest tests.test_taphoa_fast_workspace_flow -v
```
Expected: FAIL only on the new fast-workspace contracts; existing source remains unchanged.

- [ ] **Step 3: Commit only the RED test**

```bash
git add tests/test_taphoa_fast_workspace_flow.py
git commit -m "test: lock TAPHOA fast workspace flow"
```

---

### Task 2: Create one Tạp hóa workspace navigation and inline manager host

**Files:**
- Modify: `order-management.js`
- Modify: `order-management.css`
- Modify: `style.css`
- Test: `tests/test_taphoa_fast_workspace_flow.py`

**Interfaces:**
- Consumes: existing `mobileUserScope`, desktop Tạp hóa DOM, `activeView`, `renderOrders`, `refreshDebts`.
- Produces: `taphoaWorkView: "sales" | "orders" | "debts"`, `isTaphoaWorkspaceActive()`, `syncTaphoaWorkspace()`, inline `#orderManager` host.

- [ ] **Step 1: Add minimal workspace state and nav markup**

In `order-management.js`, replace the duplicated `order-work-nav` model with one Tạp hóa nav:

```js
let taphoaWorkView="sales";

function isTaphoaWorkspaceActive(){
  const mobileMine=document.querySelector('.mobile-user-source-btn[data-user-scope="mine"].active');
  const desktopMine=document.querySelector('[data-user-work-scope="mine"].active,.user-work-panel[data-scope="mine"]');
  return Boolean(mobileMine||desktopMine||document.querySelector('.user-work-top'));
}

function taphoaWorkspaceNavMarkup(){
  return '<nav class="taphoa-work-nav" aria-label="Tạp hóa">'+
    '<button type="button" data-taphoa-work-view="sales">Bán</button>'+
    '<button type="button" data-taphoa-work-view="orders">Đơn</button>'+
    '<button type="button" data-taphoa-work-view="debts">Công nợ</button>'+
  '</nav>';
}
```

`syncTaphoaWorkspace()` must show the Sales/catalog owner only for `sales`, show the existing order/debt body inline for `orders/debts`, and hide the nav when the active global scope is Siêu thị or Tin tức.

- [ ] **Step 2: Convert the normal manager host from modal semantics to inline semantics**

Change injected structure from a dialog-only overlay to:

```html
<section id="orderManager" class="order-manager taphoa-workspace-panel" hidden aria-labelledby="orderManagerTitle">
  <div class="order-manager-panel">
    ...existing order/debt body...
  </div>
</section>
```

Remove `role="dialog"`, `aria-modal="true"`, backdrop-close ownership and the normal desktop close button. Mobile detail surfaces may still use a one-level sheet, but the main Orders/Debt route is inline.

- [ ] **Step 3: Style desktop inline geometry**

In `order-management.css`:

```css
.order-manager{
  position:relative;
  inset:auto;
  z-index:auto;
  width:100%;
  min-width:0;
  background:transparent;
  display:block;
}
.order-manager-panel{
  width:100%;
  height:auto;
  min-height:0;
  background:#fff;
  box-shadow:none;
  overflow:visible;
}
.taphoa-work-nav{
  display:flex;
  align-items:center;
  gap:8px;
}
.taphoa-work-nav button{min-height:44px;min-width:64px;}
```

Do not create a second floating manager on desktop.

- [ ] **Step 4: Run focused test**

```bash
python -m unittest tests.test_taphoa_fast_workspace_flow -v
node --check order-management.js
```
Expected: workspace/nav/modal assertions PASS; customer/busy/recency/money assertions may still fail until later tasks.

- [ ] **Step 5: Commit**

```bash
git add order-management.js order-management.css style.css tests/test_taphoa_fast_workspace_flow.py
git commit -m "refactor: make Tạp hóa management inline"
```

---

### Task 3: Make customer context persistent and sales submits explicit

**Files:**
- Modify: `order-management.js`
- Modify: `order-management.css`
- Test: `tests/test_taphoa_fast_workspace_flow.py`

**Interfaces:**
- Consumes: `selectedCustomerId`, `SELECTED_CUSTOMER_KEY`, existing submit functions and action controls.
- Produces: `setSalesBusyState(kind, on)`, persistent customer selection across submit/edit completion, explicit disabled/label state.

- [ ] **Step 1: Add the busy-state helper**

```js
function setSalesBusyState(kind,on){
  const labels={send:"Gửi đơn",quick:"Bán nhanh",update:"Cập nhật"};
  const busyLabels={send:"Đang gửi…",quick:"Đang bán…",update:"Đang cập nhật…"};
  document.querySelectorAll('#userWorkSendOrder,#mobileUserSendOrder,[data-order-cart-action="quick"],[data-order-cart-action="update"]').forEach(button=>{
    const buttonKind=button.matches('[data-order-cart-action="quick"]')?"quick":button.matches('[data-order-cart-action="update"]')?"update":"send";
    const active=Boolean(on&&buttonKind===kind);
    button.disabled=Boolean(on);
    button.setAttribute('aria-busy',active?'true':'false');
    if(active)button.textContent=busyLabels[buttonKind];
    else if(buttonKind==="send")button.textContent="Gửi đơn";
    else button.textContent=labels[buttonKind];
  });
}
```

- [ ] **Step 2: Preserve customer selection across sales lifecycle**

Remove `clearSelectedCustomer()` from successful `submitSelectedOrder`, successful `submitQuickSale`, successful `updateEditingOrder`, and `cancelEditOrder`. Keep customer clearing only when Chat account identity changes, role changes from Admin to User, logout/auth clear, or customer refresh proves the saved id invalid.

- [ ] **Step 3: Keep Sales after send/quick and expose status**

In `submitSelectedOrder()` and `submitQuickSale()`, after success:
- clear only the cart;
- keep `selectedCustomerId`;
- set compact inline status containing `#orderNo`;
- set `taphoaWorkView="sales"` and `syncTaphoaWorkspace()`;
- do not call `openManager()`.

Wrap each mutation with:

```js
setSalesBusyState("send",true);
try { ... } finally { busy=false; setSalesBusyState("send",false); }
```

Use `quick` and `update` for the other mutation paths.

- [ ] **Step 4: Style disabled/busy feedback**

```css
[data-order-cart-action]:disabled,
#userWorkSendOrder:disabled,
#mobileUserSendOrder:disabled{
  cursor:progress;
  opacity:.62;
}
[data-order-cart-action][aria-busy="true"],
#userWorkSendOrder[aria-busy="true"],
#mobileUserSendOrder[aria-busy="true"]{
  min-width:7.5em;
}
```

- [ ] **Step 5: Run focused tests and syntax**

```bash
python -m unittest tests.test_taphoa_fast_workspace_flow -v
node --check order-management.js
```
Expected: persistence/busy/stay-in-Sales assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add order-management.js order-management.css tests/test_taphoa_fast_workspace_flow.py
git commit -m "fix: preserve customer and expose submit state"
```

---

### Task 4: Apply newest-first ordering and compact money display

**Files:**
- Modify: `order-management.js`
- Modify: `order-management.css`
- Test: `tests/test_taphoa_fast_workspace_flow.py`

**Interfaces:**
- Consumes: order objects returned by existing GETLINK order API; debt summaries/timeline returned by existing debt API.
- Produces: `compactMoney(value)`, `sortOrdersNewestFirst(rows,status)`, `sortDebtCustomersNewestFirst(rows)`, `newestDebtTimeline(rows)`.

- [ ] **Step 1: Replace business money formatter**

```js
function compactMoney(value){
  const n=Number(value||0);
  if(!Number.isFinite(n))return "—";
  const compact=Math.round(n/500)*.5;
  return new Intl.NumberFormat("vi-VN",{minimumFractionDigits:0,maximumFractionDigits:1}).format(compact);
}
```

Use `compactMoney()` for Tạp hóa Orders/Debt values and sales action summaries owned by `order-management.js`. Do not alter stored/API VND values.

- [ ] **Step 2: Add recency helpers**

```js
function orderRecency(order){
  if(order.status==="returned")return Date.parse(order.returnedAt||order.deliveredAt||order.orderedAt||0)||0;
  if(order.status==="delivered")return Date.parse(order.deliveredAt||order.orderedAt||0)||0;
  return Date.parse(order.submittedAt||order.orderedAt||0)||0;
}
function sortOrdersNewestFirst(rows){
  return [...rows].sort((a,b)=>orderRecency(b)-orderRecency(a)||Number(b.orderNo||0)-Number(a.orderNo||0));
}
function sortDebtCustomersNewestFirst(rows){
  return [...rows].sort((a,b)=>(Date.parse(b.lastOccurredAt||0)||0)-(Date.parse(a.lastOccurredAt||0)||0));
}
function newestDebtTimeline(rows){
  return [...rows].sort((a,b)=>(Date.parse(b.occurredAt||0)||0)-(Date.parse(a.occurredAt||0)||0));
}
```

- [ ] **Step 3: Apply helpers only at render/filter boundaries**

`renderOrders()` renders `sortOrdersNewestFirst(filterOrdersForReport(orders))`.
`renderDebtSummaries()` renders `sortDebtCustomersNewestFirst(debtSummaries)`.
`renderDebtDetail()` renders `newestDebtTimeline(timeline)`.
Do not reverse or mutate the source arrays used to calculate `balanceAfterVnd`.

- [ ] **Step 4: Make numeric columns tabular/right aligned**

```css
.order-card-head>b,
.order-source-summary [data-order-source-open] span:not(:first-child),
.debt-customer-card>b,
.debt-txn-main>b,
.debt-balance-after strong{
  font-variant-numeric:tabular-nums;
  text-align:right;
}
```

- [ ] **Step 5: Run focused test and existing money test**

```bash
python -m unittest tests.test_taphoa_fast_workspace_flow -v
node tests/test_money_display.mjs
node --check order-management.js
```
Expected: all focused assertions PASS and existing money contract remains compatible.

- [ ] **Step 6: Commit**

```bash
git add order-management.js order-management.css tests/test_taphoa_fast_workspace_flow.py
git commit -m "feat: show recent business data first"
```

---

### Task 5: Finish responsive hierarchy and remove duplicate UI ownership

**Files:**
- Modify: `app.js`
- Modify: `style.css`
- Modify: `order-management.js`
- Modify: `order-management.css`
- Test: `tests/test_taphoa_fast_workspace_flow.py`
- Test: existing UI contract tests under `tests/`

**Interfaces:**
- Consumes: existing Tạp hóa product/category layout and the workspace state from Tasks 2–4.
- Produces: wide desktop Sales geometry, one-level mobile detail behavior, one customer selector/action owner, no duplicate `Quản lý` strip.

- [ ] **Step 1: Remove duplicate manager/nav injection paths**

Delete the old `orderManagerButton` insertion and old `workManagerNavMarkup()`/`ensureWorkManagerNav()` route. Keep one `taphoa-work-nav` injected adjacent to the Tạp hóa workspace owner. Orders and Debt do not add a second nav inside their content.

- [ ] **Step 2: Use available desktop width**

Add/adjust CSS Grid for Tạp hóa Sales at wide desktop:

```css
@media (min-width:1000px){
  .user-work-layout.taphoa-workspace{
    display:grid;
    grid-template-columns:minmax(180px,.72fr) minmax(420px,1.65fr) minmax(260px,.9fr);
    gap:12px;
    min-width:0;
  }
  .taphoa-workspace-panel{grid-column:1/-1;min-width:0;}
}
```

Use the existing category list as the left owner and the existing product list as the center owner. The right Sales context must contain the one customer selector, selected-order summary and actions; do not clone product state.

- [ ] **Step 3: Keep mobile single-level**

At `<640px`, the workspace nav remains visible; Orders/Debt replace the Sales body in the same Tạp hóa surface. Detail uses one full-width sheet/surface and back returns to the previous list/filter state. Do not nest `orderManager` inside another overlay.

- [ ] **Step 4: Add Taste/UI UX interaction states**

Ensure new nav, row and action controls have:

```css
.taphoa-work-nav button,
.order-card-detail-toggle,
.debt-customer-card{
  transition:background-color .16s ease,border-color .16s ease,transform .12s ease;
}
.taphoa-work-nav button:active,
.order-card-detail-toggle:active,
.debt-customer-card:active{transform:translateY(1px);}
.taphoa-work-nav button:focus-visible,
.order-card-detail-toggle:focus-visible,
.debt-customer-card:focus-visible{
  outline:2px solid var(--order-focus);
  outline-offset:2px;
}
@media (prefers-reduced-motion:reduce){
  .taphoa-work-nav button,
  .order-card-detail-toggle,
  .debt-customer-card{transition:none;}
}
```

- [ ] **Step 5: Run focused and full local test suite**

```bash
python -m unittest tests.test_taphoa_fast_workspace_flow -v
python -m unittest discover -s tests -v
node --check app.js
node --check order-management.js
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app.js style.css order-management.js order-management.css tests/test_taphoa_fast_workspace_flow.py
git commit -m "feat: complete fast Tạp hóa workspace layout"
```

---

### Task 6: Build stamp, exact-SHA verification, review and merge

**Files:**
- Modify: build stamp file(s) selected by `tools/stamp_static_build.py`
- Read: `.github/workflows/verify.yml`
- Review: all PR changed files

**Interfaces:**
- Consumes: completed frontend changes.
- Produces: verified branch head and merge commit; no production backend change.

- [ ] **Step 1: Restamp static build**

Run:
```bash
python tools/stamp_static_build.py
python tools/stamp_static_build.py --check
```
Expected: PASS.

- [ ] **Step 2: Run complete verification locally/CI-equivalent**

Run:
```bash
python -m unittest discover -s tests -v
node --check app.js
node --check order-management.js
node tests/test_money_display.mjs
deno check supabase/functions/getlink-api/index.ts
deno check supabase/functions/getlink-orders/index.ts
```
Expected: all PASS.

- [ ] **Step 3: Review diff against scope**

Required changed-file set is limited to spec/plan/tests/build stamp plus `app.js`, `style.css`, `order-management.js`, `order-management.css`. No Chat/Call files, no Supabase migration, no Edge Function behavior changes, no news/supermarket/crawler edits.

- [ ] **Step 4: Open PR and run Verify on the exact head SHA**

Create a PR from `feature/taphoa-fast-workspace-flow` to `main`. Verify must complete successfully on the exact branch head. If the head moves after Verify, rerun Verify on the new head before merging.

- [ ] **Step 5: Merge only the verified head**

Use merge with `expected_head_sha=<verified SHA>` so GitHub rejects a moved head.

- [ ] **Step 6: Verify post-merge main**

Wait for `Verify GETLINK`, `Smoke Supabase GETLINK`, and Pages deployment on the merge commit. Only then call the release complete. Do not claim manual live-click testing unless a browser E2E was actually performed.
