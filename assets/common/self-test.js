/*
 * Can this handset reach that server, and if not, what stopped it.
 *
 * WHY A SCREEN IS NOT ENOUGH. A shop's phone failed to reach an address that
 * the same phone's browser loaded instantly. Finding out why took a day of
 * photographs of an error message read back over a chat: each round cost a
 * release, an install, and somebody's afternoon, and every answer was one line
 * long. The thing that was missing was never cleverness. It was a way to run
 * the question on a real handset and read the whole answer.
 *
 * So the app can answer it itself, out loud:
 *
 *   - a waiter or a shopkeeper opens Test connection and reads one line
 *   - a build on an emulator runs it unattended and CI reads the same line
 *     out of logcat, which is what stops the next one of these being a day
 *
 * It probes an address and reports. It changes nothing, saves nothing, and
 * needs no credential - there is nothing here a stranger could not learn by
 * typing the address into a browser.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SelfTest = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /* The tag CI greps for. One line, machine-readable, and still legible to a
     person reading a log over somebody's shoulder. */
  const TAG = 'POSNIC_SELFTEST';

  /**
   * Everything worth knowing about one attempt.
   *
   * The environment as well as the result, because "it failed" and "it failed
   * on this Android, in this WebView, through this transport" are different
   * reports, and only the second one ever ends an investigation.
   */
  async function run(url) {
    const started = Date.now();
    const report = {
      url,
      build: (root.POSNIC_BUILD && root.POSNIC_BUILD.version) || 'dev',
      commit: (root.POSNIC_BUILD && root.POSNIC_BUILD.commit) || '',
      native: !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform()),
      transport: root.POSNIC && POSNIC.discovery.probe.transport
        ? POSNIC.discovery.probe.transport()
        : 'unknown',
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      origin: root.location ? root.location.origin : '',
    };

    try {
      const hit = await POSNIC.discovery.probe(url, 8000);
      report.ok = !!hit;
      report.base = hit ? hit.base : null;
      report.edition = hit && hit.info ? hit.info.edition : null;
      report.road = POSNIC.discovery.probe.usedRoad || 'first';
      report.why = hit ? null : POSNIC.discovery.probe.lastFailure;
    } catch (e) {
      report.ok = false;
      report.threw = String((e && e.message) || e);
    }

    report.seconds = Math.round((Date.now() - started) / 100) / 10;

    /* One line, so a log with a thousand others in it is still greppable. */
    console.log(TAG + ' ' + JSON.stringify(report));
    return report;
  }

  /**
   * Run it because the URL said to.
   *
   * `?selftest=https://shop.posnic.io/api` - which is how an emulator with no
   * hands runs the same test a person would, and how CI reads the answer.
   * Nothing happens without that parameter.
   */
  async function fromLocation() {
    try {
      const asked = new URLSearchParams(root.location.search).get('selftest');
      if (!asked) return null;
      return await run(asked);
    } catch (e) {
      return null;
    }
  }

  return { run, fromLocation, TAG };
});
