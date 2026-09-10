# Chat-sourced GETLINK Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove GETLINK-owned login and make every protected GETLINK action depend only on verified identity supplied by the unchanged Chat bridge.

**Architecture:** Keep the existing `getlink-orders` bearer validation and server-side `v21_accounts` role mapping. Change only GETLINK frontend access gating: embedded mode requests/waits for Chat auth; standalone protected actions navigate to Chat. No new token issuer, no password grant, no Chat repo changes.

**Tech Stack:** Vanilla JavaScript, Python `unittest` contract tests, Supabase Edge Functions/Deno verification, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-chat-sourced-getlink-access-design.md`

## Global Constraints

- Do not modify `1sl2tp/chat`.
- GETLINK must not contain username/password login UI or call Supabase password grant.
- No refresh token may be stored or exchanged by GETLINK.
- Public/read-only GETLINK remains usable standalone.
- Protected standalone actions go through `https://chat.taphoa.xyz/`.
- Embedded protected actions request/wait for the existing Chat bridge.
- Backend remains authoritative for `user/admin` role and customer scope.

---

### Task 1: Lock the access contract with RED tests

**Files:**
- Create: `tests/test_getlink_chat_sourced_access.py`

**Interfaces:**
- Consumes: current `order-management.js` text contract.
- Produces: regression tests that reject local login and require Chat-only gating.

- [x] **Step 1: Write failing tests** checking that `chatLogin`, `/auth/v1/token?grant_type=password`, `orderLoginUsername`, `orderLoginPassword`, and `orderLoginSubmit` are absent; that embedded mode calls `requestChatAuth`; that standalone protected access targets `https://chat.taphoa.xyz/`; and that backend-verified `/me` remains the source of account role.
- [x] **Step 2: Run** `python -m unittest tests.test_getlink_chat_sourced_access -v` and confirm failure against current main behavior.
- [x] **Step 3: Commit** the RED contract.

### Task 2: Replace local login with Chat-only access gating

**Files:**
- Modify: `order-management.js`

**Interfaces:**
- Produces: `isEmbeddedInChat(): boolean`, `goToChat(): void`, `waitForChatAuth(timeoutMs=1200): Promise<boolean>`, and `requireChatAuth(): Promise<boolean>`.
- Preserves: `acceptChatBridge`, `requestChatAuth`, `orderFetch`, customer picker, order manager, submit and admin actions.

- [x] **Step 1: Remove local auth ownership**: delete `SUPABASE_ORIGIN`, `normalizeUsername`, `chatLogin`, login inputs/buttons, login-submit handlers and password-specific keyboard handling.
- [x] **Step 2: Add embedded/standalone gate**: embedded mode requests Chat auth and waits up to 1200ms for the verified bridge state; standalone mode navigates to Chat on a protected user action.
- [x] **Step 3: Change manager state**: when embedded but not yet authenticated show `Đang xác thực qua Chat...`; never render a credential form. On 401 clear transient auth and re-enter the same Chat-only gate.
- [x] **Step 4: Preserve protected behavior**: user sends `{items}`; admin sends `{items, customerId}` after customer selection; `/me` continues verifying the bearer server-side.
- [x] **Step 5: Run targeted tests and** `node --check order-management.js`; fix until GREEN.
- [x] **Step 6: Commit** the implementation.

### Task 3: Full verification and production integration

**Files:**
- Modify only build-stamp outputs if `tools/stamp_static_build.py --check` requires them.

**Interfaces:**
- Consumes: GREEN Task 2.
- Produces: merge-ready GETLINK-only change.

- [x] **Step 1: Run static build stamp/check** using the repository's existing script.
- [ ] **Step 2: Run full** `python -m unittest discover -s tests -v`.
- [ ] **Step 3: Run** `node --check app.js`, `node --check order-management.js`, and the workflow's existing Deno checks.
- [ ] **Step 4: Open/update PR and wait for `Verify GETLINK` GREEN.**
- [ ] **Step 5: Confirm no Chat repository commit was made in this slice.**
- [ ] **Step 6: Merge only after GREEN, then verify main and Pages deployment.**
