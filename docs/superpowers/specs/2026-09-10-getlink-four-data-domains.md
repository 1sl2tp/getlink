# GETLINK Four Data Domains — Architecture Addendum

## Goal

Keep the shared Supabase organized as four logical data domains while linking only the records that have a real business relationship.

## The four domains

1. **Chat** — account identity, sessions, messaging, media and calls. `public.v21_accounts` is the canonical account identity used by protected GETLINK features.
2. **Tạp hóa** — GETLINK's own sellable catalog, orders, order-line snapshots, receivables/debt ledger and later admin management. This domain is new and must not depend on TAPHOAXYZ runtime data.
3. **Siêu thị** — BHX / WinMart / GO source catalog, source identity, packaging, prices, history and comparison data. It remains a price/reference domain rather than the order system of record.
4. **Tin tức** — RSS/snapshot/cache/read UI. It has no business-data dependency on Chat, Tạp hóa or Siêu thị beyond sharing the same product shell/UI.

## Relationship rule

Do not merge data merely because it lives in the same Supabase project. Each domain owns its canonical records. Add a foreign key/reference only when the relationship is required by a concrete feature.

Approved relationships now:

- **Chat → Tạp hóa:** required. `v21_accounts.id` is used as customer/admin identity for sales, orders and debt.
- **Tạp hóa → Siêu thị:** optional/reference-only. Future product comparison may store an explicit mapping/reference, but supermarket rows never become the historical source of an order line's price.
- **Tin tức → other domains:** none required. News remains isolated.

## Tạp hóa ownership

Tạp hóa uses GETLINK-native namespaced tables for new business data:

- `getlink_supplier_products` — current sellable product/catalog source already present.
- `getlink_sales_orders` — new order header.
- `getlink_sales_order_items` — immutable order-line snapshots.
- `getlink_debt_ledger` — append-only receivables ledger.

It must not read or write legacy `accounts`, `products`, `orders`, `order_items`, `debts`, customer summaries, daily summaries, or any `taphoa_*` RPC in production runtime.

## Deletion-proof requirement

A future deletion of TAPHOAXYZ code and legacy TAPHOA business data must not break Chat, Tạp hóa, Siêu thị or Tin tức. The only shared identity dependency retained for protected GETLINK business actions is the Chat account identity in `v21_accounts`.
