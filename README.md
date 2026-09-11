# Captain for Posnic POS

The mobile order-taking companion for
[Posnic open-source POS and billing software](https://www.posnic.com/).
Restaurant floor staff can take an order at the table, send it to the kitchen,
manage KOTs and look up what a table has already had. Captain talks to the
[Posnic/POS](https://github.com/Posnic/POS) server, either the till on the
shop's own Wi-Fi or the shop's cloud address.

Android and iOS, built with Capacitor. Source under AGPL-3.0.

**[Download the latest build](../../releases/latest)** - APK for Android, IPA
for iOS.

## Which server the app talks to

The app is not shipped pointing at one address. It chooses, in this order, and
re-chooses whenever the one it is on stops answering:

1. **A pinned address.** Set in Server settings (the gear on the login screen).
   An explicit choice is never overridden.
2. **The shop's own server on this Wi-Fi.** Fastest, and keeps working when the
   shop's internet is down. Found by asking `/api/runtime-info`: a Posnic
   server identifies itself there, so a printer answering on port 5555 is not
   mistaken for a till.
3. **The shop's online address.** A shop code becomes
   `https://<code>.posnic.io/api`; a shop on its own domain can be entered in
   full.

A request that fails because the Wi-Fi dropped mid-service is retried once
against the other address rather than surfacing as an error.

**The app will only move itself onto a server it has proved holds the same
shop.** Signing in records a shop key against the address it came from; an
address whose recorded key does not match is offered to the user but never
selected on its own. Two Posnic tills on one estate's Wi-Fi is not
hypothetical.

### Setting it up on a handset

- On the shop Wi-Fi: open Server settings and tap **Find server on this Wi-Fi**.
- Away from the shop, or with no till on the network: type the **shop code**
  (for example `azure`) and tap Test, then Save & Use.
- **Automatic** clears a pin and lets the app choose between the two again.

### The client

Everything hangs off one global, `POSNIC`, in `config.js`:

| | |
|---|---|
| `POSNIC.server` | which address, and how it is chosen |
| `POSNIC.session` | the credential from sign-in |
| `POSNIC.api` | `get` / `post` / `raw`, throwing `ApiError` |
| `POSNIC.net` | reachability and the offline overlay |

Nothing else in the app builds a URL, attaches a credential, or decides what a
failure means. Call `POSNIC.api` and handle an `ApiError`, which carries a
machine-readable `code` so a caller branches on the reason rather than matching
English against a message.

State lives in two localStorage keys, `posnic.server` and `posnic.session`.

### What the server has to provide

`POST /api/users/kioskMobileLogin` returns a bearer-token grant:

```json
{ "tokenType": "Bearer", "token": "...", "expiresIn": 86400,
  "shopKey": "...", "user": { "id": "...", "name": "..." }, "branches": [] }
```

and ordinary HTTP for failures: `400` missing credentials, `401` wrong
credentials, `429` locked out (with `Retry-After`), `500` our fault. The order,
KOT and history routes refuse an anonymous caller, so without the token the app
signs in and then loads nothing.

## Offline

Every script and stylesheet is served from the app itself; nothing is fetched
from a CDN. That is enforced by `tests/offline-first.spec.js`, because a single
`<script src="https://...">` silently disables every Bootstrap modal on the KOT
and order-history screens when the shop's internet is out.

## Tests

```powershell
npm.cmd install
npx.cmd playwright test
```

## Building it yourself

Both platforms build with whatever credentials are present, so an unsigned
build always works and needs nothing set up.

### Android

Needs a JDK 17+ and the Android SDK (platform 34, build-tools 34.0.0).
`build-apk.js` finds a toolchain under `.android-build-tools/`, in
`ANDROID_HOME`, or where Android Studio puts one.

```bash
npm install
node build-apk.js            # debug
node build-apk.js --release  # signed; needs npm run setup:release-signing
```

### iOS

macOS only: an iOS binary is produced by Xcode, and Apple ships Xcode for
nothing else.

```bash
npm install
node build-ipa.js            # unsigned unless IOS_TEAM_ID and friends are set
```

An unsigned build proves the app compiles and produces an inspectable `.ipa`.
It will not install on a device; that needs a distribution certificate.

### Releases

Tagging builds both platforms and publishes them where people can download
them without a GitHub account:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Signing in CI is by repository secret, never a file in the repo:
`ANDROID_KEYSTORE_BASE64` and friends for Android, `IOS_CERT_P12` and friends
for iOS. Absent, the release carries clearly-labelled unsigned builds.

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE).
