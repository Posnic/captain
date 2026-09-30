(function () {
  "use strict";
  const t = (value) => window.I18N?.t(value) || value;
  const byId = (id) => document.getElementById(id);
  let active = [],
    tables = [],
    ready = new Set(),
    filter = "active",
    area = "",
    shapes = false;
  let revision = 0,
    tablesKnown = false,
    readyKnown = false,
    loading = false;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function render() {
    const grid = byId("tables-list");
    if (!grid) return;
    const select = byId("floor-area");
    const areas = [
      ...new Set(tables.map((row) => row.area).filter(Boolean)),
    ].sort();
    if (area && !areas.includes(area)) area = "";
    const signature = JSON.stringify(areas);
    if (select.dataset.areas !== signature) {
      select.replaceChildren(
        new Option(t("All"), ""),
        ...areas.map((name) => new Option(name, name)),
      );
      select.dataset.areas = signature;
    }
    select.value = area;
    select.closest("label").hidden = !areas.length;
    const cards = active.map((node) => node.cloneNode(true));
    if (filter === "all" && tablesKnown) {
      for (const row of tables) {
        if (
          cards.some(
            (card) => card.dataset.tableNumber === String(row.tableorder_value),
          )
        )
          continue;
        const card = element("a", "floor-card");
        card.dataset.tableNumber = String(row.tableorder_value);
        card.dataset.awaitingClose = "true";
        card.href =
          "tables.html?source=floor&table=" +
          encodeURIComponent(row.tableorder_value);
        card.append(element("div", "floor-name", row.tableorder_value));
        card.append(
          element(
            "div",
            "floor-meta",
            t(
              {
                available: "Available",
                occupied: "Occupied",
                cleaning: "Cleaning",
                held: "Held",
              }[row.status] || "Unavailable",
            ),
          ),
        );
        cards.push(card);
      }
    }
    const shown = cards.filter((card) => {
      const row = tables.find(
        (row) => String(row.tableorder_value) === card.dataset.tableNumber,
      );
      if (area && row?.area !== area) return false;
      if (
        filter === "ready" &&
        (!readyKnown ||
          !ready.has(card.dataset.takeaway ? "" : card.dataset.tableNumber))
      )
        return false;
      if (row) {
        card.dataset.shape = ["square", "round", "rectangle"].includes(
          row.shape,
        )
          ? row.shape
          : "square";
        if (shapes) card.prepend(element("span", "floor-table-shape"));
        const description = [
          row.area,
          row.capacity ? t("Seat capacity") + ": " + row.capacity : "",
        ]
          .filter(Boolean)
          .join(" · ");
        if (description) card.append(element("div", "floor-meta", description));
      }
      if (
        readyKnown &&
        ready.has(card.dataset.takeaway ? "" : card.dataset.tableNumber)
      )
        card.append(element("span", "floor-ready", t("Ready")));
      return true;
    });
    if (filter !== "ready") {
      let pending = [];
      try {
        pending = window.POSNIC_ORDER_QUEUE_UI?.visibleRows() || [];
      } catch {}
      for (const order of pending) {
        const table = String(order.body?.kiosk_table_no || "");
        const metadata = tables.find(
          (row) => String(row.tableorder_value) === table,
        );
        if (area && metadata?.area !== area) continue;
        const card = element("a", "floor-card");
        card.classList.add("is-pending");
        card.href = "pending.html";
        card.dataset.awaitingClose = "true";
        card.append(element("div", "floor-name", table || t("Take away")));
        card.append(
          element(
            "div",
            "floor-meta",
            t("Saved on this phone · Not sent to kitchen"),
          ),
        );
        shown.push(card);
      }
    }
    grid.replaceChildren(...shown);
    grid.classList.toggle("with-shapes", shapes);
    document
      .querySelectorAll("[data-floor-filter]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.floorFilter === filter),
        ),
      );
    byId("floor-shapes").setAttribute("aria-pressed", String(shapes));
    const unavailable =
      (filter === "all" && !tablesKnown) || (filter === "ready" && !readyKnown);
    const status = byId("floor-filter-status");
    status.hidden =
      (!unavailable && shown.length > 0) || (filter === "active" && !area);
    status.textContent = unavailable
      ? t(loading ? "Loading..." : "Connection failed")
      : !shown.length
        ? t("No orders yet")
        : "";
    byId("no-orders-message").style.display =
      filter === "active" && !area && !shown.length ? "block" : "none";
  }
  async function update() {
    const ticket = ++revision;
    active = [...byId("tables-list").querySelectorAll(".floor-card")].map(
      (node) => node.cloneNode(true),
    );
    tablesKnown = false;
    readyKnown = false;
    loading = true;
    render();
    const results = await Promise.allSettled([
      POSNIC.api.get("/captain/v1/tables"),
      POSNIC.api.get("/captain/v1/kitchen-ready"),
    ]);
    if (ticket !== revision) return;
    loading = false;
    if (
      results[0].status === "fulfilled" &&
      Array.isArray(results[0].value?.tables)
    ) {
      tables = results[0].value.tables;
      tablesKnown = true;
    }
    if (
      results[1].status === "fulfilled" &&
      Array.isArray(results[1].value?.tickets)
    ) {
      ready = new Set(
        results[1].value.tickets
          .filter((ticket) =>
            ticket.items.some((item) => item.ready > item.served),
          )
          .map((ticket) => String(ticket.table || "")),
      );
      readyKnown = true;
    }
    render();
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-floor-filter]").forEach((button) =>
      button.addEventListener("click", () => {
        filter = button.dataset.floorFilter;
        render();
      }),
    );
    let pendingSignature = "";
    window.addEventListener("captain:pending-changed", () => {
      let next = "";
      try {
        next = JSON.stringify(
          window.POSNIC_ORDER_QUEUE_UI?.visibleRows().map((row) => [
            row.key,
            row.state,
          ]) || [],
        );
      } catch {}
      if (next !== pendingSignature) {
        pendingSignature = next;
        render();
      }
    });
    byId("floor-area")?.addEventListener("change", (event) => {
      area = event.target.value;
      render();
    });
    byId("floor-shapes")?.addEventListener("click", () => {
      shapes = !shapes;
      render();
    });
  });
  window.FloorDashboard = { update };
})();
