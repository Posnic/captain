'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');

/**
 * config.js in a fake browser, with a shop already set up.
 *
 * `answers` decides what each address says: `true` is a healthy till, anything
 * else is silence. `saved` is what this handset had stored before the till
 * moved.
 */
function load(answers, saved) {
  const asked = [];
  const storage = new Map();
  storage.set('posnic.automatic-connections','1');
  let now=Date.now();
  if (saved) storage.set('posnic.server', JSON.stringify(saved));

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date:class extends Date {static now(){return now;}},
    Math,
    JSON,
    Promise,
    Error,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Map,
    Set,
    RegExp,
    AbortController,
    URL,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    navigator: { onLine: true },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    sessionStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    location: { origin: 'http://localhost', protocol: 'http:', hostname: 'localhost' },
    document: {
      addEventListener() {},
      removeEventListener() {},
      readyState: 'loading',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      /* Going offline builds the overlay. Nothing here looks at it, but it
         has to be buildable or the code under test throws on the way past. */
      createElement: () => ({
        style: {},
        classList: { add() {}, remove() {} },
        setAttribute() {},
        addEventListener() {},
        appendChild() {},
        querySelector: () => ({ addEventListener() {} }),
        innerHTML: '',
      }),
      body: { appendChild() {} },
      documentElement: { classList: { add() {}, remove() {} } },
    },
    documentElement: { classList: { add() {}, remove() {} } },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    XMLHttpRequest: undefined,
    fetch: async (url) => {
      asked.push(String(url));
      if (answers(String(url)) === true) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ apiSchema: 1, edition: 'test', version: '1.0.0' }),
        };
      }
      throw new Error('connection refused');
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { POSNIC: sandbox.POSNIC, asked, advance(ms){now+=ms;} };
}

const WAS_AT = 'http://192.168.1.2:5555';
const MOVED_TO = 'http://192.168.1.11:5555';

const onlyAt = (live) => (url) => url.startsWith(live);

// Manual mode deliberately replaces automatic rediscovery and fallback.
test('a changed till address never silently selects another till', async () => {
 const {POSNIC,asked}=load(onlyAt(MOVED_TO),{lan:WAS_AT,active:WAS_AT});
 await POSNIC.net.check(false);
 assert.equal(POSNIC.server.baseUrl,WAS_AT+'/api');
 assert.ok(asked.length<10,'no background subnet sweep');
});
test('manual retry retries the selected address without adopting a neighbour', async () => {
 const {POSNIC,asked}=load(onlyAt(MOVED_TO),{lan:WAS_AT,active:WAS_AT});
 await POSNIC.net.check(true);
 assert.equal(POSNIC.server.baseUrl,WAS_AT+'/api');
 assert.ok(asked.length<10);
});
test('working internet remains selected when Wi-Fi returns', async () => {
 const cloud='https://azure.posnic.io/api';
 const {POSNIC,advance}=load(url=>url.startsWith(MOVED_TO)||url.startsWith(cloud),{lan:MOVED_TO,cloud,active:cloud});
 for(let n=0;n<3;n++){advance(20000);await POSNIC.net.check(false);}
 assert.equal(POSNIC.server.baseUrl,cloud);
 assert.equal(await POSNIC.internetChoice.ask(MOVED_TO+'/api'),false);
});
test('a Wi-Fi outage never adopts a reachable cloud server', async () => {
 const cloud='https://azure.posnic.io/api';
 const {POSNIC}=load(onlyAt(cloud),{lan:WAS_AT,cloud,active:WAS_AT});
 await POSNIC.net.check(false);
 assert.equal(POSNIC.server.baseUrl,WAS_AT+'/api');
 assert.equal(POSNIC.internetChoice.allowed(cloud),false);
});
