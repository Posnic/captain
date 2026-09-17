'use strict';

/*
 * A TILL THAT MOVED IS FOUND AGAIN, BY ITSELF.
 *
 * Owner: "ethernet when mobile app its 192.168.1.2 but after restart
 * 192.168.1.18... all mobile apps now not working." And then the part that
 * matters more than the bug: "every time non tech people saying its not
 * working. very annoying i cant explain them wifi and all. i want reliaant."
 *
 * What happened. The shop's router hands the till a DHCP lease, and on every
 * restart it hands out a different one - .2, then .18, then .11. Each handset
 * has the old address saved. Every request fails. Every screen is dead.
 *
 * Why it STAYED dead is the actual fault. The app has a good subnet sweep that
 * finds the till with no internet and no router configuration, and it was
 * allowed to run only on the sign-in screen. The reasoning was that a sweep
 * takes seconds and would stall a screen a waiter is holding. True about the
 * cost, wrong about when it is paid: by the time every known address has
 * failed there is no working screen left to stall, and the phone is already
 * showing the offline overlay.
 *
 * So the cure existed, sat behind a flag, and the only way to reach it was to
 * sign out and back in - which nobody can be expected to guess, and which is
 * exactly the kind of instruction that cannot be given over the phone to
 * somebody carrying plates.
 *
 * A waiter must never be told anything about Wi-Fi. That is the requirement.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');

/**
 * config.js in a fake browser, with a shop already set up.
 *
 * `answers` decides what each address says: `true` is a healthy till, anything
 * else is silence. `saved` is what this handset had stored before the till
 * moved.
 */
function load(answers, saved) {
  const asked = [];
  const storage = new Map();
  if (saved) storage.set('posnic.server', JSON.stringify(saved));

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Promise,
    Error,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Map,
    Set,
    RegExp,
    AbortController,
    URL,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    navigator: { onLine: true },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    sessionStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    location: { origin: 'http://localhost', protocol: 'http:', hostname: 'localhost' },
    document: {
      addEventListener() {},
      removeEventListener() {},
      readyState: 'loading',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      /* Going offline builds the overlay. Nothing here looks at it, but it
         has to be buildable or the code under test throws on the way past. */
      createElement: () => ({
        style: {},
        classList: { add() {}, remove() {} },
        setAttribute() {},
        addEventListener() {},
        appendChild() {},
        querySelector: () => ({ addEventListener() {} }),
        innerHTML: '',
      }),
      body: { appendChild() {} },
      documentElement: { classList: { add() {}, remove() {} } },
    },
    documentElement: { classList: { add() {}, remove() {} } },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    XMLHttpRequest: undefined,
    fetch: async (url) => {
      asked.push(String(url));
      if (answers(String(url)) === true) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ apiSchema: 1, edition: 'test', version: '1.0.0' }),
        };
      }
      throw new Error('connection refused');
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { POSNIC: sandbox.POSNIC, asked };
}

const WAS_AT = 'http://192.168.1.2:5555';
const MOVED_TO = 'http://192.168.1.11:5555';

const onlyAt = (live) => (url) => url.startsWith(live);

test('THE PHONE FINDS THE TILL AGAIN WITHOUT ANYBODY TOUCHING IT', async () => {
  /*
   * The whole point. No sign out, no Change server, no reading an address off
   * the till, nobody told about Wi-Fi. A scheduled check - `manual` false, the
   * one the app runs on its own - has to be enough.
   */
  const { POSNIC } = load(onlyAt(MOVED_TO), { lan: WAS_AT, active: WAS_AT });

  const found = await POSNIC.net.check(false);

  assert.strictEqual(found, true, 'the phone gave up instead of looking for the till');
  assert.strictEqual(
    POSNIC.server.baseUrl,
    MOVED_TO + '/api',
    'it did not move onto the address the till is actually on'
  );
});

test('and it remembers, so the next screen does not search again', async () => {
  const { POSNIC, asked } = load(onlyAt(MOVED_TO), { lan: WAS_AT, active: WAS_AT });

  await POSNIC.net.check(false);
  const afterFinding = asked.length;

  await POSNIC.net.check(false);

  assert.ok(
    asked.length - afterFinding < 5,
    `the second check swept again (${asked.length - afterFinding} requests)`
  );
});

test('A SHOP GENUINELY OFF THE NETWORK IS NOT SWEPT FLAT', async () => {
  /*
   * The reason this is rate limited rather than free. A phone left in a drawer
   * on a dead network would otherwise probe sixty addresses on every scheduled
   * check until the battery is gone, which is its own support call.
   */
  const { POSNIC, asked } = load(() => false, { lan: WAS_AT, active: WAS_AT });

  await POSNIC.net.check(false);
  const afterFirst = asked.length;
  assert.ok(afterFirst > 20, 'the first failure did not look for the till at all');

  await POSNIC.net.check(false);

  assert.ok(
    asked.length - afterFirst < 10,
    `it swept again straight away (${asked.length - afterFirst} requests)`
  );
});

test('a manual check always searches, however recently one ran', async () => {
  /*
   * Somebody pressing Try now is asking for the expensive thing on purpose,
   * and being told "not yet" by a rate limiter they cannot see is the worst
   * possible answer to a deliberate request.
   */
  const { POSNIC, asked } = load(() => false, { lan: WAS_AT, active: WAS_AT });

  await POSNIC.net.check(false);
  const afterAuto = asked.length;

  await POSNIC.net.check(true);

  assert.ok(asked.length - afterAuto > 20, 'Try now did nothing the automatic check had not');
});
