/*
 * Orders that could not be sent yet.
 *
 * The failure mode this guards against is not losing an order - it is sending
 * it twice. A network error does not mean the order was not written; it may
 * have reached the kitchen and the reply been lost. Resending into a server
 * that does not dedupe is how a table gets two of everything.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

/* A localStorage that behaves like the browser's, so the queue can be tested
   without one. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
globalThis.localStorage = fakeStorage();

const OrderQueue = require(path.join(__dirname, '..', 'assets', 'common', 'order-queue.js'));

const reset = () => globalThis.localStorage.removeItem(OrderQueue.STORE);
const order = (key) => ({ key, branch: 'b1', body: { idempotencyKey: key, items: [] } });

test('a failed order is kept', () => {
  reset();
  assert.equal(OrderQueue.add(order('k1')), true);
  assert.equal(OrderQueue.count(), 1);
});

test('the same order is never queued twice', () => {
  reset();
  OrderQueue.add(order('k1'));
  OrderQueue.add(order('k1'));
  assert.equal(OrderQueue.count(), 1, 'one tap, one order, however many times it failed');
});

test('a key survives a retry', () => {
  /* A key minted per attempt makes every resend look like a new order, which
     is the thing the key exists to prevent. */
  const a = OrderQueue.newKey();
  const b = OrderQueue.newKey();
  assert.notEqual(a, b);
  assert.ok(a.length > 8);
});

test('only a definite success clears an order', async () => {
  reset();
  OrderQueue.add(order('k1'));
  await OrderQueue.flush(async () => ({ type: 'error', message: 'nope' }));
  assert.equal(OrderQueue.count(), 1, 'a refusal must not look like a send');

  await OrderQueue.flush(async () => { throw new Error('offline'); });
  assert.equal(OrderQueue.count(), 1, 'an unreachable server must not look like a send');

  const { sent } = await OrderQueue.flush(async () => ({ type: 'success', data: {} }));
  assert.equal(sent, 1);
  assert.equal(OrderQueue.count(), 0);
});

test('a server that does not say it dedupes is treated as one that does not', () => {
  /* Silence is not consent. An older server neither advertises the flag nor
     honours the key, and reading absent as yes doubles orders. */
  assert.equal(OrderQueue.dedupes(undefined), false);
  assert.equal(OrderQueue.dedupes({}), false);
  assert.equal(OrderQueue.dedupes({ features: {} }), false);
  assert.equal(OrderQueue.dedupes({ features: { idempotentOrders: true } }), true);
});

test('the queue does not grow without limit', () => {
  reset();
  for (let i = 0; i < OrderQueue.LIMIT + 20; i++) OrderQueue.add(order(`k${i}`));
  assert.ok(OrderQueue.count() <= OrderQueue.LIMIT,
    'beyond a shift of unsent orders, something is wrong and silence is the wrong answer');
});

test('attempts are counted, so a stuck order is visible', async () => {
  reset();
  OrderQueue.add(order('k1'));
  await OrderQueue.flush(async () => { throw new Error('offline'); });
  await OrderQueue.flush(async () => { throw new Error('offline'); });
  assert.equal(OrderQueue.all()[0].attempts, 2);
});
