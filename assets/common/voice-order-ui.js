/*
 * The microphone, and the sheet that stands between it and the kitchen.
 *
 * NOTHING SPOKEN IS EVER ORDERED. The recogniser hears "two chicken biryani
 * and three coffee", the words are matched against this shop's own menu, and
 * the result is put on screen for a person to look at. They add it, or they
 * fix it, or they throw it away. The one thing worse than failing to hear an
 * order is confidently sending the wrong one to a kitchen, and that failure is
 * invisible until the food arrives.
 *
 * So the sheet is built to be read in a second while somebody is standing at a
 * table waiting:
 *
 *   heard exactly      plain, because it is almost certainly right
 *   heard roughly      marked, with the words that were actually said, because
 *                      "briyani" resolving to Chicken Biryani is usually right
 *                      and occasionally the wrong biryani
 *   not on the menu    kept, not dropped. A line that vanishes is a line
 *                      nobody knows to re-order
 *
 * The button is absent where it cannot work rather than present and
 * disappointing. See speech.js for where the key lives (not here, ever) and
 * voice-order.js for how the words are matched.
 */

(function () {
  'use strict';

  const SHEET_ID = 'posnic-voice-sheet';
  const BUTTON_ID = 'posnic-voice-mic';

  /* What the shop's server says about voice, learned once. Its own name so a
     missing answer is distinguishable from an answer of "nothing". */
  let fromServer = null;

  /**
   * The menu, indexed for searching.
   *
   * Reuses the index the search box already built where there is one - the
   * same menu indexed twice is only ever two things that can disagree - and
   * otherwise reads the saved menu out of IndexedDB.
   *
   * IndexedDB rather than the page's own `products`, which is a top-level
   * `let` in a classic script and therefore NOT on `window`: reaching for it
   * from here finds undefined, silently, and every spoken dish comes back "not
   * on this menu" on a page that is visibly full of dishes. The stored copy is
   * also the one that survives the shop's server being unreachable, which is
   * when a waiter most needs to be able to take an order at all.
   */
  async function menuIndex() {
    if (window._itemSearchIndex && window._itemSearchIndex.length) {
      return window._itemSearchIndex;
    }
    if (typeof getData !== 'function') return [];
    try {
      const stored = await getData('products');
      return Array.isArray(stored) && stored.length ? ItemSearch.index(stored) : [];
    } catch (e) {
      return [];
    }
  }

  /* ---------------------------------------------------------------- button */

  function micButton() {
    let button = document.getElementById(BUTTON_ID);
    if (button) return button;

    const host = document.querySelector('.product-search-inner');
    if (!host) return null;

    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.setAttribute('aria-label', 'Say the order');
    button.innerHTML = '<i class="fas fa-microphone"></i>';
    button.style.cssText = [
      'flex:0 0 auto',
      'margin-left:6px',
      /* Sized to the search pill it sits inside, which has 4px of padding and
         an input about thirty high. A larger circle stretches the pill. */
      'width:30px',
      'height:30px',
      'border:none',
      'border-radius:50%',
      'background:#2563eb',
      'color:#fff',
      'font-size:13px',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
    ].join(';');
    button.addEventListener('click', start);
    host.appendChild(button);
    return button;
  }

  /* Listening has to look like listening. Several seconds of a button that
     did not visibly change is a button somebody presses again. */
  function setListening(on) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.style.background = on ? '#dc2626' : '#2563eb';
    button.innerHTML = on
      ? '<i class="fas fa-stop"></i>'
      : '<i class="fas fa-microphone"></i>';
  }

  /* ----------------------------------------------------------------- sheet */

  function sheet() {
    let element = document.getElementById(SHEET_ID);
    if (element) return element;

    element = document.createElement('div');
    element.id = SHEET_ID;
    element.hidden = true;
    /* display is set by open()/close(), never in this string. An inline
       display beats the browser's rule for [hidden], so a sheet set hidden
       would still be laid out - invisible, over the whole screen, swallowing
       every tap meant for the menu underneath. That exact bug shipped once
       already in order-queue-ui.js. */
    element.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483100',
      'background:rgba(17,24,39,.45)',
      'display:none',
      'align-items:flex-end',
    ].join(';');

    element.innerHTML = `
      <div style="background:#fff;width:100%;max-height:82vh;overflow:auto;
                  border-radius:16px 16px 0 0;padding:16px 16px 12px;
                  font:14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:2px;">
          <strong style="flex:1;font-size:16px;">Is this the order?</strong>
          <button type="button" id="${SHEET_ID}-close" aria-label="Close"
            style="border:none;background:none;font-size:24px;line-height:1;
                   color:#6b7280;cursor:pointer;">&times;</button>
        </div>
        <div id="${SHEET_ID}-heard"
          style="color:#6b7280;font-style:italic;margin-bottom:12px;"></div>
        <div id="${SHEET_ID}-lines"></div>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button type="button" id="${SHEET_ID}-again"
            style="flex:1;padding:12px;border:1.5px solid #d1d5db;border-radius:10px;
                   background:#fff;color:#111827;font-weight:600;cursor:pointer;">
            Say it again</button>
          <button type="button" id="${SHEET_ID}-add"
            style="flex:2;padding:12px;border:none;border-radius:10px;
                   background:#16a34a;color:#fff;font-weight:700;cursor:pointer;">
            Add to order</button>
        </div>
      </div>`;

    document.body.appendChild(element);
    element.querySelector(`#${SHEET_ID}-close`).addEventListener('click', close);
    element.querySelector(`#${SHEET_ID}-again`).addEventListener('click', () => {
      close();
      start();
    });
    element.querySelector(`#${SHEET_ID}-add`).addEventListener('click', accept);
    /* Tapping the dimmed area behind the sheet closes it. Nothing has been
       ordered yet, so there is nothing to lose by getting out. */
    element.addEventListener('click', (event) => {
      if (event.target === element) close();
    });
    return element;
  }

  function open() {
    const element = sheet();
    element.hidden = false;
    element.style.display = 'flex';
  }

  function close() {
    const element = document.getElementById(SHEET_ID);
    if (!element) return;
    element.hidden = true;
    element.style.display = 'none';
  }

  /* What the sheet is currently showing, so Add has something to add. */
  let lines = [];

  function render(heard) {
    open();
    const said = document.getElementById(`${SHEET_ID}-heard`);
    if (said) said.textContent = heard ? `"${heard}"` : '';

    const host = document.getElementById(`${SHEET_ID}-lines`);
    if (!host) return;

    if (!lines.length) {
      host.innerHTML =
        '<div style="padding:14px 0;color:#374151;">Nothing on the menu matched that. ' +
        'Try again, or search for the item.</div>';
      const add = document.getElementById(`${SHEET_ID}-add`);
      if (add) add.disabled = true;
      return;
    }

    const add = document.getElementById(`${SHEET_ID}-add`);
    if (add) add.disabled = !lines.some((line) => line.found && !line.dropped);

    host.innerHTML = lines
      .map((line, index) => {
        if (!line.found) {
          /* Kept on screen on purpose. A line silently dropped is a dish
             nobody knows to order until a customer asks where it is. */
          return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0;
                        border-bottom:1px solid #f3f4f6;color:#b45309;">
              <span style="flex:1;">
                <strong>${escapeHtml(line.term)}</strong>
                <div style="font-size:12px;">not on this menu - add it by hand</div>
              </span>
            </div>`;
        }
        const faded = line.dropped ? 'opacity:.4;text-decoration:line-through;' : '';
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;
                      border-bottom:1px solid #f3f4f6;${faded}">
            <span style="min-width:34px;height:30px;border-radius:8px;background:#eff6ff;
                         color:#1d4ed8;font-weight:800;display:flex;align-items:center;
                         justify-content:center;">${line.quantity}</span>
            <span style="flex:1;">
              ${escapeHtml(line.item.name)}
              ${
                line.exact
                  ? ''
                  : `<div style="font-size:12px;color:#b45309;">heard "${escapeHtml(
                      line.term
                    )}" - check this one</div>`
              }
            </span>
            <button type="button" data-drop="${index}" aria-label="Remove"
              style="border:none;background:none;font-size:20px;color:#9ca3af;
                     cursor:pointer;padding:0 4px;">&times;</button>
          </div>`;
      })
      .join('');

    host.querySelectorAll('[data-drop]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-drop'));
        if (lines[index]) lines[index].dropped = !lines[index].dropped;
        render(heard);
      });
    });
  }

  const escapeHtml = (text) =>
    String(text == null ? '' : text).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  /* ------------------------------------------------------------- listening */

  async function start() {
    if (!Speech.available(fromServer)) {
      say('Voice ordering is not available on this phone.');
      return;
    }

    setListening(true);
    try {
      const heard = await Speech.listen({ fromServer });
      setListening(false);
      if (!heard) {
        say('Nothing was heard. Try again, closer to the phone.');
        return;
      }
      lines = VoiceOrder.understand(heard, await menuIndex(), ItemSearch).map((line) => ({
        ...line,
        dropped: false,
      }));
      render(heard);
    } catch (error) {
      setListening(false);
      say((error && error.message) || 'Could not listen just now.');
    }
  }

  /**
   * Put what is on the sheet into the cart.
   *
   * This is the only path from a spoken word to an order, and it runs after a
   * person has read the list. Which is the entire design.
   */
  async function accept() {
    const wanted = lines.filter((line) => line.found && !line.dropped);
    close();
    if (!wanted.length) return;

    let added = 0;
    for (const line of wanted) {
      try {
        await updateQuantity(line.item.id, line.quantity);
        added += line.quantity;
      } catch (e) {
        /* One item failing must not lose the rest of the order. */
      }
    }
    say(added === 1 ? 'Added 1 item.' : `Added ${added} items.`);
  }

  const say = (message) => {
    if (typeof showToast === 'function') showToast(message);
    else if (typeof showErrorPopup === 'function') showErrorPopup(message);
  };

  /* ----------------------------------------------------------------- start */

  document.addEventListener('DOMContentLoaded', () => {
    /* Drawn only where it can work. A mic button that explains it cannot
       listen is worse than no mic button. */
    if (!Speech.available(fromServer)) return;
    micButton();
  });

  window.POSNIC_VOICE_UI = {
    start,
    accept,
    render,
    close,
    menuIndex,
    get lines() {
      return lines;
    },
    set lines(value) {
      lines = value;
    },
    useServerSettings(value) {
      fromServer = value || null;
    },
  };
})();
