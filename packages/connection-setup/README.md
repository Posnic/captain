# @posnic/connection-setup

Shared connection setup presentation for Captain, Posnic POS, Posnic Business
and future apps. Version 0.1.0 is consumed directly by Captain and can be
installed in another repository from an npm tarball. It has no runtime
dependencies in browser/core usage. React and React Native are optional peers
for the native entry point only.

## Boundary

This package owns the welcome content, method definitions, icon paths,
translated labels and accessible method rows. The browser and React Native
renderers share that model. App names, logos, theme colours and supported
methods are supplied by the host. The Posnic symbol identifies Cloud sign-in;
it does not replace an app's own logo.

The host owns discovery, QR camera permissions/parsing, pairing requests,
browser SSO, staff sign-in, secure storage, connection priority, network
switching, retries, shop/branch verification and queued-order ownership.
Selecting a method invokes a callback; it never authenticates or changes a
server. No credentials are accepted by this package. No localStorage keys,
Captain globals, Capacitor plugins, URLs or account scopes are shared across
apps. A discovered server is still untrusted until the host verifies it.

## Install in another repository

From this package directory:

```sh
npm pack --pack-destination ../../artifacts
```

In the consuming repository, install the resulting
`posnic-connection-setup-0.1.0.tgz`, commit its lockfile, and pin the version.
No registry publishing is required. The tarball contains its runtime assets,
declarations and licence. Do not link another developer's absolute checkout
path in an app's package.json.

## Browser / Electron / Capacitor

```js
import {mountMethods} from '@posnic/connection-setup/browser';
import '@posnic/connection-setup/styles.css';
// Resolve/copy the exported SVG with your bundler's asset mechanism.
const dispose = mountMethods(document.querySelector('#connections'), {
  supported: ['wifi', 'qr', 'cloud', 'code', 'address'],
  wifiAvailable: true,
  translate: key => translations.t(key),
  posnicLogo: bundledPosnicLogoUrl,
  onSelect: method => appConnectionActions[method]()
});
// Call on unmount. Existing app authentication remains in the action adapter.
dispose();
```

Classic-script consumers load `index.js`, then `browser.js`, then their adapter.
They expose `PosnicConnectionSetup` and `PosnicConnectionSetupUI`. For existing
screens, `decorateMethod(button, descriptor, {posnicLogo})` preserves the
button, ID and event handlers. It is repeatable and replaces only its contents.
Captain uses this API in `assets/common/setup-flow.js`.

Keep Wi-Fi as the primary method when available. Selecting Cloud opens
`cloudRoles({translate})`: owner/admin sign-in through Posnic without a shop
address, or staff sign-in using the shop address and that shop's credentials.
Render these descriptors with `decorateMethod`; host callbacks own both flows.
Choosing a role is presentation only and never grants permissions.

`renderWelcome(container, {name, logo, translate, steps, copy, onContinue})`
returns a cleanup function. Put it in your own dialog or page, with your own
back handling and persistence. `copy` can override `title`, `eyebrow`,
`description`, and `continueLabel`; a desktop till should supply desktop copy.
All caller-provided copy is rendered as text, never HTML.

Provide CSS tokens `--surface`, `--surface-sunk`, `--ink`, `--ink-soft`,
`--line`, `--accent`, `--accent-ink`. Optional artwork tokens are `--setup-teal`
and `--setup-tint`. Styles are scoped to the module. Set `dir` on the host for
RTL. Reduced motion is respected. Ship both scripts and the SVG at their
runtime URLs; checking just source-file existence is insufficient for an APK.

## React Native / Expo (POS Mobile and Business)

```tsx
import {ConnectionMethods, ConnectionWelcome} from '@posnic/connection-setup/native';
import {icons} from '@posnic/connection-setup';

<ConnectionMethods
  supported={['cloud', 'qr', 'address']}
  translate={t}
  theme={appConnectionTheme}
  renderIcon={renderAppConnectionIcon}
  onSelect={method => connectionActions[method]()}
/>
```

`renderIcon(name, color, size)` returns your native icon node. For `posnic`,
render the Posnic mark; for other names use exported `icons[name]` with your
existing SVG library or equivalent app icons. Mirror `arrow` in RTL. This
avoids imposing an icon or SVG dependency on future apps. For
`ConnectionWelcome`, pass the app's own raster/native `logo` source, name,
steps, translation function and `onContinue`. Wrap it in the app's ScrollView
and safe area. Supply light/dark theme colours explicitly; the module does not
change device appearance. Native font scaling remains enabled.

Core-only consumers can import `methods()` and `welcome()` without loading a
DOM, React or React Native. An app must explicitly pass supported methods;
only expose methods its adapter can actually complete. Wi-Fi availability
affects recommendations, never persisted switching settings.

## Adoption status

Captain uses the package now. Its Cloud action uses owner/admin approval to find the shop, then requires the shop staff login. The Cloud method description is translated by the host. POS and Business adapters have **not** been
replaced or released. Their authentication endpoints, permissions and account
scopes must be wired separately before enabling these screens. The native
entry point is reusable presentation, not a claim that Captain's staff login
works for an owner/manager app.

## Validation

From the Captain repository, run the `connection-setup-package` node and
Playwright tests and `captain-onboarding.spec.js`. The app build verifies the
packaged scripts and brand asset. Native consumers should also typecheck and
exercise their actual navigation and authentication adapters before release.
