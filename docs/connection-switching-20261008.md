# Connection switching — 8 October 2026

Implements the approved automatic/manual connection mockup on top of the
existing authenticated route transport and durable order queue.

- Saved automatic/manual preference is preserved. New setup continues to
  default to automatic switching as already approved. Manual mode now considers
  saved alternatives but requires confirmation before transmitting through them.
- One shared sheet handles Wi-Fi-to-internet and internet-to-Wi-Fi. Staff may
  enable automatic switching in the confirmation. Declining suppresses repeated
  prompts while the current connection works; a new outage can ask again.
- Native Wi-Fi state is read with an 800 ms bound. Disconnected Wi-Fi routes are
  skipped. Android's Connect to Wi-Fi action opens the phone's Wi-Fi settings.
- Normal requests prefer the working route. Idle health checks consider the
  configured preferred route. Returning Wi-Fi requires three separated successful
  checks, at least six seconds apart in total. Normal health ticks are 20 seconds;
  while on internet with Wi-Fi attached they run every five seconds.
  A failed check resets stability. Explicit cloud-first priority is respected.
- Health checks defer adoption while foreground requests are in flight. An
  unavailable till and unavailable Wi-Fi both permit verified internet fallback.
- Cryptographic route proof, session ownership, order authority and replay rules
  remain in place. An ambiguous non-replayable payment is not sent again through
  another route. An idempotent order keeps its original key and body.
- A discovered address is not presented as the new saved till until its
  authenticated session check succeeds. Local IP changes within the same verified
  shop route do not require an internet-switch confirmation.

## Evidence and remaining work

- 669 unit tests passed after the final token-refresh protection fix:
  `artifacts/switch-all-unit-final.log`.
- Initial onboarding/consent run: 70 passed, two recovery cases failed. Both
  corrected cases passed: `artifacts/switch-onboarding-recheck.log`.
- Routing/sheet follow-up: `artifacts/switch-routing-final.log` (final result
  recorded in coverage ledger).
- Phone/tablet light/dark sheet captures:
  `test-artifacts/connection-switch-{320,390,768}-{light,dark}.png`.
- Android Java compilation passed: `artifacts/switch-native-final.log`.
- Twelve new messages are translated in all 30 catalogs (AWS initial translations,
  Tamil and Nepali authored separately). Catalog checks pass: 1,258 messages per
  language, placeholders intact and no uncovered source strings. This is not a
  claim of professional native-speaker review in every language.
- All-language 320px confirmation layout and complete button bounds passed:
  `artifacts/switch-language-bounds.log`. The eleven consent/stability and
  phone/tablet theme cases passed in `artifacts/switch-translated-check.log`;
  that run's language-loop fixture was corrected and passed the separate rerun.
- Native Android confirmation, persisted automatic-switch choice, disconnected
  Wi-Fi detection and opening Android Wi-Fi settings passed on the isolated
  emulator: `artifacts/switch-native-evidence.json`. This uses an instrumented
  debug APK built from the same source; no customer credentials or transactions.
- Signed local testing APK 1.3.57:
  `artifacts/captain-1.3.57-switching-test.apk`, SHA-256
  `1ecd8aa78cefe244bea228e198ed19be2615f5225e0eb11912c7f55a7511ee91`.
  Normal release build and signature verification passed. Build alone is not
  counted as network runtime verification.
- Foreground-request protection now also covers token refresh and the retried
  request; a regression test verifies that background adoption remains blocked.
- Physical phone roaming/till outage and iOS runtime checks are not verified.
- Release gate: all 986 browser scenarios passed (366 completed before a test
  server restart, then all remaining 620 including initial failures passed).
  Vite accumulated navigation delays during the first run; the resumed run served
  the identical application files from a plain local HTTP server. Two layout
  assertions now measure spacing around the approved connection-status row.
  Evidence: `artifacts/switch-release-browser-resumed.log` and
  `artifacts/switch-gate-completed.txt`.
- The published package is rebuilt after the source commit so its About screen
  identifies the release source. The earlier local APK hash above is retained as
  local-test evidence; published APK checksums are in the release's SHA256SUMS.
- Publication status and download links are recorded in the coverage ledger.
