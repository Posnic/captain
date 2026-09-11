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
  /* And the server path needs no device support, so it is offered wherever
     the shop has configured it. */
  assert.equal(Speech.available({ provider: 'server' }), true);
});
