# AI Sales Order Agent — Design

## Goal

Add a server-side AI sales assistant that can read customer Chat messages, assemble and revise a live grocery order draft, answer price questions, send category/full price lists, learn customer-specific product aliases, ask targeted clarification questions, compare the store price with trustworthy supermarket reference data, and politely suggest small add-ons when the carton count is close to the next round number.

The assistant must feel like a helpful store employee while every commercial fact remains deterministic and traceable to GETLINK data.

## Scope and hard boundaries

- Sellable order items come **only** from the active Tạp hóa catalog `public.getlink_supplier_products`.
- WM/BHX/GO data is **reference-only** for price comparison. Supermarket products must never become order lines.
- Chat/Call core behavior remains LOCKED. The feature integrates through server-side message/event boundaries; it must not rewrite composer, renderer, call, auth, media, notification, keyboard, or viewport logic.
- Canonical customer identity remains `public.v21_accounts`.
- Canonical commercial order/debt system remains the GETLINK native sales core (`getlink_sales_orders`, `getlink_sales_order_items`, `getlink_debt_ledger`).
- The AI may interpret language and choose wording. It may **not** invent products, unit prices, totals, supermarket prices, stock state, quantity conversions, or order status.
- AI/API secrets stay server-side only.

## User experience

### Natural order entry

Customers are encouraged, but never forced, to use the simple pattern:

`<tên hàng khách hay gọi> + <số lượng>`

Examples:

- `bi bé màu 2`
- `sc nếp cẩm 3`
- `555 5 cây`
- `hảo hảo 2 thùng`

Misspellings, missing accents, abbreviations, customer nicknames, and short forms are expected. The system learns the customer's own vocabulary instead of forcing them to memorize canonical catalog names.

### Live order session

Each customer/conversation has at most one open AI order session. Incoming customer messages are debounced for 4 seconds so several consecutive lines are processed as one conversational turn. The 4-second debounce is **not** an order timeout; the open session continues until it is confirmed, deliberately closed, or replaced by an explicit new-order intent.

When a customer sends another line later, it updates the same open session. Examples:

- `milo lấy 3 thôi` changes the existing Milo quantity rather than adding a second unrelated Milo line.
- `bỏ loại ít đường` removes or revises the previously referenced line.
- `cái lúc nãy lấy 2` resolves against recent session context.

### Automatic replies

The assistant replies automatically after each meaningful update. Replies are short, polite, helpful, and lightly playful; normally zero or one emoji per reply. It should prefer wording such as `Dạ em ghi rồi ạ`, `Dạ em sửa lại rồi ạ`, and `chị cân đối giúp em nhé ạ`, without sounding robotic or over-chatty.

Commercial numbers in replies are inserted by backend code from authoritative facts. The LLM must never be the source of those numbers.

### Clarification and product notes

A customer can mention color, flavor, size, pack type, or another product-specific note. The system distinguishes:

1. a real catalog variant that maps to a different `product_code`; and
2. a free-form line note attached to the matched product.

If a required detail is missing, the assistant asks only the missing question. Example:

`bi bé 2 màu` → `Dạ 2 cái bi bé mình lấy màu gì ạ? 😄`

A reply such as `1 đỏ 1 xanh` is attached to that specific order line.

### Group/category suggestion

When the customer is clearly shopping within a group but product naming is ambiguous, the assistant may offer help once per conversational turn:

`Dạ bên em có mấy loại Probi hơi giống nhau ạ. Em gửi toàn bộ danh sách Probi đang có để mình chọn cho đúng nhé?`

The list is sent only after the customer agrees, unless the customer explicitly requested a price list.

After a list is sent, its row codes/names become part of the current session context so replies such as `mã P04 2`, `cái số 4 lấy 3`, or `loại màu xanh 2` can resolve against that list.

## Price queries and price lists

The agent treats price questions as a first-class intent.

Examples:

- `555 hôm nay?`
- `thuốc lá hôm nay bao nhiêu`
- `gửi giá sữa`
- `báo giá toàn bộ`

For an exact product query, the backend reads the current Tạp hóa selling price and recent price-history metadata, then responds with the authoritative current price and, when available, a short change signal such as `giữ giá`, `tăng 2.000`, or `giảm 5.000`.

For category/all-catalog requests:

- small category results may be sent inline;
- long lists use a compact GETLINK price-list view/link with current timestamp and grouping, rather than flooding Chat with hundreds of lines;
- the Chat message still contains a short summary and clear scope such as `Sữa hôm nay` or `Bảng giá toàn bộ hôm nay`.

Price-list rows may expose a short code for convenience, but codes are optional shortcuts, not mandatory customer vocabulary.

## Market comparison

Market comparison runs in two situations:

1. whenever the customer asks a price; and
2. whenever the assistant prepares a checkout/confirmation summary.

Comparison is allowed only when all of these are true:

- a store Tạp hóa product has a high-confidence supermarket reference match;
- the comparison is normalized to the same product and equivalent pack/unit quantity;
- the reference price was updated within the previous 24 hours;
- the source price is valid and non-zero.

When those gates pass, the reply includes the relative market position every time the customer asks that product's price or the product appears in the checkout comparison. If the two prices differ by less than 1%, wording should say they are `gần tương đương`; otherwise it should state whether the store is higher or lower and by how much when useful.

If the gates fail, the assistant omits the comparison rather than guessing.

Example when the store is more expensive:

`Dạ Hảo Hảo bên em hôm nay 188.000/thùng ạ. Giá siêu thị em đang tham khảo khoảng 185.000/thùng, hôm nay bên em hơi cao hơn chút, chị cân đối giúp em nhé ạ 😅`

Example when the store is cheaper:

`Dạ giá bên em hôm nay đang thấp hơn giá siêu thị tham khảo khá nhiều ạ 😄 Chị cân đối giá bán nhỉnh thêm chút vẫn ổn nhé.`

The comparison module never changes the store's selling price automatically.

## Round-number sales suggestion

The assistant may make one gentle add-on suggestion when the order is already close to the next round carton count.

For v1, round carton targets are the next multiple of 5: `5, 10, 15, 20, 25, ...`.

Trigger only when:

- the current draft has at least 5 cartons in carton-equivalent lines;
- the next target is 1–3 cartons away;
- no round-number suggestion has already been declined for this order session.

Examples:

- 17 cartons → suggest 20 (gap 3)
- 24 cartons → suggest 25 (gap 1)
- 11 cartons → do not push toward 15 (gap 4)

Suggested extra products must come only from the active Tạp hóa catalog. Ranking preference is: customer's known purchase history/aliases, same shopping group, currently active products, then products with a favorable market comparison. The assistant may offer to show choices rather than silently adding anything.

If the customer declines, the session records that refusal and does not repeat the same upsell.

## Hybrid intelligence model

The system uses a hybrid pipeline rather than regex-only or AI-only behavior.

### Deterministic fast path

Use code/rules first for high-confidence cases:

- normalized accents/case/spacing;
- exact product codes;
- customer/store aliases;
- explicit quantities and units;
- known abbreviations;
- exact price queries;
- arithmetic, totals, price deltas, carton rounding, and comparison math.

Known customer aliases may resolve without an LLM call.

### LLM smart path

A server-side LLM is used when natural-language understanding is needed, including:

- contextual corrections (`cái kia lấy 2 thôi`);
- references to earlier messages/list rows;
- ambiguous product wording;
- add/remove/change intent;
- extracting free-form notes such as color/size/flavor;
- deciding whether clarification is required;
- producing short, polite conversational wording from authoritative facts.

The LLM returns structured JSON, not executable actions. A representative parse contract is:

```json
{
  "intent": "add_item",
  "raw_product_text": "bi be mau",
  "quantity": 2,
  "unit_hint": null,
  "attributes": {},
  "line_note": "",
  "reference_target": null,
  "needs_clarification": false
}
```

The backend validates every field and resolves any product reference against the Tạp hóa catalog before changing a draft.

### Safe reply composition

The agent response layer receives an immutable fact bundle containing product names, prices, quantities, totals, price deltas, market comparisons, and clarification options. The LLM may choose wording around named placeholders, but backend code fills the values. This prevents the model from fabricating commercial facts while preserving natural Vietnamese conversation.

## Learning without model fine-tuning

V1 learns through database memory rather than fine-tuning the model.

### `getlink_ai_product_aliases`

Stores learned vocabulary.

Core fields:

- `id uuid primary key`
- `scope text check in ('customer','store')`
- `customer_account_id uuid null`
- `product_code text not null`
- `alias_display text not null`
- `alias_normalized text not null`
- `confidence numeric not null`
- `confirm_count integer not null default 0`
- `correction_count integer not null default 0`
- `last_used_at timestamptz`
- unique scope/customer/alias rules preventing contradictory duplicates

Resolution priority:

`customer alias → store alias → canonical product name/code → fuzzy candidates → LLM-assisted choice`

A manual admin correction is stronger evidence than an AI guess. A customer alias may be promoted to store scope only after successful confirmation by at least 3 distinct customers and no conflicting correction for that alias/product pair.

### `getlink_ai_corrections`

Audit trail for learning:

- raw customer phrase
- prior AI/matcher candidate
- corrected `product_code`
- customer/conversation/session IDs
- correction source (`customer_confirmation`, `admin_edit`, `clarification`)
- timestamp

Corrections improve alias memory; they do not mutate canonical product names.

### `getlink_ai_product_hints`

Optional product metadata for future AI assistance:

- `product_code`
- `ask_attribute` such as `color`, `flavor`, `size`
- allowed/known values when the catalog has them
- short sales hint
- reference product metadata needed for safe market comparison

This table supplements the catalog. It never overrides the canonical product price or active state.

## Live draft data model

The agent must not weaken the native sales core's historical snapshot contract. Therefore conversational work-in-progress is stored separately and materialized into a native pending order only when the customer confirms or an admin explicitly accepts it.

### `getlink_ai_order_sessions`

- one open session per customer/conversation
- state: `collecting`, `awaiting_clarification`, `quoted`, `confirmed`, `handed_off`, `closed`
- links to customer account and Chat conversation
- last customer message time
- last sent price-list scope/context
- round-upsell offered/declined state
- eventual `getlink_sales_orders.id` after handoff

### `getlink_ai_order_draft_lines`

- session ID
- stable line key
- resolved `product_code`
- customer raw wording
- quantity
- unit/pack interpretation
- structured attributes
- free-form line note
- latest authoritative quoted price snapshot for display only
- matcher confidence and resolution source

Draft lines are editable by subsequent customer messages or admin correction. On handoff, the existing GETLINK order API independently re-resolves each `product_code`, snapshots current name/price/cost, recalculates totals, and creates the canonical pending order atomically.

The AI draft never becomes the source of truth for historical sales accounting.

## Message/event architecture

```text
Customer Chat message
        ↓
server-side order-agent inbox/event
        ↓
4s per-conversation debounce / idempotency gate
        ↓
load open AI order session + recent context
        ↓
fast rules / alias memory
        ↓ (only if needed)
LLM structured parser
        ↓
Tạp hóa catalog matcher + validation
        ↓
update AI draft session
        ↓
price / total / market / round-number engines
        ↓
validated reply fact bundle
        ↓
short AI/template reply
        ↓
server-side Chat send adapter
        ↓
Customer sees automatic reply
```

The Chat frontend is not responsible for running the agent. Closing the browser must not stop processing.

A dedicated backend inbox/outbox makes retries idempotent: the same Chat message ID must never mutate a draft twice or cause duplicate auto-replies.

## Chat integration constraints

- Process only customer → store/admin text messages for v1. Media/voice understanding is out of scope for the first release.
- Bot replies are sent through a server-side Chat adapter using the existing Chat conversation/message contract.
- Agent-generated messages are marked in backend metadata so they are not re-ingested as new customer instructions.
- Existing Web Push, unread counts, message rendering, delivery order, and notification behavior continue to operate through the normal Chat message pipeline.
- No AI key, service-role key, or privileged order API is exposed to `chat.taphoa.xyz` browser code.

## Failure behavior

- LLM unavailable: known aliases/exact commands still use the deterministic fast path; ambiguous messages receive a polite temporary fallback and remain unmodified.
- Product not confidently matched: ask a focused clarification or offer the relevant current Tạp hóa list.
- Price unavailable/inactive product: do not quote or add it; explain briefly.
- Market data missing/stale: omit market advice.
- Duplicate message/event: no duplicate draft mutation and no duplicate reply.
- Backend send failure: keep reply in outbox and retry without re-running the commercial mutation.
- Conflicting correction: latest explicit customer/admin correction wins and is logged.

## Security and privacy

- Verify Chat identity and conversation membership server-side.
- All agent DB tables use RLS/no direct anonymous writes; service-role operations occur only inside trusted backend functions.
- Store only conversational fragments needed for order resolution/learning; do not copy unrelated chat history into AI learning tables.
- Send the LLM only the minimum recent context, relevant product candidates, and necessary customer alias memory.
- Never send credentials, access tokens, service-role keys, or unrelated customer records to the model provider.

## Observability

Record enough metadata to debug mistakes without storing hidden model reasoning:

- source message IDs
- parsed structured intent
- candidate product codes/scores
- chosen resolution source
- clarification state
- draft mutation result
- authoritative price/total facts used in reply
- model/provider request ID and latency when available
- final reply ID
- correction/confirmation outcome

Do not store chain-of-thought or ask the model to expose it.

## V1 acceptance scenarios

1. Customer sends `bi be mau 2`; known alias resolves to a real active Tạp hóa `product_code`, draft quantity becomes 2, and the auto-reply uses the real current price.
2. Unknown `bi be mau 2` produces a narrow clarification/list offer; after admin/customer correction, the alias is learned for that customer.
3. Customer later says `bi be mau 3`; the customer alias resolves without guessing.
4. Customer says `milo lấy 3 thôi`; the existing Milo draft line becomes 3 rather than duplicating it.
5. Customer says `bi bé 2 màu`; assistant asks for the color; `1 đỏ 1 xanh` becomes a note/attribute on that line.
6. Customer asks `555 hôm nay?`; assistant returns the live Tạp hóa price and recent change signal when available.
7. Customer asks `gửi giá sữa`; assistant sends the current Sữa list/price-list view and remembers its row context for follow-up references.
8. Customer asks `báo giá toàn bộ`; assistant returns a compact all-catalog price-list view, not hundreds of chat lines.
9. On every eligible price query and checkout comparison, fresh/equivalent supermarket reference data is reported truthfully; supermarket data never enters the order.
10. A 17-carton draft receives at most one gentle suggestion to reach 20; a declined suggestion is not repeated.
11. Customer confirms the draft; backend materializes it through the existing GETLINK native order path and recomputes current authoritative prices.
12. Retrying the same Chat message/event cannot create a second draft mutation, second order, or duplicate auto-reply.
13. Chat/Call, media, auth, Web Push, unread badge, keyboard, and viewport tests remain unchanged/green unless a proven integration contract requires a narrowly scoped adapter test.

## Rollout strategy

1. Add the AI draft/alias/correction tables and deterministic matcher behind a disabled feature flag.
2. Add order-agent inbox/outbox and idempotency tests.
3. Add server-side LLM structured parsing with secrets only in backend configuration.
4. Add draft mutation, price-query, price-list, clarification, and learning tests using fixtures from real Tạp hóa naming patterns.
5. Add the Chat server-side send adapter without changing Chat UI/core behavior.
6. Run in shadow mode first: parse and log proposed actions but do not reply or mutate customer-visible drafts.
7. Review real examples/corrections, then enable for one test/customer account.
8. Enable automatic replies after duplicate-safety, price integrity, and clarification gates are verified.
9. Enable market advice and round-number suggestions last, after core order capture is stable.

## Success criteria

The feature is ready for broader use only when:

- customer shorthand/corrections can update one continuous draft reliably;
- every order line maps to an active Tạp hóa product and every quoted amount comes from backend data;
- learned aliases improve repeat interactions without changing canonical product names;
- price/category/full-list questions are answered from current data;
- market advice is truthful, same-pack, fresh, and reference-only;
- automatic replies are concise, polite, and do not duplicate;
- confirmed drafts enter the existing native pending-order system without weakening historical snapshots;
- Chat core remains behaviorally unchanged and all existing verification stays green.
