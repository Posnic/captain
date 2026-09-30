(function () {
  "use strict";
  const t = (value) => window.I18N?.t(value) || value,
    esc = CaptainTables.esc;
  let rows = [],
    canManage = false,
    selected = null,
    busy = false,
    dirty = false;
  const at = (id) => document.getElementById(id);
  const status = (row) =>
    t(
      {
        available: "Available",
        occupied: "Occupied",
        cleaning: "Cleaning",
        held: "Held",
      }[row.status] || "Available",
    );
  const say = (text) => (at("table-management-message").textContent = t(text));
  async function load() {
    if (busy || selected) return false;
    busy = true;
    say("Loading...");
    try {
      const data = await POSNIC.api.get("/captain/v1/tables");
      if (!Array.isArray(data.tables))
        throw new Error("invalid_table_response");
      rows = data.tables;
      canManage = data.canManage === true;
      localStorage.setItem(
        "kiosk_tableorders",
        JSON.stringify(
          rows.map((row) => ({
            ...row,
            service_state: row.status === "occupied" ? "available" : row.status,
          })),
        ),
      );
      list();
      say("");
      return true;
    } catch {
      say("Connection failed");
      return false;
    } finally {
      busy = false;
    }
  }
  function list() {
    selected = null;
    dirty = false;
    at("tables-refresh").hidden = false;
    at("table-management-content").innerHTML =
      `${canManage ? `<button type="button" class="profile-primary table-add" data-action="add">${esc(t("Add table"))}</button>` : ""}<div class="managed-tables">${rows.map((row) => `<button type="button" class="managed-table" data-table="${esc(row.id)}"><span class="managed-shape shape-${esc(row.shape)}" aria-hidden="true"></span><strong translate="no">${esc(row.tableorder_value)}</strong><span class="managed-state state-${esc(row.status)}">${esc(status(row))}</span><small translate="no">${esc(CaptainTables.description(row))}</small></button>`).join("")}</div>`;
  }
  function field(label, id, value, type = "text") {
    return `<label class="profile-field">${esc(t(label))}<input id="${id}" name="${id}" class="ui-field" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="1" max="1000" step="1"' : ""}></label>`;
  }
  function edit(row) {
    selected = row || {
      tableorder_value: "",
      capacity: 0,
      max_capacity: 0,
      area: "",
      shape: "square",
      version: 0,
    };
    dirty = false;
    at("tables-refresh").hidden = true;
    say("");
    at("table-management-content").innerHTML = canManage
      ? `<form id="table-edit-form">${field("Table", "tableorder_value", selected.tableorder_value)}${field("Seat capacity", "capacity", selected.capacity || "", "number")}${field("Maximum seats", "max_capacity", selected.max_capacity || "", "number")}${field("Dining area", "area", selected.area)}<label class="profile-field">${esc(t("Table shape"))}<select class="ui-field" name="shape">${["square", "round", "rectangle"].map((shape) => `<option value="${shape}" ${selected.shape === shape ? "selected" : ""}>${esc(t(shape[0].toUpperCase() + shape.slice(1)))}</option>`).join("")}</select></label><div class="profile-actions"><button type="button" class="profile-secondary" data-action="back">${esc(t("Cancel"))}</button><button type="submit" class="profile-primary">${esc(t("Save"))}</button></div></form>${stateButtons()}`
      : `<h2 translate="no">${esc(selected.tableorder_value)}</h2><p translate="no">${esc(CaptainTables.description(selected))}</p><p>${esc(status(selected))}</p>${stateButtons()}`;
    if (canManage) {
      at("tableorder_value").required = true;
      at("tableorder_value").maxLength = 6;
      at("tableorder_value").pattern = "[A-Za-z0-9]{1,6}";
      at("area").maxLength = 60;
    }
  }
  function stateButtons() {
    if (!selected?.id || selected.status === "occupied") return "";
    return `<div class="table-status-actions">${[
      "available",
      "cleaning",
      "held",
    ]
      .filter((value) => value !== selected.status)
      .map(
        (value) =>
          `<button type="button" class="profile-secondary" data-status="${value}">${esc(t({ available: "Available", cleaning: "Cleaning", held: "Held" }[value]))}</button>`,
      )
      .join("")}</div>`;
  }
  function back() {
    if (busy) return;
    if (selected) {
      if (dirty && !confirm(t("Discard changes?"))) return;
      list();
      say("");
    } else location.href = "me.html";
  }
  async function save(body, stateChange = false) {
    if (busy) return;
    busy = true;
    say("Loading...");
    at("table-management-content")
      .querySelectorAll("input,select,button")
      .forEach((el) => (el.disabled = true));
    try {
      await POSNIC.api.post(
        "/captain/v1/tables" + (stateChange ? "/state" : ""),
        body,
      );
      selected = null;
      dirty = false;
      busy = false;
      await load();
    } catch (error) {
      if (error.status === 409) at("tables-refresh").hidden = false;
      say(
        error.status === 409
          ? "Table changed. Refresh and try again."
          : error.status === 403
            ? "Permission is required."
            : "Could not save. Please try again.",
      );
    } finally {
      busy = false;
      at("table-management-content")
        .querySelectorAll("input,select,button")
        .forEach((el) => (el.disabled = false));
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    at("tables-back").onclick = back;
    at("tables-refresh").onclick = () => {
      if (selected) {
        if (dirty && !confirm(t("Discard changes?"))) return;
        selected = null;
        dirty = false;
      }
      void MobileGestures.refresh();
    };
    at("table-management-content").addEventListener(
      "input",
      () => (dirty = true),
    );
    at("table-management-content").addEventListener(
      "change",
      () => (dirty = true),
    );
    at("table-management-content").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || busy) return;
      if (button.dataset.table)
        edit(rows.find((row) => row.id === button.dataset.table));
      if (button.dataset.action === "add") edit(null);
      if (button.dataset.action === "back") back();
      if (button.dataset.status)
        void save(
          {
            id: selected.id,
            version: selected.version,
            status: button.dataset.status,
          },
          true,
        );
    });
    at("table-management-content").addEventListener("submit", (event) => {
      event.preventDefault();
      const fields = Object.fromEntries(new FormData(event.target));
      void save({ ...fields, id: selected.id, version: selected.version });
    });
    MobileGestures.setRefresh(load);
    void load();
  });
  window.addEventListener("captain:back", (event) => {
    event.preventDefault();
    back();
  });
})();
