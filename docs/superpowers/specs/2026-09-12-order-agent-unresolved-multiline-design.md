# Order Agent — Multiline + Unresolved-Line Design

## Goal

Turn a natural customer chat message containing one or many grocery lines into one live order draft without forcing the customer to use catalog names. Preserve unknown items instead of dropping them or guessing a product code. The store owner resolves unknown lines later; that correction becomes customer-specific memory.

This design is an addendum to `2026-09-12-ai-sales-order-agent-design.md` and supersedes the old assumptions that one chat message produces one intent and that every draft line must already have a `product_code`.

## Confirmed behavior from the `test` message

Example input:

```text
2 bịch hướng dương
2 bát 1.8kg, 2 bát 1kg, 2 bát 454
2 omo 1.15kg, 2 omo 5.5kg, 2 omo 5.1kg, 2 omo 2.9kg, 2 omo 2.6kg, 2 omo 700g, 1 omo 380g
2 cái lân 1l, 2 cái lân 5l
2 meizan 1l, 2 meizan 5l
5 gạo 2l, 5 nep 2l
```

The current single-intent parser is invalid for this shape. The turn must yield multiple line actions.

Known catalog evidence at the time of design:

- Omo sizes 1.15kg, 5.5kg, 5.1kg, 2.9kg, 2.6kg, 700g and 380g exist as active Tạp hóa products.
- `Cái Lân 1/5` corresponds to catalog family `Dau lan 1/5`.
- `Meizan 1/5` corresponds to catalog family `Dau zan 1/5`.
- `gạo 2L` in the active oil sequence has a strong candidate `Dau sim gao 2`.
- `nếp 2L` has `Dau nep 2`.
- `bát` is customer vocabulary for mì chính/bột ngọt in this ordering context; sizes must still be matched safely to catalog rows.
- `hướng dương` currently has no confident catalog product and must be preserved unresolved.

## Turn parsing contract

One customer message becomes a `TurnParseResult` containing an ordered list of actions, not one intent:

```ts
type TurnParseResult = {
  actions: Array<{
    intent: 'add_item'|'change_qty'|'remove_item'|'price_query'|'confirm'|'decline';
    raw_text: string;
    raw_product_text: string;
    quantity: number | null;
    unit_hint: string | null;
    attributes: Record<string, string | null>;
    context_family: string | null;
  }>;
}
```

The deterministic segmenter runs first. It splits clear list structures at newlines, bullets and comma-separated fragments where a new quantity/product phrase begins. The Groq parser receives only fragments that deterministic parsing cannot structure confidently. Groq returns structured actions only; it never assigns authoritative product IDs or prices.

Order of actions is preserved because context may flow from one item to the next.

## Context resolution

Resolution priority is:

1. current turn/session context;
2. confirmed alias/history for this customer;
3. canonical catalog name/code and exact size/unit attributes;
4. same-family catalog candidates;
5. cross-customer/store knowledge as suggestion only;
6. unresolved line.

Current context always outranks historical habit. Cross-customer knowledge must never become a confirmed mapping automatically.

Examples for this customer/order style:

- `Omo` establishes hóa mỹ phẩm / detergent context.
- `Cái Lân`, `Meizan`, `gạo`, `nếp` occurring as a contiguous sequence with `1L/2L/5L` establish dầu ăn context.
- In that oil context, `gạo 2L` may rank `Dau sim gao 2` above unrelated products containing `gạo`.
- `zan 1` may resolve through this customer's confirmed Meizan vocabulary only after owner confirmation.
- `bát 1.8kg` is understood as mì chính family, but a size/name mismatch must not be silently converted to a catalog code unless the mapping is already confirmed for this customer.

## Resolved draft lines

`getlink_ai_order_draft_lines` remains the table for catalog-resolved lines. A resolved line must have a real active Tạp hóa `product_code`. Price remains authoritative from `getlink_supplier_products`; Groq never supplies price.

Resolved lines may exist even when the current product price is missing/zero if the native sales rules allow that product to remain orderable. Price state must be flagged in reporting rather than replaced with a guessed value.

## Unresolved draft lines

Add a separate service-only table `getlink_ai_unresolved_draft_lines` rather than weakening the foreign-key contract of resolved draft lines.

Required fields:

- `id uuid primary key`
- `session_id uuid not null`
- `line_key text not null`
- `source_message_id uuid null`
- `raw_text text not null`
- `raw_product_text text not null`
- `quantity numeric null`
- `unit_hint text null`
- `context_family text null`
- `candidate_product_codes jsonb not null default '[]'`
- `reason text not null` (`not_in_catalog`, `ambiguous`, `size_mismatch`, `needs_owner_confirmation`, `other`)
- `status text not null` (`pending`, `resolved`, `dismissed`)
- `resolved_product_code text null`
- `created_at`, `updated_at`

Unknown lines are first-class draft information. They must never be discarded merely because the catalog has no product row yet.

Example:

```text
2 bịch hướng dương
```

becomes an unresolved line with quantity `2`, unit `bịch`, raw product text `hướng dương`, reason `not_in_catalog`.

## Owner review instead of customer clarification

For this workflow, unresolved product identity does not trigger a generic customer-facing question such as `chị lấy loại nào ạ?`.

The system continues building all other confident lines. When the owner opens/reports/chốt đơn, unresolved lines are presented for owner action:

- map to an existing catalog product;
- create/add the missing catalog product first, then map it;
- dismiss the line if it is not an order item.

Only the unresolved lines block final materialization of the native pending order. Resolved lines remain intact.

## Learning from owner resolution

When the owner resolves an unresolved line:

1. log the correction/evidence;
2. save the alias/context mapping for that customer;
3. move or materialize the unresolved line into the resolved draft table;
4. mark the unresolved line `resolved`;
5. replaying the same customer phrase later may resolve deterministically.

Customer-specific confirmation is authoritative. Knowledge from other customers can rank candidates but cannot auto-confirm this customer's mapping.

## Safe materialization

Before calling `getlink_sales_create_order`:

1. ensure there are no `pending` unresolved lines for the session;
2. reload every resolved product from `getlink_supplier_products`;
3. use server-side product name/price/cost only;
4. calculate totals server-side;
5. create exactly one native pending order idempotently.

If unresolved lines remain, return an owner-review result and do not create a partial native order silently.

## Reply behavior

The system should stop sending generic clarification/fallback replies for unresolved catalog identity in this back-office flow. It may send a compact acknowledgement only when that behavior is explicitly enabled, but owner review is the primary mechanism.

A multiline turn should not generate one reply per line. At most one compact turn acknowledgement/review signal is allowed.

## Failure and safety rules

- Never choose a unique fuzzy product from a truncated catalog page.
- Never assign a product code just because Groq names a likely item.
- Never discard an item because it is absent from catalog.
- Never convert cross-customer vocabulary into a confirmed customer alias automatically.
- Never create a native order while unresolved lines remain.
- Duplicate/retried source messages must not duplicate resolved or unresolved draft lines.

## Acceptance scenarios

1. The full multiline `test` message produces independent actions for every listed item.
2. `2 bịch hướng dương` is preserved as one pending unresolved line even with no catalog product.
3. All exact Omo sizes map to their actual active catalog rows and quantities.
4. `2 cái lân 1l/5l` can resolve to the Cái Lân oil family after deterministic/context validation.
5. `2 meizan 1l/5l` can resolve to the Meizan/Zan oil family after customer vocabulary confirmation.
6. `5 gạo 2l` ranks `Dau sim gao 2` because of the contiguous dầu ăn context, while still respecting confirmation requirements.
7. `5 nep 2l` resolves to `Dau nep 2` when catalog/context evidence is unambiguous.
8. `bát` stays in the mì chính family; a mismatched size label is not silently guessed.
9. One uncertain line does not prevent all certain lines from being saved to the live draft.
10. Chốt/report with pending unresolved lines requests owner resolution and does not create a partial native order.
11. Owner resolution becomes customer-specific memory for the next occurrence.
12. Other customers may receive the learned phrase only as a candidate hint, never as a confirmed mapping.
