/* Shared presentation and capacity rules for configured restaurant tables. */
(function () {
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const t = (value) => window.I18N?.t(value) || value;
  function metadata(row = {}) {
    const capacity =
      Number.isInteger(Number(row.capacity)) && Number(row.capacity) > 0
        ? Number(row.capacity)
        : 0;
    return {
      capacity,
      max: Number(row.max_capacity) || capacity,
      max_capacity: Number(row.max_capacity) || capacity,
      area: String(row.area || ""),
      shape: ["square", "round", "rectangle"].includes(row.shape)
        ? row.shape
        : "square",
    };
  }
  const fits = (row, guests) =>
    !metadata(row).max || Number(guests) <= metadata(row).max;
  function description(row) {
    const meta = metadata(row);
    return [
      meta.area,
      meta.capacity
        ? t("Seat capacity") +
          ": " +
          meta.capacity +
          (meta.max > meta.capacity
            ? " · " + t("Maximum seats") + ": " + meta.max
            : "")
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  function cached(value) {
    try {
      return JSON.parse(localStorage.getItem("kiosk_tableorders") || "[]").find(
        (row) => String(row.tableorder_value) === String(value),
      );
    } catch {
      return null;
    }
  }
  function updateChoices(guests) {
    document
      .querySelectorAll(".table-radio[data-capacity]")
      .forEach((input) => {
        const tooSmall =
          Number(input.dataset.capacity) > 0 &&
          Number(guests) > Number(input.dataset.capacity);
        input.disabled = input.dataset.occupied === "true" || tooSmall;
        if (tooSmall && input.checked) input.checked = false;
        const label = input.nextElementSibling;
        label?.classList.toggle("disabled", input.disabled);
        if (label)
          label.title = tooSmall
            ? t("Choose a table with enough seats.")
            : input.dataset.occupied === "true"
              ? t(input.dataset.serviceState === "cleaning" ? "Cleaning" : input.dataset.serviceState === "held" ? "Held" : "This table is full")
              : "";
      });
  }
  window.CaptainTables = {
    metadata,
    fits,
    description,
    cached,
    updateChoices,
    esc,
  };
})();
