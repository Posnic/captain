/*
 * The sheet between the microphone and the kitchen.
 *
 * voice-order.test.js checks that the right words find the right dish. This
 * checks the thing that matters more: that NOTHING reaches a cart until a
 * person has read it and pressed Add, and that a line the recogniser was
 * unsure about, or could not place at all, is still on the screen when they do.
 *
 * The DOM here is the smallest one the file will run against - enough of a
 * page for the sheet to build itself, and no more.
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
 * and adding one to test three elements would cost more than it explains. Only
 * what voice-order-ui.js actually touches is here; a method it starts using
 * that is missing shows up as a loud failure rather than a silent pass.
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
  const pill = makeElement('div');

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

  const context = {
    document,
    ItemSearch,
    VoiceOrder,
    Speech: {
      available: () => true,
      config: () => ({ provider: 'device', language: 'en-IN' }),
      listen: async () => recognised,
    },
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
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  return { api: context.window.POSNIC_VOICE_UI, document, pill, byId, added, toasts, context };
}

const understood = (text) =>
  VoiceOrder.understand(text, ItemSearch.index(MENU), ItemSearch).map((line) => ({
    ...line,
    dropped: false,
  }));

/* --------------------------------------------------------------- the tests */

test('the menu is indexed from the copy the app has stored', async () => {
  /*
   * NOT from the page's `products`, which is a top-level `let` in a classic
   * script and so is not on `window`. Reading it from here finds undefined,
   * silently, and every spoken dish comes back "not on this menu" on a page
   * visibly full of dishes. That shipped in the first draft of this file and
   * only a real browser caught it.
   */
  const { api } = load();
  const index = await api.menuIndex();
  assert.equal(index.length, MENU.length);
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

test('listening does NOT put anything in the cart', async () => {
  const added = [];
  const { api } = load({ added });
  await api.start();
  assert.deepEqual(added, [], 'a spoken order reached the cart without anybody confirming it');
});

test('listening leaves the heard order on the sheet for a person to read', async () => {
  const { api } = load();
  await api.start();
  assert.deepEqual(
    api.lines.map((line) => `${line.quantity} x ${line.item ? line.item.name : '?'}`),
    ['2 x Chicken Biryani', '3 x Coffee']
  );
});

test('Add is what puts it in the cart, once, in the quantities said', async () => {
  const added = [];
  const { api } = load({ added });
  await api.start();
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
  await api.start();
  assert.equal(api.lines.length, 1);
  assert.equal(api.lines[0].found, false, 'something not on the menu was matched to a dish');
  await api.accept();
  assert.deepEqual(added, []);
});

test('an unheard line is KEPT on the sheet, not quietly dropped', async () => {
  /* A line that vanishes is a dish nobody knows to re-order until a customer
     asks where it is. */
  const { api } = load({ recognised: 'two chicken biryani and one pizza' });
  await api.start();
  assert.equal(api.lines.length, 2);
  assert.equal(api.lines[1].term, 'pizza');
});

test('a rough match is marked as rough, so the screen can say so', async () => {
  const { api } = load({ recognised: 'two chicken briyani' });
  await api.start();
  assert.equal(api.lines[0].item.name, 'Chicken Biryani');
  assert.equal(api.lines[0].exact, false);
});

test('hearing nothing adds nothing and says so', async () => {
  const added = [];
  const { api, toasts } = load({ recognised: '', added });
  await api.start();
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

test('the sheet is hidden with display as well as [hidden]', () => {
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
  assert.match(source, /style\.display = 'none'/);
  assert.doesNotMatch(
    source,
    /'display:flex',\s*\]\.join\(';'\)/,
    'the sheet sets display:flex in its static style, so hiding it will not work'
  );
});
