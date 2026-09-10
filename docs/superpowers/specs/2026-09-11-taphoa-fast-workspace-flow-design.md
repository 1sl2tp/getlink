# TAPHOA Fast Workspace Flow — GETLINK Tạp hóa

Date: 2026-09-11
Status: DESIGN LOCK — awaiting implementation
Base: `main` at `74820efb9573d6e21253f8219751cca3697c552a`
Scope: GETLINK Tạp hóa only. No Chat/Call auth change, no Siêu thị/Tin tức business UI, no backend table redesign.

## 1. Goal

Make GETLINK Tạp hóa operate like the fast TAPHOA sales flow: the user stays in one workspace, keeps customer context, changes quantity with minimal taps, can preview the current cart/order immediately, and moves between Sales / Orders / Debt without opening a second app-like overlay.

The TAPHOA reference behavior that must be preserved conceptually:
- selected customer is part of sales state and survives a successful submit; submit clears cart/edit state, not customer selection;
- quantity changes happen directly in product rows and in the cart;
- one action area changes by state: normal = Clear / Pending / Done; editing = Cancel / Update;
- pending orders are newest-first;
- order detail is one tap from the list and edit returns the order into Sales;
- debt drills from customer → transaction → linked order.

GETLINK keeps its own existing data model, Chat identity and order/debt backend. TAPHOA is interaction/reference only.

## 2. Information architecture

### Global source tabs
Keep the existing top-level modes:
- Tạp hóa
- Siêu thị
- Tin tức

`Đơn` and `Công nợ` belong only to **Tạp hóa**. They must not appear as global management for Siêu thị or Tin tức.

### Tạp hóa sub-workspace
Inside Tạp hóa, use one persistent sub-navigation:
- **Bán**
- **Đơn**
- **Công nợ**

No separate `Bán hàng` modal/overlay on desktop. The current `orderManager` overlay becomes an inline workspace surface on desktop. Mobile may use full-screen drill-down where needed, but it must remain the same Tạp hóa state tree, not a second management app.

## 3. Desktop geometry

Desktop uses the available width instead of constraining management into a narrow right overlay.

### Bán
Three regions:
1. **Left:** category/group navigation.
2. **Center:** search + product list + direct quantity controls.
3. **Right:** persistent customer context + selected cart/order preview + action bar.

The right panel is the single owner of sales actions. Do not duplicate `Chọn khách`, `Xóa`, `Bán nhanh`, `Gửi đơn`, `Hủy`, or `Cập nhật` elsewhere.

### Đơn
Two regions:
1. **Left/main:** filter, date range, source summary, newest-first order list.
2. **Right:** selected order detail and lifecycle actions.

No modal for ordinary order inspection. Clicking an order changes the right detail panel immediately.

### Công nợ
Two regions:
1. **Left/main:** debt customer list, default sorted by most recent debt transaction first.
2. **Right:** selected customer debt timeline; clicking a linked transaction opens its order detail in the same right panel.

## 4. Mobile geometry

Mobile remains one-column and fast-touch:
- Tạp hóa sub-nav stays accessible without opening a modal.
- Sales product list is primary.
- Customer + cart summary is compact/sticky near the action area.
- `Giỏ/Xem đơn` opens a single full-width sheet/surface; no nested overlay inside an overlay.
- Orders show newest first; tap row → detail; back returns to the same scroll/filter position.
- Debt: customer → timeline → linked order, preserving back context.

Touch target remains about 44px for meaningful controls, but density is preserved by reducing non-interactive whitespace rather than enlarging cards.

## 5. Customer state ownership

`selectedCustomerId` is a Tạp hóa sales-workspace state, not a one-submit temporary value.

Rules:
- selecting a customer persists it in the current Chat/GETLINK session;
- **Gửi đơn success:** clear cart only; keep selected customer;
- **Bán nhanh success:** clear cart only; keep selected customer;
- **Cập nhật đơn success:** exit edit state; keep selected customer of the edited order;
- **Hủy sửa:** exit edit state and clear edit cart; keep customer unless the user explicitly changes it;
- changing Chat account clears customer if account identity actually changes;
- invalid/deleted customer is cleared after customer refresh;
- User role does not show customer picker because identity itself is the customer.

There must be exactly one customer selector in Sales. Orders/Debt may display customer names, but they do not create a second competing selected-customer state.

## 6. Sales action state machine

### Normal state
Right action region:
- `Xóa` — clear current cart only.
- `Bán nhanh` — Admin only; create delivered order immediately.
- `Gửi đơn` — create pending order.

### Editing state
Same region changes to:
- `Hủy`
- `Cập nhật`

Do not leave normal submit buttons visible while editing.

### Busy state
A submit must never fail silently because of `if (busy) return`.

When submit starts:
- disable the relevant action buttons;
- change the initiating label to `Đang gửi…`, `Đang bán…`, or `Đang cập nhật…`;
- repeated taps are ignored while disabled;
- on success, show compact inline status with the created/updated `#mã đơn`;
- on error, restore the buttons and keep cart/customer unchanged.

After successful Gửi/Bán, do **not** automatically open a management overlay. Stay in Sales so the next order for the same customer can be entered immediately. `Đơn` is one explicit tap away.

## 7. Fast interaction rules inherited from TAPHOA

- Search updates the product list locally/realtime without Enter.
- `− 0 +` remains visible for quantity even at zero.
- Product row quantity changes immediately; no row-tap side effect.
- Selected lines are visible in the cart preview immediately.
- Cart supports quantity editing without returning to product search.
- Order edit loads the same order back into Sales on the same `order_id` / `#mã đơn`.
- Normal task should need one obvious tap per state transition; avoid confirmation except destructive actions.
- Destructive meaning remains locked: pending `Xóa` deletes pending; delivered `Xóa` means return/reversal, not physical deletion.

## 8. Ordering / recency

Anything whose primary meaning is chronological defaults to newest/recent first:
- order lists: `submitted_at DESC`, then `order_no DESC`;
- delivered/returned views use their lifecycle timestamp where relevant but retain newest visible first;
- debt customer list: `lastOccurredAt DESC` by default;
- debt timeline UI: newest transaction displayed first.

Running debt balance remains mathematically correct. If backend timeline is chronological for balance calculation, calculate `balanceAfter` in chronological order first, then reverse only the rendered rows.

Optional alternate debt sorts may exist later, but default is **gần nhất trước**.

## 9. Money display

Dense business UI must not show the old `475.000 ₫` / `475.000 đ` style when the stored VND value is 475000.

Use compact-thousand display:
- `475000` → `475`
- `475500` → `475.5`
- `1000000` → `1.000`
- `1250000` → `1.250`

Rules:
- divide stored VND by 1000 for display in Tạp hóa Sales / Orders / Debt dense surfaces;
- no `đ`, `₫`, or `.000` suffix;
- keep Vietnamese thousands grouping for the compact value;
- preserve `.5` when the value is a half-thousand;
- numbers right-align with tabular numerals where possible;
- backend/database values remain full VND integers; formatting is display-only.

## 10. Remove duplicate/obsolete UI ownership

The following current patterns must be removed or converted, not hidden behind another layer:
- injected desktop `orderManager` modal as the normal Orders/Debt surface;
- duplicate work navigation (`Quản lý` strip plus another `Đơn hàng/Công nợ` navigation inside modal);
- duplicate customer picker entry inside manager when Sales already owns customer selection;
- post-submit `clearSelectedCustomer()` calls;
- post-submit automatic `openManager()` behavior;
- silent busy-return UX.

No parallel replacement state tree is allowed. Existing order/debt functions are reused underneath the new inline surfaces.

## 11. Files / boundaries

Expected frontend scope:
- `app.js` — expose/host Tạp hóa workspace mode and Sales context hooks if needed.
- `style.css` — desktop/mobile Tạp hóa workspace geometry and Sales layout.
- `order-management.js` — convert modal renderer into inline Orders/Debt renderer; state ownership, customer persistence, busy labels, recency rendering, compact money format.
- `order-management.css` — inline Orders/Debt geometry and responsive styles.
- focused tests + build/version stamp.

Backend changes are not expected unless implementation proves a missing server contract. Do not modify Chat/Call/session model, product crawler, Siêu thị or Tin tức logic.

## 12. Verification gates

RED contracts before production edits:
1. Tạp hóa-only `Bán | Đơn | Công nợ` ownership.
2. no desktop modal as normal manager route.
3. customer is not cleared after send/quick/update/cancel-edit.
4. submit exposes visible busy/disabled state rather than silent return.
5. successful send/quick remains in Sales and preserves customer.
6. newest-first order + debt customer + debt timeline rendering.
7. compact money formatter examples and absence of `₫`/` đ` in business surfaces.
8. existing business/auth contracts still pass.

Then JS syntax, full Python suite, Deno/backend contracts, Supabase-only gates, exact-SHA CI, PR diff review, merge only verified head, and post-merge Verify + Pages/Smoke.

No manual live-click claim unless an actual browser E2E is performed.