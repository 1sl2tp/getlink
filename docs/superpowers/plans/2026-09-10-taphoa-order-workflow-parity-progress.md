# Tạp hóa order workflow parity — implementation progress

Feature branch: `feature/taphoa-order-workflow-parity`

## Implemented before full verification

- Task 1: existing GETLINK sales core retained; pending update/delete/delete-all, Admin quick sale and scoped sync contracts added.
- Task 2: `app.js` remains the only cart owner and can load an existing pending order back into Tạp hóa using canonical product keys.
- Task 3: User/Admin pending-order actions, edit round-trip, clear cart, Admin quick sale, delete-all pending and order-level detail hierarchy implemented.
- Task 4: lightweight scoped order/debt revision checks implemented and baseline seeded after normal manager refresh.
- Temporary one-shot patch helpers/workflows were deleted by the implementation commits and must not appear in the final PR diff.

## Remaining release gate

Task 5 remains open: full repository verification, diff audit, production database transaction proof/migration, exact `getlink-orders` deployment, exact verified-head merge, then main CI + Pages verification.
