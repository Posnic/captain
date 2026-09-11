/*
 * Orders that could not be sent yet.
 *
 * A waiter taps send, the till is off or the Wi-Fi dropped, and the order has
 * to go somewhere. Until now it stayed in the cart and the waiter stood there
 * retrying; the items were never lost, but the person was stuck.
 *
 * So a failed order is kept, and sent when the network comes back. Two rules
 * make that safe rather than reckless:
 *
 * ONE. Every order carries a key, generated before the first attempt and
 * reused on every retry. The server returns the order that already exists
 * instead of writing a second one, so a resend cannot double a ticket.
 *
 * TWO. A resend only happens by itself when the server is known to honour
 * that key. A network error does not mean the order was not written - it may
 * have reached the kitchen and the reply been lost - so against a server that
 * does not dedupe, sending again is how a table gets two of everything. On
 * those, the orders wait and a person decides, having been told plainly.
 *
 * Nothing here throws. An order queue that can fail is worse than none,
 * because the failure happens where the order was supposed to be kept.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OrderQueue = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const STORE = 'posnic.pending-orders';
  /* A shift's worth. Beyond this something is badly wrong and the right
     answer is not to accumulate silently. */
  const LIMIT = 50;

  function read() {
    try {
      const rows = JSON.parse(localStorage.getItem(STORE) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  function write(rows) {
    try {
      localStorage.setItem(STORE, JSON.stringify(rows.slice(0, LIMIT)));
    } catch (e) {
      /* Storage full or blocked. The order is still in the cart. */
    }
  }

  /**
   * A key that survives a retry.
   *
   * Made before the first attempt, never regenerated: a key minted per attempt
   * would make every retry look like a new order, which is the bug this whole
   * file exists to avoid.
   */
  function newKey() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const all = () => read();
  const count = () => read().length;

  /** Keep an order that could not be sent. */
  function add(order) {
    if (!order || !order.key) return false;
    const rows = read();
    if (rows.some((row) => row.key === order.key)) return false;
    rows.push({ ...order, at: Date.now(), attempts: 0 });
    write(rows);
    return true;
  }

  function remove(key) {
    write(read().filter((row) => row.key !== key));
  }

  function noteAttempt(key) {
    const rows = read();
    const row = rows.find((r) => r.key === key);
    if (row) row.attempts = (row.attempts || 0) + 1;
    write(rows);
  }

  /**
   * Does this server return the existing order instead of writing a second?
   *
   * Read from what the server says about itself rather than assumed. Absent
   * means no: an older server neither advertises the flag nor honours the key,
   * and treating silence as yes is how a kitchen gets two of everything.
   *
   * @param {object} runtime the /runtime-info payload
   */
  const dedupes = (runtime) =>
    !!(runtime && runtime.features && runtime.features.idempotentOrders);

  /**
   * Try to send everything waiting.
   *
   * @param {(order: object) => Promise<any>} send  performs one order
   * @returns {Promise<{sent: number, left: number}>}
   */
  async function flush(send) {
    const rows = read();
    let sent = 0;

    for (const row of rows) {
      try {
        noteAttempt(row.key);
        const result = await send(row);
        /* Only a definite success clears it. Anything else leaves the order
           waiting, which is the safe direction: a queued order somebody can
           see beats an order quietly dropped. */
        if (result && result.type === 'success') {
          remove(row.key);
          sent += 1;
        }
      } catch (e) {
        /* Still unreachable, or refused. Either way it stays. */
      }
    }
    return { sent, left: count() };
  }

  return { newKey, add, remove, all, count, flush, dedupes, STORE, LIMIT };
});
