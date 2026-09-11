/*
 * Telling somebody an order has not reached the kitchen yet.
 *
 * A queue nobody can see is worse than no queue: the waiter believes the
 * order went, the kitchen never cooks it, and the first anyone knows is a
 * customer asking where their food is. So the count sits on screen until it
 * is zero, and it says what it means - "not yet with the kitchen", not
 * "pending", which reads as somebody else's problem.
 *
 * Sending again is only automatic where the server is known to return the
 * order that already exists rather than writing a second one. Where it is
 * not, the orders wait for a person, because a silent resend against a server
 * that does not dedupe is how a table gets two of everything.
 */

(function () {
  'use strict';

  const BAR_ID = 'posnic-unsent';
  let capable = null; // null = not yet known

  async function serverDedupes() {
    if (capable !== null) return capable;
    try {
      const hit = await POSNIC.discovery.probe(POSNIC.server.baseUrl, 3000);
      capable = hit ? OrderQueue.dedupes(hit.info) : false;
    } catch (e) {
      capable = false;
    }
    return capable;
  }

  const sendOne = (row) => POSNIC.api.post('/sales/qrOrder', row.body);

  function bar() {
    let element = document.getElementById(BAR_ID);
    if (element) return element;

    element = document.createElement('div');
    element.id = BAR_ID;
    element.hidden = true;
    element.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      'z-index:2147483000',
      'background:#b45309',
      'color:#fff',
      'padding:10px 14px',
      'font:600 13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif',
      'align-items:center',
      'gap:10px',
      /* display is set by show()/hide(), never here. An inline display beats
         the browser's rule for [hidden], so a bar set hidden would still be
         laid out - invisible, full width, across the bottom of the screen,
         swallowing taps meant for the Place Order button underneath it. */
      'display:none',
    ].join(';');
    element.innerHTML = `
      <span id="${BAR_ID}-text" style="flex:1"></span>
      <button type="button" id="${BAR_ID}-send"
        style="border:none;border-radius:6px;background:#fff;color:#7c2d12;font-weight:800;padding:7px 14px;cursor:pointer;">Send now</button>`;
    document.body.appendChild(element);
    element.querySelector(`#${BAR_ID}-send`).addEventListener('click', () => flush(true));
    return element;
  }

  async function render() {
    const waiting = OrderQueue.count();
    const element = bar();
    if (!waiting) {
      element.hidden = true;
      element.style.display = 'none';
      return;
    }
    const text = document.getElementById(`${BAR_ID}-text`);
    if (text) {
      text.textContent =
        waiting === 1
          ? '1 order is saved on this phone and NOT yet with the kitchen.'
          : `${waiting} orders are saved on this phone and NOT yet with the kitchen.`;
    }
    element.hidden = false;
    element.style.display = 'flex';
  }

  /**
   * @param {boolean} manual a person pressed Send now, so send regardless of
   *   whether the server dedupes - they have been told, and it is their call.
   */
  async function flush(manual = false) {
    if (!OrderQueue.count()) return;
    if (!POSNIC.server.baseUrl) return;

    if (!manual && !(await serverDedupes())) {
      /* The server would write a second ticket. Leave them, and let the bar
         say so; the Send now button is still there for somebody who has
         checked the kitchen screen. */
      await render();
      return;
    }

    const { sent, left } = await OrderQueue.flush(sendOne);
    await render();
    if (sent && typeof showToast === 'function') {
      showToast(left ? `Sent ${sent}. ${left} still waiting.` : `Sent ${sent} to the kitchen.`);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    render();
    /* A server that answers again is the moment worth trying. */
    window.addEventListener('posnic:online', () => flush(false));
    window.addEventListener('posnic:server-changed', () => {
      capable = null; // a different server may answer differently
      flush(false);
    });
    /* And when somebody picks the phone back up. */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) flush(false);
    });
    flush(false);
  });

  window.POSNIC_ORDER_QUEUE_UI = { render, flush };
})();
