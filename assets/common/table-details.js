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
  let area = "";
  function areaFilter() {
    const areaBar=document.getElementById('seat-area-filter');if(!areaBar)return;
    const areas=[...new Set([...document.querySelectorAll('[data-dining-area]')].map(node=>node.dataset.diningArea).filter(Boolean))];
    if(areas.length<2 || (area&&!areas.includes(area)))area='';
    areaBar.hidden=areas.length<2;
    const choices=['',...areas];
    const signature=JSON.stringify(choices);
    if(areaBar.dataset.choices!==signature){areaBar.dataset.choices=signature;areaBar.innerHTML=choices.map(value=>`<button type="button" class="seat-area-chip" data-area="${esc(value)}" aria-pressed="${value===area}" ${value?'translate="no"':''}>${esc(value||t('All'))}</button>`).join('');}
    areaBar.querySelectorAll('[data-area]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.area===area)));
    areaBar.onclick=event=>{const button=event.target.closest('[data-area]');if(!button)return;area=button.dataset.area;areaFilter();};
    document.querySelectorAll('[data-dining-area]').forEach(node=>node.hidden=!!area&&node.dataset.diningArea!==area);
  }
  function confirmSeating({table,guests}) {
    if(document.getElementById('seat-confirmation'))return Promise.resolve(false);
    const prior=document.activeElement,dialog=document.createElement('dialog');dialog.id='seat-confirmation';dialog.className='seat-confirmation';dialog.setAttribute('aria-labelledby','seat-confirmation-title');
    dialog.innerHTML=`<form method="dialog"><header><h2 id="seat-confirmation-title">${esc(t('New order'))}</h2><button type="submit" value="cancel" aria-label="${esc(t('Back'))}">×</button></header><div class="seat-confirmation-body"><h3 translate="no">${esc(table.tableorder_value)}</h3><p>${esc(t('Guests'))}: <strong translate="no">${esc(guests)}</strong></p><p translate="no">${esc(description(table))}</p>${metadata(table).capacity&&guests>metadata(table).capacity?`<p class="seat-extra-chairs">${esc(t('Extra chairs needed'))}</p>`:''}</div><footer><button type="submit" value="cancel" class="profile-secondary">${esc(t('Cancel'))}</button><button type="submit" value="continue" class="profile-primary">${esc(t('Continue'))}</button></footer></form>`;
    document.body.append(dialog);
    return new Promise(resolve=>{
      const back=event=>{event.preventDefault();event.stopImmediatePropagation();dialog.close('cancel');};
      window.addEventListener('captain:back',back,true);
      dialog.addEventListener('close',()=>{window.removeEventListener('captain:back',back,true);const confirmed=dialog.returnValue==='continue';dialog.remove();prior?.focus({preventScroll:true});resolve(confirmed);},{once:true});
      dialog.showModal();
    });
  }
  window.CaptainTables = {
    metadata,
    fits,
    description,
    cached,
    updateChoices,
    areaFilter,
    confirmSeating,
    esc,
  };
})();
