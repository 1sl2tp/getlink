# GETLINK Native Sales Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut GETLINK Tạp hóa sales, order management and debt off TAPHOAXYZ legacy data and run them entirely on new GETLINK-native tables using Chat `v21_accounts` as identity.

**Architecture:** Keep one Supabase project but four logical data domains: Chat, Tạp hóa, Siêu thị, Tin tức. This plan changes only the Tạp hóa domain and its protected GETLINK Edge/UI path. New namespaced tables store orders, immutable item snapshots and debt ledger; `getlink-orders` verifies Chat bearer identity, resolves current Tạp hóa product price server-side, and invokes service-role-only atomic RPCs. Legacy TAPHOA tables remain untouched but become unreachable from GETLINK sales runtime.

**Tech Stack:** PostgreSQL/Supabase migrations and RPCs, Supabase Edge Functions with Deno/TypeScript, Vanilla JavaScript/CSS, Python unittest contracts, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-getlink-native-sales-core-design.md` and `docs/superpowers/specs/2026-09-10-getlink-four-data-domains.md`

## Global Constraints

- Do not modify `1sl2tp/chat`.
- Do not migrate TAPHOAXYZ customers, products, orders, debts, summaries or sessions.
- Chat `public.v21_accounts` remains the only account/customer identity source.
- Tạp hóa sellable products come from `public.getlink_supplier_products`.
- New money values are stored in full VND; do not divide by 1000.
- New runtime must not reference legacy `accounts`, `products`, `orders`, `order_items`, `debts`, legacy summaries, `taphoa_*`, or the transitional `getlink_*_v21_order` RPCs.
- User is always their own customer; admin must explicitly choose an active Chat `role=user` customer.
- Debt is append-only. Deliver creates exactly one increase; return creates exactly one reversal; payment creates a decrease.
- Supermarket and News data are not modified by this plan.
- Do not delete legacy tables in this plan.

---

### Task 1: Lock the native isolation contract with RED tests

**Files:**
- Create: `tests/test_getlink_native_sales_core.py`
- Modify: `tests/test_order_management_contract.py`

**Interfaces:**
- Consumes: current `getlink-orders/index.ts`, `order-management.js`, migration directory.
- Produces: tests that require the new table/RPC names and reject every legacy business dependency from the protected sales runtime.

- [ ] **Step 1: Write failing tests** asserting `getlink_sales_orders`, `getlink_sales_order_items`, `getlink_debt_ledger`, `getlink_sales_create_order`, `getlink_sales_deliver_order`, `getlink_sales_return_order`, and `getlink_sales_record_payment` exist in the new migration/backend contract.
- [ ] **Step 2: Add isolation assertions** rejecting `.from("orders")`, `.from("order_items")`, `.from("debts")`, `.from("products")`, `taphoa_`, `getlink_create_v21_order`, `getlink_approve_v21_order`, and `getlink_cancel_v21_order` from `supabase/functions/getlink-orders/index.ts`.
- [ ] **Step 3: Add frontend assertions** requiring status `delivered`, endpoint `/deliver`, debt routes, and VND rendering without multiplying by 1000.
- [ ] **Step 4: Run targeted unittest and confirm RED** against current branch.
- [ ] **Step 5: Commit RED tests.**

### Task 2: Add the GETLINK-native sales schema and atomic RPCs

**Files:**
- Create: `supabase/migrations/20260910113000_getlink_native_sales_core.sql`
- Test: `tests/test_getlink_native_sales_core.py`

**Interfaces:**
- Produces tables: `getlink_sales_orders`, `getlink_sales_order_items`, `getlink_debt_ledger`.
- Produces RPCs: `getlink_sales_create_order(jsonb,jsonb)`, `getlink_sales_deliver_order(uuid,uuid)`, `getlink_sales_return_order(uuid,uuid)`, `getlink_sales_record_payment(uuid,bigint,uuid,text)`.

- [ ] **Step 1: Create namespaced tables** with FKs to `v21_accounts`, immutable line snapshots, status check `pending|delivered|returned`, timestamps/version, and VND bigint amounts.
- [ ] **Step 2: Add debt indexes** including partial unique indexes for one `order_debt` and one `order_return_reversal` per order.
- [ ] **Step 3: Enable RLS** on all three tables with no direct anon/authenticated write policies.
- [ ] **Step 4: Implement create RPC** that validates active customer/creator accounts, inserts order + item snapshots atomically, and leaves debt untouched.
- [ ] **Step 5: Implement deliver RPC** with row lock, pending-only transition, exactly-one order debt increase and idempotent repeat behavior.
- [ ] **Step 6: Implement return RPC**: delete pending orders without debt; delivered orders become returned and get exactly-one reversal decrease.
- [ ] **Step 7: Implement payment RPC** validating active customer/admin actor and appending a decrease ledger event.
- [ ] **Step 8: Revoke RPC execution from public/anon/authenticated and grant only service_role.**
- [ ] **Step 9: Run contract tests GREEN and commit schema.**

### Task 3: Rewire `getlink-orders` to native persistence

**Files:**
- Modify: `supabase/functions/getlink-orders/index.ts`
- Test: `tests/test_getlink_native_sales_core.py`

**Interfaces:**
- Keeps: Chat bearer verification through `db.auth.getUser` + `v21_accounts`.
- Produces routes: `GET /me`, `GET /customers`, `GET|POST /orders`, `POST /orders/:id/deliver`, `POST /orders/:id/return`, `DELETE /orders/:id`, `GET /debts`, `GET /debts/:customerId`, `POST /debts/:customerId/payments`.

- [ ] **Step 1: Change product resolution** to use `getlink_supplier_products.product_code`, canonical URL, full-VND `display_price_vnd` and `input_price_vnd`; browser continues sending only locator + quantity.
- [ ] **Step 2: Change create path** to call `getlink_sales_create_order`; no legacy product map or `/1000` conversion remains.
- [ ] **Step 3: Change list path** to `getlink_sales_orders` + `getlink_sales_order_items`; user filters by `customer_account_id=actor.id`; admin sees all.
- [ ] **Step 4: Change admin transitions** to `/deliver` and native RPCs; pending delete uses the native return/cancel RPC behavior.
- [ ] **Step 5: Add debt reads**: admin summary across active users; user own summary; timeline sorted chronologically with computed `balanceAfterVnd`.
- [ ] **Step 6: Add payment route** admin-only, positive integer VND, selected active user.
- [ ] **Step 7: Run targeted tests plus `deno check supabase/functions/getlink-orders/index.ts`; commit.**

### Task 4: Repoint Order UI and add Công nợ UI

**Files:**
- Modify: `order-management.js`
- Modify: `order-management.css`
- Test: `tests/test_getlink_native_sales_core.py`

**Interfaces:**
- Consumes native order/debt API from Task 3.
- Produces protected views: `Đơn tạm`, `Đã giao`, `Đã hoàn`, `Công nợ`.

- [ ] **Step 1: Change status model** from `done` to `delivered` and admin action from `/approve` to `/deliver` while preserving Vietnamese labels.
- [ ] **Step 2: Change money rendering** to full VND snapshots with no `*1000` conversion.
- [ ] **Step 3: Add `Công nợ` entry/view** inside the same protected manager shell; do not modify the locked search/catalog shell.
- [ ] **Step 4: Admin debt view** lists Chat users with current balance, supports drill-down timeline, and offers payment entry.
- [ ] **Step 5: User debt view** shows only own current balance and timeline; no customer picker.
- [ ] **Step 6: Render timeline** with transaction type, amount, related order number when present, timestamp, and plain numeric `Dư nợ sau giao dịch`.
- [ ] **Step 7: Run targeted tests and `node --check order-management.js`; commit.**

### Task 5: Verify, cut over Supabase, and integrate

**Files:**
- Modify build-stamp outputs only if required by `tools/stamp_static_build.py`.

**Interfaces:**
- Consumes GREEN Tasks 1–4.
- Produces production GETLINK native sales core with no TAPHOAXYZ runtime dependency.

- [ ] **Step 1: Run build stamp/check and full `python -m unittest discover -s tests -v`.**
- [ ] **Step 2: Run `node --check` and both existing Deno checks.**
- [ ] **Step 3: Search protected sales runtime for every banned legacy dependency and require zero matches.**
- [ ] **Step 4: Apply `20260910113000_getlink_native_sales_core.sql` to Supabase production; do not modify/delete legacy rows.**
- [ ] **Step 5: Deploy `getlink-orders` with its existing custom-auth mode and smoke-test unauthorized/user/admin boundaries without creating legacy data.**
- [ ] **Step 6: Run Supabase security/performance advisors; report unrelated findings separately rather than changing them silently.**
- [ ] **Step 7: Open PR, wait for `Verify GETLINK` GREEN, then merge only after verification.**
- [ ] **Step 8: Verify `main` CI and Pages deployment after merge.**

## Self-review

- Spec coverage: identity, product authority, new orders/items/debt, role scopes, state transitions, debt timeline, payment, four-domain isolation and TAPHOAXYZ deletion-proofing are covered.
- Placeholder scan: no TBD/TODO or unspecified implementation step remains.
- Type consistency: all native order IDs are UUID; money is full VND bigint; customer/actor IDs are `v21_accounts.id`; order status is consistently `pending|delivered|returned`.
