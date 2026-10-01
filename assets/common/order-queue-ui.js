/* Durable orders stay visible until the kitchen confirms them. */
(function () {
  "use strict";
  let flight,
    timer,
    lastError = "";
  const ID = "posnic-unsent";
  const buttonStyle = 'min-height:44px;padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;font:600 14px system-ui;cursor:pointer;';
  const failure = (message, code) =>
    Object.assign(new Error(message), { code });
  function ownerMatches(row) {
    const s = POSNIC.session;
    return (
      row.owner &&
      row.owner.user === s.user?.id &&
      row.owner.shop === s.shopKey &&
      (row.owner.base === (s.base || POSNIC.server.baseUrl) ||
        s.allowsBase?.(row.owner.base)) &&
      (!row.owner.branch ||
        row.owner.branch === localStorage.getItem("branch_id"))
    );
  }
  async function sendOne(row) {
    if (!ownerMatches(row))
      throw failure(
        "Reconnect the original staff member, shop and branch to send this order.",
        "OWNER",
      );
    if (window.CaptainAccess?.locked || !POSNIC.session.active)
      throw failure(
        "Unlock or reconnect your account. This order is saved.",
        "PIN_LOCKED",
      );
    if (!POSNIC.session.resilient) {
      const hit = await POSNIC.discovery.probe(POSNIC.server.baseUrl, 3000);
      if (!hit)
        throw failure(
          "The till is not answering. Retrying in the background.",
          "OFFLINE",
        );
      if (!OrderQueue.dedupes(hit.info))
        throw failure(
          "Update the till before sending saved orders safely.",
          "SESSION_UPDATE",
        );
    }
    return POSNIC.api.post("/sales/qrOrder", row.body, { timeout: 7000 });
  }
  function bar() {
    let el = document.getElementById(ID);
    if (el) return el;
    el = document.createElement("section");
    el.id = ID;
    el.setAttribute("aria-label", "Orders awaiting delivery");
    el.style.cssText =
      "position:relative;background:#f8fafc;color:#475569;border-bottom:1px solid #e2e8f0;padding:0 16px;font:13px/1.4 system-ui;max-height:45vh;overflow:auto;";
    el.innerHTML = `<details id="${ID}-details"><summary style="min-height:44px;display:flex;align-items:center;gap:12px;cursor:pointer"><span id="${ID}-text" role="status" style="flex:1"></span><span style="font-weight:600">View</span></summary><div id="${ID}-rows"></div><div style="display:flex;align-items:center;gap:16px;padding:12px 0"><button type="button" id="${ID}-send">Retry now</button><a id="${ID}-reconnect" href="index.html?serverFailure=1" hidden>Reconnect</a></div></details>`;
    const header = document.querySelector('.floor-head, .mobile-header, .bill-head');
    if (header) header.after(el);
    else document.body.prepend(el);
    el.style.flexShrink = '0';
    el.querySelector(`#${ID}-send`).style.cssText = buttonStyle;
    el.querySelector(`#${ID}-send`).onclick = () => flush(true);
    el.querySelector(`#${ID}-reconnect`).onclick = () => {
      sessionStorage.setItem("posnic_change_server", "1");
    };
    return el;
  }
  function render() {
    const el = bar();
    let rows;
    try {
      rows = OrderQueue.all();
    } catch (e) {
      lastError = e.message;
      rows = [];
    }
    // A healthy connection needs no space in the ordering interface.
    // Automatic delivery continues even while this notice is absent.
    el.hidden = !rows.length && !lastError;
    el.querySelector(`#${ID}-text`).textContent =
      lastError ||
      (rows.length === 1 ? `${rows.length} order saved · Not sent to kitchen` : `${rows.length} orders saved · Not sent to kitchen`);
    if (el.hidden) el.querySelector(`#${ID}-details`).open = false;
    const list = el.querySelector(`#${ID}-rows`);
    list.replaceChildren();
    const needsAccess =
      !POSNIC.session.active ||
      window.CaptainAccess?.locked ||
      POSNIC.session.needsReconnect;
    el.querySelector(`#${ID}-reconnect`).hidden = !needsAccess;
    el.querySelector(`#${ID}-send`).hidden = needsAccess || !rows.length;
    if (!POSNIC.session.active || window.CaptainAccess?.locked) {
      if (rows.length)
        el.querySelector(`#${ID}-text`).textContent =
          `${rows.length} orders saved. Unlock or reconnect to view and send them.`;
      return;
    }
    for (const row of rows) {
      const card = document.createElement("article");
      card.style.cssText =
        "padding:10px;border-top:1px solid #cbd5e1;background:#e2e8f0;margin-top:6px;";
      const title = document.createElement("strong");
      title.textContent = `${row.body?.kiosk_table_no ? "Table " + row.body.kiosk_table_no : "Order"} · ${new Date(row.at).toLocaleTimeString()} · ${row.state === "attention" ? "Needs attention" : row.state === "blocked" ? "Reconnect required" : "Waiting to send"}`;
      const items = document.createElement("p");
      items.setAttribute("translate", "no");
      items.textContent = (row.body?.items || [])
        .map((i) => `${i.item_quantity} × ${i.item_name || i.item_id}`)
        .join(", ");
      const message = document.createElement("p");
      message.textContent =
        row.message || "Saved on this phone · Not sent to kitchen";
      card.append(title, items, message);
      if (row.state === "attention") {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry this order";
        retry.style.cssText = buttonStyle;
        retry.onclick = () => flush(true, row.key);
        card.append(retry);
      }
      list.append(card);
    }
  }
  async function reconcileCart() {
    for (const row of OrderQueue.all().filter((r) => r.held)) {
      if (!ownerMatches(row)) continue;
      if (localStorage.getItem("kiosk_order_key") === row.key) {
        if (typeof saveCartData !== "function") continue;
        await saveCartData([]);
      }
      if (!OrderQueue.update(row.key, { held: false }))
        throw new Error(
          "Could not finish saving this order. Keep the app data and retry.",
        );
    }
  }
  function flush(manual = false, key) {
    if (flight) return flight;
    flight = (async () => {
      try {
        lastError = "";
        await POSNIC.session.ready;
        if (!POSNIC.session.active || window.CaptainAccess?.locked) return;
        if (manual && POSNIC.session.needsReconnect)
          await POSNIC.session.retryAccess();
        await reconcileCart();
        if (manual && !OrderQueue.count()) await POSNIC.net.check(true);
        const result = await OrderQueue.flush(sendOne, { force: manual, key });
        if (result.sent) window.dispatchEvent(new Event('posnic:orders-sent'));
        if (result.sent && typeof showToast === "function")
          showToast(`Sent ${result.sent} to the kitchen.`);
      } catch (e) {
        lastError = e.message;
      } finally {
        flight = null;
        render();
        schedule();
      }
    })();
    return flight;
  }
  function schedule() {
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(() => flush(), 5000);
  }
  document.addEventListener("DOMContentLoaded", () => {
    render();
    flush();
    window.addEventListener("online", () => flush());
    window.addEventListener("posnic:online", () => {
      render();
      flush();
    });
    window.addEventListener("posnic:server-changed", render);
    window.addEventListener("posnic:offline", render);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) flush();
      else clearTimeout(timer);
    });
  });
  window.POSNIC_ORDER_QUEUE_UI = { render, flush, reconcileCart };
})();
