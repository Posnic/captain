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
 * HELD, LIKE A VOICE NOTE. Press, speak, let go. Everybody already knows this
 * gesture from every messaging app they use, so nothing about it has to be
 * taught, and the waiter decides when they have finished talking rather than
 * racing a timer. Everything that comes with that gesture comes with it:
 *
 *   slide left to cancel    a button pressed by accident, at a table, with a
 *                           customer watching, needs an out that is not "wait
 *                           for it to finish and then delete it"
 *   slide up to lock        a long order, or a hand that is carrying plates.
 *                           Hands-free until Stop is pressed
 *   a timer and a level     several seconds of a screen that does not move
 *                           reads as a dead button, and the waiter presses
 *                           again and loses the first half of the order
 *   a tap is not a record   a stray tap says "hold to speak" instead of
 *                           opening a microphone nobody asked for
 *
 * SAID ALL AT ONCE, OR ONE AT A TIME. A held press takes the whole table -
 * "two chicken biryani, three coffee, one masala dosa". Pressing again while
 * the sheet is open ADDS to it rather than replacing it, so somebody who
 * remembers one more thing, or who prefers to say items singly, does exactly
 * the same thing either way. Only "Start again" clears it, and it says so.
 *
 * The sheet is built to be read in a second while somebody is standing at a
 * table waiting:
 *
 *   heard exactly      plain, because it is almost certainly right
 *   heard roughly      marked, with the words that were actually said, because
 *                      "briyani" resolving to Chicken Biryani is usually right
 *                      and occasionally the wrong biryani
 *   not on the menu    kept, not dropped. A line that vanishes is a line
 *                      nobody knows to re-order
 *
 * and every quantity is editable there, because "three coffee" heard as two is
 * a tap to fix and a whole order to say again.
 *
 * The button is absent where it cannot work rather than present and
 * disappointing. See speech.js for where the key lives (not here, ever) and
 * voice-order.js for how the words are matched.
 */

(function () {
  'use strict';

  const SHEET_ID = 'posnic-voice-sheet';
  const BUTTON_ID = 'posnic-voice-mic';
  const HUD_ID = 'posnic-voice-hud';

  /* Under this, a press was a tap. Somebody brushing the button gets told how
     it works instead of a microphone opening on a conversation at the table. */
  const TAP_MS = 350;
  /* How far the thumb travels before a gesture means something. Generous
     enough not to fire on the wobble of a normal press. */
  const CANCEL_PX = 90;
  const LOCK_PX = 80;

  /* What the shop's server says about voice, learned once. Its own name so a
     missing answer is distinguishable from an answer of "nothing". */
  let fromServer = null;

  /* What the sheet is currently showing, so Add has something to add. */
  let lines = [];
  /* Whether this handset can listen at all, answered once at startup. null
     until the question has been asked. */
  let canListen = null;

  /* The live recording, if there is one. */
  let session = null;
  let held = null;
  /* Listening without a finger on the button - by a tap, or by sliding up. */
  let locked = false;
  let ticker = null;

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
    button.setAttribute('aria-label', 'Hold to say the order');
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
      /* A held button must not also scroll the menu, select the icon, or
         raise Android's long-press menu over the top of the recording. */
      'touch-action:none',
      '-webkit-user-select:none',
      'user-select:none',
      '-webkit-touch-callout:none',
    ].join(';');

    button.addEventListener('pointerdown', onPress);
    button.addEventListener('pointermove', onMove);
    button.addEventListener('pointerup', onRelease);
    button.addEventListener('pointercancel', onRelease);
    button.addEventListener('contextmenu', (event) => event.preventDefault());

    host.appendChild(button);
    return button;
  }

  /* Somebody who cannot see the screen - and a waiter is looking at a table,
     not a phone - still needs to know it started. */
  function buzz(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* not every device has one, and none of this depends on it */
    }
  }

  /* ------------------------------------------------------------------- HUD */

  /*
   * What is on screen WHILE the button is held.
   *
   * Deliberately not the sheet. The sheet is for reading and deciding; this is
   * for the two seconds somebody is talking, and it has to answer one question
   * from across a table: is it listening to me.
   */
  function hud() {
    let element = document.getElementById(HUD_ID);
    if (element) return element;

    element = document.createElement('div');
    element.id = HUD_ID;
    element.hidden = true;
    /* display is set by showHud()/hideHud(), never in this string. An inline
       display beats the browser's rule for [hidden], so an element set hidden
       is still laid out - invisible, over the screen, swallowing every tap
       meant for the menu underneath. That bug shipped once in
       order-queue-ui.js and made Place Order do nothing. */
    element.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      'z-index:2147483200',
      'padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px))',
      'background:#111827',
      'color:#fff',
      "font:600 14px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif",
      'display:none',
      'flex-direction:column',
      'gap:8px',
      'pointer-events:none',
    ].join(';');

    element.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <span id="${HUD_ID}-dot" style="width:11px;height:11px;border-radius:50%;
          background:#ef4444;flex:0 0 auto;"></span>
        <span id="${HUD_ID}-time" style="font-variant-numeric:tabular-nums;">0:00</span>
        <span id="${HUD_ID}-hint" style="flex:1;text-align:right;opacity:.75;font-weight:500;">
          Slide left to cancel &nbsp;&middot;&nbsp; up to lock</span>
      </div>
      <div style="height:4px;border-radius:2px;background:#374151;overflow:hidden;">
        <div id="${HUD_ID}-level" style="height:100%;width:0%;background:#22c55e;"></div>
      </div>
      <div id="${HUD_ID}-words" style="min-height:19px;font-weight:500;opacity:.9;"></div>
      <button type="button" id="${HUD_ID}-stop" hidden
        style="pointer-events:auto;align-self:stretch;margin-top:2px;padding:11px;border:none;
               border-radius:10px;background:#ef4444;color:#fff;font-weight:800;
               cursor:pointer;">Stop and read it back</button>`;

    document.body.appendChild(element);
    element.querySelector(`#${HUD_ID}-stop`).addEventListener('click', finish);
    return element;
  }

  function showHud() {
    const element = hud();
    element.hidden = false;
    element.style.display = 'flex';
    setHudWords('');
    setHudLevel(0);
    setHudTime(0);
  }

  function hideHud() {
    const element = document.getElementById(HUD_ID);
    if (!element) return;
    element.hidden = true;
    element.style.display = 'none';
    const stop = document.getElementById(`${HUD_ID}-stop`);
    if (stop) stop.hidden = true;
  }

  const setHudWords = (text) => {
    const words = document.getElementById(`${HUD_ID}-words`);
    if (words) words.textContent = text || '';
  };

  const setHudLevel = (level) => {
    const bar = document.getElementById(`${HUD_ID}-level`);
    if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%`;
  };

  function setHudTime(seconds) {
    const time = document.getElementById(`${HUD_ID}-time`);
    if (!time) return;
    const whole = Math.floor(seconds);
    time.textContent = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
    /* The last five seconds of the cap, said plainly, so a long order is not
       cut off mid-sentence with no warning. */
    const left = Speech.MAX_SECONDS - seconds;
    time.style.color = left <= 5 ? '#fca5a5' : '#fff';
  }

  function setHudHint(text) {
    const hint = document.getElementById(`${HUD_ID}-hint`);
    if (hint) hint.textContent = text;
  }

  /* ---------------------------------------------------------- the gesture */

  function onPress(event) {
    /* Already listening because of a tap: this press is the one that ends it,
       the way tapping a voice note again does. */
    if (session && locked) {
      event.preventDefault();
      finish();
      return;
    }
    if (session) return;
    event.preventDefault();
    if (event.target.setPointerCapture) {
      /* Captured so a thumb that slides off the little button still reports
         its move and release here. Without it, letting go anywhere but on the
         button leaves a recording running with nothing listening for it. */
      try {
        event.target.setPointerCapture(event.pointerId);
      } catch (e) {
        /* older WebView: the document-level handlers still cover it */
      }
    }
    held = { x: event.clientX, y: event.clientY, at: Date.now(), locked: false, id: event.pointerId };
    begin();
  }

  function onMove(event) {
    if (!held || held.locked || locked || !session) return;
    const dx = held.x - event.clientX;
    const dy = held.y - event.clientY;

    if (dx > CANCEL_PX) {
      setHudHint('Cancelled');
      abandon();
      return;
    }
    if (dy > LOCK_PX) {
      held.locked = true;
      setHudHint('Hands free');
      const stop = document.getElementById(`${HUD_ID}-stop`);
      if (stop) stop.hidden = false;
      buzz(20);
      return;
    }
    /* Live feedback on the way to cancelling, so somebody can feel out how far
       is far enough without committing. */
    if (dx > CANCEL_PX / 3) setHudHint('Keep sliding to cancel');
    else setHudHint('Slide left to cancel · up to lock');
  }

  function onRelease() {
    if (!held) return;
    /* Locked means hands free: letting go is not the end of it. */
    if (held.locked) {
      locked = true;
      return;
    }

    const quick = Date.now() - held.at < TAP_MS;
    held = null;

    /*
     * A TAP STARTS IT. A HOLD ALSO STARTS IT. Either is fine.
     *
     * The first version refused a tap and said "hold the button" - which is
     * one more thing to learn, and it is not even what a voice note does: tap
     * and it listens until you tap again, hold and it listens until you let
     * go. Somebody in a hurry taps. Somebody being careful holds. Both are
     * the same intention and the app should not have an opinion.
     *
     * The recording is already open by this point, so a tap simply LEAVES it
     * open and the button becomes Stop.
     */
    if (quick) {
      locked = true;
      setHudHint('Listening - tap the mic again to stop');
      const stop = document.getElementById(`${HUD_ID}-stop`);
      if (stop) stop.hidden = false;
      return;
    }
    finish();
  }

  /* --------------------------------------------------------- the recording */

  function begin() {
    locked = false;
    /*
     * The CACHED answer, not a fresh one. Asking the native recogniser costs a
     * round trip to the bridge, and this runs on the press itself - a delay
     * here is a waiter who has already started talking into a microphone that
     * is not open yet. Whether a handset can listen does not change between
     * one order and the next.
     */
    if (canListen === false) {
      say('Voice ordering is not available on this phone.');
      held = null;
      return;
    }
    try {
      session = Speech.start({
        fromServer,
        onPartial: setHudWords,
        onLevel: setHudLevel,
      });
    } catch (error) {
      session = null;
      held = null;
      say((error && error.message) || 'Could not listen just now.');
      return;
    }

    paint(true);
    showHud();
    buzz(15);

    ticker = setInterval(() => {
      if (!session) return;
      const seconds = session.seconds();
      setHudTime(seconds);
      /* The outer limit, reached by a phone in a pocket rather than by an
         order. Stopped rather than cancelled: whatever was said is still
         worth showing. */
      if (seconds >= Speech.MAX_SECONDS) finish();
    }, 200);
  }

  /** Thrown away. Nothing is transcribed and nothing is billed. */
  function abandon() {
    if (session) {
      try {
        session.cancel();
      } catch (e) {
        /* already stopped */
      }
    }
    close(true);
    buzz([10, 40, 10]);
  }

  /** Ended by a person. Whatever was said gets read back. */
  async function finish() {
    const current = session;
    if (!current) return;
    session = null;
    held = null;
    locked = false;
    clearInterval(ticker);
    paint(false);
    buzz(15);

    let heard = '';
    try {
      heard = await current.stop();
    } catch (error) {
      hideHud();
      say((error && error.message) || 'Could not listen just now.');
      return;
    }
    hideHud();

    if (!heard) {
      say('Nothing was heard. Try again, closer to the phone.');
      return;
    }
    await absorb(heard);
  }

  function close(alsoHud) {
    session = null;
    locked = false;
    held = null;
    clearInterval(ticker);
    paint(false);
    if (alsoHud) hideHud();
  }

  function paint(recording) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.style.background = recording ? '#dc2626' : '#2563eb';
    button.style.transform = recording ? 'scale(1.25)' : 'scale(1)';
  }

  /* ------------------------------------------------------------ the sheet */

  /**
   * Fold what was just said into what is already on the sheet.
   *
   * ADDED, not replaced. Somebody who remembers one more thing, or who prefers
   * to say items one at a time, presses the same button and gets the same
   * behaviour as the person who said the whole table in one breath. Replacing
   * would mean the second press quietly deleted the first order, at a table,
   * with no way back.
   *
   * The same dish said twice becomes one line with the quantities added. Two
   * "2 Coffee" lines on a sheet is a thing somebody has to read twice and
   * think about; "4 Coffee" is not.
   */
  async function absorb(heard) {
    const fresh = VoiceOrder.understand(heard, await menuIndex(), ItemSearch).map((line) => ({
      ...line,
      dropped: false,
    }));

    for (const line of fresh) {
      const already =
        line.found &&
        lines.find((existing) => existing.found && existing.item.id === line.item.id);
      if (already) {
        already.quantity = Math.min(99, already.quantity + line.quantity);
        already.dropped = false;
        /* Heard cleanly the second time settles a line that was doubtful the
           first, which is exactly what saying it again is FOR. */
        if (line.exact) already.exact = true;
      } else {
        lines.push(line);
      }
    }
    render(heard);
  }

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
                  border-radius:16px 16px 0 0;padding:16px 16px calc(12px + env(safe-area-inset-bottom,0px));
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
        <div id="${SHEET_ID}-more"
          style="margin-top:12px;color:#2563eb;font-weight:600;font-size:13px;">
          Hold the microphone again to add more.</div>
        <div style="display:flex;gap:10px;margin-top:12px;">
          <button type="button" id="${SHEET_ID}-again"
            style="flex:1;padding:12px;border:1.5px solid #d1d5db;border-radius:10px;
                   background:#fff;color:#111827;font-weight:600;cursor:pointer;">
            Start again</button>
          <button type="button" id="${SHEET_ID}-add"
            style="flex:2;padding:12px;border:none;border-radius:10px;
                   background:#16a34a;color:#fff;font-weight:700;cursor:pointer;">
            Add to order</button>
        </div>
      </div>`;

    document.body.appendChild(element);
    element.querySelector(`#${SHEET_ID}-close`).addEventListener('click', dismiss);
    element.querySelector(`#${SHEET_ID}-again`).addEventListener('click', () => {
      /* The one path that throws the list away, and it says so on the button.
         Everything else adds. */
      lines = [];
      dismiss();
    });
    element.querySelector(`#${SHEET_ID}-add`).addEventListener('click', accept);
    /* Tapping the dimmed area behind the sheet closes it. Nothing has been
       ordered yet, so there is nothing to lose by getting out. */
    element.addEventListener('click', (event) => {
      if (event.target === element) dismiss();
    });
    return element;
  }

  function open() {
    const element = sheet();
    element.hidden = false;
    element.style.display = 'flex';
  }

  /** Put the sheet away but KEEP the lines, so the mic can add to them. */
  function dismiss() {
    const element = document.getElementById(SHEET_ID);
    if (!element) return;
    element.hidden = true;
    element.style.display = 'none';
  }

  function render(heard) {
    open();
    const said = document.getElementById(`${SHEET_ID}-heard`);
    if (said) said.textContent = heard ? `"${heard}"` : '';

    const host = document.getElementById(`${SHEET_ID}-lines`);
    if (!host) return;

    const add = document.getElementById(`${SHEET_ID}-add`);
    const wanted = lines.filter((line) => line.found && !line.dropped);
    if (add) {
      add.disabled = !wanted.length;
      add.style.opacity = wanted.length ? '1' : '.5';
      const count = wanted.reduce((sum, line) => sum + line.quantity, 0);
      add.textContent = count ? `Add ${count} to order` : 'Add to order';
    }

    if (!lines.length) {
      host.innerHTML =
        '<div style="padding:14px 0;color:#374151;">Nothing on the menu matched that. ' +
        'Try again, or search for the item.</div>';
      return;
    }

    host.innerHTML = lines.map(lineHtml).join('');

    host.querySelectorAll('[data-act]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-index'));
        const line = lines[index];
        if (!line) return;
        const act = button.getAttribute('data-act');
        if (act === 'drop') line.dropped = !line.dropped;
        if (act === 'more') {
          line.quantity = Math.min(99, line.quantity + 1);
          line.dropped = false;
        }
        if (act === 'less') line.quantity = Math.max(1, line.quantity - 1);
        render(heard);
      });
    });
  }

  /**
   * One line of the sheet.
   *
   * The quantity is a stepper, not a label. "Three coffee" heard as two is one
   * tap to fix; without it, it is the whole order said again.
   */
  function lineHtml(line, index) {
    if (!line.found) {
      /* Kept on screen on purpose. A line silently dropped is a dish nobody
         knows to order until a customer asks where it is. */
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;
                    border-bottom:1px solid #f3f4f6;color:#b45309;">
          <i class="fas fa-circle-question" style="width:18px;text-align:center;"></i>
          <span style="flex:1;">
            <strong>${escapeHtml(line.term)}</strong>
            <div style="font-size:12px;">not on this menu - add it by hand</div>
          </span>
          <button type="button" data-act="drop" data-index="${index}" aria-label="Remove"
            style="border:none;background:none;font-size:20px;color:#9ca3af;
                   cursor:pointer;padding:0 4px;">&times;</button>
        </div>`;
    }

    const step = (act, glyph, label) => `
      <button type="button" data-act="${act}" data-index="${index}" aria-label="${label}"
        style="width:30px;height:30px;border:1.5px solid #d1d5db;border-radius:8px;
               background:#fff;color:#111827;font-size:16px;font-weight:800;
               line-height:1;cursor:pointer;">${glyph}</button>`;

    return `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 0;
                  border-bottom:1px solid #f3f4f6;${
                    line.dropped ? 'opacity:.4;text-decoration:line-through;' : ''
                  }">
        ${step('less', '&minus;', 'One fewer')}
        <span style="min-width:26px;text-align:center;font-weight:800;
                     font-variant-numeric:tabular-nums;">${line.quantity}</span>
        ${step('more', '+', 'One more')}
        <span style="flex:1;padding-left:4px;">
          ${escapeHtml(line.item.name)}
          ${
            line.exact
              ? ''
              : `<div style="font-size:12px;color:#b45309;">heard "${escapeHtml(
                  line.term
                )}" - check this one</div>`
          }
        </span>
        <button type="button" data-act="drop" data-index="${index}" aria-label="Remove"
          style="border:none;background:none;font-size:20px;color:#9ca3af;
                 cursor:pointer;padding:0 4px;">&times;</button>
      </div>`;
  }

  const escapeHtml = (text) =>
    String(text == null ? '' : text).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  /**
   * Put what is on the sheet into the cart.
   *
   * This is the only path from a spoken word to an order, and it runs after a
   * person has read the list. Which is the entire design.
   */
  async function accept() {
    const wanted = lines.filter((line) => line.found && !line.dropped);
    lines = [];
    dismiss();
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

  document.addEventListener('DOMContentLoaded', async () => {
    /* Drawn only where it can work. A mic button that explains it cannot
       listen is worse than no mic button, and on a phone the answer needs a
       round trip to the native recogniser - a handset can have the plugin and
       still have nothing behind it. */
    canListen = await Speech.available(fromServer);
    if (!canListen) return;

    micButton();
    /* A press that ends somewhere the button never hears about - a finger
       dragged off the edge of the screen - must still end the recording. */
    document.addEventListener('pointerup', onRelease);
    document.addEventListener('pointercancel', onRelease);
    document.addEventListener('pointermove', onMove);
  });

  window.POSNIC_VOICE_UI = {
    begin,
    finish,
    abandon,
    absorb,
    accept,
    render,
    dismiss,
    menuIndex,
    onPress,
    onMove,
    onRelease,
    get lines() {
      return lines;
    },
    set lines(value) {
      lines = value;
    },
    get recording() {
      return !!session;
    },
    useServerSettings(value) {
      fromServer = value || null;
    },
    /* For a test, and for a screen that wants to draw the button itself. */
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
  };
})();
