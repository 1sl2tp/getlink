# Tạp hóa order workflow parity — implementation progress

Feature branch: `feature/taphoa-order-workflow-parity`

## Implemented before full verification

- Task 1: existing GETLINK sales core retained; pending update/delete/delete-all, Admin quick sale and scoped sync contracts added.
- Task 2: `app.js` remains the only cart owner and can load an existing pending order back into Tạp hóa using canonical product keys.
- Task 3: User/Admin pending-order actions, edit round-trip, clear cart, Admin quick sale, delete-all pending and order-level detail hierarchy implemented.
- Task 4: lightweight scoped order/debt revision checks implemented and baseline seeded after normal manager refresh.
- Existing sales-core compatibility markers were preserved so the prior GETLINK contracts remain valid alongside the added workflow.
- Generated `__pycache__/*.pyc` artifacts were removed and `.gitignore` now prevents them from re-entering commits.
- The cleanup gate ran the full Python suite, JS syntax, Deno checks, node contract tests and Supabase-only gate successfully before committing cleanup.
- Temporary one-shot patch/cleanup helpers and workflows are absent from the final branch tree.

## Remaining release gate

Task 5 remains open: fresh PR Verify on this human-authored head, diff audit, production database transaction proof/migration, exact `getlink-orders` deployment, exact verified-head merge, then main CI + Pages verification.
