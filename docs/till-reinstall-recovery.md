# Reconnecting Captain after a till reinstall

A reinstall which replaces the local database removes `captain_sessions`. The
phone still has the issuing URL, session ID, HMAC route key and renewal token.
The route-proof endpoint correctly returns UNKNOWN_AUTHORITY (404). Previously
the transport swallowed that response as OFFLINE, leaving the app retrying a
session the till no longer knew. Reinstalling Captain appeared to fix this
because it discarded the stale credentials and ran setup again.

Captain now asks for explicit sign-in at the saved issuing URL when that exact
response occurs. No bearer, refresh token or order is sent before proof succeeds.
A discovered alternative URL returning the same response remains untrusted.
Network timeouts do not trigger this recovery. Device revocation remains blocked.
Password-only sessions also offer sign-in when the saved token is rejected with
401 and no refresh credential exists, including a changed desktop signing key.

After validated same-shop, same-staff, same-branch login, replacement credentials
remove the previous installation's pairing secrets and offline lease. A blocked
primary session is cleared only by validated replacement. Separate connection
credentials and phone order storage are retained. Different identities remain
rejected by the existing identity guard.

If the desktop address changed, select the correct till using Search this Wi-Fi
or scan its QR and authenticate. If a fresh database has different shop/staff/
branch IDs, old work must not be silently assigned to it. This change does not
promise unattended reauthentication or automatic replay of ambiguous sends.

## Synchronization and rollout

Only Captain's existing secure local credential state changes; no business data,
sync collection, cloud schema, Gateway or sync-agent changes are needed. Session
secrets must remain local and must not be synchronized. The fix requires an
updated Captain APK; existing POS route-proof and password-login APIs suffice.
The browser regression simulates a replaced till session database, reconnects
through the displayed login, and checks retained local data. Secure-session tests
also check old secret removal, reload, separate connections and pending work.
Actual uninstall/reinstall on a client till/phone has not been verified.
