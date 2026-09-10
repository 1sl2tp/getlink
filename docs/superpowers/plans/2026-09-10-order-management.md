# GETLINK Order Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nối nút Gửi đơn của Tạp hóa GETLINK vào lõi SHOP88 hiện có và bổ sung Quản lý đơn với ba trạng thái Đơn tạm → Đã giao → Đã hoàn.

**Architecture:** Không tạo bảng đơn/công nợ mới. Một Edge Function riêng `getlink-orders` xác thực phiên khách hàng SHOP88 hoặc phiên Admin GETLINK, đọc giá Tạp hóa trực tiếp từ Supabase, rồi gọi các RPC `taphoa_create_order_with_debt`, `taphoa_approve_order_with_debt`, `taphoa_cancel_order`. Frontend bổ sung module độc lập `order-management.js/css`, giữ nguyên `app.js` và layout tìm kiếm hiện tại; duyệt hàng không bắt đăng nhập, chỉ yêu cầu đăng nhập khi Gửi đơn hoặc mở đơn của khách.

**Tech Stack:** Vanilla JS/CSS, Supabase Edge Functions (Deno/TypeScript), PostgreSQL RPC hiện có, pytest contract tests, GitHub Actions.

**Spec:** Yêu cầu đã chốt trong cuộc trao đổi hiện tại: Tạp hóa gửi đơn; Quản lý đơn gồm Đơn tạm/Đã giao/Đã hoàn; Admin quản lý toàn bộ, User chỉ thấy đơn của mình; công nợ chỉ phát sinh khi giao và phải đảo khi hoàn.

## Global Constraints

- Không tạo bảng `orders`, `order_items`, `debts` mới; dùng bảng và RPC SHOP88 hiện có.
- Không thay đổi UI tìm kiếm Tạp hóa/Siêu thị/Tin tức đang LOCK.
- Không tin giá, tên khách hoặc trạng thái do browser gửi lên; backend tự đọc giá và danh tính.
- User chỉ đọc/tạo đơn của chính tài khoản customer đang đăng nhập.
- Admin GETLINK mới được duyệt giao, hoàn đơn, xóa đơn tạm.
- `pending` = Đơn tạm, `done` = Đã giao, `returned` = Đã hoàn.
- Duyệt `pending → done` phải dùng `taphoa_approve_order_with_debt`; hoàn `done → returned` phải dùng `taphoa_cancel_order(..., true, ...)`.
- Giá GETLINK lưu theo VND; lõi SHOP88 hiện dùng đơn vị nghìn đồng, nên snapshot order item phải chuyển VND / 1000 trước khi gọi RPC.
- Không xóa hay thay đổi logic Tin tức, nguồn giá, đồng bộ XLS trong phạm vi này.

---

### Task 1: Order backend contract

**Files:**
- Create: `tests/test_order_management_contract.py`
- Create: `supabase/functions/getlink-orders/index.ts`

**Interfaces:**
- Consumes: `sessions`, `accounts`, `getlink_update_settings`, `getlink_supplier_products`, `products`, `orders`, `order_items`, `debts`.
- Produces: `GET /orders`, `POST /orders`, `POST /orders/:id/approve`, `POST /orders/:id/return`, `DELETE /orders/:id`.

- [ ] **Step 1: Write failing contract tests**

Tests assert: customer identity comes only from hashed session token; admin identity comes only from `x-getlink-admin`; create uses server-side `display_price_vnd` and `input_price_vnd`; create calls `taphoa_create_order_with_debt` with `pending`; approve calls `taphoa_approve_order_with_debt`; return calls `taphoa_cancel_order` with `p_reverse_debt:true`; customer list scopes by `customer_id`; admin list includes `pending|done|returned`.

- [ ] **Step 2: Run contract test and verify RED**

Run: `pytest -q tests/test_order_management_contract.py`
Expected: FAIL because `supabase/functions/getlink-orders/index.ts` does not exist.

- [ ] **Step 3: Implement the minimal Edge Function**

Implement publishable-key gate, SHA-256 session lookup, admin-session hash/expiry validation, server-side item resolution, unique exact-name mapping to SHOP product ids when safe, order serialization, and the five routes above. Use service role only inside Edge Function.

- [ ] **Step 4: Run contract test and verify GREEN**

Run: `pytest -q tests/test_order_management_contract.py`
Expected: PASS.

- [ ] **Step 5: Commit backend + tests**

Commit message: `feat: add secure GETLINK order backend`.

### Task 2: Frontend send-order and manager

**Files:**
- Create: `order-management.js`
- Create: `order-management.css`
- Modify: `config.js`
- Test: `tests/test_order_management_contract.py`

**Interfaces:**
- Consumes: existing global `userWorkSelectedItems()`, DOM ids `userWorkSendOrder`, `mobileUserSendOrder`, `userWorkOrderStatus`, `mobileUserOrderStatus`, body `data-app-role`, Admin session key `getlink:update-admin-session`.
- Produces: customer login-on-demand, send pending order, own/all order manager overlay, status tabs, admin transition actions.

- [ ] **Step 1: Extend failing tests for frontend wiring**

Tests assert config loads the order module; module intercepts both existing Gửi đơn buttons in capture phase; sends only `{url, qty}`; never sends client price/name/customer id; stores only the SHOP session token/profile; exposes Đơn tạm/Đã giao/Đã hoàn tabs; Admin controls exist only for valid transitions.

- [ ] **Step 2: Run and verify RED**

Run: `pytest -q tests/test_order_management_contract.py`
Expected: FAIL on missing frontend module/wiring.

- [ ] **Step 3: Implement module and styles**

Inject an `Đơn hàng` entry near the existing role controls/order actions plus one responsive overlay. User may browse without login; first Gửi đơn/Đơn hàng opens customer login. Successful send creates `pending`, clears selected quantities only after backend success, refreshes order list, and shows compact status. Admin uses existing GETLINK Admin session and sees all customers/orders. Confirmation is required for delete/return; delivery is a non-destructive state action.

- [ ] **Step 4: Run and verify GREEN**

Run: `pytest -q tests/test_order_management_contract.py tests/test_mobile_user_work_v46.py tests/test_v44_order_geometry.py tests/test_v44_search_and_order_regressions.py`
Expected: PASS.

- [ ] **Step 5: Commit frontend**

Commit message: `feat: add GETLINK order manager UI`.

### Task 3: Full verification and deploy candidate

**Files:**
- No production source changes unless verification exposes a regression.

**Interfaces:**
- Consumes: branch commits from Tasks 1-2.
- Produces: verified PR/branch and deployable `getlink-orders` Edge Function.

- [ ] **Step 1: Run full repository verification**

Run: the existing `Verify GETLINK` GitHub Actions workflow on the feature branch/PR.
Expected: all jobs PASS.

- [ ] **Step 2: Verify database invariants without contaminating production data**

Use read-only checks to confirm RPC definitions and status/debt semantics. Do not create a real customer order as a smoke test unless a dedicated test account is available.

- [ ] **Step 3: Deploy `getlink-orders` with `verify_jwt=false`**

The function still enforces its own publishable-key + customer/admin authorization; deployment must not modify `taphoa-api` or existing GETLINK function.

- [ ] **Step 4: Smoke-test auth boundaries**

Verify unauthenticated order list/create are rejected; expired/invalid customer session is rejected; invalid Admin token is rejected. Use read-only list only with an authorized session if a safe session is available.

- [ ] **Step 5: Re-run verification after any fix and report exact commit/run ids**

No success claim before fresh GREEN evidence.
