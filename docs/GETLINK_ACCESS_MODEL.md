# GETLINK access model

GETLINK is one application. Embedding or opening it from Chat does not create a second GETLINK application mode.

## Identity states

Sales/account identity has exactly three states:

- `guest`: no verified account is present.
- `user`: a verified active Chat account with role `user` is present.
- `admin`: a verified active Chat account with role `admin` is present.

The source of the identity is metadata, not a fourth state. At present authenticated sales identity is supplied by Chat. GETLINK reuses the current Chat access token, verifies it server-side against `v21_accounts`, and maps the verified account to `user` or `admin`.

GETLINK must not perform a second username/password sign-in, create another Supabase auth session, or maintain a separate GETLINK user account for this flow.

## Standalone GETLINK

Public GETLINK functions such as product browsing, supermarket data and news may run while identity is `guest`. Protected sales actions require a verified account. If GETLINK is opened inside Chat, the already signed-in Chat account is used automatically.

## `appRole` is not identity

The existing `appRole` variable in `app.js` controls catalog/admin presentation and legacy maintenance surfaces. It is not the account login state and must not be used as the source of sales authorization.

Sales authorization is represented by `window.GETLINK_ACCESS_CONTEXT`, whose state is only `guest`, `user`, or `admin`.

## Boundary

Chat owns account authentication. GETLINK owns GETLINK UI and business logic. The integration boundary should stay thin: Chat may host/open GETLINK and provide the current authenticated identity; GETLINK verifies that identity and handles the rest of its own behavior.
