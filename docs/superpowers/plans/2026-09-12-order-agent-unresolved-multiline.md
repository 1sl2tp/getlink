# Order Agent — Multiline + Unresolved-Line Implementation Plan

> Execute on `feature/quyen-deterministic-order-learning` only. Do not merge or write to `main`. Keep production rollout limited to the existing `test` pilot account until the full verification and production replay gates pass.

**Goal:** Convert one natural multiline customer message into independent ordered draft actions, preserve unknown/mismatched items as owner-review lines, keep confident catalog matches in the resolved draft, and block native order materialization until pending unresolved lines are cleared.

**Design source:** `docs/superpowers/specs/2026-09-12-order-agent-unresolved-multiline-design.md`

**Existing safety constraints:** Tạp hóa catalog is the only sellable authority; Chat/Call core stays untouched; Groq may parse language but never supplies authoritative product IDs or prices; customer-specific confirmation outranks store/cross-customer hints; current turn context outranks historical habits; retries must be idempotent.

---

## Task 1 — Add a service-only unresolved draft table

**Files:**
- Create: `supabase/migrations/20260912013700_getlink_ai_unresolved_draft_lines.sql`
- Create: `tests/test_ai_unresolved_draft_schema.py`

**Step 1: Write the RED schema contract test**

The test must require a migration defining `public.getlink_ai_unresolved_draft_lines` with:

- `id uuid primary key default gen_random_uuid()`
- `session_id` FK → `getlink_ai_order_sessions(id)` with cascade delete
- `line_key text not null`
- optional `source_message_id` FK → `v21_messages(id)`
- `raw_text`, `raw_product_text`
- nullable positive `quantity`
- nullable `unit_hint`, `context_family`
- `candidate_product_codes jsonb not null default '[]'::jsonb`
- checked `reason` in `not_in_catalog|ambiguous|size_mismatch|needs_owner_confirmation|other`
- checked `status` in `pending|resolved|dismissed`
- optional `resolved_product_code` FK → `getlink_supplier_products(product_code)`
- timestamps
- unique `(session_id,line_key)` for replay idempotency
- index for pending rows by session
- RLS enabled; revoke from `public, anon, authenticated`; grant table access only to `service_role`

Run the Python test and confirm it fails because the migration does not exist.

**Step 2: Implement the migration**

Create the table/index/security grants in one transaction. Do not modify `getlink_ai_order_draft_lines` or weaken its `product_code` FK.

**Step 3: Run the focused schema test**

Expected: PASS.

**Step 4: Commit**

Commit message: `feat: add unresolved order draft storage`

---

## Task 2 — Segment multiline orders deterministically and carry family context

**Files:**
- Create: `supabase/functions/getlink-order-agent/multiline.ts`
- Modify: `supabase/functions/getlink-order-agent/deterministic.ts`
- Create: `tests/ai_sales_order_multiline_test.ts`
- Modify: `tests/quyen_deterministic_replay_test.ts`
- Modify: `.github/workflows/verify.yml`

**Step 1: Write RED segmentation tests from the exact `test` message**

Use this exact input:

```text
2 bịch hướng dương
- 2 bát 1.8kg, 2 bát 1kg, 2 bát 454
- 2 omo 1.15kg, 2 omo 5.5kg, 2 omo 5.1kg, 2 omo 2.9kg, 2 omo 2.6kg, 2 omo 700g, 1 omo 380g
- 2 cái lân 1l, 2 cái lân 5l
- 2 meizan 1l, 2 meizan 5l
- 5 gạo 2l, 5 nep 2l
```

Require exactly 17 ordered fragments. Newlines/bullets are removed, and comma fragments split only when the next fragment starts with a quantity. Each fragment keeps its own `rawText`, numeric quantity, product phrase and unit/size text.

Also test that ordinary prose containing commas is not blindly split when the following text does not begin a quantity phrase.

**Step 2: Write RED context tests**

Extend deterministic family/context support with `mi_chinh`, `hoa_my_pham`, and `dau_an` without breaking existing Quyên dairy/tobacco/Milo tests.

Require these safe deterministic outputs:

- `2 bát 1kg` → lookup `Mi chinh bat 1`, family `mi_chinh`
- `2 bát 454` → lookup `Mi chinh bat 454`, family `mi_chinh`
- `2 bát 1.8kg` → unresolved descriptor, family `mi_chinh`, reason `size_mismatch`; do not map it to `Mi chinh bat 2`
- every listed Omo size → canonical lookup name (`Bot giat omo ...`) and family `hoa_my_pham`
- `2 cái lân 1l` → `Dau lan 1`; `2 cái lân 5l` → `Dau lan 5`
- `2 meizan 1l` → `Dau zan 1`; `2 meizan 5l` → `Dau zan 5`
- while family is `dau_an`, `5 gạo 2l` → `Dau sim gao 2`
- while family is `dau_an`, `5 nep 2l` → `Dau nep 2`
- `2 bịch hướng dương` remains unresolved with quantity 2, unit `bịch`, reason `not_in_catalog`

The deterministic result must preserve the fragment raw text and context family so an unresolved row can be saved without asking the customer.

**Step 3: Implement `multiline.ts`**

Expose a small focused API such as:

```ts
export type OrderFragment = {
  index:number;
  rawText:string;
  quantity:number|null;
  rawProductText:string;
  unitHint:string|null;
};

export function segmentOrderMessage(text:unknown):OrderFragment[];
```

Rules:
- split physical lines first
- trim bullets like `-`, `•`
- within a physical line split comma-separated chunks only when a new chunk begins with quantity
- preserve original order
- never infer product code here

**Step 4: Extend `deterministic.ts`**

Keep one responsibility: map a single fragment + prior context to a safe catalog lookup or an unresolved description. Extend context types without changing existing customer-specific dairy semantics. Do not add `Mi chinh bat 2` as an alias for `bát 1.8kg`.

**Step 5: Add the new Deno test file to Verify GETLINK**

Append `tests/ai_sales_order_multiline_test.ts` to the existing Deno test command.

**Step 6: Run focused Deno tests through PR CI**

Expected: segmentation/context tests pass and existing deterministic replay tests remain green.

**Step 7: Commit**

Commit message: `feat: parse multiline grocery order fragments`

---

## Task 3 — Add unresolved-line repository support and idempotent line keys

**Files:**
- Modify: `supabase/functions/getlink-order-agent/session.ts`
- Modify: `supabase/functions/getlink-order-agent/repository.ts`
- Create: `tests/ai_sales_order_unresolved_test.ts`
- Modify: `.github/workflows/verify.yml`

**Step 1: Write RED repository/session tests**

Add an `UnresolvedDraftLine` type and repository contract that supports:

- `listUnresolvedLines(sessionId, status?)`
- `saveUnresolvedLine(sessionId,line)` using `(session_id,line_key)` upsert
- `markUnresolvedResolved(id, productCode)`
- optional dismiss operation if needed by owner workflow

Use stable line keys derived from source message ID plus fragment index, e.g. `${sourceMessageId}:${index}`. This guarantees replaying the same message cannot duplicate an unresolved row. Resolved lines created from a multiline source must also use a stable fragment-aware key rather than only `product_code`; however repeated identical products in later customer messages should still merge by product according to existing order behavior.

**Step 2: Implement repository mappings**

Map DB snake_case fields to service types. Only pending unresolved rows should block materialization.

**Step 3: Run focused tests**

Expected: unresolved save/list/mark behavior is idempotent.

**Step 4: Add the new test to Verify GETLINK and commit**

Commit message: `feat: persist unresolved order draft lines`

---

## Task 4 — Process all fragments in one turn without stopping on uncertainty

**Files:**
- Modify: `supabase/functions/getlink-order-agent/session.ts`
- Modify: `supabase/functions/getlink-order-agent/orchestrator.ts`
- Modify: `tests/ai_sales_order_session_test.ts`
- Modify: `tests/ai_sales_order_unresolved_test.ts`

**Step 1: Write RED turn-processing tests**

Build a memory repository containing both resolved and unresolved lines. Require one multiline message to:

- process all 17 fragments in original order
- save every safe catalog match
- save `hướng dương` unresolved instead of discarding it
- save `bát 1.8kg` unresolved as `size_mismatch`
- continue processing later Omo/oil lines after both unresolved fragments
- return a result kind `owner_review` when pending unresolved lines exist
- include both resolved and unresolved collections in the result for owner/report surfaces
- never call native materialization during ordinary collection

For the production catalog evidence, expected safe resolved fragment count is 15 and pending unresolved count is 2.

**Step 2: Integrate deterministic multiline processing before Groq**

For each customer message:

1. preserve existing explicit single-message commands (`ok`, decline, price query/list, corrections) where applicable;
2. when order-list segmentation yields multiple fragments, process each fragment deterministically in sequence;
3. for a fragment that is structurally parseable but cannot be safely catalog-resolved, save unresolved instead of calling customer clarification;
4. only use Groq for a fragment whose language/intent itself cannot be structured, not to choose product IDs;
5. update current family/context after each fragment so later fragments inherit the right category.

**Step 3: Make unresolved identity non-blocking within collection**

A failed product match for one fragment must not return early from the turn. Continue with remaining fragments.

**Step 4: Keep price authority deterministic**

For resolved products call existing `commercialFacts`; products such as `Dau sim gao 2` with active `no_price` may remain a draft line with quoted display price 0 if existing native order rules allow zero. Do not manufacture a price.

**Step 5: Run the focused session/unresolved tests**

Expected: 15 resolved + 2 unresolved for the exact test fixture, no early stop.

**Step 6: Commit**

Commit message: `feat: build mixed resolved and unresolved live drafts`

---

## Task 5 — Block checkout on unresolved lines and suppress customer-facing identity questions

**Files:**
- Modify: `supabase/functions/getlink-order-agent/session.ts`
- Modify: `supabase/functions/getlink-order-agent/orchestrator.ts`
- Modify: `supabase/functions/getlink-order-agent/reply.ts`
- Modify: `tests/ai_sales_order_session_test.ts`
- Modify: `tests/ai_sales_order_reply_test.ts`

**Step 1: Write RED checkout gate test**

When a session has at least one pending unresolved line and the customer sends confirmation:

- return `owner_review`
- do not call `materializePendingOrder`
- preserve all resolved lines
- preserve all pending unresolved lines

After unresolved rows are cleared, confirmation should retain the existing idempotent native order behavior.

**Step 2: Write RED reply/orchestrator test**

For `owner_review` caused by product identity:

- no generic `clarification` customer message
- no generic fallback customer message
- `processLiveRows` must not enqueue an outbox reply for this result

Known-product attribute clarification (for example an already resolved product that genuinely requires color) may continue using the existing targeted clarification path.

**Step 3: Implement the materialization gate**

Load pending unresolved rows before `getlink_sales_create_order`. `materializePendingOrder` itself should fail closed if called with pending unresolved state, so the safety rule is enforced below the conversational result layer as well.

**Step 4: Implement reply suppression**

Treat `owner_review` as back-office state, not a customer conversation. At most one normal draft acknowledgement may remain for fully resolved turns; a mixed/unresolved turn must not send “chị lấy loại nào” or the existing generic fallback.

**Step 5: Run focused tests and commit**

Commit message: `fix: keep unresolved product review back office only`

---

## Task 6 — Add owner resolution and customer-specific learning

**Files:**
- Modify: `supabase/functions/getlink-order-agent/repository.ts`
- Modify: `supabase/functions/getlink-order-agent/learning.ts`
- Create/modify: `tests/ai_sales_order_unresolved_test.ts`

**Step 1: Write RED owner-resolution test**

Given a pending unresolved row and an owner-confirmed active catalog `product_code`:

- validate the product against `getlink_supplier_products`
- create/update the resolved draft line with the unresolved quantity/unit/raw text
- mark the unresolved row `resolved` and set `resolved_product_code`
- record a correction with source `admin_edit`
- create/update a **customer-scoped** alias for this customer
- do not create a store-scoped alias from one customer's correction

The operation must be safe to retry without duplicate resolved lines or correction side effects that corrupt the alias.

**Step 2: Implement a focused service function**

Prefer a backend function/module method such as `resolveOwnerDraftLine(...)` rather than embedding owner learning in UI code. There is no need to build a new front-end review UI in this phase; the pilot acceptance is service-level resolution plus reportable unresolved rows.

**Step 3: Run tests and commit**

Commit message: `feat: learn customer aliases from owner draft resolution`

---

## Task 7 — Full branch verification before production changes

**Files:** none unless failures reveal a real regression.

**Step 1: Run Verify GETLINK through GitHub Actions on the latest PR head**

Require all existing gates plus new tests to pass:

- Python unit suite
- static build check
- Node syntax checks
- Deno checks for GETLINK edges
- all Order Agent Deno tests, including multiline/unresolved tests
- existing BHX/GO/search gates
- Supabase-only gate

**Step 2: Review the PR diff**

Confirm no Chat/Call core files, auth flow, media, notification, or unrelated GETLINK business logic changed.

**Step 3: Stop if any gate is red**

Do not apply production migration or deploy Edge until the exact head is green.

---

## Task 8 — Apply schema and deploy only to the existing `test` pilot

**Production target:** Supabase project `gcnoahqsrquxkwkjbuxy`.

**Step 1: Reconfirm production safety state**

Before DDL/deploy verify:

- runtime remains `pilot`
- pilot allowlist contains exactly one account, username `test`
- no expansion to other customers

**Step 2: Apply `20260912013700_getlink_ai_unresolved_draft_lines.sql`**

Use Supabase migration tooling, not ad-hoc DDL. Then query table/security metadata to confirm creation.

**Step 3: Deploy the verified Order Agent Edge bundle**

Deploy all relative dependencies from the verified branch head. Preserve current custom webhook authentication and `verify_jwt=false` because the existing function already authenticates via `x-order-agent-secret`.

**Step 4: Health check**

Require HTTP 200 and:

- `mode=pilot`
- `model_provider=groq`
- `model_configured=true`
- `pilot_customer_count=1`

---

## Task 9 — Replay only the latest multiline `test` message safely

**Production data scope:** only the existing `test` account, its current conversation, and the latest multiline source message already inspected.

**Step 1: Snapshot current test state**

Record the source message ID, session ID, existing audit/outbox rows and current resolved/unresolved counts. Do not delete Chat history or old audit evidence.

**Step 2: Clear only derived draft state for that source message**

Remove/revert resolved or unresolved draft rows sourced from the latest multiline message if any. Do not touch other customers and do not delete the message itself.

**Step 3: Replay the source message once**

Set only that inbox record back to a processable state or invoke the authenticated recovery path once. Because `owner_review` is back-office only, replay must not send a new generic clarification/fallback message to the customer.

**Step 4: Verify exact replay result**

Expected:

- inbox processed successfully, no error
- resolved draft contains the safe catalog matches
- expected safe resolved fragment count: 15
- pending unresolved contains exactly the two intentionally uncertain fragments:
  - `2 bịch hướng dương` → reason `not_in_catalog`
  - `2 bát 1.8kg` → reason `size_mismatch` or `needs_owner_confirmation`
- no native pending order is created while those unresolved rows remain
- no new customer-facing generic clarification/fallback reply is sent
- `Dau sim gao 2` may have quoted price 0/no-price state; no invented price

If real catalog evidence makes any supposedly safe line ambiguous, fail closed and preserve it unresolved rather than forcing the expected count.

**Step 5: Final verification**

Re-run production health and branch Verify GETLINK. Report actual resolved/unresolved lines and any remaining owner mappings needed; do not merge PR.

---

## Completion gate

Work is complete only when:

1. full branch Verify is green on the exact final head;
2. production remains pilot-only for `test`;
3. the exact multiline test message replays into a mixed live draft without dropping any line;
4. no uncertain fragment is assigned a guessed product code;
5. no generic customer clarification is sent for unresolved identity;
6. native order materialization is blocked until unresolved rows are resolved/dismissed;
7. owner resolution can create customer-scoped memory without leaking it into global/store confirmation.

Do **not** merge PR #37 or expand the pilot without explicit user approval.