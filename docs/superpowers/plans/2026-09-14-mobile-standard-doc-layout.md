# Mobile Standard Document Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the GETLINK/Tạp hóa mobile workflow to match the user-provided five-page mobile reference without shrinking the desktop workspace.

**Architecture:** Keep the existing catalog/order/debt data owners and APIs. Add one mobile-only presentation owner loaded after `order-management.js`; it reuses existing DOM actions (`data-order-customer-select`, `data-work-qty`, `mobileUserSendOrder`, quick sale, existing order/debt manager) and never watches the DOM with `MutationObserver`. CSS below 640px owns geometry; desktop files and APIs stay unchanged.

**Tech Stack:** Static HTML/CSS/JavaScript, existing GETLINK order manager, Python unittest/static contract tests, GitHub Actions Verify GETLINK.

**Spec:** User-provided `Tài liệu không có tiêu đề (3).docx`, especially pages 1–5: mobile has one primary column; Sales is customer → product search → categories → compact rows (name, selling price, quantity) → cart → Đặt/Bán; Orders is search/time → Đã giao/Đơn tạm → compact list; Debts is search/summary → customer → transaction history/order detail; two actions divide evenly, three actions give more width to the primary action.

## Global Constraints

- Mobile is a separate layout; do not shrink desktop into mobile.
- Mobile width contract is `<640px`; desktop presentation remains untouched.
- Reuse existing order/debt APIs and existing cart quantity state; no new backend contract.
- Do not use `MutationObserver` or any self-triggering DOM reconciliation loop.
- Keep `Tạp hóa / Siêu thị / Tin tức` source switching available; the document standard applies to the Tạp hóa sales/order/debt flow.
- Preserve current realtime search, order creation, quick sale, edit, debt timeline, and customer picker behavior.

---

### Task 1: Lock the mobile document contract

**Files:**
- Create: `tests/test_mobile_standard_document_layout.py`
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Consumes: existing `index.html`, `app.js`, `order-management.js`.
- Produces: a static contract that rejects mid-screen Bán/Đơn/Công nợ navigation, permanent four-action sale bars, image-heavy Tạp hóa rows, and any MutationObserver-based mobile owner.

- [ ] **Step 1: Write the failing test** that requires the new mobile JS/CSS bootstrap, customer-first row, cart sheet, bottom work nav, compact Tạp hóa rows, order delivered/pending priority, debt search surface, and explicit absence of `MutationObserver` in the new owner.
- [ ] **Step 2: Run the focused test** and verify RED because the new assets do not exist on baseline.
- [ ] **Step 3: Add the focused test to `Verify GETLINK`** after the current layout tests.

### Task 2: Build the mobile-only presentation owner

**Files:**
- Create: `taphoa-mobile-standard.js`
- Create: `taphoa-mobile-standard.css`

**Interfaces:**
- Consumes: `window.userWorkSelectedItems()`, `data-work-qty`, `data-order-customer-select`, `#mobileUserSendOrder`, `[data-order-cart-action="quick"]`, `[data-order-cart-action="clear"]`, `[data-order-cart-action="update"]`, `.taphoa-work-nav.mobile`, `#orderManager`.
- Produces: `#mobileStandardCustomer`, `#mobileStandardCartBar`, `#mobileStandardCartSheet`, `#mobileStandardDebtSearch` and document-level event sync without a DOM observer.

- [ ] **Step 1: Mount once** after existing runtime owners, creating a customer-first row and moving the existing mobile Tạp hóa nav to the end of the mobile workspace.
- [ ] **Step 2: Build the cart bar** as `Giỏ | tổng | Đặt | Bán`; route Đặt to the existing send action and Bán to existing quick sale. During order editing, route the primary action to existing update instead of creating a duplicate order.
- [ ] **Step 3: Build the cart sheet** from `window.userWorkSelectedItems()` with name, unit price, `− SL +`, line total, total quantity, total money and `Xóa | Đặt | Bán`; quantity buttons retain existing `data-work-qty` contract.
- [ ] **Step 4: Add debt search** that filters the already-rendered debt customer list locally and is shown only on the debt customer-summary screen.
- [ ] **Step 5: Sync only from explicit events** (`click`, `input`, `getlink-access-change`, resize, visibility/load). No MutationObserver, no polling loop.

### Task 3: Lock mobile geometry to the document

**Files:**
- Modify: `taphoa-mobile-standard.css`

**Interfaces:**
- Consumes: existing mobile catalog/order/debt markup.
- Produces: one-column Tạp hóa mobile geometry and bottom action/navigation ownership.

- [ ] **Step 1: Make Tạp hóa rows compact**: hide the product image only for own-store rows, show name/QC + selling price + quantity, and when quantity is zero show only `+`; selected rows show `− SL +`.
- [ ] **Step 2: Remove the legacy permanent sale footer from view** and make the new document cart bar the only mobile sale footer.
- [ ] **Step 3: Place Bán/Đơn/Công nợ at the bottom** of the Tạp hóa mobile workspace, not between filters and product rows.
- [ ] **Step 4: Make Orders document-like**: search/time first, show `Đã giao` then `Đơn tạm`, de-emphasize/hide `Đã hoàn` on mobile, and keep each list row compact with customer/order/date/amount.
- [ ] **Step 5: Make Debts document-like**: search + compact summary/customer list first; opening a customer shows timeline/history and linked order detail; payment form remains contextual.

### Task 4: Bootstrap and static build ownership

**Files:**
- Modify: `index.html`
- Modify: `tools/stamp_static_build.py`
- Modify: `version.json` via `python tools/stamp_static_build.py`

**Interfaces:**
- Consumes: new mobile JS/CSS.
- Produces: cache-busted production bootstrap with mobile assets included in static build hashing.

- [ ] **Step 1: Load the new CSS and JS after `order-management`** so existing data/action owners initialize first.
- [ ] **Step 2: Add both assets to `ASSETS` and version metadata.**
- [ ] **Step 3: Stamp the build** and verify `python tools/stamp_static_build.py --check` passes.

### Task 5: Regression and integration gate

**Files:**
- Test only unless a regression is found.

**Interfaces:**
- Consumes: final branch tree.
- Produces: mergeable PR only after exact-head verification.

- [ ] **Step 1: Run focused mobile contract test.**
- [ ] **Step 2: Run existing mobile contracts, order/debt contracts, JS syntax checks, and static build check.**
- [ ] **Step 3: Run the repository Verify GETLINK workflow on the exact final head.**
- [ ] **Step 4: Review the PR diff for desktop/backend scope leakage.**
- [ ] **Step 5: Merge only after the exact-head gate is green; then verify the merge commit and Pages deployment before calling production updated.**
