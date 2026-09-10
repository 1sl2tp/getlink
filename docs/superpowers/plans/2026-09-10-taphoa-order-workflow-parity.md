# GETLINK Tạp hóa Order Workflow Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the native GETLINK Tạp hóa workflow so User/Admin can create, edit, delete, quick-sell, manage and synchronize orders/debt with the same interaction hierarchy as the TAPHOAXYZ reference.

**Architecture:** Keep `app.js` as the only cart owner, `order-management.js` as order/debt UI orchestration, `getlink-orders` as the authorization gateway, and the existing `getlink_sales_*` tables as the single business data core. Add service-role-only RPCs for pending edits/deletes/batch deletes and atomic Admin quick sale, plus a lightweight sync fingerprint endpoint for cross-device refresh.

**Tech Stack:** Vanilla JS/CSS, Supabase Edge Functions (Deno/TypeScript), PostgreSQL migrations/RPCs, Python unittest contract tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-taphoa-order-workflow-parity-design.md`

## Global Constraints

- Do not modify Chat, Call, crawler, supermarket/news behavior, or TAPHOAXYZ.
- Chat remains the identity owner; no second GETLINK login/session.
- User sees only own orders/debt and never cost/profit/customer list.
- `app.js` exclusively owns Tạp hóa cart localStorage and rendering.
- Products appear only after opening an order detail.
- Destructive actions require confirmation.
- Cart clears only after a successful create/update/quick-sale command.
- No direct authenticated/anon CRUD grants to `getlink_sales_*` tables.

---

### Task 1: Lock backend permission and command contracts

**Files:**
- Create: `tests/test_taphoa_order_workflow_parity.py`
- Create: `supabase/migrations/20260910224500_getlink_order_workflow_parity.sql`
- Modify: `supabase/functions/getlink-orders/index.ts`

**Interfaces:**
- Produces RPCs `getlink_sales_update_pending_order(uuid,uuid,jsonb)`, `getlink_sales_delete_pending_order(uuid,uuid)`, `getlink_sales_delete_all_pending(uuid)`, `getlink_sales_create_quick_sale(jsonb,jsonb)`.
- Produces HTTP `PUT /orders/:id`, `DELETE /orders/:id`, `DELETE /orders/pending`, `POST /orders` with `mode:"quick"`, and `GET /sync`.

- [ ] **Step 1: Write the failing backend contract tests**

Test source must assert:
```python
self.assertIn('getlink_sales_update_pending_order', migration)
self.assertIn('getlink_sales_delete_pending_order', migration)
self.assertIn('getlink_sales_delete_all_pending', migration)
self.assertIn('getlink_sales_create_quick_sale', migration)
self.assertIn('if v_actor_role=\'user\' and v_order.customer_account_id<>p_actor_id', migration)
self.assertIn('if(req.method==="PUT"&&orderIdMatch)', edge)
self.assertIn('req.method==="DELETE"&&path==="/orders/pending"', edge)
self.assertIn('body?.mode)==="quick"', edge)
self.assertIn('path==="/sync"', edge)
self.assertIn('"access-control-allow-methods":"GET,POST,PUT,DELETE,OPTIONS"', edge)
```

- [ ] **Step 2: Run RED**

Run: `python -m unittest tests.test_taphoa_order_workflow_parity -v`
Expected: FAIL because the RPCs/routes do not exist yet.

- [ ] **Step 3: Add atomic service-role-only RPCs**

Migration behavior:
- update locks the target order, requires `pending`, allows Admin or the matching `customer_account_id` User, validates every line, replaces items and totals, increments version;
- delete-one uses the same actor rule and deletes only pending;
- delete-all scopes User to `customer_account_id=p_actor_id`, Admin to all pending;
- quick sale requires Admin, calls existing create RPC then existing deliver RPC inside one SQL transaction;
- revoke from public/anon/authenticated and grant only service_role.

- [ ] **Step 4: Extend Edge Function routes**

Implement:
```ts
PUT /orders/:id                 -> updatePendingOrder(req,id,actor)
DELETE /orders/:id              -> deletePendingOrder(id,actor)
DELETE /orders/pending          -> deleteAllPendingOrders(actor)
POST /orders {mode:"quick"}    -> Admin-only atomic quick sale
GET /sync                       -> scoped order/debt fingerprints
```
`resolveCreateItems()` remains authoritative for current price/cost/stock.

- [ ] **Step 5: Run backend tests and Deno syntax check**

Run: `python -m unittest tests.test_taphoa_order_workflow_parity -v` and repository Edge Function verification.
Expected: PASS.

---

### Task 2: Give the Tạp hóa cart explicit load/clear ownership

**Files:**
- Modify: `app.js`
- Test: `tests/test_taphoa_order_workflow_parity.py`

**Interfaces:**
- Produces `window.loadUserWorkOrderSelection(order)` and keeps `window.clearUserWorkOrderSelection()` as the only cart mutations used by order management.

- [ ] **Step 1: Add failing cart-owner assertions**

```python
self.assertIn('function loadUserWorkOrderSelection(order)', app)
self.assertIn('window.loadUserWorkOrderSelection=loadUserWorkOrderSelection', app)
self.assertIn('writeUserWorkQtyMap(map)', app)
self.assertIn('mobileUserScope="mine"', app)
```
Also assert `order-management.js` does not directly remove/set `getlink:user-work-order-qty`.

- [ ] **Step 2: Run RED**

Expected: FAIL because the load API does not exist.

- [ ] **Step 3: Implement load owner**

`loadUserWorkOrderSelection(order)` clears the current quantity map, loads only matching Tạp hóa item URLs from `order.items`, switches desktop/mobile scope back to `mine`, invalidates only the mine view cache, renders, updates selected count, and returns the number of loaded lines.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

---

### Task 3: Implement edit, clear, quick sale and scoped order actions in UI

**Files:**
- Modify: `order-management.js`
- Modify: `order-management.css`
- Modify: `index.html` only if static action slots cannot be injected cleanly
- Test: `tests/test_taphoa_order_workflow_parity.py`

**Interfaces:**
- Uses cart APIs from Task 2.
- Maintains `editingOrderId`/`editingOrderNo` only in order-management state.

- [ ] **Step 1: Add failing UI contract tests**

Assert normal cart action labels and permissions:
```python
self.assertIn('data-order-cart-action="clear"', js)
self.assertIn('data-order-cart-action="quick"', js)
self.assertIn('Bán nhanh', js)
self.assertIn('data-order-action="edit"', js)
self.assertIn('data-order-batch="delete-pending"', js)
self.assertIn('Xóa tất cả', js)
self.assertIn('editingOrderId', js)
self.assertIn('Cập nhật đơn', js)
self.assertIn('Hủy', js)
```

- [ ] **Step 2: Run RED**

Expected: FAIL.

- [ ] **Step 3: Make list/detail hierarchy match the locked flow**

Collapsed order card shows only `#orderNo`, Admin customer name, time, line count, total quantity, total and `Xem đơn`. Expanded pending detail shows items and footer actions:
- User: `Sửa | Xóa`;
- Admin: `Sửa | Đã giao | Xóa`.
Delivered Admin gets `Đã hoàn`; returned is read-only.

- [ ] **Step 4: Implement edit round-trip**

On `Sửa` for pending:
```js
editingOrderId=order.id;
editingOrderNo=order.orderNo;
window.loadUserWorkOrderSelection(order);
closeManager();
```
Normal send controls switch to `Hủy | Cập nhật đơn`. Update calls `PUT /orders/:id`, clears cart only after success, exits edit mode and opens pending list with the same order number.

- [ ] **Step 5: Implement normal cart actions**

User sees `Xóa | Gửi đơn`.
Admin sees `Xóa | Gửi đơn | Bán nhanh`.
`Xóa` calls cart owner clear. `Bán nhanh` requires selected customer, sends `mode:"quick"`, then clears cart and opens `Đã giao`.

- [ ] **Step 6: Implement pending batch delete**

Show `Xóa tất cả` only on pending with visible rows. Confirm once, call `DELETE /orders/pending`, collapse detail and refresh. Backend actor scope is authoritative.

- [ ] **Step 7: Run focused UI tests and JS syntax checks**

Expected: PASS.

---

### Task 4: Keep Admin/User order screens synchronized

**Files:**
- Modify: `order-management.js`
- Test: `tests/test_taphoa_order_workflow_parity.py`

**Interfaces:**
- Uses `GET /sync` from Task 1.

- [ ] **Step 1: Add failing sync assertions**

```python
self.assertIn('const ORDER_SYNC_MS=', js)
self.assertIn('async function checkRemoteRevision', js)
self.assertIn('orderFetch("/sync"', js)
self.assertIn('document.addEventListener("visibilitychange"', js)
self.assertIn('window.addEventListener("focus"', js)
```

- [ ] **Step 2: Run RED**

Expected: FAIL.

- [ ] **Step 3: Implement lightweight polling only while useful**

Every 3 seconds, only when manager is open, document visible and auth exists, call `/sync`. Compare `ordersVersion` and `debtVersion`; call `refreshManager()` only if the relevant fingerprint changed. Also run once on focus and when visibility returns.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

---

### Task 5: Verify database state machine and release safely

**Files:**
- Test: existing sales/order tests plus new workflow test
- Modify build stamp files only through `tools/stamp_static_build.py`

**Interfaces:** None beyond the completed feature.

- [ ] **Step 1: Run SQL transaction proof with ROLLBACK**

Use an active Admin and User only inside `BEGIN ... ROLLBACK` to prove:
1. User create pending #A.
2. User create pending #B without deleting #A.
3. User updates #A and order number is preserved.
4. User cannot update/delete another User's pending.
5. User delete-all removes only their pending rows.
6. Admin quick sale creates delivered order + one debt event atomically.
7. Admin return creates one reversal only.
8. Final ROLLBACK leaves production counts unchanged.

- [ ] **Step 2: Run full repository verification**

Run the existing GitHub Actions verify workflow and all current order regression tests. Expected: all PASS.

- [ ] **Step 3: Review PR diff**

Confirm no Chat/Call/TAPHOAXYZ/crawler/news/supermarket files changed and no temporary helper/workflow files remain.

- [ ] **Step 4: Merge only the verified head**

Merge the exact tested SHA into `main`.

- [ ] **Step 5: Apply the new Supabase migration and deploy only `getlink-orders`**

Verify the deployed function source/version and re-run a read-only production sanity query.

- [ ] **Step 6: Verify main CI and Pages deployment**

Do not claim completion until the merge commit's verification and static deployment both succeed.