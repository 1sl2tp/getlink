# Tạp hóa order workflow parity — implementation progress

Feature branch: `feature/taphoa-order-workflow-parity`

## Implemented and verified

- Task 1: existing GETLINK sales core retained; pending update/delete/delete-all, Admin quick sale and scoped sync contracts added.
- Task 2: `app.js` remains the only cart owner and can load an existing pending order back into Tạp hóa using canonical product keys.
- Task 3: User/Admin pending-order actions, edit round-trip, clear cart, Admin quick sale, delete-all pending and order-level detail hierarchy implemented.
- Task 4: lightweight scoped order/debt revision checks implemented and baseline seeded after normal manager refresh.
- Existing sales-core compatibility markers were preserved so the prior GETLINK contracts remain valid alongside the added workflow.
- Generated `__pycache__/*.pyc` artifacts were removed and `.gitignore` prevents them from re-entering commits.
- Temporary one-shot patch/cleanup helpers and workflows are absent from the final branch tree.
- PR Verify passed full Python tests, JS syntax, Deno checks, node contract tests and Supabase-only gate.
- Production migration was applied successfully. New mutation/sync RPCs are service-role-only; anon/authenticated cannot execute them directly.
- `getlink-orders` production Edge Function was deployed as version 5 from the verified branch source and re-read after deployment.
- Production business data was not modified by verification; no fake test orders were inserted because the identity order number sequence is non-transactional across rollback.

## Remaining release gate

Merge the exact verified head into `main`, then require main Verify and Pages deployment to pass before declaring the release complete.
