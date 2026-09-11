/*
 * Where a transcription key is allowed to live.
 *
 * Not on a handset. A key in the app is a key on every waiter's phone, in a
 * file anybody can read, on devices that get lost and sold; it cannot be
 * rotated without reinstalling every one, and a leaked key is billed to the
 * shop until somebody notices.
 *
 * So the app refuses to hold one even if something hands it one. That is the
 * guard these tests exist for: a misconfigured or compromised server must not
 * be able to put a key into a pocket.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
globalThis.localStorage = fakeStorage();

const Speech = require(path.join(__dirname, '..', 'assets', 'common', 'speech.js'));

test('a shop that configured nothing still gets something that works', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  const config = Speech.config();
  assert.equal(config.provider, 'device');
  assert.equal(config.language, 'en-IN');
});

test('the shop can choose the provider', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  assert.equal(Speech.config({ provider: 'server' }).provider, 'server');
  assert.equal(Speech.config({ provider: 'off' }).provider, 'off');
});

test('a key sent by a server is dropped, not stored', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  const config = Speech.config({ provider: 'server', apiKey: 'sk-secret', api_key: 'x', secret: 'y' });
  assert.equal(config.provider, 'server');
  assert.equal(config.apiKey, undefined, 'a key reached the handset');
  assert.equal(config.api_key, undefined);
  assert.equal(config.secret, undefined);
});

test('a key cannot be written into the device settings either', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  Speech.configure({ provider: 'server', apiKey: 'sk-secret' });
  const raw = globalThis.localStorage.getItem(Speech.STORE) || '';
  assert.ok(!raw.includes('sk-secret'), 'a key was written to device storage');
  assert.equal(Speech.config().apiKey, undefined);
});

test('this device overrides the shop, so one handset can be changed', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  Speech.configure({ provider: 'off' });
  assert.equal(Speech.config({ provider: 'server' }).provider, 'off');
});

test('voice turned off means no microphone at all', () => {
  globalThis.localStorage.removeItem(Speech.STORE);
  assert.equal(Speech.available({ provider: 'off' }), false);
});

test('the server path still needs a device that can RECORD', () => {
  /*
   * The shop having configured a provider says nothing about this handset.
   * Answering yes on the strength of the setting alone draws a microphone
   * button on a device with no MediaRecorder, and the waiter finds that out
   * by pressing it at a table.
   */
  globalThis.localStorage.removeItem(Speech.STORE);
  assert.equal(Speech.canRecord(), false, 'node has no MediaRecorder; the test is meaningless');
  assert.equal(Speech.available({ provider: 'server' }), false);

  /* defineProperty, not assignment: node exposes `navigator` as a read-only
     global, so `globalThis.navigator = ...` silently does nothing and the
     test would pass by measuring the wrong thing. */
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: {} },
  });
  globalThis.MediaRecorder = function () {};
  try {
    assert.equal(Speech.available({ provider: 'server' }), true);
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
    else delete globalThis.navigator;
    delete globalThis.MediaRecorder;
  }
});
