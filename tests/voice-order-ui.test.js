/*
 * The microphone, the cart, and the one button between them and the kitchen.
 *
 * voice-order.test.js checks that the right words find the right dish and
 * the right verb. This checks what happens next, which matters more:
 *
 *   a spoken "add" ADDS to the cart, a spoken "take off" takes off - through
 *     the same function the menu's own buttons use, so stock rules are one
 *   a spoken "send to kitchen" does NOT send. It puts a button on the panel,
 *     and a person presses it. A cart can be corrected; a ticket cannot.
 *   a dish that could not be placed on the menu stays on screen, named
 *   the panel never covers the bill bar and never dims the page - the
 *     owner's "bottom buttons are in active" - so the rest of the screen
 *     keeps working while it is up
 *   a tap is not a recording, and a slide is a way out
 *
 * The DOM here is the smallest one the file will run against. Only what
 * voice-order-ui.js actually touches is here; a method it starts using that is
 * missing shows up as a loud failure, not a silent pass.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ItemSearch = require(path.join(__dirname, '..', 'assets', 'common', 'item-search.js'));
const VoiceOrder = require(path.join(__dirname, '..', 'assets', 'common', 'voice-order.js'));

const MENU = ['Chicken Biryani', 'Coffee', 'Masala Dosa'].map((name, id) => ({
  id: String(id),
  name,
}));

/* ------------------------------------------------------------------- a DOM */

function makeElement(tag) {
  const element = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    listeners: {},
    style: { cssText: '', display: '', bottom: '' },
    hidden: false,
    disabled: false,
    innerHTML: '',
    textContent: '',
    id: '',
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
      return child;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    addEventListener(name, handler) {
      (this.listeners[name] = this.listeners[name] || []).push(handler);
    },
    click() {
      (this.listeners.click || []).forEach((h) => h({ target: element }));
    },
    querySelector() {
      return makeElement('div');
    },
    querySelectorAll() {
      return [];
    },
    remove() {},
  };
  return element;
}

function makeWindow() {
  const byId = new Map();
  const pill = makeElement('div');
  const document = {
    body: makeElement('body'),
    listeners: {},
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector: (selector) => (selector === '.product-search-inner' ? pill : null),
    addEventListener(name, handler) {
      (this.listeners[name] = this.listeners[name] || []).push(handler);
    },
  };
  const register = (element) => {
    if (element.id) byId.set(element.id, element);
    element.children.forEach(register);
  };
  const wrap = (host) => {
    const original = host.appendChild.bind(host);
    host.appendChild = (child) => {
      const result = original(child);
      register(child);
      return result;
    };
  };
  wrap(document.body);
  wrap(pill);
  return { document, pill, byId };
}

/**
 * Load voice-order-ui.js into a context of our own making, with a cart that
 * remembers what was done to it the way indexedDB.js's does.
 */
function load({ recognised = 'two chicken biryani and three coffee' } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'common', 'voice-order-ui.js'), 'utf8');
  const { document, pill, byId } = makeWindow();
  const toasts = [];
  const sessions = [];
  const calls = { quantity: [], cleared: 0, placed: 0 };
  let cart = [];

  const context = {
    document,
    ItemSearch,
    VoiceOrder,
    Speech: {
      MAX_SECONDS: 45,
      available: () => true,
      config: () => ({ provider: 'device', language: 'en-IN' }),
      start() {
        const session = {
          cancelled: false,
          seconds: () => 3,
          cancel() {
            this.cancelled = true;
          },
          async stop() {
            return context.__heard;
          },
        };
        sessions.push(session);
        return session;
      },
    },
    __heard: recognised,
    getData: async (store) => (store === 'products' ? MENU.slice() : []),
    getCartData: async () => cart.map((row) => ({ ...row })),
    saveCartData: async (rows) => {
      cart = rows.map((row) => ({ ...row }));
      calls.cleared += rows.length === 0 ? 1 : 0;
    },
    /* The real one adds a row when there is none, removes it at zero, and
       refuses a decrease on nothing - mirrored, because "remove one coffee"
       on an empty cart must be a no-op and not a negative coffee. */
    updateQuantity: async (id, change) => {
      calls.quantity.push({ id, change });
      const item = MENU.find((m) => m.id === id);
      let row = cart.find((r) => r.id === id);
      if (!row) {
        if (change < 0) return;
        row = { id, name: item ? item.name : id, quantity: 0 };
        cart.push(row);
      }
      row.quantity += change;
      if (row.quantity <= 0) cart = cart.filter((r) => r.id !== id);
    },
    kioskPlaceOrder: () => {
      calls.placed += 1;
    },
    showToast: (message) => toasts.push(message),
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: {},
    Date,
    Math,
    Promise,
    Map,
    Event: function Event() {},
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  const api = context.window.POSNIC_VOICE_UI;
  /* The till is not asked: this is the handset reading by itself. */
  api.serverReads = false;

  return { api, document, pill, byId, calls, toasts, sessions, context, cart: () => cart };
}

const lines = (cart) => cart().map((row) => `${row.quantity} x ${row.name}`);

/* ---------------------------------------------------------- the menu index */

test('the menu is indexed from the copy the app has stored', async () => {
  const { api } = load();
  assert.equal((await api.menuIndex()).length, MENU.length);
});

test('the index the search box built is reused, not rebuilt', async () => {
  const { api, context } = load();
  const shared = ItemSearch.index(MENU.slice(0, 1));
  context.window._itemSearchIndex = shared;
  assert.strictEqual(await api.menuIndex(), shared);
});

test('no stored menu means nothing is matched, not a crash', async () => {
  const { api, context } = load();
  context.getData = async () => [];
  assert.deepEqual(await api.menuIndex(), []);
});

/* ----------------------------------------------------- words move the cart */

test('what is said goes into the cart', async () => {
  /* Owner: "if user say add 2 chicken briyani cart needs to get added." */
  const { api, cart } = load({ recognised: 'add two chicken biryani' });
  api.begin();
  await api.finish();
  assert.deepEqual(lines(cart), ['2 x Chicken Biryani']);
});

test('an order read off a table, with no verb, is an addition', async () => {
  const { api, cart } = load({ recognised: 'two chicken biryani and three coffee' });
  api.begin();
  await api.finish();
  assert.deepEqual(lines(cart), ['2 x Chicken Biryani', '3 x Coffee']);
});

test('"take off" takes off, through the same door the menu buttons use', async () => {
  /* Owner: "if user says remove 2 chicken briyani remove it." */
  const { api, cart, calls, context } = load({ recognised: 'remove one coffee' });
  await context.updateQuantity('1', 3);
  api.begin();
  await api.finish();
  assert.deepEqual(lines(cart), ['2 x Coffee']);
  assert.deepEqual(calls.quantity.at(-1), { id: '1', change: -1 }, 'removal did not go through updateQuantity');
});

test('removing what is not there does nothing, rather than going negative', async () => {
  const { api, cart } = load({ recognised: 'remove two coffee' });
  api.begin();
  await api.finish();
  assert.deepEqual(lines(cart), []);
});

test('"make it three" sets the quantity, whatever it was', async () => {
  const { api, cart, context } = load({ recognised: 'make it three coffee' });
  await context.updateQuantity('1', 1);
  api.begin();
  await api.finish();
  assert.deepEqual(lines(cart), ['3 x Coffee']);
});

test('add and remove in one breath are both carried out, in order', async () => {
  const { api, cart, context } = load({ recognised: 'two masala dosa and take off the coffee' });
  await context.updateQuantity('1', 2);
  api.begin();
  await api.finish();
  assert.deepEqual(lines(cart), ['1 x Coffee', '2 x Masala Dosa']);
});

test('"start over" empties the cart before what follows is added', async () => {
  const { api, cart, calls, context } = load({ recognised: 'start over, two coffee' });
  await context.updateQuantity('0', 4);
  api.begin();
  await api.finish();
  assert.equal(calls.cleared, 1, 'the cart was not cleared');
  assert.deepEqual(lines(cart), ['2 x Coffee']);
});

/* --------------------------------------------- the kitchen needs a finger */

test('"send to kitchen" does NOT send. It offers the button', async () => {
  /*
   * A cart can be corrected; a ticket on the pass cannot. The words put the
   * button on the panel and a person who has just read the cart presses it.
   */
  const { api, calls, context } = load({ recognised: 'send it to the kitchen' });
  await context.updateQuantity('1', 2);
  api.begin();
  await api.finish();
  assert.equal(calls.placed, 0, 'a spoken word placed an order with nobody confirming it');
  assert.equal(api.pendingPlace, true, 'the send button was not offered');
});

test('the button places it, the way the cart page does', async () => {
  const { api, calls } = load({ recognised: 'two coffee, send to kitchen' });
  api.begin();
  await api.finish();
  assert.equal(api.pendingPlace, true);
  api.confirmPlace();
  assert.equal(calls.placed, 1);
  assert.equal(api.pendingPlace, false);
});

test('nothing in the cart, nothing to send', async () => {
  const { api, calls } = load({ recognised: 'send to kitchen' });
  api.begin();
  await api.finish();
  api.confirmPlace();
  assert.equal(calls.placed, 0, 'an empty cart was sent to the kitchen');
});

/* --------------------------------------------------- what could not be placed */

test('a dish not on the menu stays on screen, named, instead of vanishing', async () => {
  const { api, cart } = load({ recognised: 'two coffee and five widgets' });
  api.begin();
  await api.finish();
  assert.deepEqual(lines(cart), ['2 x Coffee']);
  assert.deepEqual(
    api.unplaced.map((m) => `${m.quantity} ${m.term}`),
    ['5 widgets'],
    'a line that could not be placed was dropped silently'
  );
});

/* ---------------------------------------------------- editing what was heard */

test('every line can be stepped and struck after the fact', async () => {
  /* "three coffee" heard as two is one tap to fix, not a whole order again. */
  const { api, cart } = load({ recognised: 'two coffee' });
  api.begin();
  await api.finish();
  await api.bump('1', 1);
  assert.deepEqual(lines(cart), ['3 x Coffee']);
  await api.strike('1');
  assert.deepEqual(lines(cart), []);
});

test('a rough match is flagged on its line, and settles when said cleanly', async () => {
  /*
   * "briyani" resolving to Chicken Biryani is usually right and sometimes the
   * wrong biryani. It goes in the cart - one tap to fix beats saying it again -
   * but the line says what was actually heard, so the waiter checks that one.
   * Said cleanly a second time, the flag goes: that is what repeating is for.
   */
  const { api, cart, context } = load({ recognised: 'two chicken briyani' });
  api.begin();
  await api.finish();
  assert.deepEqual(lines(cart), ['2 x Chicken Biryani']);
  assert.deepEqual(api.view.rough, { 0: 'chicken briyani' }, 'the guess is not flagged');

  context.__heard = 'one chicken biryani';
  api.begin();
  await api.finish();
  assert.deepEqual(api.view.rough, {}, 'a clean hearing did not settle the doubtful line');
  assert.deepEqual(lines(cart), ['3 x Chicken Biryani']);
});

/* ------------------------------------------------ the panel is beside the work */

test('the panel never dims the screen or covers the bill bar', async () => {
  /*
   * Owner: "bottom buttons are in active when showing voice to text." The
   * first version put a full-screen shade behind a sheet. This one sits above
   * the bill bar with no backdrop, so the menu and the bill button keep
   * working while it is up.
   */
  const { api, byId } = load({ recognised: 'two coffee' });
  api.begin();
  await api.finish();
  const panel = byId.get('posnic-voice-panel');
  assert.ok(panel, 'no panel was drawn');
  assert.equal(panel.getAttribute('data-open'), 'true');
  assert.ok(!/inset\s*:\s*0/.test(panel.style.cssText || ''), 'the panel is a full-screen overlay');
  assert.ok(!/rgba\(/.test(panel.style.cssText || ''), 'the panel dims the page behind it');
  /* Anchored to the bar's height, measured; with no bar it sits on the floor. */
  assert.equal(panel.style.bottom, '0px');
});

test('the microphone and panel are drawn in the app\'s own tokens, not a blue circle', async () => {
  const { api, byId } = load({ recognised: 'two coffee' });
  api.begin();
  await api.finish();
  const style = byId.get('posnic-voice-style');
  assert.ok(style, 'no stylesheet was injected');
  assert.ok(!/gradient/i.test(style.textContent), 'a gradient is back');
  assert.ok(!/#2563eb/i.test(style.textContent), 'the old hard-coded blue is back');
  assert.match(style.textContent, /var\(--accent/, 'the accent is not a design token');
  /*
   * Three rings on a stagger, not one on a loop. A single ring appeared,
   * vanished and appeared again, and the gap between looked like something
   * had stopped - the opposite of what a live microphone should be saying.
   */
  assert.match(style.textContent, /posnic-voice-ring/, 'nothing leaves the button while it listens');
  assert.match(style.textContent, /animation-delay:1\.6s/, 'the rings are not staggered');
  assert.match(style.textContent, /posnic-voice-breathe/, 'the centre of the button is dead');
  assert.match(style.textContent, /posnic-voice-wave/, 'the bars are still when nobody is metering');

  /* transform and opacity only: both are composited, so a live microphone and
     a sixty-frame animation can share a cheap Android. */
  assert.ok(
    !/animation:[^;}]*\b(height|width|top|left|margin)\b/.test(style.textContent),
    'something animates a layout property'
  );
  assert.match(style.textContent, /prefers-reduced-motion/, 'the animation ignores the phone\'s motion setting');
});

/* ------------------------------------------------------------- the gesture */

test('a quick press is a tap, and a tap listens until the next tap', () => {
  const { api } = load();
  api.onPress({ preventDefault() {}, clientX: 0, clientY: 0, pointerId: 1, target: {} });
  api.onRelease();
  assert.equal(api.recording, true, 'a tap did not leave the microphone open');
});

test('sliding left throws the recording away', () => {
  const { api, sessions } = load();
  api.onPress({ preventDefault() {}, clientX: 200, clientY: 0, pointerId: 1, target: {} });
  api.onMove({ clientX: 50, clientY: 0 });
  assert.equal(api.recording, false);
  assert.equal(sessions[0].cancelled, true, 'the session was not cancelled');
});

test('the mic is absent where the phone cannot listen', async () => {
  const { api, context } = load();
  context.Speech.available = () => false;
  assert.equal(await api.refreshAvailability(), false);
});

/* ------------------------------------------- the smart half, from the till */

/*
 * When the till's own AI reads the order, the answer carries more than the
 * commands: the note said for a dish, the dishes a miss might have been, what
 * goes with the order, and one sentence to read back. Each of those has to
 * land somewhere a waiter can act on it, and none of them may break a handset
 * talking to an older till that sends none of them.
 */
function tillAnswers(res, data) {
  res.api.serverReads = true;
  res.context.POSNIC = { api: { post: async () => ({ data }) } };
}

test('a note said for a dish is written on that line, after the line exists', async () => {
  const res = load();
  res.api.begin();
  const notes = [];
  res.context.setCartItemNotes = async (id, text) => { notes.push({ id, text }); };
  tillAnswers(res, {
    commands: [{ verb: 'add', quantity: 2, item_id: '2', said: 'masala dosa', note: 'no onion' }],
  });
  await res.api.absorb('two masala dosa no onion');
  assert.deepEqual(res.calls.quantity.at(-1), { id: '2', change: 2 }, 'the dish was not added');
  assert.deepEqual(notes, [{ id: '2', text: 'no onion' }], 'the note did not reach the line');
});

test('a note already on the line is kept, and the same words are not added twice', async () => {
  const res = load();
  res.api.begin();
  const notes = [];
  res.context.setCartItemNotes = async (id, text) => { notes.push({ id, text }); };
  res.context.getCartData = async () => [{ id: '2', name: 'Masala Dosa', quantity: 1, notes: 'extra sambar' }];
  tillAnswers(res, { commands: [{ verb: 'add', quantity: 1, item_id: '2', note: 'no onion' }] });
  await res.api.absorb('one more dosa no onion');
  assert.deepEqual(notes, [{ id: '2', text: 'extra sambar, no onion' }]);

  notes.length = 0;
  res.context.getCartData = async () => [{ id: '2', name: 'Masala Dosa', quantity: 2, notes: 'extra sambar; no onion' }];
  tillAnswers(res, { commands: [{ verb: 'add', quantity: 1, item_id: '2', note: 'No Onion' }] });
  await res.api.absorb('another dosa no onion');
  /* the line is rewritten with what it already had; the words appear once */
  assert.ok(notes.every((n) => n.text === 'extra sambar; no onion'), 'the same note was added a second time');
});

test('a dish that did not match offers the dishes it might have been, one tap each', async () => {
  const res = load();
  res.api.begin();
  tillAnswers(res, {
    commands: [{ verb: 'add', quantity: 2, item_id: null, said: 'dosa', candidates: ['2', '0'] }],
  });
  await res.api.absorb('two dosa');
  const miss = res.api.snapshot().unplaced;
  assert.deepEqual(miss, [{ term: 'dosa', quantity: 2, candidates: ['2', '0'] }],
    'the miss does not carry the candidates the till named, with the quantity said');

  await res.api.pickCandidate('2', 2, 'dosa');
  assert.deepEqual(res.calls.quantity.at(-1), { id: '2', change: 2 }, 'the tap did not add the dish');
  assert.deepEqual(res.api.snapshot().unplaced, [], 'the miss is still listed after it was resolved');
});

test('what goes with the order is offered, and taking one adds it and removes the offer', async () => {
  const res = load();
  res.api.begin();
  tillAnswers(res, {
    commands: [{ verb: 'add', quantity: 1, item_id: '2', said: 'masala dosa' }],
    suggestions: [{ item_id: '1', why: 'goes with dosa' }],
  });
  await res.api.absorb('one masala dosa');
  assert.deepEqual(res.api.snapshot().suggestions, [{ id: '1', name: 'Coffee', why: 'goes with dosa' }],
    'the suggestion the till made is not held');

  await res.api.takeSuggestion('1');
  assert.deepEqual(res.calls.quantity.at(-1), { id: '1', change: 1 });
  assert.deepEqual(res.api.snapshot().suggestions, [], 'a suggestion already taken is still offered');
});

test('the read-back is shown when the till gives one, and the panel\'s own words otherwise', async () => {
  const res = load();
  res.api.begin();
  tillAnswers(res, {
    commands: [{ verb: 'add', quantity: 1, item_id: '2' }],
    summary: 'One masala dosa, no onion.',
  });
  await res.api.absorb('one masala dosa no onion');
  assert.equal(res.api.snapshot().summary, 'One masala dosa, no onion.');

  /* an older till: commands only, nothing else in the answer */
  tillAnswers(res, { commands: [{ verb: 'add', quantity: 1, item_id: '1' }] });
  await res.api.absorb('a coffee');
  const snap = res.api.snapshot();
  assert.equal(snap.summary, '', 'a summary from an earlier answer survived');
  assert.ok(snap.status && !snap.status.includes('undefined'), 'an answer without a summary broke the fallback wording');
});
