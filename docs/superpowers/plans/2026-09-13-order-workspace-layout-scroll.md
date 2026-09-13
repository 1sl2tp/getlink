# Order Workspace Layout & Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tạp hóa Bán/Đơn/Công nợ structurally stable: fixed workspace navigation, dense order index with unambiguous STT vs order code, invoice-style detail with fixed actions, native scroll ownership, editable order customer, and explicit line/product counts.

**Architecture:** Keep the existing order/data model and realtime refresh flow. Refactor the order rendering into a fixed filter/header shell plus a two-pane desktop work area (compact order index + invoice detail), with single-pane mobile/tablet drill-in. Add one admin-only RPC/API route to reassign the customer of a pending or delivered order; delivered reassignment moves its order debt ledger rows atomically so debt ownership stays consistent.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Supabase Edge Functions (Deno/TypeScript), PostgreSQL RPC migration, Python unittest static-contract tests, GitHub Actions.

**Spec:** User-uploaded `Tài liệu không có tiêu đề` (3 pages, 2026-09-13).

## Global Constraints

- The bottom `Bán / Đơn / Công nợ` switch must have a dedicated grid row and must not jump when content changes.
- The quick-order summary must distinguish line count from total product quantity.
- Truncated previews must say `+N dòng khác`, never an ambiguous bare `+N`.
- Order list cards must show a separate visible sequential `STT` and `Mã đơn #...`.
- Wide desktop must be dense enough to show about ten compact order rows without expanding cards in place.
- Order detail must read like one invoice: customer/meta, line items, line/product totals, grand total, then fixed actions.
- `Xóa tất cả` remains outside the scrolling data region.
- Native scrolling only: no smooth/snap/wheel interception; exactly one scroll owner per list/detail pane.
- Admin can change the customer on pending or delivered orders; delivered-order debt ledger rows must move to the same new customer atomically.
- Returned orders remain immutable.
- Do not change unrelated Chat/Call/Auth/catalog business logic.

---

### Task 1: Lock the feedback as failing contracts

**Files:**
- Create: `tests/test_order_workspace_layout_scroll_feedback.py`

**Interfaces:**
- Consumes: current `order-management.js`, `taphoa-workspace-feedback.css`, `supabase/functions/getlink-orders/index.ts`.
- Produces: contract tests for the new rendering markers, navigation row, customer reassignment API/RPC, explicit count copy, and scroll-owner CSS.

- [ ] **Step 1: Write failing tests** that assert markers/functions/classes do not yet exist: `TAPHOA_ORDER_WORKSPACE_V2_20260913`, `orderSelectionCounts`, `orderInvoiceMarkup`, `data-order-list-item`, `data-order-back`, `data-order-customer-change`, `getlink_sales_reassign_order_customer`, `/customer`, `grid-template-rows:auto minmax(0,1fr) 52px`, `scroll-behavior:auto`, and `+${...} dòng khác`.
- [ ] **Step 2: Run** `python -m unittest tests.test_order_workspace_layout_scroll_feedback -v` and require failure before implementation.
- [ ] **Step 3: Commit** the RED contract test.

### Task 2: Stabilize Bán summary and workspace navigation geometry

**Files:**
- Modify: `order-management.js`
- Modify: `taphoa-workspace-feedback.css`

**Interfaces:**
- Produces: `orderSelectionCounts(selected)` returning `{lines, products}` and a dedicated desktop nav row.

- [ ] **Step 1:** Add `orderSelectionCounts()` and update `renderSalesContext()` to show `Đã chọn N dòng · M sản phẩm`.
- [ ] **Step 2:** Change the preview overflow label to `+N dòng khác`.
- [ ] **Step 3:** Put desktop nav in grid row 3; keep source/category rail in row 2; let the right work region span rows 2/4.
- [ ] **Step 4:** Run the focused feedback test and `node --check order-management.js`.
- [ ] **Step 5:** Commit the stable bottom navigation/count change.

### Task 3: Replace expandable order cards with compact index + invoice detail

**Files:**
- Modify: `order-management.js`
- Modify: `taphoa-workspace-feedback.css`

**Interfaces:**
- Produces: `orderInvoiceMarkup(order,index)`; `orderIndexCardMarkup(order,index)`; desktop `.order-orders-main` split; mobile/tablet list/detail drill-in.

- [ ] **Step 1:** Add helpers for total product quantity and selected order index.
- [ ] **Step 2:** Render compact index rows showing `STT N`, `Mã đơn #X`, customer, time, `N dòng · M SP`, and total.
- [ ] **Step 3:** Render invoice detail with line STT, name/note, quantity × price, line total, final `N dòng · M sản phẩm`, and grand total.
- [ ] **Step 4:** Move `Sửa / Đã giao / Xóa` into `.order-invoice-actions` outside `.order-invoice-scroll` so actions stay fixed.
- [ ] **Step 5:** Add mobile/tablet `← Danh sách đơn` drill-back and remove the old `Xem đơn / Thu gọn` control.
- [ ] **Step 6:** Keep source reporting available but collapsed by default inside the index pane so it does not consume the initial viewport.
- [ ] **Step 7:** Run focused tests and JS syntax check.
- [ ] **Step 8:** Commit the invoice/index refactor.

### Task 4: Make order customer editable without corrupting debt ownership

**Files:**
- Create: `supabase/migrations/20260914001000_getlink_reassign_order_customer.sql`
- Modify: `supabase/functions/getlink-orders/index.ts`
- Modify: `order-management.js`

**Interfaces:**
- Produces DB RPC `public.getlink_sales_reassign_order_customer(p_id uuid,p_customer_id uuid,p_actor_id uuid)` and API `PUT /orders/:id/customer`.

- [ ] **Step 1:** Add the RPC. Validate admin actor and active customer, lock the order, reject returned orders, update `getlink_sales_orders.customer_account_id`, and for delivered orders update every `getlink_debt_ledger` row for that order to the same customer in the same transaction.
- [ ] **Step 2:** Restrict RPC execute to `service_role`.
- [ ] **Step 3:** Add Edge Function route `PUT /orders/:id/customer` accepting `{customerId}` and returning the refreshed order.
- [ ] **Step 4:** Reuse the customer picker in a targeted `reassign order` mode; the invoice `Đổi khách` action opens it, selection calls the new route, refreshes orders, and keeps the same order selected.
- [ ] **Step 5:** Run focused tests, `deno check supabase/functions/getlink-orders/index.ts`, and existing order tests.
- [ ] **Step 6:** Commit the customer-reassignment change.

### Task 5: Lock native scroll ownership and density

**Files:**
- Modify: `taphoa-workspace-feedback.css`

**Interfaces:**
- Desktop >=1000px: `.order-index-scroll` and `.order-invoice-scroll` are the only order data scroll owners.
- 640–999px/mobile: one visible pane at a time, each with native `overflow:auto`.

- [ ] **Step 1:** Make outer order manager/list shells `overflow:hidden` and `min-height:0`.
- [ ] **Step 2:** Set list/detail scroll owners to `overflow:auto; scroll-behavior:auto; overscroll-behavior:auto` and no scroll snap.
- [ ] **Step 3:** Use compact desktop index row geometry (~54–58px) so ten rows fit in a normal large-screen work area.
- [ ] **Step 4:** Keep report controls/tabs/tools/batch actions outside scroll owners.
- [ ] **Step 5:** Run focused tests.
- [ ] **Step 6:** Commit CSS geometry/scroll ownership.

### Task 6: Full verification, Supabase rollout, and merge

**Files:**
- Update static build stamp (`index.html`, `version.json`) using the repository's existing stamp workflow/process.

**Interfaces:**
- Production GitHub `main`, Supabase migration + `getlink-orders` Edge Function, GitHub Pages.

- [ ] **Step 1:** Run focused tests, full `python -m unittest discover -s tests -v`, JS syntax checks, Deno checks, and build-stamp check.
- [ ] **Step 2:** Open PR and require `Verify GETLINK` green.
- [ ] **Step 3:** Apply the new Supabase migration and verify RPC permissions/read-only schema checks.
- [ ] **Step 4:** Deploy the updated `getlink-orders` Edge Function and run smoke checks.
- [ ] **Step 5:** Review the PR diff for scope creep and destructive changes.
- [ ] **Step 6:** Merge only after green verification; then require production Verify, Supabase Smoke, and Pages deployment green.
