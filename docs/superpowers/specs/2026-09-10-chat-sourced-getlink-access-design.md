# Chat-sourced GETLINK access design

## Goal

Keep Chat unchanged and make GETLINK a dependent module that consumes Chat identity for protected actions without owning account creation, password login, role management, or refresh-token lifecycle.

## Architecture

Chat remains the source of identity and the existing iframe bridge remains unchanged. GETLINK accepts the short-lived Chat/Supabase access token only as an input credential. `getlink-orders` validates the bearer with Supabase Auth, resolves `v21_accounts` server-side, and derives GETLINK module permission: Chat `user` -> GETLINK `user`; Chat `admin` -> GETLINK `admin`. This permission exists only inside GETLINK and never mutates Chat.

No second signed GETLINK token is introduced now: the verified Chat bearer plus server-derived role already provides the required module authorization with less complexity. GETLINK never owns a refresh token.

## Embedded behavior

1. GETLINK loads in the existing Chat iframe.
2. GETLINK requests the current auth payload from the unchanged Chat bridge.
3. The received bearer is verified through `GET /getlink-orders/me` before GETLINK stores transient auth state.
4. Protected UI is enabled according to the verified role.
5. While waiting for the bridge, protected actions show only `Đang xác thực qua Chat...` and retry; no username/password form is rendered.
6. Rejected or expired credentials clear transient GETLINK auth and return to the waiting-for-Chat state.

## Standalone behavior

Public/read-only product, supermarket and news views remain available. GETLINK has no independent login. If a standalone visitor invokes `Gửi đơn`, `Đơn hàng`, customer selection, or another protected action without verified Chat auth, GETLINK navigates to `https://chat.taphoa.xyz/`. Protected use therefore happens through Chat; there is no return-handoff feature because Chat must remain unchanged.

## Permission behavior

- `user`: backend derives the customer from the verified Chat account; browser cannot choose another customer; only own orders are returned.
- `admin`: backend verifies admin role, allows listing Chat `role=user` accounts, customer selection, all Chat-linked orders, delivery approval, return and pending-order deletion.
- Browser account/role snapshots are display-only. Authorization always comes from bearer validation plus server-side `v21_accounts` lookup.

## Security boundaries

- No Supabase password-grant call remains in GETLINK.
- No GETLINK username/password fields or account-creation path remain.
- No refresh token enters GETLINK.
- Existing exact-origin Chat bridge is reused unchanged.
- Order mutation RPCs stay service-role-only behind `getlink-orders`.
- On 401, transient GETLINK auth is cleared before any further protected action.

## Files

Only `1sl2tp/getlink` changes:

- `order-management.js`: remove local login and replace fallback with Chat-only access gating.
- `tests/test_getlink_chat_sourced_access.py`: regression contracts.
- static build metadata/stamp files only if required by the existing build gate.

`1sl2tp/chat`: no file changes.

## Verification

- Targeted access tests.
- Full GETLINK unit suite.
- `node --check order-management.js`.
- Existing `deno check supabase/functions/getlink-orders/index.ts` gate.
- Verify that Chat main SHA is unchanged throughout this slice.
