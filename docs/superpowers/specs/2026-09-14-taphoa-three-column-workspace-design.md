# Tạp hóa three-column workspace architecture

Date: 2026-09-14
Status: Approved in chat for implementation planning
Scope: GETLINK → Tạp hóa desktop workspace. Mobile remains a separate layout and is not implemented by shrinking the desktop grid.

## 1. Problem statement

The current Tạp hóa desktop UI visually resembles a three-column workspace, but the DOM and state ownership are not truly three-column. `order-management.js`, `taphoa-workspace-feedback.js`, and `taphoa-hot-path-runtime.js` each move, hide, rebuild, or observe overlapping regions. In particular:

- the category/source rail can be hidden by one owner and re-parented by another;
- `Theo nguồn` is created inside the order list and then moved into a left rail after render;
- selecting an order can rebuild list DOM instead of only changing selection and detail;
- MutationObservers listen across large areas and can turn a local click into multiple layout/re-render cycles;
- scroll ownership is split across nested wrappers, so rebuilding or moving DOM can cause visible jank or jumps;
- the Tạp hóa hot path can still inherit catalog-wide state even though Siêu thị and Tin tức are unrelated to the current sales interaction.

This architecture replaces those implicit relationships with one explicit desktop shell and three permanent slots.

## 2. Locked desktop shell

`GETLINK → Tạp hóa` owns one persistent desktop workspace:

```text
GETLINK HEADER                                  FIXED
[ Tạp hóa ] [ Siêu thị ] [ Tin tức ]

TẠP HÓA WORKSPACE
┌─────────────────┬──────────────────────────┬─────────────────────────────┐
│ LEFT RAIL       │ MASTER LIST              │ DETAIL PANE                 │
│ context/nav     │ primary working list     │ selected object / actions   │
│                 │                          │                             │
│ Bán: Danh mục   │ Bán: Sản phẩm            │ Bán: Đơn đang lên           │
│ Đơn: Theo nguồn │ Đơn: Danh sách đơn       │ Đơn: Hóa đơn chi tiết       │
│ Công nợ: KH     │ Công nợ: DS/timeline     │ Công nợ: Chi tiết/số dư     │
├─────────────────┴──────────────────────────┴─────────────────────────────┤
│ [ Bán ]                    [ Đơn ]                    [ Công nợ ]          │
└──────────────────────────────────────────────────────────────────────────┘
BOTTOM WORK NAV                                FIXED
```

The three columns are not recreated when switching Bán / Đơn / Công nợ. Only the content mounted into each slot changes.

## 3. Single ownership rule

The shell has exactly one owner. Proposed DOM contract:

```html
<section id="taphoaDesktopWorkspace" data-view="sales|orders|debts">
  <aside id="taphoaLeftRail"></aside>
  <main id="taphoaMasterList"></main>
  <aside id="taphoaDetailPane"></aside>
  <nav id="taphoaBottomNav"></nav>
</section>
```

Rules:

1. `taphoaLeftRail` owns all left-column content.
2. `taphoaMasterList` owns all list/search result content.
3. `taphoaDetailPane` owns all selected-item detail and fixed detail actions.
4. `taphoaBottomNav` owns only Bán / Đơn / Công nợ.
5. No feature may create content in one slot and later move it to another with `appendChild`, `replaceChildren`, `insertAdjacentElement`, or equivalent re-parenting.
6. Legacy nodes may be read as data sources during migration, but must not remain active visual owners after the new shell mounts.
7. One user action may update only the state owners it actually changes.

## 4. Scroll ownership

Desktop scroll behavior is locked as follows:

- page/body: no Tạp hóa content scroll;
- GETLINK top navigation: fixed;
- Tạp hóa top controls for the active view: fixed inside the workspace;
- bottom Bán / Đơn / Công nợ navigation: fixed to the workspace bottom;
- left rail: one independent native scroll owner;
- master list: one independent native scroll owner;
- detail pane: one independent native scroll owner;
- no nested list scroll container inside another active list scroll container;
- no code path may reset another column's `scrollTop` because data changed elsewhere;
- selecting an item in the master list must preserve the master-list scroll position;
- infinite load appends to the existing master-list DOM and must not reconstruct the list root.

No scroll-position patching should be needed in the normal path. If preserving `scrollTop` manually becomes necessary, that is treated as evidence that an owner is still being rebuilt incorrectly.

## 5. View mapping

### 5.1 Bán

**Left rail**
- product categories / groups;
- local filters that belong specifically to Tạp hóa;
- no Siêu thị or Tin tức controls.

**Master list**
- Tạp hóa product search;
- product rows;
- price shown as the single sale price used by the sales workflow;
- quantity controls;
- note input where required;
- manual add entry only when the Tạp hóa search has no matching product.

**Detail pane**
- selected customer / customer context;
- current order preview;
- selected line count and total product quantity;
- send / update / cancel actions according to the active sales mode.

### 5.2 Đơn

**Left rail**
- `Theo nguồn` summary and source drill-down;
- it is rendered directly here by the left-rail owner;
- it must never first exist inside the list and then be moved left.

**Master list**
- order status tabs and search/time controls at the top of the master region;
- compact order index below;
- each row shows customer as primary identity;
- STT is separate from order code;
- line count and product quantity are explicit;
- selecting an order changes only selected state plus the detail pane.

**Detail pane**
- complete invoice-like order detail;
- customer, date/time, STT, order code;
- item table;
- line count and product quantity;
- total;
- fixed actions appropriate to status, e.g. Sửa / Đã giao / Xóa;
- customer reassignment stays an Admin action and does not belong to list ownership.

### 5.3 Công nợ

**Left rail**
- customer/debt navigation and customer selection.

**Master list**
- customer debt transactions / timeline list;
- native independent scrolling.

**Detail pane**
- selected transaction/order/debt detail;
- running balance / `Dư nợ sau giao dịch` where applicable;
- actions that already belong to debt management.

## 6. Performance architecture

### 6.1 Tạp hóa-only in-memory index

Tạp hóa sales search must operate on a Tạp hóa-only RAM index. It must not iterate the full Siêu thị or Tin tức data sets on each input event.

Index lifecycle:
- build after the Tạp hóa catalog is available;
- update incrementally when a manual product is added or a product row changes;
- invalidate only when the Tạp hóa product data source actually changes;
- search normalization remains accent-insensitive and realtime.

### 6.2 Quantity hot path

A `+` or `−` action updates:
- the quantity for that row in RAM;
- that row's quantity DOM;
- aggregate selected-line / total-product counters;
- current order preview data only if needed.

It must not:
- scan every product row;
- parse the entire localStorage cart repeatedly;
- render the product workspace;
- trigger global mutation-driven synchronization.

### 6.3 Order selection hot path

Clicking one order updates:
- previous selected row class/ARIA state;
- new selected row class/ARIA state;
- `taphoaDetailPane` contents.

It must not:
- replace all order row nodes;
- rebuild the master-list root;
- move `Theo nguồn`;
- trigger catalog/product rendering;
- reset list scroll.

### 6.4 Manual product add

When the Tạp hóa search returns no result, Admin may add a product. On success:
- the API response is inserted directly into the Tạp hóa RAM index/cache;
- the current search result is updated immediately;
- no full catalog reload occurs;
- the add form uses Tạp hóa product fields only and does not expose unrelated source/catalog fields.

The exact persisted fields remain subject to the existing product API and data model; this architecture does not redefine backend business data.

## 7. State boundaries

Use one small view state object for shell navigation and selection, conceptually:

```js
{
  view: "sales" | "orders" | "debts",
  left: { ...view-specific local filters... },
  master: { query, filter, selectedId, scrollOwner },
  detail: { selectedId },
  cart: { quantities, notes, selectedCustomerId }
}
```

Existing backend order/debt authority remains unchanged. UI state is not business authority.

The master list and detail pane communicate through an ID, not through DOM traversal or DOM relocation.

## 8. Observer policy

MutationObserver is not a state manager.

Allowed uses:
- temporary compatibility detection while legacy modules are being migrated;
- narrow observation of a stable host when no direct lifecycle callback exists.

Forbidden uses in hot paths:
- observing the entire desktop workspace to infer selection changes;
- re-rendering list/detail because the renderer itself mutated the DOM;
- moving source reports between columns in response to DOM mutations;
- coordinating Bán / Đơn / Công nợ state through broad DOM observation.

The end state should use explicit calls/events from the actual owner rather than observer-driven synchronization.

## 9. Migration strategy

Implementation should be incremental but architecture-first:

1. Add the permanent three-column shell and fixed bottom nav without changing backend business logic.
2. Move Bán into the shell using existing product/cart functions as data sources.
3. Move Đơn into the shell; render `Theo nguồn` directly in the left rail, compact order index in master, invoice in detail.
4. Move Công nợ into the shell.
5. Remove compatibility DOM-moving code and broad observers made obsolete by the shell.
6. Remove duplicate/legacy visual owners only after each view has parity tests.

Do not keep the current experimental approach of stacking more runtime hotfix layers onto legacy visual ownership.

The existing `fix/order-source-left-owner` PR is considered an experimental diagnostic branch, not the implementation base for this architecture.

## 10. Mobile boundary

Mobile remains a separate layout and keeps the mobile-first interaction already established for the project. This desktop architecture must not be implemented by shrinking the three columns to mobile widths.

Shared data/state helpers are allowed. Shared desktop geometry is not.

## 11. Testing strategy

Tests must protect ownership and performance, not only visible strings.

Required contracts:

- desktop shell exposes exactly one left/master/detail owner;
- switching Bán / Đơn / Công nợ keeps the same shell nodes;
- no `Theo nguồn` DOM re-parenting after order render;
- order selection does not replace order-list row nodes;
- order selection does not change master-list `scrollTop`;
- quantity change updates one row and RAM counters without full render;
- Tạp hóa search consumes the Tạp hóa RAM index, not global catalog arrays;
- infinite loading appends rows without replacing the list root;
- manual product add inserts returned product without full catalog reload;
- each desktop column has one scroll owner;
- parent workspace/body does not become the Tạp hóa scroll owner;
- existing order/debt backend and permission tests stay green;
- mobile contract tests stay green.

Browser-level regression tests should cover repeated rapid order clicks and repeated `+` clicks, because the reported failures are interaction/jank failures rather than only static markup errors.

## 12. Acceptance criteria

Desktop is accepted when:

1. At ≥1000px the user clearly sees three stable Tạp hóa columns.
2. Bán maps to `Danh mục | Sản phẩm | Đơn đang lên`.
3. Đơn maps to `Theo nguồn | Danh sách đơn | Hóa đơn chi tiết`.
4. Công nợ maps to `Khách hàng | Danh sách/timeline | Chi tiết`.
5. Top GETLINK navigation and bottom Tạp hóa navigation stay fixed.
6. Each column scrolls independently and naturally.
7. Selecting orders rapidly does not visibly lag, jump, or rebuild the list.
8. Scrolling deep in a list and selecting an item does not jump the list to the top.
9. Tạp hóa product search and quantity controls feel local and immediate and do not involve Siêu thị/Tin tức data.
10. `Theo nguồn` is always owned by and visible in the left rail on the Đơn view.
11. No new business logic is introduced for orders, debt, permissions, or pricing as part of this layout refactor.

## 13. Out of scope

- redesigning Siêu thị;
- redesigning Tin tức;
- changing Supabase order/debt authority;
- changing customer-group business rules;
- adding new product classification logic;
- changing mobile into a three-column layout;
- visual restyling unrelated to clarifying the three-column ownership.
