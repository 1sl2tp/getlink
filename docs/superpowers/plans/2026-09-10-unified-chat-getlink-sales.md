# Unified Chat + GETLINK Sales Foundation Implementation Plan

> Execute with `superpowers:executing-plans`, TDD and verification-before-completion. Work only on feature branches until verified.

**Goal:** Make Chat's `v21_accounts` the shared account/customer identity and make GETLINK/Tạp hóa create canonical pending sales orders using TAPHOAXYZ business semantics.

**Architecture:** Chat owns the Supabase session and securely bridges a short-lived access token/account snapshot into the embedded GETLINK iframe. GETLINK validates every sales request server-side against `v21_accounts`, stores orders/items/debt in the same Supabase project, and keeps the existing Tạp hóa product picker as the sales UI.

**Reference business contract:** `1sl2tp/taphoaxyz/src/core/business.js`, `src/screens/sales.js`; copy behavior/data semantics, not old auth/storage.

---

## Task 1: Lock shared-account and sales security contract with RED tests

**GETLINK files**
- Create: `tests/test_unified_sales_auth_contract.py`
- Create: `tests/test_unified_sales_order_contract.py`
- Modify later: `app.js`
- Modify later: `supabase/functions/getlink-api/index.ts`
- Create later: `supabase/migrations/20260910143000_unified_sales_core.sql`

**Chat files**
- Create: `tests/test_v21_work_auth_bridge.py`
- Create later: `work-auth-bridge.js`
- Modify later: `index.source.html`

**RED assertions**
1. GETLINK edge CORS explicitly permits `authorization`.
2. Sales endpoints resolve caller from Bearer token to `v21_accounts`; no client role trust.
3. User orders force `customer_account_id` to caller account; admin requires explicit active user customer.
4. Deliver/reverse/delete are admin-only.
5. GETLINK Send Order calls `/api/sales/orders`; it is not localStorage-only.
6. Chat Work iframe auth bridge uses exact target origin `https://get.taphoa.xyz`, never `*`, passes access token/account, and listens to token refresh.
7. GETLINK iframe accepts the bridge only from trusted Chat origins.

**Verify RED**
- Open draft PRs so existing pull-request workflows run the tests, or use a temporary branch-only verification workflow if necessary.
- Confirm the new targeted tests fail for the expected missing implementation, not syntax/setup errors.

---

## Task 2: Add canonical sales schema

**File**
- Create: `supabase/migrations/20260910143000_unified_sales_core.sql`

**Schema**
- `getlink_sales_orders`
- `getlink_sales_order_items`
- `getlink_debt_ledger`

**Constraints/indexes**
- account FKs to `v21_accounts(id)`
- status checks
- qty > 0, unit_price >= 0, line_no > 0
- one sale ledger row per order, one reversal row per order
- indexes by customer/status/created_at
- updated_at trigger if a compatible helper exists; otherwise explicit API updates

**Security**
- Enable RLS and expose no broad client write policy. Sales writes go through authenticated edge routes.

**Schema verification**
- Apply migration with `Supabase.apply_migration` only after code review of SQL.
- Query information_schema/constraints to prove tables and checks exist.

---

## Task 3: Implement GETLINK Bearer account resolver and sales API

**File**
- Modify: `supabase/functions/getlink-api/index.ts`

**Implementation**
1. Add `authorization` to CORS allow-headers.
2. Add `salesAccount(req)`:
   - parse Bearer token
   - create user-scoped Supabase client or call auth user lookup with token
   - get authenticated user id
   - resolve active/unlocked `v21_accounts` row by `auth_user_id`
   - return only role `admin|user`
3. Route sales endpoints before legacy write gate, because browser sales POSTs authenticate with Bearer, not the GETLINK admin password.
4. `GET /api/sales/bootstrap` returns account, permissions, and customers according to role.
5. `GET /api/sales/orders` applies server-side role scoping.
6. `POST /api/sales/orders` validates item array, snapshots values, calculates total, inserts order/items atomically enough for failure cleanup.
7. `POST /api/sales/orders/:id/deliver` admin-only pending -> delivered and inserts sale debt ledger row.
8. `POST /api/sales/orders/:id/reverse` admin-only delivered -> reversed and inserts negative reversal debt row.
9. `DELETE /api/sales/orders/:id` admin-only pending; delete/cancel per locked semantics.

**Targeted GREEN tests**
- Run new sales auth/order tests.
- Run Deno check.

---

## Task 4: Implement Chat -> GETLINK session bridge

**Chat files**
- Create: `work-auth-bridge.js`
- Modify: `index.source.html`
- Regenerate: `index.html`, build/version metadata using repo build tooling

**Bridge behavior**
1. On iframe `load`, obtain `V21AuthSessionStore.snapshot()` and `client.auth.getSession()`.
2. Post `{type:'taphoa-auth-context', account, accessToken}` to exact `https://get.taphoa.xyz` target origin.
3. On `v21-auth-token-refreshed`, post refreshed access token.
4. On auth state/account changes, re-send current context; on signed out send empty context.
5. Never send refresh token.

**GETLINK receiver**
- Modify `app.js`:
  - allow origins only `https://chat.taphoa.xyz` and the known GitHub Pages chat origin if needed for preview.
  - store access token in memory only.
  - set shared account context from payload.
  - `apiFetch` adds `Authorization: Bearer ...` when token exists.

**Verify**
- New Chat auth bridge test GREEN.
- `python tools/verify_current.py` GREEN.

---

## Task 5: Wire Tạp hóa / Bán hàng Send Order

**GETLINK files**
- Modify: `app.js`
- Modify: `index.html` only through static stamping/build workflow as required
- Modify: `style.css` only if small customer/account UI styling is required

**Behavior**
1. Load `/api/sales/bootstrap` after trusted account context arrives.
2. User mode:
   - show current customer identity in compact sales status
   - no customer selector
   - Send Order posts current selected Tạp hóa items as `pending`
3. Admin mode:
   - expose compact customer selector populated with active user accounts
   - disable Send Order until customer selected
4. Product line snapshot uses GETLINK own product URL/code/name and sale price currently displayed.
5. Clear quantities only after successful API response.
6. Status text becomes `Đã tạo đơn tạm` plus compact order identifier.
7. Preserve existing instant Tạp hóa/Siêu thị/Tin tức scope switching and news DOM cache behavior.

**Targeted tests**
- user cannot choose customer
- admin requires selected customer
- request path/payload is canonical
- local quantity draft remains only before send; canonical order is server-backed

---

## Task 6: Deploy and verify production safely

1. Run full GETLINK verification:
   - `python tools/stamp_static_build.py --check`
   - `python -m unittest discover -s tests -v`
   - Python compile checks
   - `node --check app.js`
   - `deno check supabase/functions/getlink-api/index.ts`
2. Run full Chat verification:
   - targeted auth bridge test
   - `python tools/verify_current.py`
   - existing workflow suite
3. Apply production migration with `Supabase.apply_migration`.
4. Deploy updated GETLINK Edge function.
5. Smoke test with SQL/API evidence:
   - active user bootstrap returns self only
   - admin bootstrap returns user customers
   - user pending order stores self as customer
   - unauthorized/impersonated customer attempt is rejected/ignored
   - admin can deliver once; one sale ledger row exists
   - reverse once; one reversal row exists
6. Only after all evidence is GREEN, merge feature PRs to main and verify Pages/deploy runs.

## Rollback

- Frontend/Chat bridge: revert feature commits; no data loss.
- Edge: redeploy previous verified function version.
- Schema: tables are additive; do not drop production order/debt data during rollback. Disable new routes/UI instead.
