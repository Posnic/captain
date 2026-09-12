/*
 * The app's connection to its shop: which server, which session, one client.
 *
 * A waiter's phone lives in two worlds during one shift. Inside the shop it is
 * on the same Wi-Fi as the till, which answers in single-digit milliseconds
 * whether or not the shop's internet is up. Step into the car park and that
 * address is gone, while the same shop is still reachable at its cloud
 * address. So the server is chosen, not configured once by hand:
 *
 *   1. an address someone pinned - an explicit choice always wins
 *   2. the shop's own server on this Wi-Fi
 *   3. the shop's cloud address, https://<code>.posnic.io/api
 *
 * and the choice is re-made whenever the active one stops answering.
 *
 * Everything reachable from here hangs off one global, POSNIC. Nothing else in
 * the app builds a URL, attaches a credential, or decides what a failure
 * means: it calls POSNIC.api and handles an ApiError. That is the whole reason
 * this file exists as one unit rather than a helper each screen reimplements.
 *
 * The safety rule behind automatic switching: the app only moves itself onto a
 * server it has PROVED holds the same shop. Signing in records a shop key - a
 * hash of the tenant licence, identical on the till and in its synced cloud
 * copy - against the address it came from. A server whose recorded key does
 * not match is offered to the user and never chosen silently. Two Posnic tills
 * on one industrial estate's Wi-Fi is not hypothetical.
 */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- config */

  const CLOUD_SUFFIX = '.posnic.io';
  const API_PATH = '/api';
  const LAN_PORT = 5555;

  const REQUEST_TIMEOUT_MS = 10000;
  const PROBE_TIMEOUT_MS = 2500;
  /* A LAN round trip is under 10ms. A host silent for this long is not there. */
  /*
   * Measured on a real network rather than guessed, sweeping four subnets
   * with nothing to find - the worst case, and the one a waiter waits through:
   *
   *   32 at a time, 900ms   7.3s
   *   48 at a time, 700ms   4.4s
   *   64 at a time, 500ms   2.2s
   *
   * A LAN round trip is under 10ms, so 500ms is already fifty times the
   * budget an answer needs; anything longer is only waiting on addresses with
   * nothing behind them. 64 is where a phone's connection pool starts being
   * the limit rather than the network.
   */
  const SCAN_TIMEOUT_MS = 500;
  const SCAN_CONCURRENCY = 64;

  /*
   * THE ADDRESSES A TILL IS ACTUALLY AT, tried before the other two hundred.
   *
   * A sweep of 2..254 already starts low, but it starts low on ONE subnet at a
   * time while every other subnet is doing the same - and a Windows machine
   * offers four of them. Two hundred and fifty requests per network, fired
   * together, saturate the connection pool: the 500ms timeout starts when
   * fetch is CALLED, not when the socket opens, so the later batches time out
   * having never left the queue. The search then takes tens of seconds and
   * looks like a hang, which is what it was reported as.
   *
   * So the likely addresses go first, across every subnet, as one small
   * bounded pass. A router hands out .2 upwards and a till given a static
   * address gets a round number, so this is where it nearly always is - and it
   * is 30 probes rather than 1,016.
   */
  const LIKELY_HOSTS = [
    2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    100, 101, 102, 150, 200, 201, 250, 254,
  ];

  /*
   * And a hard stop on the whole thing.
   *
   * Without one the sweep is bounded only by how long the slowest of a
   * thousand queued requests takes to give up, which on a busy network is not
   * bounded in any way a person would call bounded. Twenty seconds is longer
   * than a real find ever takes and short enough that somebody still believes
   * the screen.
   */
  const SEARCH_DEADLINE_MS = 20000;

  /* Ask whether the active server is still there: rarely while it answers,
     often while it does not, because that is the only time it can change. */
  const HEALTH_OK_MS = 20000;
  const HEALTH_DOWN_MS = 4000;

  const STORE_SERVER = 'posnic.server';
  const STORE_SESSION = 'posnic.session';

  /* --------------------------------------------------------------- storage */

  function load(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}') || {};
    } catch (e) {
      /* Corrupt or unreadable is the same as absent: the app re-derives
         everything it needs, and refusing to start would be worse. */
      return {};
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* Private mode. The app still works, it just forgets between launches. */
    }
  }

  /* ----------------------------------------------------------------- debug */

  const originalConsole = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console),
  };

  const debug = (function () {
    const KEY = 'posnic.debug';
    const onDevServer =
      !/Android/i.test(navigator.userAgent || '') &&
      (location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.port === '5173');

    let enabled = false;

    function apply(on) {
      enabled = !!on;
      console.log = on ? originalConsole.log : function () {};
      console.debug = on ? originalConsole.debug : function () {};
      console.info = on ? originalConsole.info : function () {};
    }

    let stored = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch (e) {
      stored = null;
    }
    apply(stored === '1' || (stored !== '0' && onDevServer));

    return {
      get enabled() {
        return enabled;
      },
      enable() {
        try {
          localStorage.setItem(KEY, '1');
        } catch (e) {
          /* nothing to remember it with; the session still gets logs */
        }
        apply(true);
        originalConsole.info('POSNIC debug logging enabled');
      },
      disable() {
        try {
          localStorage.setItem(KEY, '0');
        } catch (e) {
          /* as above */
        }
        apply(false);
      },
    };
  })();

  /* ---------------------------------------------------------------- errors */

  /**
   * Everything POSNIC.api throws.
   *
   * One type with a machine-readable `code`, so a caller can branch on the
   * reason instead of matching English against `error.message`. `offline`
   * means the request never reached a server, which is the case the UI has to
   * treat differently from any answer a server gave.
   */
  class ApiError extends Error {
    constructor(message, { status = 0, code = 'REQUEST_FAILED', body = null } = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.body = body;
    }

    get offline() {
      return this.status === 0;
    }

    get unauthorized() {
      return this.status === 401;
    }
  }

  /* ---------------------------------------------------------------- server */

  /* A bare shop code: what the shop is called, and what its address is built
     from. Deliberately narrow, so anything with a dot, colon or slash is
     treated as an address the user typed in full and is left alone. */
  const SHOP_CODE = /^[a-z0-9][a-z0-9-]{0,62}$/i;

  const isPrivateHost = (hostname) =>
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);

  const trimSlashes = (value) => String(value || '').trim().replace(/\/+$/, '');

  /**
   * Turn whatever someone typed into a base URL, or null.
   *
   * Accepts a shop code ("azure"), a hostname ("azure.posnic.io"), an address
   * with a port ("192.168.1.5:5555"), or a full URL carrying its own path
   * ("https://pos.myshop.com/api").
   */
  function normalize(value) {
    const text = trimSlashes(value);
    if (!text) return null;

    if (!/[.:/]/.test(text)) {
      return SHOP_CODE.test(text)
        ? `https://${text.toLowerCase()}${CLOUD_SUFFIX}${API_PATH}`
        : null;
    }

    let url;
    try {
      /* No scheme means an address, not a URL. A private address is http, since
         a till holds no certificate; anything else is https, because sending a
         shop's password in clear to a public host is not a default worth
         having. */
      if (/^https?:\/\//i.test(text)) {
        url = new URL(text);
      } else {
        const host = text.split('/')[0].split(':')[0];
        url = new URL((isPrivateHost(host) ? 'http://' : 'https://') + text);
      }
    } catch (e) {
      return null;
    }
    if (!url.hostname) return null;

    /*
     * A PUBLIC host is https, even when it was handed to us saying otherwise.
     *
     * Servers printed pairing codes reading `http://shop.posnic.io/api` for
     * months: nginx terminates TLS and forwards plain http, so Express saw
     * `http` and put that on the QR. A phone scanned it, the address 301'd,
     * and the handset reported that nothing answered - so the shop was told to
     * check whether their till was running.
     *
     * The server is fixed, and those codes are printed and stuck to walls.
     * Upgrading here means every one of them works without being reprinted.
     *
     * Only ever upwards, and only for a public host: a till on the shop's
     * Wi-Fi holds no certificate, and forcing https on it would break every
     * LAN install to tidy up a scheme.
     */
    if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) url.protocol = 'https:';

    if (isPrivateHost(url.hostname) && !url.port) url.port = String(LAN_PORT);

    const path = trimSlashes(url.pathname);
    if (path) return url.origin + path;

    /* The API answers under /api on every server, cloud or till. There is no
       root-mounted fallback: nothing is deployed that needs one. */
    return url.origin + API_PATH;
  }

  const isLanUrl = (url) => {
    try {
      return isPrivateHost(new URL(url).hostname);
    } catch (e) {
      return false;
    }
  };

  const originOf = (url) => {
    try {
      return new URL(url).origin;
    } catch (e) {
      return '';
    }
  };

  const server = (function () {
    let state = load(STORE_SERVER);
    let active = null;

    const persist = () => save(STORE_SERVER, state);

    function setActive(url, { announce = true } = {}) {
      const next = trimSlashes(url);
      if (!next || next === active) return false;
      const previous = active;
      active = next;
      state.active = next;
      persist();
      if (announce) {
        window.dispatchEvent(
          new CustomEvent('posnic:server-changed', {
            detail: { from: previous, to: next, local: isLanUrl(next) },
          })
        );
      }
      return true;
    }

    /* Whichever address was in use last is the opening bet, so no page ever
       renders without one. Resolution corrects it in the background. */
    active = normalize(state.pinned) || normalize(state.active) || null;

    return {
      get baseUrl() {
        return active;
      },
      get isLocal() {
        return !!active && isLanUrl(active);
      },
      get isConfigured() {
        return !!active || !!normalize(state.cloud) || !!normalize(state.lan);
      },
      get pinned() {
        return normalize(state.pinned);
      },
      get lan() {
        return normalize(state.lan);
      },
      get cloud() {
        return normalize(state.cloud);
      },
      get shopCode() {
        return state.shopCode || null;
      },
      get imageOrigin() {
        return originOf(active);
      },

      normalize,
      isLanUrl,

      /** Addresses to try, best first. */
      candidates() {
        const pinned = normalize(state.pinned);
        if (pinned) return [pinned];
        return [normalize(state.lan), normalize(state.cloud), normalize(state.active)]
          .filter(Boolean)
          .filter((url, i, all) => all.indexOf(url) === i);
      },

      /**
       * May the app move onto this address without asking?
       *
       * Yes when it is the pinned choice, when nobody is signed in (there is no
       * shop to be wrong about), or when this address is recorded as holding
       * the shop this device is signed in to.
       */
      canAdopt(url) {
        const clean = trimSlashes(url);
        if (!clean) return false;
        if (normalize(state.pinned) === clean) return true;
        const current = session.shopKey;
        if (!current) return true;
        return (state.servers || {})[clean] === current;
      },

      adopt(url) {
        const clean = trimSlashes(url);
        if (!clean) return false;
        state[isLanUrl(clean) ? 'lan' : 'cloud'] = clean;
        return setActive(clean);
      },

      /** Record that this address served this shop, proved by a sign-in. */
      recordShop(url, shopKey) {
        if (!url || !shopKey) return;
        state.servers = state.servers || {};
        state.servers[trimSlashes(url)] = String(shopKey);
        state[isLanUrl(url) ? 'lan' : 'cloud'] = trimSlashes(url);
        persist();
      },

      /** Pin an address by hand. An explicit choice is never overridden. */
      pin(url) {
        const base = normalize(url);
        if (!base) return null;
        /* A credential signed by the server being left behind is worthless at
           the new one, and sending it would only produce confusing 401s. */
        if (base !== active) session.end();
        state.pinned = base;
        state[isLanUrl(base) ? 'lan' : 'cloud'] = base;
        persist();
        setActive(base);
        return base;
      },

      unpin() {
        delete state.pinned;
        persist();
      },

      /** Remember the shop's cloud address without pinning it. */
      useShopCode(code) {
        const base = normalize(code);
        if (!base) return null;
        state.shopCode = String(code).trim().toLowerCase();
        state.cloud = base;
        persist();
        return base;
      },

      /** Forget everything about this device's shop. Used by sign-out. */
      forget() {
        state = {};
        active = null;
        persist();
      },
    };
  })();

  /* --------------------------------------------------------------- session */

  const session = (function () {
    let state = load(STORE_SESSION);

    return {
      get token() {
        return state.token || null;
      },
      get shopKey() {
        return state.shopKey || null;
      },
      get user() {
        return state.user || null;
      },
      get active() {
        return !!state.token;
      },

      /**
       * Keep what a sign-in proved.
       *
       * A server older than the bearer-token work returns no token at all. That
       * is not a failure: the menu and placing an order are anonymous
       * endpoints and work regardless. Only the order, KOT and table screens
       * need the credential, and they say so when it is missing rather than
       * failing as if the network were down.
       */
      start({ token, shopKey, expiresIn, user } = {}) {
        state = {
          token: token || null,
          shopKey: shopKey || null,
          user: user || null,
          /* Stored so a stale credential can be recognised without a round
             trip. The server states its own lifetime so this never guesses. */
          expiresAt: expiresIn ? Date.now() + Number(expiresIn) * 1000 : null,
        };
        save(STORE_SESSION, state);
        if (shopKey) server.recordShop(server.baseUrl, shopKey);
      },

      end() {
        state = {};
        save(STORE_SESSION, state);
      },
    };
  })();

  /* ------------------------------------------------------------- discovery */

  /* Captured before the retrying client below exists, so a probe is always a
     single plain request: no credential, no failover, no recursion. */
  const rawFetch = window.fetch.bind(window);

  /*
   * WHO IS ANSWERING window.fetch.
   *
   * Capacitor's HTTP plugin replaces it with a bridge to native code, which
   * behaves differently from the browser's: it ignores an AbortSignal, and it
   * has its own idea of what a failure is. An address that a browser on the
   * same phone loads perfectly can fail inside the app for that reason alone,
   * and nothing on screen would say so.
   *
   * Recorded rather than reasoned about, because "works in Chrome, not in the
   * app" is otherwise a guess somebody has to make from a distance.
   */
  const transport = () => {
    try {
      const patched = !/\[native code\]/.test(String(window.fetch));
      const bridged = !!(window.Capacitor && window.Capacitor.isNativePlatform
        && window.Capacitor.isNativePlatform());
      return (bridged ? 'native' : 'browser') + (patched ? '+patched-fetch' : '');
    } catch (e) {
      return 'unknown';
    }
  };

  /*
   * The same request, by the other road.
   *
   * XMLHttpRequest and fetch are patched separately by the bridge and fail
   * separately, so when one cannot reach an address the other frequently can.
   * Only ever tried AFTER fetch has failed, so the normal path is untouched.
   */
  /*
   * A fetch the bridge has never seen.
   *
   * Capacitor's HTTP plugin replaces window.fetch on the page it runs in. A
   * fresh same-origin iframe gets its own window, and the browser's own fetch
   * with it - so this is the same request made by the engine underneath,
   * unpatched, and it is the only way to tell "the address is unreachable"
   * from "the bridge did not come back".
   *
   * The frame is kept while the request is in flight and removed after.
   * Detaching it early invalidates the function taken from it.
   */
  function pristineFetch() {
    try {
      if (!document.documentElement) return null;
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'display:none;width:0;height:0;border:0;';
      document.documentElement.appendChild(frame);
      const inner = frame.contentWindow;
      if (!inner || typeof inner.fetch !== 'function') {
        frame.remove();
        return null;
      }
      return {
        fetch: inner.fetch.bind(inner),
        done: () => {
          try {
            frame.remove();
          } catch (e) {
            /* the page is going away anyway */
          }
        },
      };
    } catch (e) {
      return null;
    }
  }

  function fetchByXhr(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      try {
        const request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.timeout = timeoutMs;
        request.setRequestHeader('Accept', 'application/json');
        request.onload = () =>
          resolve({ ok: request.status >= 200 && request.status < 300, status: request.status,
            json: async () => JSON.parse(request.responseText) });
        request.onerror = () => reject(new Error('xhr failed'));
        request.ontimeout = () => reject(new Error('xhr timed out'));
        request.send();
      } catch (e) {
        reject(e);
      }
    });
  }

  /* A Posnic server says so in a shape nothing else on a shop network
     produces. Accepting any reply from port 5555 would enrol a printer's
     status page or a router's admin panel as the till. */
  const looksLikePosnic = (info) =>
    !!info &&
    typeof info === 'object' &&
    typeof info.apiSchema !== 'undefined' &&
    typeof info.edition === 'string';

  /*
   * WHY A PROBE FAILED, in words somebody can act on.
   *
   * Every failure used to come back as null, and the screen said "nothing
   * answered at that address - check the shop code, or that POSNIC is running
   * on the till." That one sentence covered a wrong address, no internet, a
   * name that does not resolve, a certificate a phone will not accept, a
   * server that answered 500, and a server that answered perfectly but is not
   * a Posnic one. A shopkeeper cannot act on it and neither can anybody
   * helping them over the phone: "it says nothing answered" is the end of the
   * conversation rather than the start.
   *
   * So the reason is carried out. It costs nothing - the information was
   * already in the exception that was being discarded.
   */
  /* An exception said plainly enough to read down a telephone. */
  const describe = (e) => {
    if (!e) return 'no detail';
    return String((e.name ? e.name + ': ' : '') + (e.message || e)).slice(0, 120);
  };

  const REASONS = {
    BAD_ADDRESS: 'That is not an address this app can use.',
    UNREACHABLE: 'Could not reach it. Check the phone is online and the address is right.',
    TIMED_OUT: 'It did not answer in time. It may be slow, or not listening.',
    REFUSED: 'It answered, but refused: ',
    NOT_POSNIC: 'Something answered, but it is not a Posnic server.',
    UNREADABLE: 'It answered with something this app could not read.',
  };

  /**
   * Try one address.
   *
   * @returns {{base, info}|null} on success, null otherwise - unchanged, so
   *   every existing caller behaves exactly as before. `probe.lastFailure`
   *   holds why the most recent one failed, for a screen that wants to say.
   */
  async function probe(url, timeoutMs = PROBE_TIMEOUT_MS) {
    const base = normalize(url);
    if (!base) {
      probe.lastFailure = { reason: 'BAD_ADDRESS', message: REASONS.BAD_ADDRESS, url };
      return null;
    }

    const target = base + '/runtime-info';
    const fail = (reason, extra) => {
      probe.lastFailure = {
        reason,
        message: (REASONS[reason] || reason) + (extra || ''),
        url: target,
      };
      return null;
    };

    /*
     * A TRANSPORT KNOWN TO HANG GETS A SHORTER LEASH.
     *
     * Capacitor's patched fetch ignores an AbortSignal and can simply never
     * come back. Waiting the full budget on it and THEN trying the roads that
     * work would make a waiter stand at a table for twenty seconds to reach a
     * server that answers in under one. So when the bridge is in play the
     * first attempt gets a few seconds, and the fallbacks get the rest.
     */
    const bridged = /patched-fetch/.test(transport());
    const firstBudget = bridged ? Math.min(timeoutMs, 3000) : timeoutMs;
    const laterBudget = Math.max(2000, Math.min(timeoutMs, 5000));

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, firstBudget);

    try {
      const response = await rawFetch(target, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!response) return fail('UNREACHABLE');
      if (!response.ok) return fail('REFUSED', String(response.status));

      let info;
      try {
        info = await response.json();
      } catch (e) {
        /*
         * A BODY THE FIRST ROAD COULD NOT READ IS A TRANSPORT FAULT, NOT A
         * VERDICT ABOUT THE SERVER.
         *
         * This used to give up here, which meant the one failure the fallback
         * roads exist for was the one failure that never reached them. The
         * emulator reported it exactly that way: ok:false, reason UNREADABLE,
         * road "first" - it never tried a second - against a server that
         * answers curl with two hundred bytes of perfectly good JSON.
         *
         * Capacitor's patched fetch is the thing in the middle, and it is
         * already known to mishandle the rest of this call: it ignores an
         * AbortSignal and can simply never come back. Handing back a response
         * whose body will not parse is the same class of fault, so it takes
         * the same road out.
         */
        const unreadable = new Error('unreadable body: ' + describe(e));
        unreadable.unreadable = true;
        throw unreadable;
      }
      if (!looksLikePosnic(info)) return fail('NOT_POSNIC');

      probe.lastFailure = null;
      return { base, info };
    } catch (e) {
      /* An abort is our own timer, not the network saying anything. Told
         apart because "it is slow" and "it is not there" send somebody to
         look in two different places. */
      /*
       * A TIMEOUT IS THE CASE THE FALLBACK EXISTS FOR, and the first draft
       * gave up on it.
       *
       * Capacitor's patched fetch ignores an AbortSignal and, on a real
       * handset against a real server, simply never came back - eight seconds
       * of nothing, reported as "it did not answer in time" about a server
       * that answers a browser on the same phone instantly. Falling back only
       * when fetch THREW meant never falling back at all.
       */
      /* Remembered, because it decides what to call this if every road
         fails: a body nobody could read is a different problem from an
         address nobody could reach, and they send somebody to look in two
         different places. */
      let unreadable = !!(e && e.unreadable);
      const notes = [
        '[' + transport() + ']',
        'fetch: ' + (unreadable ? describe(e) : timedOut ? 'hung' : describe(e)),
      ];

      /* The other roads, in the order most likely to work. An unpatched fetch
         from a fresh frame is the engine's own; XHR is patched separately from
         fetch and fails separately. */
      const roads = [
        ['clean-fetch', async (ms) => {
          const clean = pristineFetch();
          if (!clean) throw new Error('no frame');
          try {
            return await clean.fetch(target, {
              method: 'GET',
              headers: { Accept: 'application/json' },
              cache: 'no-store',
              signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined,
            });
          } finally {
            clean.done();
          }
        }],
        ['xhr', (ms) => fetchByXhr(target, ms)],
      ];

      for (const [name, attempt] of roads) {
        try {
          const response = await attempt(laterBudget);
          if (!response || !response.ok) {
            notes.push(name + ': ' + (response ? String(response.status) : 'no response'));
            continue;
          }
          let info;
          try {
            info = await response.json();
          } catch (body) {
            unreadable = true;
            notes.push(name + ': unreadable body');
            continue;
          }
          if (!looksLikePosnic(info)) return fail('NOT_POSNIC', ' [' + name + ']');
          /* It worked by another road. The address is fine; the bridge is
             not, and the shopkeeper does not need to know that. */
          probe.lastFailure = null;
          probe.usedRoad = name;
          return { base, info };
        } catch (road) {
          notes.push(name + ': ' + describe(road));
        }
      }

      if (unreadable) return fail('UNREADABLE', ' ' + notes.join(' / '));
      return fail(timedOut ? 'TIMED_OUT' : 'UNREACHABLE', ' ' + notes.join(' / '));
    } finally {
      clearTimeout(timer);
    }
  }

  probe.lastFailure = null;
  probe.REASONS = REASONS;
  probe.transport = transport;
  probe.usedRoad = null;

  /** The /24 networks this device is on, most reliable source first. */
  /* Host numbers this device holds, filled in by localSubnets(). See the
     comment in `add` for why they matter more than any guessed list. */
  let ownHosts = [];

  async function localSubnets() {
    const found = [];
    ownHosts = [];
    const add = (value) => {
      const match = String(value || '').match(/(?:\d{1,3}\.){3}\d{1,3}/);
      if (!match) return;
      const parts = match[0].split('.');
      const subnet = parts.slice(0, 3).join('.');
      if (!found.includes(subnet)) found.push(subnet);
      /*
       * AND THE HOST NUMBER THIS DEVICE ITSELF WAS GIVEN.
       *
       * The strongest hint there is about where the till sits. A router hands
       * out its pool in order, so the phone and the till are usually near each
       * other in it - and the pool is not always low: a real shop's till came
       * back on .170, which no list of "likely" numbers would have guessed.
       *
       * Knowing one address in the pool is worth more than guessing at the
       * shape of every router's defaults.
       */
      const host = Number(parts[3]);
      if (host >= 2 && host <= 254 && !ownHosts.includes(host)) ownHosts.push(host);
    };

    /* The native plugin reads the Wi-Fi interface outright. It is the only
       source that cannot be wrong. */
    try {
      const plugin =
        window.Capacitor && window.Capacitor.Plugins
          ? window.Capacitor.Plugins.LocalNetwork
          : null;
      if (plugin && typeof plugin.getLocalIp === 'function') {
        const result = await plugin.getLocalIp();
        add(result && result.ip);
      }
    } catch (e) {
      /* a browser: fall through to WebRTC */
    }

    if (!found.length) {
      await new Promise((resolve) => {
        const PeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if (!PeerConnection) return resolve();
        let peer = null;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          try {
            if (peer) peer.close();
          } catch (e) {
            /* already closed */
          }
          resolve();
        };
        try {
          peer = new PeerConnection({ iceServers: [] });
          peer.createDataChannel('posnic-discovery');
          peer.onicecandidate = (event) => {
            const candidate = event && event.candidate ? event.candidate.candidate : '';
            (candidate.match(/(?:\d{1,3}\.){3}\d{1,3}/g) || []).forEach((ip) => {
              if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) add(ip);
            });
            if (!event.candidate) finish();
          };
          peer
            .createOffer()
            .then((offer) => peer.setLocalDescription(offer))
            .catch(finish);
          setTimeout(finish, 1500);
        } catch (e) {
          finish();
        }
      });
    }

    add(server.lan);
    /* Guesses, and last: what a consumer router hands out. */
    ['192.168.1', '192.168.0', '192.168.29', '10.0.0'].forEach((subnet) => {
      if (!found.includes(subnet)) found.push(subnet);
    });
    return found;
  }

  /** The host numbers of one subnet, likeliest first. */
  function hostOrder() {
    /* The host that worked last, so a re-scan on the same network finishes on
       the first probe rather than the tenth batch. */
    const previous = String(server.lan || '').match(/(?:\d{1,3}\.){3}(\d{1,3})/);
    const first = previous ? Number(previous[1]) : null;

    const seen = new Set();
    const hosts = [];
    const add = (host) => {
      if (host < 2 || host > 254 || seen.has(host)) return;
      seen.add(host);
      hosts.push(host);
    };

    if (first) add(first);

    /*
     * THIS DEVICE'S OWN NEIGHBOURHOOD, before any general guess.
     *
     * A router hands out its pool in order, so whatever address the phone was
     * given, the till is usually within a dozen of it. A real shop's till came
     * back on .170 - not low, not round, and not on any list anybody would
     * have written. Its phone would have been in the same part of the pool.
     */
    for (const own of ownHosts) {
      for (let step = 0; step <= 12; step += 1) {
        add(own - step);
        add(own + step);
      }
    }

    LIKELY_HOSTS.forEach(add);
    for (let host = 2; host <= 254; host++) add(host);
    return hosts;
  }

  /** How many of those are the fast first pass: the known host, this device's
      neighbourhood, and the general guesses. Still under sixty probes. */
  const likelyCount = () => new Set([...LIKELY_HOSTS]).size + 1 + ownHosts.length * 25;

  async function scanSubnet(subnet, { hosts, onProgress, onBatch, shouldStop, concurrency } = {}) {
    const list = hosts || hostOrder();
    const width = concurrency || SCAN_CONCURRENCY;

    for (let start = 0; start < list.length; start += width) {
      if (shouldStop && shouldStop()) return null;
      const batch = list.slice(start, start + width);
      const results = await Promise.all(
        batch.map((host) => probe(`http://${subnet}.${host}:${LAN_PORT}`, SCAN_TIMEOUT_MS))
      );
      if (onBatch) onBatch(batch.length);
      if (onProgress) onProgress(Math.min(start + width, list.length), list.length);
      const hit = results.find(Boolean);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Find the shop's own server on this Wi-Fi.
   *
   * The known address is checked first and alone: when it is right, which it is
   * on every shift after the first, this returns in under a second and no sweep
   * happens at all.
   */
  async function findOnWifi({ onProgress, shouldStop, skipKnown = false } = {}) {
    if (!skipKnown && server.lan) {
      if (onProgress) onProgress(0, 0, server.lan);
      const hit = await probe(server.lan, 1500);
      if (hit) return hit;
    }
    if (shouldStop && shouldStop()) return null;

    const subnets = await localSubnets();

    /*
     * Every network at once, not one after another.
     *
     * This swept subnets in sequence, and a Windows machine has more networks
     * than anybody thinks: measured on the development desk it offered four -
     * the Wi-Fi, a minikube bridge and two WSL bridges - so a first run took
     * 24 seconds to find a till that was answering the whole time. A waiter
     * watching a screen do nothing for 24 seconds concludes the app is broken.
     *
     * Ranking them better was the other option and is guesswork: nothing in a
     * WebRTC candidate says which interface it came from. Searching all of
     * them together makes the ranking not matter, because only a real Posnic
     * server answers and the first one that does wins.
     */
    let stopped = false;
    /*
     * A deadline that nothing can outlive.
     *
     * The sweep used to be bounded only by how long the slowest of a thousand
     * queued requests took to give up, which on a busy network is not bounded
     * in any way a person would call bounded.
     */
    const deadline = Date.now() + SEARCH_DEADLINE_MS;
    const stop = () =>
      stopped || Date.now() > deadline || (shouldStop ? shouldStop() : false);

    /* Progress is reported as one number across the whole search rather than
       per subnet, because "3 of 4 networks" means nothing to the person
       holding the phone. */
    let done = 0;
    const total = subnets.length * 253;
    const report = (delta) => {
      done += delta;
      if (onProgress) onProgress(Math.min(done, total), total, 'this Wi-Fi');
    };

    /*
     * THE LIKELY ADDRESSES FIRST, everywhere, as one small pass.
     *
     * A till is nearly always low on its subnet or on a round static number,
     * so this is about thirty probes instead of a thousand and it answers in
     * about a second. Only when it finds nothing does the full sweep run.
     *
     * Doing it this way round is what stopped the search LOOKING like a hang:
     * the 500ms probe timeout starts when fetch is called, not when the socket
     * opens, so firing a thousand at once means the later ones time out having
     * never left the queue. A small pass actually runs.
     */
    const sweep = (hosts, concurrency) =>
      Promise.all(
        subnets.map((subnet) =>
          scanSubnet(subnet, {
            hosts,
            concurrency,
            shouldStop: stop,
            onProgress: () => report(0),
            onBatch: (size) => report(size),
          }).then((hit) => {
            /* The first answer ends the others: there is one till, and the
               remaining sweeps are only spending the phone's radio. */
            if (hit) stopped = true;
            return hit;
          })
        )
      );

    const order = hostOrder();
    const likely = order.slice(0, likelyCount());

    const quick = (await sweep(likely, likely.length)).find(Boolean);
    if (quick) return quick;
    if (stop()) return null;

    /*
     * And then the rest, narrower.
     *
     * The concurrency is divided across the subnets rather than applied to
     * each, so four networks do not put 256 requests in flight at once - which
     * is the state that made every later batch time out in the queue instead
     * of on the wire.
     */
    const rest = order.slice(likely.length);
    const width = Math.max(8, Math.floor(SCAN_CONCURRENCY / Math.max(1, subnets.length)));
    return (await sweep(rest, width)).find(Boolean) || null;
  }

  /* ------------------------------------------------------------ resolution */

  let resolving = null;

  /**
   * Choose a server that answers, in preference order.
   *
   * Always walks the whole list rather than asking only whether the current one
   * is alive. Those are different questions, and the difference is the point: a
   * phone that fell back to the cloud yesterday would answer the second one
   * "yes" for ever and keep routing every order over the internet while
   * standing two metres from the till.
   *
   * One runs at a time, so a burst of failed requests cannot start a burst of
   * scans.
   */
  function resolve({ allowScan = false } = {}) {
    if (resolving) return resolving;

    resolving = (async () => {
      for (const candidate of server.candidates()) {
        const hit = await probe(candidate);
        if (hit && server.canAdopt(hit.base)) {
          server.adopt(hit.base);
          return hit.base;
        }
      }

      /* A sweep is affordable only where nothing else is happening, which is
         the sign-in screen. Mid-service it would stall the screen a waiter is
         holding for seconds, to find what is not there. */
      if (allowScan) {
        /*
         * Say that something is happening.
         *
         * A first run on a shop's Wi-Fi connects with no taps at all, which is
         * the point - but it took 24 seconds on the measured desk, and for all
         * of them the screen said nothing. Silence for that long is
         * indistinguishable from a broken app, and the person holding the
         * phone starts pressing things. The search is the same; only now it
         * admits to being under way.
         */
        window.dispatchEvent(new CustomEvent('posnic:searching', { detail: { done: 0, total: 0 } }));
        const hit = await findOnWifi({
          onProgress: (done, total) =>
            window.dispatchEvent(new CustomEvent('posnic:searching', { detail: { done, total } })),
        });
        window.dispatchEvent(new CustomEvent('posnic:searched', { detail: { found: !!hit } }));
        if (hit && server.canAdopt(hit.base)) {
          server.adopt(hit.base);
          return hit.base;
        }
      }
      return null;
    })().finally(() => {
      resolving = null;
    });

    return resolving;
  }

  /* ------------------------------------------------------------------- api */

  /*
   * What may be replayed on the other server after a failure, and what may not.
   *
   * A network error says the reply did not arrive. It does NOT say the request
   * was not carried out: an order may have been written a millisecond before
   * the Wi-Fi dropped. Replaying it writes it twice, and because the till and
   * the cloud sync to each other the duplicate comes back, so the kitchen makes
   * two of everything and the shop is out of pocket.
   *
   * An allowlist of reads rather than a method check, because most reads here
   * are POSTs - they carry a branch id in a body - so "GET is safe" would have
   * disabled failover for nearly everything while protecting nothing.
   */
  const REPLAYABLE = new Set([
    '/items/accessQr',
    '/users/kioskMobileLogin',
    '/sales/getTablesWithActiveOrders',
    '/sales/getOrderHistory',
    '/sales/getListKot',
    '/sales/getFrequentItems',
  ]);

  const isReplayable = (path, method) =>
    method === 'GET' || method === 'HEAD' || REPLAYABLE.has(String(path).split('?')[0]);

  async function readBody(response) {
    const type = response.headers.get('content-type') || '';
    if (type.includes('application/json')) {
      try {
        return await response.json();
      } catch (e) {
        return null;
      }
    }
    try {
      return await response.text();
    } catch (e) {
      return null;
    }
  }

  function toApiError(response, body) {
    const detail = body && body.error ? body.error : null;
    const message =
      (detail && detail.message) ||
      (body && body.message) ||
      `The server answered ${response.status}`;
    return new ApiError(message, {
      status: response.status,
      code: (detail && detail.code) || `HTTP_${response.status}`,
      body,
    });
  }

  /**
   * One request, with the base URL, the credential, a deadline and failover
   * applied in one place.
   *
   * Returns the parsed body. Throws ApiError for anything else, so a caller
   * never has to check `response.ok` or remember which endpoints need a token.
   */
  async function request(path, { method = 'GET', body, headers, raw = false, timeout } = {}) {
    if (!server.baseUrl) {
      throw new ApiError('No shop server has been chosen yet', { code: 'NO_SERVER' });
    }

    const send = async (base) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout || REQUEST_TIMEOUT_MS);

      const requestHeaders = new Headers(headers || {});
      requestHeaders.set('Accept', 'application/json');
      if (session.token && !requestHeaders.has('Authorization')) {
        requestHeaders.set('Authorization', `Bearer ${session.token}`);
      }
      if (body !== undefined && !requestHeaders.has('Content-Type')) {
        requestHeaders.set('Content-Type', 'application/json');
      }

      try {
        return await rawFetch(base + path, {
          method,
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          cache: 'no-store',
        });
      } finally {
        clearTimeout(timer);
      }
    };

    const base = server.baseUrl;
    let response;
    try {
      response = await send(base);
    } catch (cause) {
      /* Find a working server whatever the request was, so the next attempt
         lands in the right place, then replay only if replaying is safe. */
      const moved = await resolve();
      if (moved) net.setOnline();
      else net.setOffline();

      if (moved && moved !== base && isReplayable(path, method)) {
        try {
          response = await send(moved);
        } catch (retryCause) {
          throw new ApiError('Could not reach the shop server', {
            code: 'OFFLINE',
            body: String(retryCause && retryCause.message),
          });
        }
      } else {
        throw new ApiError(
          cause && cause.name === 'AbortError'
            ? 'The shop server did not answer in time'
            : 'Could not reach the shop server',
          { code: cause && cause.name === 'AbortError' ? 'TIMEOUT' : 'OFFLINE' }
        );
      }
    }

    net.setOnline();

    if (raw) {
      if (!response.ok) throw toApiError(response, await readBody(response));
      return response;
    }

    const payload = await readBody(response);
    if (!response.ok) {
      const error = toApiError(response, payload);
      /* A credential the server will not accept is worse than none: every
         later request carries it and fails the same way. Drop it and let the
         sign-in screen take over.
         Only when there WAS one. A 401 with no token in hand means the server
         is older than the bearer-token work and refuses this route to
         everyone; clearing an empty session would just bounce the user back to
         a sign-in that cannot help. */
      if (error.status === 401 && session.token && !path.includes('kioskMobileLogin')) {
        session.end();
      }
      /*
       * A 401 on the SIGN-IN route means the password was wrong.
       *
       * Everywhere else a tokenless 401 really does mean an old server - one
       * from before the bearer-token work, refusing the route to everybody.
       * But kioskMobileLogin answers 401 for a bad credential, which is
       * correct and ordinary, and this turned that into "update POSNIC on the
       * till": a confident wrong diagnosis that sends somebody to upgrade
       * their server because they mistyped a password.
       *
       * The route is already excluded from the session-clearing branch above,
       * for the same reason. It was missed here.
       */
      if (error.status === 401 && !session.token && !path.includes('kioskMobileLogin')) {
        error.code = 'SERVER_TOO_OLD';
        error.message =
          'This shop’s server is too old for this screen. Update POSNIC on the till.';
      }
      throw error;
    }
    return payload;
  }

  const api = {
    ApiError,
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
    /** For the rare case that needs the Response itself, such as printable HTML. */
    raw: (path, options) => request(path, { ...options, raw: true }),
  };

  /* --------------------------------------------------------------- network */

  const net = (function () {
    let offline = false;
    let delay = HEALTH_OK_MS;
    let timer = null;
    let attempts = 0;
    let nextAt = 0;
    let ticker = null;

    /*
     * Show that waiting is a real option.
     *
     * The app retries on its own, but a screen that only offers two buttons
     * looks like it is waiting for the user, so people tap Try now every few
     * seconds and conclude it is broken. Saying when the next attempt happens
     * turns doing nothing into a choice.
     */
    function countdown() {
      clearInterval(ticker);
      const status = document.getElementById('posnic-offline-status');
      if (!status) return;
      const paint = () => {
        if (!offline) return;
        const left = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
        status.textContent =
          (attempts === 1 ? 'Tried once' : `Tried ${attempts} times`) +
          (left > 0 ? `, trying again in ${left}s` : ', trying again now');
      };
      paint();
      ticker = setInterval(paint, 1000);
    }

    function settingsOpen() {
      const modal = document.getElementById('serverModal');
      return !!(modal && modal.style.display && modal.style.display !== 'none');
    }

    /*
     * SOMEBODY IS CHOOSING A SERVER. DO NOT FIGHT THEM.
     *
     * Owner: "still change server not working. still looking for same not
     * working old config and after two try its showing option to edit."
     *
     * Tapping Change shop server sets a flag and comes here. This file's own
     * DOMContentLoaded listener then started a health check against the
     * address the person had just said was wrong - and because that address is
     * dead, the check spends its full timeout, fails, schedules a retry and
     * goes round again. The editor is open the whole time, underneath an app
     * busy proving what everybody already knows.
     *
     * settingsOpen() covers the modal once it is UP, and misses this entirely:
     * net.start() runs on DOMContentLoaded and the modal opens sixty
     * milliseconds later, so the probe is already away before there is a modal
     * to notice.
     *
     * Two flags because they mark two moments. `posnic_change_server` is set
     * on the screen being left, before this page exists at all, which is the
     * only thing early enough to be read here. `posnic_editing_server` lasts
     * as long as the editor is open.
     */
    function choosingServer() {
      try {
        return (
          sessionStorage.getItem('posnic_change_server') === '1' ||
          sessionStorage.getItem('posnic_editing_server') === '1'
        );
      } catch (e) {
        /* private mode: behave as though nobody is, which is the old way */
        return false;
      }
    }

    function overlay() {
      let element = document.getElementById('posnic-offline');
      if (element) return element;

      element = document.createElement('div');
      element.id = 'posnic-offline';
      element.hidden = true;
      element.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'background:rgba(2,6,23,0.96)',
        'color:#fff',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:24px',
        'text-align:center',
        'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      ].join(';');
      element.innerHTML = `
        <div style="max-width:380px;width:100%;">
          <div style="font-size:42px;margin-bottom:12px;">!</div>
          <h2 id="posnic-offline-title" style="margin:0 0 8px;font-size:23px;font-weight:800;color:#f97316;">Shop server is not responding</h2>
          <p id="posnic-offline-body" style="margin:0 0 4px;color:#e5e7eb;font-size:14px;line-height:1.5;"></p>
          <div id="posnic-offline-url" style="margin:10px 0 4px;color:#94a3b8;font-size:12px;word-break:break-all;"></div>
          <div id="posnic-offline-status" style="margin:0 0 18px;color:#64748b;font-size:12px;min-height:16px;"></div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button type="button" id="posnic-offline-retry" style="border:none;border-radius:8px;background:#f97316;color:#111827;font-weight:800;padding:11px 18px;cursor:pointer;">Try now</button>
            <button type="button" id="posnic-offline-settings" style="border:1px solid #475569;border-radius:8px;background:#111827;color:#fff;font-weight:700;padding:11px 18px;cursor:pointer;">Change server</button>
          </div>
        </div>`;
      document.body.appendChild(element);

      element.querySelector('#posnic-offline-retry').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Trying...';
        try {
          await net.check(true);
        } finally {
          button.disabled = false;
          button.textContent = 'Try now';
        }
      });
      element.querySelector('#posnic-offline-settings').addEventListener('click', () => {
        sessionStorage.setItem('posnic.open-server-settings', '1');
        window.location.href = 'index.html';
      });
      return element;
    }

    const net = {
      get offline() {
        return offline;
      },

      setOffline() {
        offline = true;
        attempts += 1;
        delay = HEALTH_DOWN_MS;

        /*
         * Never wall off a device that has simply not been set up yet.
         *
         * "No connection" and "no server chosen" look identical from here and
         * are completely different problems. Painting the outage screen over a
         * fresh install hides the sign-in form and the settings gear, which
         * are the only two things that could fix it.
         */
        if (!server.isConfigured || settingsOpen()) return;

        const element = overlay();
        const local = server.isLocal;

        /*
         * Name the thing that is down, and say whose it is.
         *
         * "No connection" reads as a problem with the phone, so people restart
         * the phone. The address is nearly always fine and the till is off, so
         * the screen says which one it is and what would fix it.
         */
        const title = element.querySelector('#posnic-offline-title');
        const body = element.querySelector('#posnic-offline-body');
        const url = element.querySelector('#posnic-offline-url');

        if (title) title.textContent = local ? 'The till is not responding' : 'The shop server is not responding';
        if (body) {
          body.textContent = local
            ? 'This address answered before, so it is usually the till: check POSNIC is open on it, and that this phone is on the shop Wi-Fi.'
            : 'This address answered before, so it is usually the connection: check this phone has internet.';
        }
        if (url) url.textContent = server.baseUrl || '';

        ['loader', 'page-loader'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.hidden = true;
        });
        element.hidden = false;
        document.documentElement.classList.add('posnic-offline-active');
        countdown();
      },

      setOnline() {
        delay = HEALTH_OK_MS;
        attempts = 0;
        clearInterval(ticker);
        if (!offline) return;
        offline = false;
        const element = document.getElementById('posnic-offline');
        if (element) element.hidden = true;
        document.documentElement.classList.remove('posnic-offline-active');
        window.dispatchEvent(new CustomEvent('posnic:online'));
      },

      hideOverlay() {
        const element = document.getElementById('posnic-offline');
        if (element) element.hidden = true;
        document.documentElement.classList.remove('posnic-offline-active');
      },

      async check(manual = false) {
        /* A scheduled tick that arrives mid-edit stands aside too; a manual
           check is the editor itself asking, and always runs. */
        if (!manual && choosingServer()) return false;
        const chosen = await resolve({ allowScan: manual });
        if (chosen) {
          net.setOnline();
          return true;
        }
        net.setOffline();
        return false;
      },

      /* Exposed because the sign-in page has a boot check of its own and it
         has to make the same decision from the same facts. */
      choosingServer,

      start() {
        if (!server.isConfigured) return;
        /*
         * Not while somebody is picking one. The editor calls start() again
         * when it closes, so nothing is lost by waiting - and what is gained
         * is that the address they are typing over is not simultaneously
         * being dialled.
         */
        if (choosingServer()) return;
        net.check(false);
        const tick = () => {
          clearTimeout(timer);
          nextAt = Date.now() + delay;
          timer = setTimeout(async () => {
            await net.check(false);
            tick();
          }, delay);
        };
        tick();
      },
    };

    return net;
  })();

  /* --------------------------------------------------------------- exports */

  window.POSNIC = {
    debug,
    server,
    session,
    api,
    net,
    discovery: { probe, findOnWifi, scanSubnet, localSubnets },
    resolve,
    ApiError,
    constants: { CLOUD_SUFFIX, API_PATH, LAN_PORT },
  };

  document.addEventListener('DOMContentLoaded', () => net.start());

  /* Coming back onto the shop Wi-Fi should not need a tap. */
  window.addEventListener('online', () => net.check(false));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) net.check(false);
  });
})();
