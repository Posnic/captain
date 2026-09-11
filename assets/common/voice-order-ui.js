/*
 * The microphone, and what happens to the cart when somebody speaks.
 *
 * WHAT IS SAID GOES INTO THE CART. Owner: "as soon as you heard text you need
 * to convert as cart and what said need to show the cart. if user say add 2
 * chicken briyani cart needs to get added. if user says remove 2 chicken
 * briyani remove it."
 *
 * So a spoken "add two coffee" adds two coffee, a spoken "take off the
 * coffee" takes it off, and the panel shows the cart as it now stands with
 * the lines that just changed marked. Every quantity there is a stepper and
 * every line can be struck, because "three coffee" heard as two is one tap
 * to fix and a whole order to say again. The cart is the right place for
 * this to be reversible: nothing in it has reached a kitchen.
 *
 * ONE THING IS NOT DONE ON A WORD. "send it to the kitchen" puts a button on
 * the panel that says exactly that, and a person presses it. A cart can be
 * corrected; a ticket on the pass cannot, and the one failure worse than not
 * hearing an order is confidently firing the wrong one. The owner asked for
 * the words to place the order, and they do - one tap later.
 *
 * HELD, LIKE A VOICE NOTE, OR TAPPED. Press and speak and let go; or tap and
 * it listens until tapped again. Slide left to cancel, up to lock. While it
 * listens the button breathes and five bars follow the voice, so from across
 * a table the one question - is it hearing me - has an answer.
 *
 * THE PANEL NEVER COVERS THE BILL BAR. It sits above it, and there is no
 * backdrop: the menu behind stays live, the bill button stays live. The
 * first version dimmed the whole screen and the owner's words were "bottom
 * buttons are in active". A panel is a thing beside the work, not over it.
 *
 * WHO DOES THE READING. Every shop gets voice-order.js, a fixed list of verbs
 * and a tolerant match against the menu - no key, no network. A shop that has
 * configured an AI provider gets the model instead, through the till, which
 * hears accents and local-language dish names better; and if the till does
 * not answer quickly the local reading is used, because a waiter is standing
 * at a table. Either way the answer is the same shape and the same code
 * carries it out.
 *
 * LOOKS LIKE THE REST OF THE APP. Every colour and size here is a token from
 * design.css, with the same values as fallbacks for a page that has not
 * loaded it. One accent, on the one thing to press; the rest is ink and line.
 */

(function () {
  'use strict';

  const PANEL_ID = 'posnic-voice-panel';
  const BUTTON_ID = 'posnic-voice-mic';
  const STYLE_ID = 'posnic-voice-style';

  const TAP_MS = 350;
  const CANCEL_PX = 90;
  const LOCK_PX = 80;
  /* How long the till gets to read the words with its model before the
     handset reads them itself. A person is waiting. */
  const SERVER_MS = 3000;

  let fromServer = null;
  let canListen = null;
  /* Whether the till has a model to read with. null until asked. */
  let serverReads = null;

  let session = null;
  let held = null;
  let locked = false;
  let ticker = null;

  /* What the panel shows: the cart as it stands, what just changed, which of
     those were a guess, and anything said that could not be placed at all. */
  let view = {
    cart: [],
    changed: {},
    /* item id -> the words actually said, for a line matched roughly.
       "briyani" resolving to Chicken Biryani is usually right and sometimes
       the wrong biryani, and the waiter can only check it if told. */
    rough: {},
    unplaced: [],
    said: '',
    status: '',
    pendingPlace: false,
  };

  /* ------------------------------------------------------------- helpers */

  const $ = (id) => document.getElementById(id);

  const escapeHtml = (text) =>
    String(text == null ? '' : text).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  const say = (message) => {
    if (typeof showToast === 'function') showToast(message);
    else if (typeof showErrorPopup === 'function') showErrorPopup(message);
  };

  function buzz(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* not every device has one */
    }
  }

  /**
   * The menu, indexed for searching.
   *
   * Reuses the index the search box built where there is one, otherwise the
   * saved menu out of IndexedDB - NOT the page's own `products`, a top-level
   * `let` in a classic script that is not on `window` and reads as undefined
   * from here. The stored copy also survives the server being unreachable.
   */
  async function menuIndex() {
    if (window._itemSearchIndex && window._itemSearchIndex.length) return window._itemSearchIndex;
    if (typeof getData !== 'function') return [];
    try {
      const stored = await getData('products');
      return Array.isArray(stored) && stored.length ? ItemSearch.index(stored) : [];
    } catch (e) {
      return [];
    }
  }

  async function cartNow() {
    if (typeof getCartData !== 'function') return [];
    try {
      const rows = await getCartData();
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  /* -------------------------------------------------------------- styles */

  /*
   * Injected once. Tokens from design.css with the same values as fallbacks,
   * so the panel is the same object on a page that loaded the stylesheet and
   * one that did not. No gradients, one accent, everything else ink and line.
   */
  function styles() {
    if ($(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
#${BUTTON_ID}{flex:0 0 auto;margin-left:6px;width:32px;height:32px;border:1px solid var(--line-strong,#cbd5e1);
  border-radius:50%;background:var(--surface,#fff);color:var(--ink,#0f172a);font-size:13px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;touch-action:none;-webkit-user-select:none;
  user-select:none;-webkit-touch-callout:none;position:relative;transition:border-color .15s,color .15s}
#${BUTTON_ID}[data-recording="true"]{border-color:var(--bad,#dc2626);color:var(--bad,#dc2626)}
#${BUTTON_ID}[data-recording="true"]::after{content:"";position:absolute;inset:-6px;border-radius:50%;
  border:2px solid var(--bad,#dc2626);opacity:.6;animation:posnic-voice-pulse 1.2s ease-out infinite}
@keyframes posnic-voice-pulse{0%{transform:scale(.85);opacity:.7}100%{transform:scale(1.35);opacity:0}}
@media (prefers-reduced-motion:reduce){#${BUTTON_ID}[data-recording="true"]::after{animation:none;opacity:.5}}

#${PANEL_ID}{position:fixed;left:0;right:0;z-index:60;background:var(--surface,#fff);color:var(--ink,#0f172a);
  border-top:1px solid var(--line,#e2e8f0);box-shadow:0 -2px 16px rgba(15,23,42,.08);
  font:var(--t-base,15px)/1.45 var(--font,system-ui,-apple-system,'Segoe UI',sans-serif);
  max-height:58vh;display:none;flex-direction:column}
#${PANEL_ID}[data-open="true"]{display:flex}
#${PANEL_ID} .vp-head{display:flex;align-items:center;gap:var(--s3,12px);padding:var(--s3,12px) var(--s4,16px) 0}
#${PANEL_ID} .vp-status{font-size:var(--t-xs,12px);font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink-soft,#475569)}
#${PANEL_ID} .vp-status[data-live="true"]{color:var(--bad,#dc2626)}
#${PANEL_ID} .vp-time{font-variant-numeric:tabular-nums;color:var(--ink-soft,#475569);font-size:var(--t-sm,13px)}
#${PANEL_ID} .vp-close{margin-left:auto;width:36px;height:36px;border:0;background:none;color:var(--ink-faint,#94a3b8);
  font-size:22px;line-height:1;cursor:pointer;border-radius:50%}
#${PANEL_ID} .vp-said{padding:2px var(--s4,16px) 0;color:var(--ink-soft,#475569);font-style:italic;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${PANEL_ID} .vp-bars{display:flex;align-items:flex-end;gap:3px;height:22px;margin:var(--s2,8px) var(--s4,16px) 0}
#${PANEL_ID} .vp-bars span{width:4px;height:4px;border-radius:2px;background:var(--bad,#dc2626);transition:height .08s}
#${PANEL_ID} .vp-note{padding:var(--s2,8px) var(--s4,16px) 0;font-size:var(--t-sm,13px);color:var(--ink-soft,#475569)}
#${PANEL_ID} .vp-lines{overflow:auto;padding:var(--s2,8px) var(--s4,16px)}
#${PANEL_ID} .vp-row{display:flex;align-items:center;gap:var(--s2,8px);padding:var(--s2,8px) 0;
  border-bottom:1px solid var(--line,#e2e8f0)}
#${PANEL_ID} .vp-row:last-child{border-bottom:0}
#${PANEL_ID} .vp-row[data-changed="up"]{background:var(--accent-soft,#eef2ff);margin:0 calc(-1*var(--s4,16px));
  padding-left:var(--s4,16px);padding-right:var(--s4,16px)}
#${PANEL_ID} .vp-row[data-changed="down"]{opacity:.85}
#${PANEL_ID} .vp-row[data-unplaced="true"]{color:var(--warn,#b45309)}
#${PANEL_ID} .vp-step{width:34px;height:34px;border:1px solid var(--line-strong,#cbd5e1);border-radius:8px;
  background:var(--surface,#fff);color:var(--ink,#0f172a);font-size:18px;font-weight:700;line-height:1;cursor:pointer}
#${PANEL_ID} .vp-qty{min-width:26px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}
#${PANEL_ID} .vp-name{flex:1;min-width:0;padding-left:var(--s1,4px)}
#${PANEL_ID} .vp-delta{font-size:var(--t-xs,12px);font-weight:700;color:var(--ink-soft,#475569)}
#${PANEL_ID} .vp-rough{font-size:var(--t-xs,12px);color:var(--warn,#b45309)}
#${PANEL_ID} .vp-x{border:0;background:none;color:var(--ink-faint,#94a3b8);font-size:20px;cursor:pointer;
  width:34px;height:34px;line-height:1}
#${PANEL_ID} .vp-empty{padding:var(--s4,16px) 0;color:var(--ink-soft,#475569)}
#${PANEL_ID} .vp-actions{display:flex;gap:var(--s2,8px);padding:var(--s2,8px) var(--s4,16px)
  calc(var(--s3,12px) + env(safe-area-inset-bottom,0px))}
#${PANEL_ID} .vp-btn{flex:1;min-height:44px;border:1px solid var(--line-strong,#cbd5e1);border-radius:var(--radius,12px);
  background:var(--surface,#fff);color:var(--ink,#0f172a);font:inherit;font-weight:700;cursor:pointer}
#${PANEL_ID} .vp-btn[data-primary="true"]{flex:2;border-color:transparent;background:var(--accent,#4f46e5);
  color:var(--accent-ink,#fff)}
#${PANEL_ID} .vp-btn:disabled{opacity:.5;cursor:default}
`;
    (document.head || document.body).appendChild(style);
  }

  /* -------------------------------------------------------------- button */

  function micButton() {
    let button = $(BUTTON_ID);
    if (button) return button;
    const host = document.querySelector('.product-search-inner');
    if (!host) return null;

    styles();
    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.setAttribute('aria-label', 'Hold or tap to say the order');
    button.innerHTML = '<i class="fas fa-microphone"></i>';

    button.addEventListener('pointerdown', onPress);
    button.addEventListener('pointermove', onMove);
    button.addEventListener('pointerup', onRelease);
    button.addEventListener('pointercancel', onRelease);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    host.appendChild(button);
    return button;
  }

  function paint(recording) {
    const button = $(BUTTON_ID);
    if (!button) return;
    button.setAttribute('data-recording', recording ? 'true' : 'false');
  }

  /* --------------------------------------------------------------- panel */

  function panel() {
    let element = $(PANEL_ID);
    if (element) return element;
    styles();

    element = document.createElement('div');
    element.id = PANEL_ID;
    element.setAttribute('data-open', 'false');
    element.setAttribute('role', 'region');
    element.setAttribute('aria-label', 'Order by voice');
    element.innerHTML = `
      <div class="vp-head">
        <span class="vp-status" id="${PANEL_ID}-status"></span>
        <span class="vp-time" id="${PANEL_ID}-time"></span>
        <button type="button" class="vp-close" id="${PANEL_ID}-close" aria-label="Close">&times;</button>
      </div>
      <div class="vp-said" id="${PANEL_ID}-said"></div>
      <div class="vp-bars" id="${PANEL_ID}-bars" hidden><span></span><span></span><span></span><span></span><span></span></div>
      <div class="vp-note" id="${PANEL_ID}-note"></div>
      <div class="vp-lines" id="${PANEL_ID}-lines"></div>
      <div class="vp-actions" id="${PANEL_ID}-actions"></div>`;

    document.body.appendChild(element);

    const close = $(`${PANEL_ID}-close`);
    if (close) close.addEventListener('click', hidePanel);

    /* One listener for every stepper and strike, because the rows are redrawn
       on every change and listeners on them would be redrawn too. */
    element.addEventListener('click', (event) => {
      const target = event && event.target;
      const control = target && typeof target.closest === 'function' ? target.closest('[data-act]') : null;
      if (!control) return;
      const act = control.getAttribute('data-act');
      const id = control.getAttribute('data-id');
      if (act === 'more') bump(id, 1);
      else if (act === 'less') bump(id, -1);
      else if (act === 'strike') strike(id);
      else if (act === 'place') confirmPlace();
      else if (act === 'search') searchFor(control.getAttribute('data-term'));
      else if (act === 'unplaced-drop') dropUnplaced(control.getAttribute('data-term'));
    });
    return element;
  }

  /**
   * Sit exactly on top of whatever bar is at the bottom, never over it.
   *
   * Measured rather than assumed, and not by one class name. This page has
   * had two bottom bars in its life - a `.bill-bar` and, before it, a fixed
   * footer holding #next-btn - and a panel that knew only one of them sat at
   * bottom:0 on the other and covered the Next button, which is precisely
   * the complaint this panel exists to fix. So: every fixed ancestor of the
   * Next button and the bill bar are candidates, and the first one that is
   * actually on screen at the bottom edge sets the offset.
   */
  function place() {
    const element = panel();
    element.style.bottom = `${bottomBarHeight()}px`;
  }

  function bottomBarHeight() {
    const candidates = [];
    const bill = document.querySelector('.bill-bar');
    if (bill) candidates.push(bill);
    let node = document.getElementById('next-btn');
    while (node && node !== document.body) {
      candidates.push(node);
      node = node.parentElement || null;
    }

    const viewport = Number(window.innerHeight) || 0;
    if (!viewport) return 0;

    for (const candidate of candidates) {
      if (!candidate || typeof candidate.getBoundingClientRect !== 'function') continue;
      let fixed = false;
      try {
        fixed = typeof getComputedStyle === 'function' && getComputedStyle(candidate).position === 'fixed';
      } catch (e) {
        fixed = false;
      }
      if (!fixed) continue;
      const box = candidate.getBoundingClientRect();
      if (!box || !box.height) continue;
      /*
       * On screen and touching the bottom edge - or ON ITS WAY there.
       *
       * The bill bar slides up over 220ms when the first item lands, and the
       * panel is placed the instant the words are applied, while the bar is
       * still mid-slide and measures as off-screen. Read only the geometry and
       * the panel takes bottom:0, then the bar arrives underneath it and the
       * bill button is covered - the exact complaint. So a bar that has
       * declared where it is going (.is-up) is measured by its height now,
       * and a transitionend re-places the panel for good measure.
       */
      const arriving = candidate.classList && candidate.classList.contains('is-up');
      if (arriving || (box.top < viewport && box.bottom >= viewport - 2)) {
        return Math.round(box.height);
      }
    }
    return 0;
  }

  /* The bar moves after the panel is placed; follow it. Bound once. */
  (function followTheBar() {
    if (typeof document.addEventListener !== 'function') return;
    document.addEventListener('transitionend', (event) => {
      const target = event && event.target;
      if (!target || !target.classList || !target.classList.contains('bill-bar')) return;
      const element = $(PANEL_ID);
      if (element && element.getAttribute('data-open') === 'true') place();
    });
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('resize', () => {
        const element = $(PANEL_ID);
        if (element && element.getAttribute('data-open') === 'true') place();
      });
    }
  })();

  function showPanel() {
    place();
    panel().setAttribute('data-open', 'true');
  }

  function hidePanel() {
    const element = $(PANEL_ID);
    if (element) element.setAttribute('data-open', 'false');
  }

  const setText = (id, text) => {
    const element = $(`${PANEL_ID}-${id}`);
    if (element) element.textContent = text || '';
  };

  function setLevel(level) {
    const bars = $(`${PANEL_ID}-bars`);
    if (!bars || !bars.children || !bars.children.length) return;
    const v = Math.max(0, Math.min(1, level));
    /* Five bars, the middle tallest, so a voice reads as a wave and silence
       as a flat line - the shape people already know from every phone. */
    const shape = [0.5, 0.8, 1, 0.8, 0.5];
    for (let i = 0; i < bars.children.length; i++) {
      const h = 4 + Math.round(18 * v * shape[i] * (0.7 + 0.3 * Math.random()));
      bars.children[i].style.height = `${h}px`;
    }
  }

  function setTime(seconds) {
    const whole = Math.floor(seconds);
    setText('time', `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`);
  }

  /* ------------------------------------------------------------- gesture */

  function onPress(event) {
    if (session && locked) {
      event.preventDefault();
      finish();
      return;
    }
    if (session) return;
    event.preventDefault();
    if (event.target && event.target.setPointerCapture) {
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch (e) {
        /* older WebView */
      }
    }
    held = { x: event.clientX, y: event.clientY, at: Date.now(), locked: false };
    begin();
  }

  function onMove(event) {
    if (!held || held.locked || locked || !session) return;
    const dx = held.x - event.clientX;
    const dy = held.y - event.clientY;
    if (dx > CANCEL_PX) {
      abandon();
      return;
    }
    if (dy > LOCK_PX) {
      held.locked = true;
      setText('status', 'Listening, hands free. Tap the mic to stop');
      buzz(20);
      return;
    }
    setText('status', dx > CANCEL_PX / 3 ? 'Keep sliding to cancel' : 'Listening. Slide left to cancel, up to lock');
  }

  function onRelease() {
    if (!held) return;
    if (held.locked) {
      locked = true;
      return;
    }
    const quick = Date.now() - held.at < TAP_MS;
    held = null;
    if (quick) {
      /* A tap listens until the next tap, the way a voice note does. */
      locked = true;
      setText('status', 'Listening. Tap the mic again when done');
      return;
    }
    finish();
  }

  /* ----------------------------------------------------------- recording */

  function begin() {
    locked = false;
    if (canListen === false) {
      say('Voice ordering is not available on this phone.');
      held = null;
      return;
    }
    try {
      session = Speech.start({
        fromServer,
        onPartial: livePreview,
        onLevel: setLevel,
      });
    } catch (error) {
      session = null;
      held = null;
      say((error && error.message) || 'Could not listen just now.');
      return;
    }

    paint(true);
    buzz(15);
    view.said = '';
    view.status = '';
    showPanel();
    const status = $(`${PANEL_ID}-status`);
    if (status) status.setAttribute('data-live', 'true');
    setText('status', 'Listening. Slide left to cancel, up to lock');
    setText('said', '');
    setText('note', '');
    const bars = $(`${PANEL_ID}-bars`);
    if (bars) bars.hidden = false;
    setTime(0);

    ticker = setInterval(() => {
      if (!session) return;
      const seconds = session.seconds();
      setTime(seconds);
      if (seconds >= Speech.MAX_SECONDS) finish();
    }, 200);
  }

  /**
   * Words as they arrive, read as they arrive.
   *
   * Nothing is applied yet - the recogniser rewrites its own sentence several
   * times before it settles - but the panel already shows what it would do,
   * so a waiter can see "2 Coffee" forming and stop talking when it is right.
   */
  async function livePreview(text) {
    view.said = text || '';
    setText('said', view.said ? `"${view.said}"` : '');
    if (!view.said) return;
    try {
      const commands = VoiceOrder.commands(view.said, await menuIndex(), ItemSearch);
      setText('note', describe(commands) || '');
    } catch (e) {
      /* a preview is a nicety */
    }
  }

  function abandon() {
    if (session) {
      try {
        session.cancel();
      } catch (e) {
        /* already stopped */
      }
    }
    session = null;
    locked = false;
    held = null;
    clearInterval(ticker);
    paint(false);
    hidePanel();
    buzz([10, 40, 10]);
  }

  async function finish() {
    const current = session;
    if (!current) return;
    session = null;
    held = null;
    locked = false;
    clearInterval(ticker);
    paint(false);
    buzz(15);
    const status = $(`${PANEL_ID}-status`);
    if (status) status.setAttribute('data-live', 'false');
    const bars = $(`${PANEL_ID}-bars`);
    if (bars) bars.hidden = true;

    let heard = '';
    try {
      heard = await current.stop();
    } catch (error) {
      hidePanel();
      say((error && error.message) || 'Could not listen just now.');
      return;
    }
    if (!heard) {
      hidePanel();
      say('Nothing was heard. Try again, closer to the phone.');
      return;
    }
    setText('status', 'Reading');
    await absorb(heard);
  }

  /* ----------------------------------------------------------- the reading */

  /** A short line saying what a list of commands will do. */
  function describe(commands) {
    const parts = [];
    for (const command of commands) {
      if (command.verb === 'place') parts.push('then send to kitchen');
      else if (command.verb === 'clear') parts.push('clear the cart');
      else if (command.verb === 'show') parts.push('read it back');
      else {
        const names = command.lines
          .map((l) => `${l.quantity} ${l.item ? l.item.name : l.term + '?'}`)
          .join(', ');
        parts.push(`${command.verb === 'remove' ? 'take off' : command.verb === 'set' ? 'make it' : 'add'} ${names}`);
      }
    }
    return parts.join(' - ');
  }

  /**
   * The till reads the words with its model, if it has one, else the handset.
   *
   * Asked once whether the till can, and not again: the answer does not
   * change between one order and the next, and a round trip on every press
   * is a waiter waiting.
   */
  async function serverCanRead() {
    if (serverReads !== null) return serverReads;
    if (typeof POSNIC === 'undefined' || !POSNIC.api || typeof POSNIC.api.get !== 'function') {
      serverReads = false;
      return false;
    }
    try {
      const answer = await POSNIC.api.get('/items/aiAvailability');
      serverReads = !!(answer && answer.data && answer.data.available === true);
    } catch (e) {
      serverReads = false;
    }
    return serverReads;
  }

  async function readOnServer(text, indexed) {
    const items = indexed.map((entry) => ({ id: entry.item.id, name: entry.item.name })).slice(0, 400);
    const byId = new Map(indexed.map((entry) => [String(entry.item.id), entry.item]));
    const call = POSNIC.api.post('/sales/voiceIntent', { text, items });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SERVER_MS));
    const answer = await Promise.race([call.catch(() => null), timeout]);
    const commands = answer && answer.data && Array.isArray(answer.data.commands) ? answer.data.commands : null;
    if (!commands) return null;

    /* Into the shape the local parser produces, so one path carries it out. */
    const out = [];
    for (const c of commands) {
      if (c.verb === 'place' || c.verb === 'clear' || c.verb === 'show') {
        out.push({ verb: c.verb, lines: [] });
        continue;
      }
      const item = c.item_id != null ? byId.get(String(c.item_id)) || null : null;
      out.push({
        verb: c.verb,
        lines: [{ quantity: c.quantity || 1, term: c.said || '', item, found: !!item, exact: !!item }],
      });
    }
    return out;
  }

  async function resolve(text) {
    const indexed = await menuIndex();
    if (await serverCanRead()) {
      const fromModel = await readOnServer(text, indexed);
      if (fromModel) return { commands: fromModel, by: 'server' };
    }
    return { commands: VoiceOrder.commands(text, indexed, ItemSearch), by: 'device' };
  }

  /**
   * Carry the commands out on the cart, and show what that did.
   *
   * add and remove go straight to the cart through the same function the
   * menu's own buttons use, so stock limits and negative-stock rules are the
   * same whichever way an item arrives. "set" is a difference against what is
   * there now. "place" is NOT carried out - it puts the button on the panel.
   */
  async function absorb(heard) {
    view.said = heard;
    view.changed = {};
    view.unplaced = [];
    view.pendingPlace = false;

    const { commands } = await resolve(heard);
    await apply(commands);
    view.cart = await cartNow();
    view.status = describe(commands) || 'Nothing to change';
    render();
  }

  async function apply(commands) {
    const change = async (id, delta) => {
      if (!delta) return;
      if (typeof updateQuantity !== 'function') return;
      try {
        await updateQuantity(id, delta);
        view.changed[id] = (view.changed[id] || 0) + delta;
      } catch (e) {
        /* one line failing must not lose the rest of the order */
      }
    };

    for (const command of commands) {
      if (command.verb === 'clear') {
        if (typeof saveCartData === 'function') {
          try {
            await saveCartData([]);
          } catch (e) {
            /* nothing to clear */
          }
        }
        continue;
      }
      if (command.verb === 'place') {
        view.pendingPlace = true;
        continue;
      }
      if (command.verb === 'show') continue;

      for (const line of command.lines) {
        if (!line.found) {
          view.unplaced.push({ term: line.term, quantity: line.quantity, verb: command.verb });
          continue;
        }
        const id = line.item.id;
        /* Heard cleanly the second time settles a line that was doubtful the
           first, which is what saying it again is for. */
        if (line.exact) delete view.rough[id];
        else view.rough[id] = line.term;
        if (command.verb === 'add') await change(id, line.quantity);
        else if (command.verb === 'remove') await change(id, -line.quantity);
        else if (command.verb === 'set') {
          const now = (await cartNow()).find((row) => row.id === id);
          await change(id, line.quantity - (now ? now.quantity : 0));
        }
      }
    }
  }

  /* --------------------------------------------------------------- render */

  function render() {
    showPanel();
    setText('status', view.pendingPlace ? 'Ready to send' : 'Heard');
    setText('said', view.said ? `"${view.said}"` : '');
    setText('note', view.status);

    const host = $(`${PANEL_ID}-lines`);
    if (host) {
      const rows = [];
      for (const row of view.cart) {
        const delta = view.changed[row.id] || 0;
        rows.push(`
          <div class="vp-row" data-changed="${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">
            <button type="button" class="vp-step" data-act="less" data-id="${escapeHtml(row.id)}" aria-label="One fewer">&minus;</button>
            <span class="vp-qty">${row.quantity}</span>
            <button type="button" class="vp-step" data-act="more" data-id="${escapeHtml(row.id)}" aria-label="One more">+</button>
            <span class="vp-name">${escapeHtml(row.name)}${
              delta ? ` <span class="vp-delta">${delta > 0 ? '+' : ''}${delta}</span>` : ''
            }${
              view.rough[row.id]
                ? `<div class="vp-rough">heard "${escapeHtml(view.rough[row.id])}" - check this one</div>`
                : ''
            }</span>
            <button type="button" class="vp-x" data-act="strike" data-id="${escapeHtml(row.id)}" aria-label="Remove">&times;</button>
          </div>`);
      }
      for (const miss of view.unplaced) {
        rows.push(`
          <div class="vp-row" data-unplaced="true">
            <span class="vp-name"><strong>${escapeHtml(miss.term)}</strong>
              <div style="font-size:var(--t-xs,12px)">not on this menu</div></span>
            <button type="button" class="vp-btn" style="flex:0 0 auto;min-height:34px;padding:0 10px" data-act="search" data-term="${escapeHtml(miss.term)}">Search</button>
            <button type="button" class="vp-x" data-act="unplaced-drop" data-term="${escapeHtml(miss.term)}" aria-label="Dismiss">&times;</button>
          </div>`);
      }
      host.innerHTML = rows.length ? rows.join('') : '<div class="vp-empty">The cart is empty.</div>';
    }

    const actions = $(`${PANEL_ID}-actions`);
    if (actions) {
      const count = view.cart.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
      actions.innerHTML = view.pendingPlace
        ? `<button type="button" class="vp-btn" data-act="search" data-term="">Add more</button>
           <button type="button" class="vp-btn" data-primary="true" data-act="place" ${count ? '' : 'disabled'}>
             Send ${count ? count + (count === 1 ? ' item' : ' items') : ''} to kitchen</button>`
        : `<button type="button" class="vp-btn" data-act="search" data-term="">Add more</button>`;
    }
  }

  /* ------------------------------------------------------------ editing */

  async function bump(id, delta) {
    if (typeof updateQuantity !== 'function') return;
    try {
      await updateQuantity(id, delta);
      view.changed[id] = (view.changed[id] || 0) + delta;
    } catch (e) {
      /* stock limit, most likely; the row simply does not move */
    }
    view.cart = await cartNow();
    render();
  }

  async function strike(id) {
    const row = view.cart.find((r) => r.id === id);
    if (row && typeof updateQuantity === 'function') {
      try {
        await updateQuantity(id, -row.quantity);
        view.changed[id] = (view.changed[id] || 0) - row.quantity;
      } catch (e) {
        /* nothing to do */
      }
    }
    view.cart = await cartNow();
    render();
  }

  function dropUnplaced(term) {
    view.unplaced = view.unplaced.filter((m) => m.term !== term);
    render();
  }

  /** Hand a dish that could not be placed to the search box, by name. */
  function searchFor(term) {
    hidePanel();
    const input = document.querySelector('.product-search-inner input');
    if (!input) return;
    if (term) {
      input.value = term;
      try {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) {
        /* older WebView */
      }
    }
    if (typeof input.focus === 'function') input.focus();
  }

  /**
   * The one action a word never takes by itself.
   *
   * Pressed by a person who has just read the cart. Goes through the cart
   * page's own placing function where it exists, so voice and thumb place an
   * order the same way; where it does not, to the cart page, which has it.
   */
  function confirmPlace() {
    if (!view.cart.length) return;
    view.pendingPlace = false;
    hidePanel();
    if (typeof kioskPlaceOrder === 'function') {
      kioskPlaceOrder();
      return;
    }
    if (typeof window !== 'undefined' && window.location) window.location.href = 'cart.html';
  }

  /* ----------------------------------------------------------------- start */

  document.addEventListener('DOMContentLoaded', async () => {
    canListen = await Speech.available(fromServer);
    if (!canListen) return;
    micButton();
    document.addEventListener('pointerup', onRelease);
    document.addEventListener('pointercancel', onRelease);
    document.addEventListener('pointermove', onMove);
    /* Learned in the background so the first press does not pay for it. */
    serverCanRead();
  });

  window.POSNIC_VOICE_UI = {
    begin,
    finish,
    abandon,
    absorb,
    render,
    menuIndex,
    onPress,
    onMove,
    onRelease,
    bump,
    strike,
    confirmPlace,
    hidePanel,
    describe,
    get view() {
      return view;
    },
    get pendingPlace() {
      return view.pendingPlace;
    },
    get unplaced() {
      return view.unplaced;
    },
    get recording() {
      return !!session;
    },
    useServerSettings(value) {
      fromServer = value || null;
    },
    async refreshAvailability() {
      canListen = await Speech.available(fromServer);
      return canListen;
    },
    get canListen() {
      return canListen;
    },
    set canListen(value) {
      canListen = value;
    },
    set serverReads(value) {
      serverReads = value;
    },
  };
})();
