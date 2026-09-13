# AI Sales Order Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-side AI sales assistant that turns customer Chat text into one continuous Tạp hóa draft order, answers price/list questions, learns customer aliases, asks only necessary clarification questions, compares eligible supermarket reference prices, and safely hands confirmed drafts into the existing GETLINK native pending-order core.

**Architecture:** Keep Chat/Call frontend/core unchanged. A new Supabase Edge Function `getlink-order-agent` consumes customer text messages through a database inbox, applies a deterministic fast path first, uses a structured-output LLM only when language understanding is needed, validates every product against `getlink_supplier_products`, calculates every price/total in backend code, writes an AI-only draft/session layer, then sends idempotent replies back through the existing `v21_messages` table. Postgres `pg_net` + Vault dispatch new inbox rows immediately; a low-frequency recovery sweep handles missed dispatches. Confirmed drafts are re-resolved and materialized through the existing GETLINK native sales path so historical order snapshots remain authoritative.

**Tech Stack:** Supabase Postgres migrations/RLS/RPCs, `pg_net`, Supabase Vault, Supabase Edge Functions with Deno/TypeScript, OpenAI Responses API Structured Outputs behind server-only environment variables, Vanilla HTML/JS/CSS for the compact price-list view, Python `unittest` contract tests, Deno tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-12-ai-sales-order-agent-design.md`

## Global Constraints

- Sellable order lines come only from active `public.getlink_supplier_products`; WM/BHX/GO are reference-only and can never become order lines.
- Do not modify Chat composer, renderer, call, auth, media, Web Push, unread, keyboard, viewport, or notification behavior.
- Canonical identity remains `public.v21_accounts`; canonical Chat messages remain `public.v21_messages` / `public.v21_conversations`.
- Canonical commercial accounting remains `getlink_sales_orders`, `getlink_sales_order_items`, and `getlink_debt_ledger`.
- AI may interpret language and produce wording; it may not invent product IDs, prices, totals, stock, pack conversions, market prices, or order states.
- All AI/service-role credentials are server-only. No privileged key enters `chat.taphoa.xyz`, `get.taphoa.xyz`, static JS, or GitHub source.
- Incoming text is debounced for exactly 4 seconds per conversation turn; the open order session itself does not expire after 4 seconds.
- V1 processes customer text only; voice/image/file understanding is out of scope.
- Customer alias promotion to store scope requires at least 3 distinct successful customer confirmations and no conflicting correction.
- Market advice is allowed only for the same product/equivalent pack with a valid non-zero reference updated within 24 hours; within 1% say prices are near-equivalent.
- Round-number upsell uses the next multiple of 5, only when the draft has at least 5 carton-equivalents and the gap is 1–3; one decline suppresses further round-up suggestions for that session.
- Rollout must pass `off → shadow → pilot → on`; automatic customer replies must not be enabled globally before shadow and one-customer pilot verification.

---

### Task 1: Lock the AI-agent contract with RED tests

**Files:**
- Create: `tests/test_ai_sales_order_agent_contract.py`
- Create: `tests/ai_sales_order_agent_test.ts`
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Consumes: approved design spec, existing `getlink-orders`, current sales schema, current Chat table names.
- Produces: executable contracts for new schema names, no Chat frontend changes, deterministic product/price authority, four-second debounce, alias priority, market freshness, round-number rules, and idempotency.

- [ ] **Step 1: Add RED Python schema/runtime contract.** The test must require these names in the new migration/function tree: `getlink_ai_order_sessions`, `getlink_ai_order_draft_lines`, `getlink_ai_product_aliases`, `getlink_ai_corrections`, `getlink_ai_product_hints`, `getlink_ai_message_inbox`, `getlink_ai_reply_outbox`, `getlink_ai_enqueue_chat_message`, `getlink_ai_send_chat_message`, and `getlink-order-agent`.

```python
required = (
    "getlink_ai_order_sessions",
    "getlink_ai_order_draft_lines",
    "getlink_ai_product_aliases",
    "getlink_ai_corrections",
    "getlink_ai_product_hints",
    "getlink_ai_message_inbox",
    "getlink_ai_reply_outbox",
    "getlink_ai_enqueue_chat_message",
    "getlink_ai_send_chat_message",
)
for name in required:
    self.assertIn(name, migration_text)
```

- [ ] **Step 2: Add RED isolation assertions.** Require the agent to read `getlink_supplier_products` for sellable items; reject any code path that inserts WM/BHX/GO products into `getlink_sales_order_items`; require the Chat repo to remain untouched by this GETLINK branch.
- [ ] **Step 3: Add RED Deno unit cases** for `normalizeCustomerText`, `nextRoundSuggestion`, `marketComparison`, alias priority, and structured intent validation. Use examples `bi be mau 2`, `milo lấy 3 thôi`, `17 → 20`, `11 → no suggestion`, and stale market data → no advice.
- [ ] **Step 4: Update Verify GETLINK** to run `deno test -A tests/ai_sales_order_agent_test.ts` and `deno check supabase/functions/getlink-order-agent/index.ts` once the function exists.
- [ ] **Step 5: Run targeted tests and confirm RED.**

Run:
```bash
python -m unittest tests.test_ai_sales_order_agent_contract -v
deno test -A tests/ai_sales_order_agent_test.ts
```
Expected: failures because schema/modules do not exist yet.

- [ ] **Step 6: Commit RED tests.**

---

### Task 2: Add AI draft, learning, inbox/outbox, and Chat-send database primitives

**Files:**
- Create: `supabase/migrations/20260912013000_getlink_ai_sales_order_agent.sql`
- Test: `tests/test_ai_sales_order_agent_contract.py`

**Interfaces:**
- Produces tables: `getlink_ai_order_sessions`, `getlink_ai_order_draft_lines`, `getlink_ai_product_aliases`, `getlink_ai_corrections`, `getlink_ai_product_hints`, `getlink_ai_message_inbox`, `getlink_ai_reply_outbox`.
- Produces RPCs/functions: `getlink_ai_enqueue_chat_message()`, `getlink_ai_claim_turn(uuid)`, `getlink_ai_send_chat_message(uuid,text,text)`, `getlink_ai_promote_aliases()`.
- Consumes existing `v21_messages`, `v21_conversations`, `v21_accounts`, `getlink_supplier_products`.

- [ ] **Step 1: Create AI session and line tables.** Enforce one open session per conversation with a partial unique index for states `collecting|awaiting_clarification|quoted|confirmed`; draft lines reference session and store `product_code`, raw customer wording, quantity, unit hint, `attributes jsonb`, line note, quoted price snapshot, confidence, and resolution source.
- [ ] **Step 2: Create alias/correction/hint tables.** Alias uniqueness must distinguish customer scope from store scope. Corrections must retain source message/session/customer IDs and correction source. Product hints may contain required attribute and market-reference metadata but never a selling price override.
- [ ] **Step 3: Create inbox/outbox tables with idempotency.** Inbox has unique `message_id`; outbox has unique `(session_id, turn_key, reply_kind)` so retries cannot duplicate replies.
- [ ] **Step 4: Enable RLS on all new tables** and provide no direct anon/authenticated write policy. Grant trusted execution only to service role for mutation RPCs.
- [ ] **Step 5: Add AFTER INSERT trigger on `v21_messages`.** `getlink_ai_enqueue_chat_message()` must enqueue only non-deleted, non-empty messages whose sender resolves to active `v21_accounts.role='user'`. Messages sent by the agent/admin must therefore never re-enter the inbox.
- [ ] **Step 6: Add `getlink_ai_send_chat_message`.** The function derives the active admin member from `v21_conversations`, validates body length/client id, and inserts into `v21_messages` with an idempotent client id such as `ai:<outbox-id>`. It must not require a browser app session.
- [ ] **Step 7: Add atomic claim RPC.** `getlink_ai_claim_turn(conversation_id)` uses a row/advisory lock, returns only pending inbox rows after the newest customer message has been quiet for at least 4 seconds, and marks the claimed batch with one `turn_key`.
- [ ] **Step 8: Add immediate pg_net dispatch hook.** On inbox insertion, use `vault.decrypted_secrets` names `getlink_order_agent_url` and `getlink_order_agent_webhook_secret`; if either is absent, enqueue without failing. Send only `message_id`/`conversation_id`, never customer text in the webhook payload.
- [ ] **Step 9: Add recovery sweep support.** Provide SQL function `getlink_ai_pending_dispatches(limit)` for the Edge Function to recover pending rows older than 30 seconds. Do not require per-second cron; production may invoke sweep every minute as recovery only.
- [ ] **Step 10: Run Python contract tests GREEN and commit.**

---

### Task 3: Build deterministic text, matching, market, and sales-rule core

**Files:**
- Create: `supabase/functions/getlink-order-agent/types.ts`
- Create: `supabase/functions/getlink-order-agent/normalize.ts`
- Create: `supabase/functions/getlink-order-agent/rules.ts`
- Create: `supabase/functions/getlink-order-agent/matcher.ts`
- Create: `supabase/functions/getlink-order-agent/commerce.ts`
- Test: `tests/ai_sales_order_agent_test.ts`

**Interfaces:**
- Produces `normalizeCustomerText(text): string`.
- Produces `parseFastCommand(text, context): ParsedIntent|null`.
- Produces `resolveProduct(db, customerId, rawText, candidates?): Promise<ProductResolution>`.
- Produces `nextRoundSuggestion(cartonEquivalent): {target:number,gap:number}|null`.
- Produces `marketComparison(store, reference, now): MarketComparison|null`.
- Produces `buildCommercialFacts(session): Promise<CommercialFacts>`.

- [ ] **Step 1: Define strict shared types** for intents `ignore|add_item|change_qty|remove_item|price_query|price_list|confirm|decline|clarification_answer`, draft mutations, product resolution, market facts, and reply facts.
- [ ] **Step 2: Implement Vietnamese normalization**: Unicode NFD accent stripping for search only, `đ→d`, lower-case, collapse whitespace, while preserving original customer text separately for audit/reply context.
- [ ] **Step 3: Implement deterministic fast path** for exact product code, explicit quantity/unit, known aliases, simple price query, confirmation/decline tokens, and known abbreviations; fast-path results must still validate against an active Tạp hóa product.
- [ ] **Step 4: Implement matcher priority exactly:** customer alias → store alias → exact canonical product code/name → fuzzy shortlist. Fuzzy matching returns candidates but never mutates a draft unless confidence threshold passes.
- [ ] **Step 5: Implement commercial lookup** from `getlink_supplier_products`, including current selling price, current pack fields, active/stock gates, price direction/history fields, and quantity arithmetic in full VND.
- [ ] **Step 6: Implement market comparison** using `getlink_ai_product_hints` reference metadata plus current GETLINK supermarket price tables; reject source data older than 24h or inequivalent pack/size; classify `<1%` as `near`, otherwise `store_higher|store_lower`.
- [ ] **Step 7: Implement carton-equivalent and round suggestion** with v1 rule next multiple of 5, minimum 5 cartons, gap 1–3 only.
- [ ] **Step 8: Run Deno tests GREEN and commit.**

Run:
```bash
deno test -A tests/ai_sales_order_agent_test.ts
deno check supabase/functions/getlink-order-agent/types.ts supabase/functions/getlink-order-agent/normalize.ts supabase/functions/getlink-order-agent/rules.ts supabase/functions/getlink-order-agent/matcher.ts supabase/functions/getlink-order-agent/commerce.ts
```

---

### Task 4: Add structured-output LLM adapter without giving AI commercial authority

**Files:**
- Create: `supabase/functions/getlink-order-agent/llm.ts`
- Test: `tests/ai_sales_order_agent_test.ts`

**Interfaces:**
- Consumes `ParsedIntent`, recent bounded context, relevant Tạp hóa candidate names/codes, and alias memory.
- Produces `parseWithModel(input, fetchImpl?): Promise<ParsedIntent>`.
- Environment: `OPENAI_API_KEY`, `ORDER_AGENT_MODEL`; model name remains configuration, not hard-coded business logic.

- [ ] **Step 1: Define a strict JSON schema** matching `ParsedIntent`; include `intent`, `raw_product_text`, `quantity`, `unit_hint`, `attributes`, `line_note`, `reference_target`, `needs_clarification`, and optional `clarification_question_hint`.
- [ ] **Step 2: Call the Responses API with Structured Outputs** using the server-only key and configured model. Send only the latest turn, minimal prior order/list context, and relevant product candidates; never send access tokens, service-role keys, unrelated customer records, or whole chat history.
- [ ] **Step 3: Validate returned JSON again in TypeScript** before use. Invalid/refused/incomplete output becomes a typed `model_unavailable_or_invalid` result; it must not mutate the draft.
- [ ] **Step 4: Make `fetchImpl` injectable** so tests use a local stub and never call a real model provider.
- [ ] **Step 5: Add tests** proving contextual `milo lấy 3 thôi` becomes a change operation, `1 đỏ 1 xanh` can answer an awaiting color clarification, and an invalid model response is rejected.
- [ ] **Step 6: Run Deno tests/check GREEN and commit.**

---

### Task 5: Implement one-turn order-session processor and alias learning

**Files:**
- Create: `supabase/functions/getlink-order-agent/session.ts`
- Create: `supabase/functions/getlink-order-agent/learning.ts`
- Test: `tests/ai_sales_order_agent_test.ts`

**Interfaces:**
- Produces `processTurn(db, claimedTurn, deps): Promise<TurnResult>`.
- Produces `recordCorrection(...)`, `recordConfirmation(...)`, `promoteEligibleStoreAliases(...)`.
- Consumes Tasks 2–4.

- [ ] **Step 1: Load or create one open session** by customer/conversation and load only current draft lines, outstanding clarification, last price-list context, and bounded recent turn metadata.
- [ ] **Step 2: Try deterministic fast path first;** call the LLM only when deterministic parsing/matching cannot safely resolve the turn.
- [ ] **Step 3: Implement draft mutations** add/change/remove without duplicating a product line when the customer clearly revises the existing line. Store customer raw wording and resolution source on each mutation.
- [ ] **Step 4: Implement clarification state.** Missing required color/size/flavor changes session to `awaiting_clarification`; the next matching answer updates that exact line and returns to collecting/quoted state.
- [ ] **Step 5: Implement price queries and lists** without requiring an order mutation. `price_query` returns current Tạp hóa price/change plus eligible market comparison. `price_list` records the sent scope/list codes in session context for `mã P04`, `cái số 4`, etc.
- [ ] **Step 6: Implement confirm flow.** On customer confirmation, re-read every active product and current price, then call the existing native sales RPC/path to create one pending `getlink_sales_orders` order; save `sales_order_id` and transition session `confirmed → handed_off`. Retry with the same session must return the same order id.
- [ ] **Step 7: Implement learning.** Customer/admin clarification or correction inserts `getlink_ai_corrections`, raises confidence on the customer alias, and may promote to store alias only after 3 distinct customer confirmations with zero conflict.
- [ ] **Step 8: Implement round-up state** so a 17-carton session may offer 20 once; a decline records suppression for the rest of that session.
- [ ] **Step 9: Add acceptance tests** for all 13 spec scenarios at module level with fake DB fixtures.
- [ ] **Step 10: Run tests GREEN and commit.**

---

### Task 6: Compose safe Vietnamese replies and deliver them idempotently to Chat

**Files:**
- Create: `supabase/functions/getlink-order-agent/reply.ts`
- Create: `supabase/functions/getlink-order-agent/chat.ts`
- Test: `tests/ai_sales_order_agent_test.ts`

**Interfaces:**
- Produces `composeReply(result, facts): ReplyDraft`.
- Produces `enqueueReply(db, sessionId, turnKey, replyKind, body): Promise<OutboxRow>`.
- Produces `flushReply(db, outboxRow): Promise<string>` returning Chat message id.

- [ ] **Step 1: Build reply from immutable backend facts.** Templates/LLM wording may choose phrasing, but product names, quantities, prices, totals, deltas, market values, and round targets are inserted from `CommercialFacts` after model output.
- [ ] **Step 2: Keep tone contract concise:** polite Vietnamese, normally `Dạ ... ạ`, zero or one emoji, no repeated upsell, no long lecture. Clarification asks only the missing detail.
- [ ] **Step 3: Implement explicit reply kinds** `draft_update|clarification|price|price_list|checkout|round_suggestion|fallback` so outbox uniqueness prevents duplicates.
- [ ] **Step 4: Flush via `getlink_ai_send_chat_message`** using `client_id='ai:'+outbox.id`; mark the outbox sent only after a Chat message id is returned.
- [ ] **Step 5: On send failure, retain pending outbox** and retry delivery without rerunning the order mutation.
- [ ] **Step 6: Add tests** proving a duplicated source message creates one mutation + one reply only and bot/admin replies are not ingested by the customer-message trigger.
- [ ] **Step 7: Run tests GREEN and commit.**

---

### Task 7: Add the Edge Function entrypoint, 4-second debounce, rollout modes, and recovery sweep

**Files:**
- Create: `supabase/functions/getlink-order-agent/index.ts`
- Modify: `.github/workflows/verify.yml`
- Modify: `.github/workflows/smoke-supabase.yml`
- Test: `tests/test_ai_sales_order_agent_contract.py`
- Test: `tests/ai_sales_order_agent_test.ts`

**Interfaces:**
- HTTP `POST /message` accepts only the DB webhook secret plus message/conversation IDs.
- HTTP `POST /sweep` processes stale pending inbox/outbox rows for recovery.
- Environment: `ORDER_AGENT_WEBHOOK_SECRET`, `ORDER_AGENT_MODE=off|shadow|pilot|on`, `ORDER_AGENT_PILOT_CUSTOMER_IDS`, `OPENAI_API_KEY`, `ORDER_AGENT_MODEL`.

- [ ] **Step 1: Add constant-time webhook-secret validation.** Reject missing/invalid secret before any DB read.
- [ ] **Step 2: Implement 4-second debounce.** After webhook arrival, wait only until the conversation has been quiet for 4 seconds, then call `getlink_ai_claim_turn`; simultaneous invocations that lose the atomic claim exit successfully without processing.
- [ ] **Step 3: Implement rollout gates.** `off` only health-checks; `shadow` parses/logs proposed result but sends no reply and creates no customer-visible order; `pilot` processes only configured customer account IDs; `on` processes all eligible customers.
- [ ] **Step 4: Implement `/sweep` recovery** for pending inbox older than 30 seconds and unsent outbox; use the same atomic claim/idempotent delivery paths.
- [ ] **Step 5: Add `/health`** reporting mode and dependency configuration booleans without returning secrets.
- [ ] **Step 6: Extend Verify GETLINK** with Deno check + Deno tests.
- [ ] **Step 7: Extend Supabase smoke workflow** to hit `getlink-order-agent/health` read-only when deployed; do not exercise customer-visible AI replies in CI.
- [ ] **Step 8: Run full local verification and commit.**

Run:
```bash
python -m unittest discover -s tests -v
deno test -A tests/ai_sales_order_agent_test.ts
deno check supabase/functions/getlink-api/index.ts supabase/functions/getlink-orders/index.ts supabase/functions/getlink-order-agent/index.ts
node --check app.js
node --check order-management.js
```

---

### Task 8: Add compact category/all-price-list view for Chat links

**Files:**
- Create: `price-list.html`
- Create: `price-list.js`
- Create: `price-list.css`
- Modify: `supabase/functions/getlink-order-agent/session.ts`
- Test: `tests/test_ai_sales_order_agent_contract.py`

**Interfaces:**
- URL: `https://get.taphoa.xyz/price-list.html?scope=all` or `?scope=group&name=<encoded>`.
- Reads only public/customer-safe catalog fields through existing GETLINK API/public key; never exposes supplier input cost/profit/admin fields.
- Produces stable visible row codes used by the current AI session context.

- [ ] **Step 1: Build a mobile-first read-only list** with product display name, selling price, pack/QC, update time, and short row code; support group/all scope.
- [ ] **Step 2: Ensure price-list API payload excludes supplier cost/profit/admin-only fields.** Add a contract assertion for this boundary.
- [ ] **Step 3: Make the agent send inline rows only for a small result set;** otherwise send the scoped price-list URL and save the same row-code mapping into the AI session.
- [ ] **Step 4: Add deterministic tests** for `gửi giá sữa`, `báo giá toàn bộ`, and follow-up `mã P04 2`/`cái số 4 lấy 3` resolution.
- [ ] **Step 5: Run static/contract tests and commit.**

---

### Task 9: Deploy safely through shadow → pilot → automatic replies

**Files:**
- No product code change unless verification exposes a defect.
- Update: `docs/superpowers/plans/2026-09-12-ai-sales-order-agent-progress.md` with evidence/checkpoints.

**Interfaces:**
- Consumes all GREEN Tasks 1–8.
- Produces a verified production agent with staged enablement.

- [ ] **Step 1: Run full Verify GETLINK locally/CI** and require all existing sales/search/news/scraper tests plus new agent tests GREEN.
- [ ] **Step 2: Apply migration to production Supabase.** Verify RLS, trigger creation, `pg_net`, Vault availability, and RPC grants. Do not insert sample orders into customer accounts.
- [ ] **Step 3: Deploy `getlink-order-agent` with `ORDER_AGENT_MODE=off`.** Configure `OPENAI_API_KEY`, `ORDER_AGENT_MODEL`, and `ORDER_AGENT_WEBHOOK_SECRET` only in Edge Function secrets.
- [ ] **Step 4: Store DB dispatcher values in Vault** as `getlink_order_agent_url` and `getlink_order_agent_webhook_secret`; verify a user Chat insert creates exactly one inbox row and an admin/bot insert creates none.
- [ ] **Step 5: Switch to `shadow`.** Use real incoming customer text to inspect structured intent/candidates/latency without sending replies or creating orders. Review examples including shorthand, misspellings, price questions, and non-sales chat.
- [ ] **Step 6: Fix only demonstrated parser/matcher defects, rerun full verification, then switch to `pilot` for one controlled customer account.**
- [ ] **Step 7: Pilot end-to-end:** multiple lines inside 4 seconds → one turn; add/change/remove; clarification color; price query; category list; full list; confirmation → one pending GETLINK order; repeated webhook → no duplicate order/reply.
- [ ] **Step 8: Enable market comparison in pilot** and verify same-pack + <24h gates with at least one store-higher and one store-lower example. If no eligible reference exists, verify silence rather than fabricated advice.
- [ ] **Step 9: Enable round-number suggestion in pilot** and verify 17→20 suggestion once, 11→no suggestion, decline→no repeat.
- [ ] **Step 10: Switch `ORDER_AGENT_MODE=on` only after pilot evidence is GREEN.** Open PR, require `Verify GETLINK` GREEN, merge only after review, then verify `main` CI/Pages and Edge Function health.

## Self-review

- Spec coverage: natural shorthand, continuous draft, 4-second turn debounce, automatic replies, per-line notes/clarification, category/full price lists, price history, market comparison, round-number suggestion, deterministic fast path, LLM structured path, alias learning, correction audit, draft/session separation, inbox/outbox idempotency, Chat send adapter, failure behavior, security/privacy, observability, and staged rollout all have implementation tasks.
- Placeholder scan: no TBD/TODO or unspecified provider/model hard-code remains; model is an environment value and the API contract is explicit.
- Type consistency: customer/conversation/message/session/order IDs are UUID strings; `product_code` is text; money is full-VND integer; quantities may be numeric; market freshness is 24 hours; quiet debounce is 4 seconds; round target gap is 1–3 cartons.
- Safety boundary: AI never writes canonical order item prices directly; final handoff re-resolves products/prices through existing native sales authority.
