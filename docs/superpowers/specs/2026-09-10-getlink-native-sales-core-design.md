# GETLINK Native Sales Core — Design

## Goal

Build the GETLINK grocery-sales business core as a completely new data system that can survive removal of `taphoaxyz` without any runtime dependency on TAPHOA legacy tables, RPCs, summaries, sessions, or IDs.

GETLINK continues to reuse the business ideas that worked in TAPHOAXYZ (sell → draft order → delivered → returned → debt), but not its data model or runtime code path.

## Non-goals

- Do not migrate legacy TAPHOAXYZ orders, debts, products, customers, summaries, or sessions into the new core.
- Do not modify Chat login, Chat role management, or Chat business logic.
- Do not create a second customer/account registry inside GETLINK.
- Do not delete legacy tables in this project as part of this change.
- Do not make supermarket comparison data authoritative for historical order prices.

## Canonical identity

`public.v21_accounts` is the only account/customer identity source used by the new sales core.

Rules:

- `role='user'` means a customer for GETLINK sales.
- `role='admin'` means an administrator.
- User-created orders always use the authenticated user's own `v21_accounts.id`.
- Admin-created orders require explicit selection of one active `role='user'` account.
- GETLINK backend verifies the Chat/Supabase access token and reads `v21_accounts`; it never trusts a role or customer ID supplied only by browser state.
- GETLINK does not own password login, account creation, password reset, or Chat role changes.

## Canonical product source

The sellable Tạp hóa catalog is `public.getlink_supplier_products`.

For sales, the minimum authoritative fields are:

- `product_code` — stable product identifier
- `product_name` — current display name
- `display_price_vnd` — current selling price
- `canonical_url` — current product route/reference
- `is_active` / `stock_status` — availability gates

A historical order never recalculates from the current catalog. At order creation, item snapshots capture product code, name, unit price, quantity, and optional cost/source metadata needed for admin reporting.

## New data model

### `public.getlink_sales_orders`

Purpose: canonical header for all NEW GETLINK sales orders.

Fields:

- `id uuid primary key default gen_random_uuid()`
- `order_no bigint generated always as identity unique`
- `customer_account_id uuid not null references v21_accounts(id)`
- `created_by_account_id uuid not null references v21_accounts(id)`
- `created_by_role text not null check in ('user','admin')`
- `status text not null check in ('pending','delivered','returned')`
- `total_amount_vnd bigint not null check >= 0`
- `total_cost_vnd bigint not null default 0 check >= 0`
- `submitted_at timestamptz not null default now()`
- `delivered_at timestamptz null`
- `returned_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `version integer not null default 1 check >= 1`

The customer name is not a foreign identity source. UI resolves current account display name from `v21_accounts`; historical order ownership is the immutable `customer_account_id`.

### `public.getlink_sales_order_items`

Purpose: immutable commercial snapshot of each line at creation time.

Fields:

- `id bigint generated always as identity primary key`
- `order_id uuid not null references getlink_sales_orders(id) on delete cascade`
- `line_no integer not null`
- `product_code text not null`
- `product_name text not null`
- `product_url text not null default ''`
- `quantity numeric not null check > 0`
- `unit_price_vnd bigint not null check >= 0`
- `unit_cost_vnd bigint not null default 0 check >= 0`
- `source_key text not null default ''`
- `created_at timestamptz not null default now()`
- unique `(order_id, line_no)`

Order items are not updated when supplier names or prices change later.

### `public.getlink_debt_ledger`

Purpose: append-only receivables history for NEW GETLINK sales.

Fields:

- `id uuid primary key default gen_random_uuid()`
- `customer_account_id uuid not null references v21_accounts(id)`
- `order_id uuid null references getlink_sales_orders(id)`
- `event_type text not null check in ('order_debt','payment','order_return_reversal','manual_adjustment')`
- `amount_vnd bigint not null check > 0`
- `direction text not null check in ('increase','decrease')`
- `note text not null default ''`
- `occurred_at timestamptz not null default now()`
- `created_by_account_id uuid not null references v21_accounts(id)`
- `created_at timestamptz not null default now()`

For order events, enforce one `order_debt` and at most one `order_return_reversal` per order through partial unique indexes.

No mutable customer balance column is authoritative. Balance is the sum of ledger directions. A derived view/query may return the running balance and current balance.

## State transitions

### Create order

- User: customer is authenticated user.
- Admin: customer is selected active user.
- Backend resolves each submitted product by `product_code` or canonical URL in `getlink_supplier_products`.
- Browser supplies only product reference + quantity; backend reads current name/price/cost.
- Insert header + item snapshots atomically as `pending`.
- No debt entry is created yet.

### Deliver order

Admin only.

Atomic transaction:

1. Lock `getlink_sales_orders` row.
2. Require `status='pending'`.
3. Change status to `delivered`; set `delivered_at`.
4. Append `getlink_debt_ledger` `order_debt` with `direction='increase'` and order total.
5. Increment version.

Idempotency: a repeated delivery request must not create a second debt line.

### Return order

Admin only.

- A `pending` order may be cancelled by deleting the header; cascade removes items; no debt exists.
- A `delivered` order moves to `returned`, sets `returned_at`, and appends exactly one `order_return_reversal` with `direction='decrease'` for the original order total.
- A repeated return request must not create a second reversal.

### Payment

Admin only.

Append `event_type='payment'`, `direction='decrease'`, for the selected customer. It is independent from a specific order unless future UX explicitly links it.

## Debt reads

Admin:

- list all customer users with current debt balance
- open one customer timeline
- see each transaction, amount, source order (if any), timestamp, and `Dư nợ sau giao dịch`

User:

- only current user's balance and timeline

Running balance is computed in occurred order from the ledger; no legacy `customer_summary`, `customer_daily_summary`, `daily_summary`, or `debts` table participates.

## API boundary

Keep `getlink-orders` as the GETLINK protected Edge Function entrypoint, but replace its legacy persistence path.

Routes:

- `GET /me` — verified module identity
- `GET /customers` — admin only, active Chat users
- `GET /orders` — admin all / user own
- `POST /orders` — create pending order
- `POST /orders/:id/deliver` — admin only
- `POST /orders/:id/return` — admin only
- `DELETE /orders/:id` — admin only, pending only
- `GET /debts` — admin customer summary list / user own summary
- `GET /debts/:customerId` — admin selected customer; user only own ID
- `POST /debts/:customerId/payments` — admin only

The function may use service-role internally after independently verifying the Chat token and active `v21_accounts` record.

## UI

Existing GETLINK Bán hàng and Quản lý đơn screens remain the interaction surface.

Changes:

- Repoint Quản lý đơn to the native tables/API status names.
- Add Công nợ as a first-class protected view.
- Admin sees customer list + debt balance + drill-down timeline.
- User sees only their own debt view.
- Timeline displays plain numeric `Dư nợ sau giao dịch`.
- No TAPHOAXYZ labels, IDs, login, summaries, or storage concepts are exposed.

## Legacy isolation contract

After cutover, production GETLINK sales runtime must contain **zero reads/writes/calls** to these legacy business objects:

- `public.accounts`
- `public.sessions`
- `public.products`
- `public.orders`
- `public.order_items`
- `public.debts`
- `public.customer_summary`
- `public.customer_product_summary`
- `public.customer_daily_summary`
- `public.daily_summary`
- any `taphoa_*` business RPC
- `getlink_create_v21_order`
- `getlink_approve_v21_order`
- `getlink_cancel_v21_order`

Legacy tables may physically remain until a future cleanup project. Their presence is not a dependency.

## Cutover strategy

1. Add new native tables/indexes/functions without touching legacy data.
2. Add RED contract tests proving the Edge Function still references legacy objects.
3. Change `getlink-orders` to native persistence and debt operations.
4. Change frontend order/debt UI to native API semantics.
5. Run complete GETLINK verification and Deno checks.
6. Apply migration and deploy Edge Function.
7. Smoke-test auth boundaries without creating fake legacy data.
8. Create one deliberate NEW GETLINK test order in a controlled user/admin session if available; verify pending → delivered → debt → returned → reversal.
9. Only after verification, merge to `main` and deploy Pages.

No legacy data migration is required at any step.

## Security

- Chat token is verified server-side on every protected API request.
- Admin authorization is re-derived from `v21_accounts.role` server-side.
- User order/customer queries are always scoped to their own `v21_accounts.id`.
- Direct browser writes to native sales tables are not needed; tables should have RLS enabled and no permissive anon/authenticated write policies.
- RPCs used for atomic transitions are service-role only.

Separately, the existing `public.getlink_manual_group_exclusions` table currently has RLS disabled. This is not part of the sales-core cutover; remediate in a separate, tested policy change so existing grouping reads are not accidentally blocked.

## Success criteria

The change is complete when:

1. A Chat `user` can submit a GETLINK order and only see their own orders/debt.
2. A Chat `admin` can select a user, create an order, deliver it, return it, and record a payment.
3. Delivery creates exactly one debt increase; return creates exactly one matching decrease.
4. Historical order line prices remain unchanged after supplier price updates.
5. GETLINK sales runtime has zero references to TAPHOAXYZ legacy business tables/RPCs listed above.
6. No Chat repo change is required.
7. Removing TAPHOAXYZ code/data later cannot break GETLINK sales, orders, or debt.
