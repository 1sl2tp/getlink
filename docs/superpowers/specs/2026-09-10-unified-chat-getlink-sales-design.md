# Unified Chat + GETLINK Sales Design

Date: 2026-09-10
Status: APPROVED BY USER
Scope: Phase 1 foundation

## Product model

The long-term product has two codebases only:

- `1sl2tp/chat`: account identity, login/session, 1:1 communication, calls/media and notifications.
- `1sl2tp/getlink`: grocery sales (`Tạp hóa = Bán hàng`), supermarket comparison, products, pending/delivered/reversed orders, debt and admin management.

`1sl2tp/taphoaxyz` is a business-behavior reference only and will eventually be retired. Its old account store must not be copied into GETLINK.

## Canonical identity

`public.v21_accounts` in the shared Supabase project is the only account/customer identity source.

There are exactly two account roles:

- `admin`: operator. An admin must explicitly choose a customer before creating a sales order.
- `user`: customer. A logged-in user is the customer; the client must not be able to choose or impersonate another customer.

Server authorization always resolves the Supabase Bearer token to `auth.users.id`, then to `v21_accounts.auth_user_id`. Client-supplied role or creator identity is never trusted.

## Embedded authentication

Chat already owns the authenticated session and embeds GETLINK in the Work iframe. Chat sends a short auth context to the exact GETLINK origin using `postMessage`:

- account id / username / display name / role
- current Supabase access token

No refresh token is sent. Chat re-sends the current access token when the iframe loads and when Supabase refreshes the token. GETLINK accepts messages only from the trusted Chat origin and uses the access token only as a Bearer header to its API.

Standalone GETLINK keeps its existing legacy admin controls during Phase 1 so update/settings workflows are not broken. Unified account behavior activates when a trusted Chat auth context is present.

## Sales source of truth

A sales order stored in Supabase is canonical. LocalStorage is only UI draft state and must not be treated as an order database.

A pending order is created first. Chat notification is secondary and may be added after the canonical order exists; a missing notification must never lose the order.

The business lifecycle follows TAPHOAXYZ semantics:

`Bán -> Đơn tạm -> Đã giao -> (Công nợ) -> Hoàn`

Core operations mirror the existing TAPHOAXYZ contract: save pending order, deliver order, reverse delivered order, delete pending order, read order detail and read debt ledger.

## Sales data model

### `getlink_sales_orders`

- `id uuid`
- `customer_account_id uuid -> v21_accounts.id`
- `created_by_account_id uuid -> v21_accounts.id`
- `status`: `pending | delivered | reversed | cancelled`
- `note`
- `total_vnd`
- `delivered_at`, `reversed_at`, timestamps
- immutable customer/creator identity after creation

### `getlink_sales_order_items`

Order-line snapshots so later product-price changes do not mutate history:

- `order_id`
- `product_url`
- `product_code`
- `product_name_snapshot`
- `qty`
- `unit_price_vnd`
- `line_no`
- `note`

### `getlink_debt_ledger`

Append-only business ledger:

- customer
- optional order
- `kind`: `sale | reversal | collection | payment`
- signed `amount_vnd`
- note / creator / timestamp

Delivering an order writes one `sale` ledger row. Reversing a delivered order writes one matching negative `reversal` row. Both transitions are idempotent by status and unique order/kind constraints.

## API contract

GETLINK edge accepts `Authorization: Bearer <Supabase access token>` for sales routes.

- `GET /api/sales/bootstrap`
  - returns current account and permissions
  - admin gets active user customers
  - user gets self only
- `GET /api/sales/orders?status=pending|delivered|reversed`
  - admin sees all
  - user sees own customer orders only
- `POST /api/sales/orders`
  - user customer is forcibly self
  - admin must provide an active user customer id
  - server recalculates total from validated item snapshots
- `POST /api/sales/orders/:id/deliver`
  - admin only
  - pending -> delivered + sale debt row
- `POST /api/sales/orders/:id/reverse`
  - admin only
  - delivered -> reversed + negative debt row
- `DELETE /api/sales/orders/:id`
  - admin only, pending only

## GETLINK sales UI Phase 1

The existing Tạp hóa cards remain the product picker. The Send Order action changes from a localStorage-only draft to a canonical pending order API call.

- user: no customer picker; identity line shows the current account and Send Order creates their pending order.
- admin: Send Order is disabled until a customer is selected; customer picker is populated from `/api/sales/bootstrap`.
- quantities clear only after the server confirms the pending order.
- Tạp hóa product data continues to come from GETLINK supplier/canonical catalog.

## Security invariants

1. User cannot submit another customer id.
2. Admin cannot create an order for another admin/deleted/locked account.
3. Only admin can deliver/reverse/delete pending.
4. Debt changes only through server-side order transitions or later explicit debt transactions.
5. Service-role key never reaches the browser.
6. Chat iframe bridge never uses `targetOrigin='*'`.
7. GETLINK iframe ignores auth messages from untrusted origins.

## Out of Phase 1

- Full replacement of all TAPHOAXYZ screens.
- Final debt management UI.
- Automatic order-card Chat notification formatting.
- Removing legacy GETLINK admin password/settings flows.
- Deleting TAPHOAXYZ.
