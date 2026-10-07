# Captain branding

Captain uses a teal (#087F8C) serving dish and single tick. Posnic POS retains
its blue smiling receipt; Posnic Business retains its existing Posnic wordmark.
The source artwork is `assets/common/captain-mark.svg`.

Android and iOS build scripts install native assets after Capacitor sync with
`scripts/install-native-branding.js`. Android includes legacy, adaptive and
themed launcher icons. iOS receives an opaque 1024px app icon. Existing native
splash image sizes are preserved. Sign-in and browser favicons use the SVG.

## Verification — 2026-10-07

- Local signed Android 1.3.56 build passed, including translation/package audits.
- Installed on Android 36 emulator; new launcher artwork visually verified.
- Existing 30-language connection/settings layout browser scenario passed.
- POS and Business reference artwork was inspected; their files were not changed.
- Comparison: `artifacts/captain-branding-review.html`.
- Launcher evidence: `artifacts/captain-branding-launcher.png`. The second
  Captain entry with the old Capacitor icon is a separate existing test app.
- Build log: `artifacts/captain-branding-build.log`.
- Browser log: `artifacts/captain-branding-browser.log`.
- iOS build integration is implemented; iOS runtime verification remains pending.
- Release gate: 667 unit tests passed; 973 of 975 browser scenarios passed in
  the full four-worker run (47.5 minutes). Both animation screenshot scenarios
  timed out after their 520ms cleanup timer removed the paused animation during
  screenshot capture. All four tests in that file passed on a one-worker rerun
  without source changes (38.7 seconds).
- Gate evidence: `artifacts/captain-branding-release-checks.log` and
  `artifacts/captain-branding-animation-recheck.log`.
- Prepared for GitHub release `captain-1.3.56-test.1`.
