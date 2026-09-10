# TAPHOA Order/Debt Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining TAPHOA-proven order reporting, delivered-order editing/reversal, and debt-to-order drill-down in GETLINK without creating a second sales core.

**Architecture:** Extend the existing `order-management.js` manager and `getlink-orders` Edge Function. Reporting and source grouping stay client-side over the already-scoped order payload; only lifecycle mutations that must be atomic go through new service-role RPCs. The three existing sales/debt tables remain the single source of truth.

**Tech Stack:** Vanilla JS/CSS, Deno Edge Function, Supabase PostgreSQL RPCs, Python unittest contract tests.

**Spec:** `docs/superpowers/specs/2026-09-11-taphoa-order-debt-parity.md`

## Global Constraints

- Do not modify Chat/Call or Chat session policy.
- Do not add another GETLINK login or another cart owner.
- Do not add new sales/debt tables.
- Pending delete is physical deletion; Delivered delete is Return/reversal, never physical deletion.
- Delivered edit must keep the same order id/order number and reconcile its `order_debt` ledger amount atomically.
- User remains scoped to own order/debt data; Admin-only lifecycle actions remain Admin-only.
- Existing 44px operational touch target/UI polish stays intact.

---

### Task 1: Lock parity contracts

**Files:**
- Create: `tests/test_taphoa_full_order_debt_parity.py`
- Modify: none

**Interfaces:**
- Consumes existing `order-management.js`, `getlink-orders/index.ts` and sales migrations.
- Produces failing contracts for the remaining parity features.

- [ ] **Step 1: Write the failing test** asserting date/range order filtering, source summary/detail/combined-share controls, Delivered edit + batch return RPC/route, and debt ledger order drill-down with lifecycle actions.
- [ ] **Step 2: Run `python -m unittest tests.test_taphoa_full_order_debt_parity -v`** and verify the new assertions fail for missing functionality while existing tests remain green.
- [ ] **Step 3: Commit the RED contract** without production-code changes.

### Task 2: Add atomic Delivered edit and batch return

**Files:**
- Create: `supabase/migrations/20260911010000_getlink_delivered_edit_batch_return.sql`
- Modify: `supabase/functions/getlink-orders/index.ts`
- Test: `tests/test_taphoa_full_order_debt_parity.py`

**Interfaces:**
- Consumes existing order/item/debt tables and `getlink_sales_return_order` semantics.
- Produces `getlink_sales_update_delivered_order(uuid,uuid,jsonb)` and `getlink_sales_return_delivered_scope(uuid,jsonb)` service-role RPCs plus Edge routes.

- [ ] **Step 1: Implement `getlink_sales_update_delivered_order`**: validate active Admin; lock Delivered order; validate items; replace order items; update totals/version; update the single `order_debt` ledger row to the new total, or delete it when total becomes zero; keep id/order_no/status/delivered_at unchanged.
- [ ] **Step 2: Implement `getlink_sales_return_delivered_scope`**: validate active Admin; accept an explicit JSON array of delivered order ids from the currently filtered UI scope; lock them; insert one `order_return_reversal` per order using the current order total; set status Returned and timestamps/version; return count. The function must be one transaction.
- [ ] **Step 3: Revoke Public/anon/authenticated execute and grant only `service_role`.**
- [ ] **Step 4: Extend Edge API** so `PUT /orders/:id` dispatches Pending vs Delivered update to the correct RPC, `GET /orders/:id` returns scoped detail, and `POST /orders/return-batch` accepts explicit ids and is Admin-only.
- [ ] **Step 5: Run the parity test plus all existing native-sales/auth tests.**
- [ ] **Step 6: Commit GREEN backend changes.**

### Task 3: Add order report/source workflow inside existing manager

**Files:**
- Modify: `order-management.js`
- Modify: `order-management.css`
- Test: `tests/test_taphoa_full_order_debt_parity.py`

**Interfaces:**
- Consumes `orders` already loaded by the existing manager.
- Produces local `orderReportFilter`, filtered order list, source summaries, source detail/combined drill-down and share/copy fallback.

- [ ] **Step 1: Add manager-local report state** for Today/custom range, quick ranges Yesterday/Week/Month/Year, search text and source drill-down state.
- [ ] **Step 2: Add pure helpers** to filter by order timestamp/search and summarize by `sourceId`: qty, cost, revenue, profit, order count.
- [ ] **Step 3: Render compact report controls and source summary above the lifecycle list** without adding a second manager/screen owner.
- [ ] **Step 4: Add source detail** showing order/customer/product/qty rows and a Combined view grouping same product name/code with summed quantity.
- [ ] **Step 5: Add share action** using `navigator.share({text})` where available, falling back to `navigator.clipboard.writeText`; no new dependency.
- [ ] **Step 6: Delivered tab shows `Sửa` for Admin and `Xóa` meaning Return. The batch button on Delivered returns only the currently filtered Delivered order ids after confirmation.**
- [ ] **Step 7: Keep Pending `Xóa tất cả` semantics scoped to Pending and existing User/Admin permission rules.**
- [ ] **Step 8: Run focused test and full Python suite.**
- [ ] **Step 9: Commit GREEN frontend changes.**

### Task 4: Debt → order detail → allowed action parity

**Files:**
- Modify: `order-management.js`
- Modify: `order-management.css`
- Test: `tests/test_taphoa_full_order_debt_parity.py`

**Interfaces:**
- Consumes timeline `orderId/orderNo` and `GET /orders/:id`.
- Produces debt-linked order detail rendered inside the existing manager, with the same action policy as Orders.

- [ ] **Step 1: Make linked debt timeline rows actionable** and fetch the scoped order detail on click.
- [ ] **Step 2: Render debt-linked order detail** with `#orderNo`, customer/date, lines, totals, and a Back control to customer debt timeline.
- [ ] **Step 3: Reuse the existing order actions**: Pending User/Admin may edit/delete own/scoped pending; Admin may deliver. Delivered Admin may edit/return. Returned is read-only.
- [ ] **Step 4: After mutation, refresh both Orders and Debt via the existing `/sync`/manager refresh path.**
- [ ] **Step 5: Run focused and full tests.**
- [ ] **Step 6: Commit GREEN debt drill-down changes.**

### Task 5: Build stamp, full verification, production gates, merge

**Files:**
- Modify: `index.html`
- Modify: `version.json`
- Update tests/docs only if contractually required; no temporary helper/workflow remains.

**Interfaces:**
- Consumes all prior tasks.
- Produces one verified PR and exact-SHA deployment evidence.

- [ ] **Step 1: Update static build stamp for changed frontend assets.**
- [ ] **Step 2: Run full Verify: Python unittest discovery, JS syntax checks, Deno checks, source contracts, Supabase-only gate.**
- [ ] **Step 3: Inspect final PR diff and remove all temporary files.**
- [ ] **Step 4: Apply the new migration to production only after exact branch SHA is green; verify function grants are service-role only and capture order/item/debt counts before and after.**
- [ ] **Step 5: Deploy `getlink-orders` exact verified source.**
- [ ] **Step 6: Merge only the exact verified PR head into `main`.**
- [ ] **Step 7: Verify `main` and Pages on the merge commit; do not claim manual browser E2E unless actually performed.**
