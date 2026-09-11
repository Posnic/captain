/*
 * The sheet between the microphone and the kitchen, and the gesture in front
 * of it.
 *
 * voice-order.test.js checks that the right words find the right dish. This
 * checks the things that matter more:
 *
 *   NOTHING reaches a cart until a person has read it and pressed Add
 *   a line that was doubtful, or could not be placed at all, is still on the
 *     screen when they do
 *   a second press ADDS to the order rather than replacing it, because
 *     replacing would silently delete what a waiter had already said
 *   a tap is not a recording, and a slide is a way out
 *
 * The DOM here is the smallest one the file will run against - enough of a
 * page for the sheet to build itself, and no more. voice-order.spec.js drives
 * the same file in a real browser.
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

/*
 * Hand-built rather than jsdom, because jsdom is not a dependency of this repo
 * and adding one to test a handful of elements would cost more than it
 * explains. Only what voice-order-ui.js actually touches is here; a method it
 * starts using that is missing shows up as a loud failure, not a silent pass.
 */
function makeElement(tag) {
  const element = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    listeners: {},
    style: { cssText: '', display: '' },
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
    /* The search pill the mic button attaches to. */
    querySelector: (selector) => (selector === '.product-search-inner' ? pill : null),
    addEventListener(name, handler) {
      (this.listeners[name] = this.listeners[name] || []).push(handler);
    },
  };

  /* appendChild is where an element becomes findable by id, which is how the
     file actually reaches everything it builds. */
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
 * Load voice-order-ui.js into a context of our own making.
 *
 * Run rather than required, because the file is a browser IIFE that reaches
 * for globals rather than importing them - which is what every other file in
 * assets/common does, and changing that for a test would be testing something
 * the app does not run.
 */
function load({ recognised = 'two chicken biryani and three coffee', added = [] } = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'common', 'voice-order-ui.js'),
    'utf8'
  );
  const { document, pill, byId } = makeWindow();
  const toasts = [];
  const sessions = [];

  const context = {
    document,
    ItemSearch,
    VoiceOrder,
    Speech: {
      MAX_SECONDS: 45,
      available: () => true,
      config: () => ({ provider: 'device', language: 'en-IN' }),
      /* A held session, the way speech.js hands one back. */
      start() {
        const session = {
          cancelled: false,
          stopped: false,
          seconds: () => 3,
          cancel() {
            this.cancelled = true;
          },
          async stop() {
            this.stopped = true;
            return context.__heard;
          },
        };
        sessions.push(session);
        return session;
      },
    },
    __heard: recognised,
    /* The menu as the app stores it: a flat list in IndexedDB, which is where
       the page's own copy comes from and what survives the server being
       unreachable. */
    getData: async (store) => (store === 'products' ? MENU.slice() : []),
    updateQuantity: async (id, quantity) => {
      added.push({ id, quantity });
    },
    showToast: (message) => toasts.push(message),
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: {},
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    api: context.window.POSNIC_VOICE_UI,
    document,
    pill,
    byId,
    added,
    toasts,
    sessions,
    context,
  };
}

const understood = (text) =>
  VoiceOrder.understand(text, ItemSearch.index(MENU), ItemSearch).map((line) => ({
    ...line,
    dropped: false,
  }));

const names = (api) =>
  api.lines.map((line) => `${line.quantity} x ${line.item ? line.item.name : '?'}`);

/* ---------------------------------------------------------- the menu index */

test('the menu is indexed from the copy the app has stored', async () => {
  /*
   * NOT from the page's `products`, which is a top-level `let` in a classic
   * script and so is not on `window`. Reading it from here finds undefined,
   * silently, and every spoken dish comes back "not on this menu" on a page
   * visibly full of dishes. That shipped in the first draft of this file and
   * only a real browser caught it.
   */
  const { api } = load();
  assert.equal((await api.menuIndex()).length, MENU.length);
});

test('the index the search box built is reused, not rebuilt', async () => {
  /* The same menu indexed twice is two things that can disagree. */
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

/* -------------------------------------------------------------- the sheet */

test('speaking does NOT put anything in the cart', async () => {
  const added = [];
  const { api } = load({ added });
  api.begin();
  await api.finish();
  assert.deepEqual(added, [], 'a spoken order reached the cart without anybody confirming it');
});

test('speaking leaves the heard order on the sheet for a person to read', async () => {
  const { api } = load();
  api.begin();
  await api.finish();
  assert.deepEqual(names(api), ['2 x Chicken Biryani', '3 x Coffee']);
});

test('Add is what puts it in the cart, once, in the quantities said', async () => {
  const added = [];
  const { api } = load({ added });
  api.begin();
  await api.finish();
  await api.accept();
  assert.deepEqual(added, [
    { id: '0', quantity: 2 },
    { id: '1', quantity: 3 },
  ]);
});

test('a line struck off is not added', async () => {
  const added = [];
  const { api } = load({ added });
  api.lines = understood('two chicken biryani, three coffee');
  api.lines[0].dropped = true;
  await api.accept();
  assert.deepEqual(added, [{ id: '1', quantity: 3 }]);
});

test('a dish that is not on the menu is never invented into one', async () => {
  const added = [];
  const { api } = load({ recognised: 'two pizza', added });
  api.begin();
  await api.finish();
  assert.equal(api.lines.length, 1);
  assert.equal(api.lines[0].found, false, 'something not on the menu was matched to a dish');
  await api.accept();
  assert.deepEqual(added, []);
});

test('an unheard line is KEPT on the sheet, not quietly dropped', async () => {
  /* A line that vanishes is a dish nobody knows to re-order until a customer
     asks where it is. */
  const { api } = load({ recognised: 'two chicken biryani and one pizza' });
  api.begin();
  await api.finish();
  assert.equal(api.lines.length, 2);
  assert.equal(api.lines[1].term, 'pizza');
});

test('a rough match is marked as rough, so the screen can say so', async () => {
  const { api } = load({ recognised: 'two chicken briyani' });
  api.begin();
  await api.finish();
  assert.equal(api.lines[0].item.name, 'Chicken Biryani');
  assert.equal(api.lines[0].exact, false);
});

test('hearing nothing adds nothing and says so', async () => {
  const added = [];
  const { api, toasts } = load({ recognised: '', added });
  api.begin();
  await api.finish();
  assert.deepEqual(added, []);
  assert.match(toasts.join(' '), /nothing was heard/i);
});

test('one item failing to add does not lose the rest of the order', async () => {
  const added = [];
  const { api, context } = load({ added });
  context.updateQuantity = async (id, quantity) => {
    if (id === '0') throw new Error('stock check blew up');
    added.push({ id, quantity });
  };
  api.lines = understood('two chicken biryani, three coffee');
  await api.accept();
  assert.deepEqual(added, [{ id: '1', quantity: 3 }]);
});

/* ------------------------------------------------- said all, or one by one */

test('a second press ADDS to the order instead of replacing it', async () => {
  /*
   * The whole reason "say it all at once" and "say it one at a time" are the
   * same feature. Replacing would mean the second press silently deleted what
   * the waiter had already said, at a table, with no way back.
   */
  const { api, context } = load({ recognised: 'two chicken biryani' });
  api.begin();
  await api.finish();

  context.__heard = 'one masala dosa';
  api.begin();
  await api.finish();

  assert.deepEqual(names(api), ['2 x Chicken Biryani', '1 x Masala Dosa']);
});

test('the same dish said twice becomes one line, not two', async () => {
  /* Two "2 Coffee" rows is something a person has to read twice and add up.
     "4 Coffee" is not. */
  const { api, context } = load({ recognised: 'two coffee' });
  api.begin();
  await api.finish();

  context.__heard = 'two more coffee';
  api.begin();
  await api.finish();

  assert.deepEqual(names(api), ['4 x Coffee']);
});

test('heard cleanly the second time settles a line that was doubtful', async () => {
  const { api, context } = load({ recognised: 'two chicken briyani' });
  api.begin();
  await api.finish();
  assert.equal(api.lines[0].exact, false);

  context.__heard = 'one chicken biryani';
  api.begin();
  await api.finish();
  assert.equal(api.lines[0].exact, true, 'saying it again clearly did not settle it');
  assert.equal(api.lines[0].quantity, 3);
});

test('Add clears the sheet, so the next table starts empty', async () => {
  const { api } = load();
  api.begin();
  await api.finish();
  await api.accept();
  assert.deepEqual(api.lines, []);
});

/* ---------------------------------------------------------- the gesture */

test('a TAP starts it and keeps listening, like a voice note', async () => {
  /*
   * The first version refused a tap and said "hold the button" - one more
   * thing to learn, and not even what a voice note does. Somebody in a hurry
   * taps; somebody careful holds. Both are the same intention.
   */
  const { api, sessions } = load();
  api.onPress({ clientX: 10, clientY: 10, pointerId: 1, preventDefault() {}, target: {} });
  api.onRelease({ clientX: 10, clientY: 10, pointerId: 1 });

  assert.equal(api.recording, true, 'a tap did not leave it listening');
  assert.equal(sessions[0].cancelled, false, 'a tap threw the recording away');
});

test('and a second tap is what stops it', async () => {
  const { api } = load();
  api.onPress({ clientX: 10, clientY: 10, pointerId: 1, preventDefault() {}, target: {} });
  api.onRelease({ clientX: 10, clientY: 10, pointerId: 1 });

  api.onPress({ clientX: 10, clientY: 10, pointerId: 2, preventDefault() {}, target: {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(api.recording, false, 'a second tap did not stop it');
});

test('holding still works, and releasing still ends it', async () => {
  const { api } = load();
  api.begin();
  assert.equal(api.recording, true);
  await api.finish();
  assert.equal(api.recording, false);
  assert.deepEqual(names(api), ['2 x Chicken Biryani', '3 x Coffee']);
});

test('sliding left cancels, and nothing is transcribed', async () => {
  const { api, sessions } = load();
  api.onPress({ clientX: 300, clientY: 700, pointerId: 1, preventDefault() {}, target: {} });
  assert.equal(api.recording, true);

  api.onMove({ clientX: 300 - 120, clientY: 700, pointerId: 1 });

  assert.equal(api.recording, false);
  assert.equal(sessions[0].cancelled, true);
  assert.equal(sessions[0].stopped, false, 'a cancelled recording was still sent to be transcribed');
  assert.deepEqual(api.lines, []);
});

test('sliding up locks it, so letting go does NOT end the order', async () => {
  /* A long order, or a hand carrying plates. */
  const { api } = load();
  api.onPress({ clientX: 300, clientY: 700, pointerId: 1, preventDefault() {}, target: {} });
  api.onMove({ clientX: 300, clientY: 700 - 100, pointerId: 1 });

  api.onRelease({ clientX: 300, clientY: 700 - 100, pointerId: 1 });
  assert.equal(api.recording, true, 'letting go ended a locked recording');

  await api.finish();
  assert.deepEqual(names(api), ['2 x Chicken Biryani', '3 x Coffee']);
});

test('a press while already recording is ignored', async () => {
  const { api, sessions } = load();
  api.onPress({ clientX: 10, clientY: 10, pointerId: 1, preventDefault() {}, target: {} });
  api.onPress({ clientX: 10, clientY: 10, pointerId: 2, preventDefault() {}, target: {} });
  assert.equal(sessions.length, 1, 'a second microphone was opened over the first');
});

test('finishing twice transcribes once', async () => {
  const added = [];
  const { api, sessions } = load({ added });
  api.begin();
  await Promise.all([api.finish(), api.finish()]);
  assert.equal(sessions.length, 1);
  assert.deepEqual(names(api), ['2 x Chicken Biryani', '3 x Coffee']);
});

/* -------------------------------------------------------- the layout trap */

test('the sheet and the recording bar are hidden with display, not just [hidden]', () => {
  /*
   * An inline display beats the browser's rule for [hidden]. order-queue-ui.js
   * shipped with exactly this bug: a bar set hidden was still laid out,
   * invisible and full width, swallowing the taps meant for Place Order
   * underneath it. A full-screen sheet would swallow the entire menu.
   */
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'common', 'voice-order-ui.js'),
    'utf8'
  );
  const hides = source.match(/style\.display = 'none'/g) || [];
  assert.ok(hides.length >= 2, 'something that can be shown is never explicitly hidden');
  assert.doesNotMatch(
    source,
    /'display:flex',\s*\]\.join\(';'\)/,
    'an overlay sets display:flex in its static style, so hiding it will not work'
  );
});
