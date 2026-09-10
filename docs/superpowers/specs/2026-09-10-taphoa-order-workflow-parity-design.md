# GETLINK Tạp hóa Order Workflow Parity Design

## Purpose

Use the existing `taphoaxyz` screens only as the behavioral/presentation reference for the Tạp hóa workflow. GETLINK remains the only implementation and data owner for this work. Do not call TAPHOAXYZ, migrate to TAPHOAXYZ, or create a second order core.

## Locked flow

`Tạp hóa → cart selection → Gửi đơn / Bán nhanh → Đơn tạm → Đã giao → Đã hoàn → Công nợ`.

A User pressing **Gửi đơn** creates one real pending order with its own numeric `orderNo`. The cart clears only after the backend confirms success. Multiple pending orders per User are allowed.

An Admin may use **Gửi đơn** to create a pending order for a selected User, or **Bán nhanh** to create and deliver the order atomically. A quick sale immediately appears in Đã giao and creates the same debt event as a normal delivery.

## Identity and permissions

Chat remains the identity owner. GETLINK receives the current Chat bearer only as the existing handoff; there is no second GETLINK login/session.

### User

User can:
- browse Tạp hóa, change quantity, clear the current cart, and Gửi đơn;
- see only their own orders in Đơn tạm / Đã giao / Đã hoàn;
- open order detail;
- edit their own pending order;
- delete their own pending order;
- delete all of their own pending orders from the pending tab;
- see only their own debt ledger and running balance.

User cannot:
- see other customers or their orders/debt;
- see cost/profit;
- Bán nhanh;
- deliver or return orders;
- record payments/debt adjustments for other customers.

### Admin

Admin can:
- choose a User customer;
- create pending orders or Bán nhanh;
- see all orders and all debt customers;
- edit/delete any pending order;
- delete all pending orders in the current pending scope;
- deliver pending orders;
- return delivered orders and reverse their debt;
- record customer payments.

## Presentation

The order list must remain an order list, not a product list. Each collapsed row/card shows:
- prominent `#orderNo`;
- customer name for Admin only;
- submitted time;
- number of lines and total quantity;
- total money;
- `Xem đơn`.

Products appear only after `Xem đơn`. Pending detail actions are:
- User: `Sửa | Xóa`;
- Admin: `Sửa | Đã giao | Xóa`.

Delivered detail exposes `Đã hoàn` only to Admin. Returned orders are read-only.

The pending tab header exposes `Xóa tất cả` when at least one pending order is visible. The operation follows the current actor scope: User deletes only their own pending orders; Admin deletes all pending orders visible to Admin.

## Edit behavior

`Sửa` does not create a separate editor. It closes the order manager, loads the selected pending order back into the existing Tạp hóa cart owner (`app.js`), and switches the cart action state to `Hủy | Cập nhật đơn`.

`Cập nhật đơn` preserves the same order id/order number/customer and replaces only the pending order lines/totals from current authoritative supplier product data. Editing is forbidden after delivery/return.

`Hủy` exits edit mode and clears the temporary cart without mutating the saved order.

## Cart ownership

`app.js` is the sole owner of Tạp hóa quantity state and rendering. `order-management.js` may request `load`, `clear`, and read selected items through exported cart APIs, but must not write the quantity localStorage key itself.

Normal cart actions:
- User: `Xóa | Gửi đơn`;
- Admin: `Xóa | Gửi đơn | Bán nhanh`.

Edit cart actions:
- User/Admin: `Hủy | Cập nhật đơn`.

## Cross-device consistency

Admin and User must not keep independent stale order lists. While the order/debt manager is open and the page is visible, GETLINK performs a lightweight revision check. It reloads order/debt data only when the server fingerprint changes. It also checks on focus/visibility return.

This preserves the existing security boundary: clients still read business data through `getlink-orders`; no direct table CRUD or new GETLINK auth authority is introduced.

## Backend commands

Keep the existing `getlink_sales_*` tables. Add service-role-only database functions for:
- updating a pending order with actor ownership checks;
- deleting one pending order with actor ownership checks;
- deleting all pending orders within actor scope;
- creating an Admin quick sale atomically by create + deliver.

The Edge Function remains the authorization gateway. User ownership is always checked server-side.

## Non-goals

Do not modify Chat, Call, crawler, supermarket/news behavior, supplier pricing rules, or TAPHOAXYZ. Do not add printing/sharing in this pass.