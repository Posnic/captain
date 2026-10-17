(function (host) {
  "use strict";
  // Keep local till traffic on the connected Wi-Fi even when Android chooses
  // cellular as its Internet network. Cloud requests retain their usual route.
  host.CaptainFetch = async function (url, options = {}) {
    const parsed = new URL(url, host.location?.href || 'http://localhost');
    const parts = parsed.hostname.split('.').map(Number);
    const local = /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname) &&
      (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
       (parts[0] === 192 && parts[1] === 168));
    const plugin = host.Capacitor?.getPlatform?.() === 'android' && host.Capacitor?.Plugins?.LocalNetwork;
    if (!local || host.Capacitor?.getPlatform?.() !== 'android') return host.fetch(url, options);
    if (!parsed.pathname.startsWith('/api/') || !plugin?.request)
      throw new Error('Shop Wi-Fi transport is unavailable. Update Captain and try again.');
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    // No transport fallback after sending: a timed-out order may already exist.
    const id = host.crypto.randomUUID();
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => {
        plugin.cancelRequest?.({id}).catch(() => {});
        reject(new DOMException('Aborted', 'AbortError'));
      };
      options.signal?.addEventListener('abort', abort, { once: true });
    });
    try {
      const result = await Promise.race([plugin.request({
        id, url: parsed.href, method: options.method || 'GET',
        headers: Object.fromEntries(new Headers(options.headers || {})),
        ...(options.body == null ? {} : { body: options.body }),
      }), cancelled]);
      const bytes = Uint8Array.from(atob(result.data || ''), c => c.charCodeAt(0));
      return new Response([204,205,304].includes(result.status) ? null : bytes,
        { status: result.status, headers: result.headers });
    } finally { options.signal?.removeEventListener('abort', abort); }
  };
  // Check the same authorization used by the orders screen before saving a grant.
  // The credential is sent only to the server which just issued it.
  host.CaptainValidateAccess = async function (grant, base, signal) {
    if (!grant?.token) return; // Legacy servers do not issue bearer grants.
    const branch = grant.branches?.[0]?.branch_id || grant.branches?.[0]?.store_id || '';
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(abort, 7000);
    try {
      if (signal?.aborted) controller.abort();
      const response = await host.CaptainFetch(base + '/sales/getListKot?page=1&limit=1&branchId=' + encodeURIComponent(branch), {
        credentials:'omit', redirect:'error', cache:'no-store', signal:controller.signal,
        headers:{Accept:'application/json', Authorization:'Bearer ' + grant.token}
      });
      const body = await response.json();
      if (!response.ok || body?.type === 'error') throw Object.assign(new Error(body?.error?.message || body?.message || 'Could not sign in.'), {status:response.status,code:body?.error?.code || body?.code});
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
  function showDisabled(error) {
    if (!host.document || host.document.getElementById('captain-disabled')) return;
    if(error.code !== 'CAPTAIN_DISABLED' && !/captain is disabled/i.test(error.message || ''))return;
    const t = value => host.I18N?.t(value) || value;
    const dialog=host.document.createElement('dialog');dialog.id='captain-disabled';
    dialog.style.cssText='box-sizing:border-box;width:min(420px,calc(100% - 32px));margin:auto;padding:24px;border:1px solid var(--line,#ccd5e0);border-radius:20px;background:var(--surface,#fff);color:var(--ink,#172638)';
    const message=host.document.createElement('p');message.textContent=t(error.message);dialog.append(message);
    for(const label of ['Sign in','Change server']){
      const button=host.document.createElement('button');button.textContent=t(label);
      button.style.cssText='min-height:48px;width:100%;margin-top:12px;border-radius:12px;border:1px solid var(--line,#ccd5e0);background:var(--surface,#fff);color:var(--accent,#2458db);font:inherit';
      button.onclick=()=>{host.sessionStorage.setItem('posnic_editing_server','1');host.sessionStorage.setItem('posnic_connection_view',label==='Change server'?'start':'address');host.location.href='index.html';};
      dialog.append(button);
    }
    dialog.addEventListener('cancel',e=>e.preventDefault());
    host.document.body.append(dialog);dialog.showModal();
  }
  host.CaptainShowDisabled = showDisabled;
  function createAccess(plugin, storage, fetcher, cryptoApi = host.crypto) {
    let state = {},
      profile = null,
      pinSet = false,
      locked = false,
      flight = null,
      generation = 0;
    const random = () => {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
      return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    };
    const apply = (result) => {
      pinSet = !!result.pinSet;
      locked = !!result.locked;
      profile = result.profile || null;
      state = result.session || {};
      return result;
    };
    let lifecycle = Promise.resolve();
    let suspended = false;
    function transition(action) {
      lifecycle = lifecycle.catch(() => {}).then(action);
      return lifecycle;
    }
    async function resume() {
      return transition(async () => {
        await ready;
        await writing.catch(() => {});
        apply(await plugin.status());
        suspended = false;
        cooling.clear();
        nextConnectionCheck = 0;
      });
    }
    let writing = Promise.resolve();
    function persist() {
      const started = generation,
        snapshot = JSON.parse(JSON.stringify(state));
      writing = writing
        .catch(() => {})
        .then(async () => {
          if (generation !== started) return;
          const result = await plugin.save({ session: snapshot });
          if (generation === started) {
            pinSet = !!result.pinSet;
            locked = !!result.locked;
            profile = result.profile || null;
          }
        });
      return writing;
    }
    const ready = (async () => {
      apply(await plugin.status());
      if(storage.getItem('posnic.remember-session')==='0'&&!host.sessionStorage?.getItem('posnic.current-session')) {
        await plugin.clear();apply(await plugin.status());storage.removeItem('posnic.session');
      }
      const legacy = JSON.parse(storage.getItem("posnic.session") || "{}");
      if (!profile && legacy.token) {
        state = legacy;
        await persist();
      }
      // Remove only after secure storage has successfully answered/persisted.
      if (legacy.token && legacy.user?.id && legacy.shopKey) {
        const base = JSON.parse(
          storage.getItem("posnic.server") || "{}",
        ).active;
        if (base) {
          const rows = JSON.parse(
            storage.getItem("posnic.pending-orders") || "[]",
          );
          storage.setItem(
            "posnic.pending-orders",
            JSON.stringify(
              rows.map((row) =>
                row.owner
                  ? row
                  : {
                      ...row,
                      owner: {
                        user: legacy.user.id,
                        shop: legacy.shopKey,
                        base,
                        branch:
                          row.body?.branch_id || storage.getItem("branch_id"),
                      },
                    },
              ),
            ),
          );
        }
      }
      storage.removeItem("posnic.session");
    })();
    async function post(base, path, body, signal, limit = 7000) {
      const controller = new AbortController(),
        abort = () => controller.abort();
      if (signal?.aborted) throw new Error("Connection cancelled.");
      signal?.addEventListener("abort", abort, { once: true });
      let timer;
      try {
        return await Promise.race([
          (async () => {
            const res = await fetcher(base + path, {
              method: "POST",
              credentials: "omit",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
              redirect: "error",
            });
            const data = await res.json();
            if (!res.ok)
              throw Object.assign(
                new Error(
                  data.error?.message ||
                    data.message ||
                    "Connection was not approved.",
                ),
                { status: res.status, code: data.error?.code },
              );
            return data;
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              abort();
              reject(
                Object.assign(
                  new Error(
                    "The server is unavailable. Your orders are saved.",
                  ),
                  { offline: true },
                ),
              );
            }, limit);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }
    const verified = new Set();
    const cooling = new Map();
    const local = (url) =>
      /^http:\/\/(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)/.test(
        url,
      );
    const safeRoute = (value) => {
      try {
        const u = new URL(value);
        return !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          (u.protocol === "https:" || local(u.href))
          ? u.href.replace(/\/$/, "")
          : null;
      } catch {
        return null;
      }
    };
    async function prove(base, credential = state, remember = true, signal) {
      const nonce = random();
      const answer = await post(
        base,
        "/captain/v1/route-proof",
        { sessionId: credential.sessionId, nonce },
        signal,
        2000,
      );
      const key = await cryptoApi.subtle.importKey(
        "raw",
        new TextEncoder().encode(credential.routeKey),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const bytes = await cryptoApi.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(nonce),
      );
      const expected = [...new Uint8Array(bytes)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      if (answer.proof !== expected)
        throw Object.assign(
          new Error("This address is not the server that approved this phone."),
          { code: "WRONG_AUTHORITY" },
        );
      if (remember) verified.add(base);
    }
    let connectionFlight = null,
      nextConnectionCheck = 0;
    const rotations = new Map();
    const sameIdentity = (grant) =>
      grant.shopKey === state.shopKey &&
      grant.user?.id === state.user?.id &&
      grant.branches?.[0]?.branch_id === state.branches?.[0]?.branch_id;
    async function refreshConnections() {
      if (
        locked ||
        !state.cloudAuthorization?.connectionToken ||
        connectionFlight ||
        Date.now() < nextConnectionCheck
      )
        return;
      nextConnectionCheck = Date.now() + 5 * 60000;
      const started = generation;
      connectionFlight = (async () => {
        let pending = state.pendingConnections;
        if (!pending) {
          const metadata = await post(
            "https://www.posnic.com",
            "/api/mobile/connections",
            {
              connectionToken: state.cloudAuthorization.connectionToken,
              codeVerifier: state.cloudAuthorization.verifier,
              connectedDevices: (state.connections || [])
                .map((connection) => connection.targetDeviceId)
                .filter(Boolean),
            },
          );
          if (
            generation !== started ||
            locked ||
            safeRoute(metadata.baseUrl) !== state.base
          )
            return;
          pending = metadata.localServers || [];
          state.pendingConnectionsUntil = Date.now() + 150000;
        }
        state.pendingConnectionsUntil ||= Date.now() + 150000;
        const retry = [];
        for (const target of pending.slice(0, 8)) {
          if (generation !== started || locked) return;
          const addresses = (target.addresses || [])
            .map(safeRoute)
            .filter((base) => base && local(base));
          if (!addresses.length || !target.deviceId) continue;
          const known = (state.connections || []).find(
            (c) => c.targetDeviceId === target.deviceId,
          );
          if (known) {
            known.routes = addresses;
            continue;
          }
          let paired = false;
          for (const base of addresses.slice(0, 2)) {
            try {
              const nonce = random();
              const answer = await post(
                base,
                "/captain/v1/enrolment-proof",
                { enrolmentId: target.enrolmentId, nonce },
                null,
                1800,
              );
              const digest = await cryptoApi.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(target.code),
              );
              const secret = [...new Uint8Array(digest)]
                .map((n) => n.toString(16).padStart(2, "0"))
                .join("");
              const key = await cryptoApi.subtle.importKey(
                "raw",
                new TextEncoder().encode(secret),
                { name: "HMAC", hash: "SHA-256" },
                false,
                ["sign"],
              );
              const proof = [
                ...new Uint8Array(
                  await cryptoApi.subtle.sign(
                    "HMAC",
                    key,
                    new TextEncoder().encode(nonce),
                  ),
                ),
              ]
                .map((n) => n.toString(16).padStart(2, "0"))
                .join("");
              if (proof !== answer.proof) continue;
              const grant = await post(base, "/captain/v1/pair", {
                code: target.code,
                device: host.POSNIC.thisDevice.facts(),
                codeVerifier: state.cloudAuthorization.verifier,
              });
              if (generation !== started || locked) return;
              if (!sameIdentity(grant)) continue;
              state.connections = [
                ...(state.connections || []),
                {
                  ...grant,
                  base,
                  routes: addresses,
                  targetDeviceId: target.deviceId,
                  expiresAt: Date.now() + grant.expiresIn * 1000,
                },
              ];
              host.POSNIC?.server.remember({ lan: base });
              paired = true;
              break;
            } catch {
              /* The cloud connection remains usable while a till catches up. */
            }
          }
          if (!paired) retry.push(target);
        }
        if (generation === started && !locked) {
          if (retry.length) {
            if (Date.now() < state.pendingConnectionsUntil)
              state.pendingConnections = retry;
            else {
              delete state.pendingConnections;
              delete state.pendingConnectionsUntil;
            }
            nextConnectionCheck = Date.now() + 10000;
          } else {
            delete state.pendingConnections;
            delete state.pendingConnectionsUntil;
          }
          await persist();
        }
      })()
        .catch(() => {
          nextConnectionCheck = Date.now() + 30000;
        })
        .finally(() => {
          connectionFlight = null;
        });
      return connectionFlight;
    }
    function authority(credential) {
      return (
        credential.targetDeviceId ||
        (state.cloudAuthorization ? "cloud:" + state.shopKey : credential.base)
      );
    }
    function orderAuthority(key, value) {
      const name = "posnic.order-authorities";
      const entries = JSON.parse(storage.getItem(name) || "{}");
      const id = state.shopKey + ":" + state.user?.id + ":" + key;
      if (value) {
        entries[id] = value;
        storage.setItem(name, JSON.stringify(entries));
      }
      return entries[id];
    }
    let activeRequests = 0;
    async function transport(path, options, refreshBody) {
      if (refreshBody && !state.routeKey)
        return post(state.base, path, refreshBody);
      const start = generation;
      const choiceRevision = host.POSNIC?.internetChoice?.revision;
      const choices = [state, ...(!refreshBody ? state.connections || [] : [])];
      const credentials = new Map();
      for (const credential of choices)
        for (const base of [credential.base, ...(credential.routes || [])]
          .map(safeRoute)
          .filter(Boolean)) {
          if (!credentials.has(base)) credentials.set(base, credential);
        }
      const preferred=host.POSNIC?.server.pinned || host.POSNIC?.server.baseUrl || state.lastRoute;
      const preferredLocal=host.POSNIC?.server.priority !== 'cloud';
      let wifi=null;
      if(host.Capacitor?.Plugins?.LocalNetwork?.getLocalIp) {
        try { const network=await Promise.race([host.Capacitor.Plugins.LocalNetwork.getLocalIp(),new Promise(resolve=>setTimeout(()=>resolve(null),800))]);wifi=network?.wifi; } catch (_) {}
      }
      host.POSNIC?.internetChoice?.setWifi?.(wifi);
      const routes = [...credentials.keys()].sort(
        (a, b) =>
          Number((cooling.get(a) || 0) > Date.now()) -
            Number((cooling.get(b) || 0) > Date.now()) ||
          (!options.background ? Number(b===preferred)-Number(a===preferred) : 0) ||
          (host.POSNIC?.server.pinned || !host.POSNIC?.server.priorityConfigured ? Number(b===preferred)-Number(a===preferred) : 0) ||
          (preferredLocal ? Number(local(b))-Number(local(a)) : Number(local(a))-Number(local(b))) ||
          Number(b===preferred)-Number(a===preferred),
      ).filter(base=>(wifi!==false||!local(base))&&(!options.onlyBase||base===options.onlyBase));
      const orderKey =
        path === "/sales/qrOrder" && options.body?.idempotencyKey;
      let last;
      for (const base of routes) {
        // Do not send credentials or orders to an unselected connection.
        if(host.POSNIC?.internetChoice?.allowed ? !host.POSNIC.internetChoice.allowed(base) : storage.getItem('posnic.automatic-connections')==='0' && base!==(options.onlyBase||preferred||state.base))continue;
        let attempted = false;
        const credential = credentials.get(base);
        if (credential.expiresAt && credential.expiresAt <= Date.now() && !credential.refreshToken) {
          last = Object.assign(new Error('Sign-in required'), {status:401, code:'CONNECTION_SIGNIN'});
          continue;
        }
        if (
          orderKey &&
          orderAuthority(orderKey) &&
          orderAuthority(orderKey) !== authority(credential)
        )
          continue;
        try {
          if (credential.routeKey) await prove(base, credential);
          if (
            credential !== state &&
            credential.refreshToken &&
            credential.expiresAt < Date.now() + 60000
          ) {
            if (!rotations.has(credential))
              rotations.set(
                credential,
                (async () => {
                  credential.rotation ||= random();
                  await persist();
                  const renewed = await post(base, "/captain/v1/refresh", {
                    sessionId: credential.sessionId,
                    refreshToken: credential.refreshToken,
                    nextToken: credential.rotation,
                  });
                  if (start !== generation || locked)
                    throw Object.assign(new Error("Unlock this phone first."), {
                      code: "PIN_LOCKED",
                    });
                  if (!sameIdentity(renewed))
                    throw Object.assign(
                      new Error(
                        "This address is not the server that approved this phone.",
                      ),
                      { code: "WRONG_AUTHORITY" },
                    );
                  Object.assign(credential, renewed, {
                    expiresAt: Date.now() + renewed.expiresIn * 1000,
                  });
                  delete credential.rotation;
                  await persist();
                })().finally(() => rotations.delete(credential)),
              );
            try {
              await rotations.get(credential);
            } catch (error) {
              if ([401, 403].includes(error.status)) error.accessRefused = true;
              throw error;
            }
          }
          if (!credential.routeKey && base !== credential.base) continue;
          if (start !== generation || locked)
            throw Object.assign(new Error("Unlock this phone first."), {
              code: "PIN_LOCKED",
            });
          // A preferred route returning is checked over several health ticks.
          // Ordinary requests stay on the working route; failed routes can fail
          // over immediately, subject to the same consent and replay rules.
          const returning=options.background && base!==preferred && local(base) && !local(preferred) && (cooling.get(preferred)||0)<=Date.now();
          if(options.background && (activeRequests || choiceRevision !== host.POSNIC?.internetChoice?.revision)) return {connectionCheckDeferred:true};
          if (host.POSNIC?.internetChoice && !(await host.POSNIC.internetChoice.ask(base,{returning}))) continue;
          if(options.background && (activeRequests || choiceRevision !== host.POSNIC?.internetChoice?.revision)) return {connectionCheckDeferred:true};
          if (start !== generation || locked) throw Object.assign(new Error('Unlock this phone first.'), {code:'PIN_LOCKED'});
          if (orderKey) orderAuthority(orderKey, authority(credential));
          attempted = true;
          let result;
          if (refreshBody) result = await post(base, path, refreshBody);
          else {
            const controller = new AbortController();
            let timer;
            try {
              result = await Promise.race([
                (async () => {
                  const response = await fetcher(base + path, {
                    method: options.method || "GET",
                    credentials: "omit",
                    redirect: "error",
                    cache: "no-store",
                    signal: controller.signal,
                    headers: {
                      ...options.headers,
                      Accept: "application/json",
                      "Content-Type": "application/json",
                      Authorization: "Bearer " + credential.token,
                    },
                    body:
                      options.body === undefined
                        ? undefined
                        : JSON.stringify(options.body),
                  });
                  if (options.raw && response.ok) return response;
                  else {
                    const payload = await response.json().catch(() => null);
                    if (!response.ok)
                      throw Object.assign(
                        new Error(
                          payload?.error?.message ||
                            payload?.message ||
                            `Server answered ${response.status}`,
                        ),
                        {
                          status: response.status,
                          code: payload?.error?.code || payload?.code,
                          body: payload,
                        },
                      );
                    if (!payload)
                      throw Object.assign(
                        new Error(
                          "The server reply was incomplete. This order is retained.",
                        ),
                        { code: "TIMEOUT" },
                      );
                    return payload;
                  }
                })(),
                new Promise((_, reject) => {
                  timer = setTimeout(() => {
                    reject(
                      Object.assign(
                        new Error("The server did not answer in time."),
                        { code: "TIMEOUT" },
                      ),
                    );
                    controller.abort();
                  }, options.timeout || 7000);
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
          }
          if (start !== generation)
            throw Object.assign(new Error("Unlock this phone first."), {
              code: "PIN_LOCKED",
            });
          if(options.background && (activeRequests || choiceRevision !== host.POSNIC?.internetChoice?.revision)) return {connectionCheckDeferred:true};
          cooling.delete(base);
          host.POSNIC?.internetChoice?.succeeded?.(base);
          if(state.lastRoute!==base){state.lastRoute=base;await persist().catch(()=>{});}
          host.POSNIC?.server.adopt(base);
          host.POSNIC?.net.setOnline();
          return result;
        } catch (error) {
          if (start !== generation)
            throw Object.assign(new Error("Unlock this phone first."), {code:"PIN_LOCKED"});
          showDisabled(error);
          last = error;
          if (error.code === "PIN_LOCKED" || error.accessRefused) throw error;
          if (
            attempted &&
            error.status &&
            error.status < 500 &&
            error.status !== 408
          )
            throw error;
          cooling.set(base, Date.now() + 30000);
          host.POSNIC?.internetChoice?.failed?.(base);
          const replayable =
            refreshBody ||
            options.method === "GET" ||
            options.method === "HEAD" ||
            [
              "/items/accessQr",
              "/sales/getTablesWithActiveOrders",
              "/sales/getOrderHistory",
              "/sales/getListKot",
              "/sales/getFrequentItems",
            ].includes(path) ||
            (path === "/sales/qrOrder" &&
              options.body?.idempotencyKey &&
              state.idempotentOrders);
          if (attempted && !replayable) break;
        }
      }
      if (last?.code === 'CONNECTION_SIGNIN') throw last;
      host.POSNIC?.net.setOffline();
      if (last?.status >= 500) throw last;
      throw Object.assign(
        new Error(
          "Cannot reach the verified shop server. Orders remain saved on this phone.",
        ),
        { code: "OFFLINE" },
      );
    }
    const session = {
      ready,
      get busy() { return activeRequests > 0; },
      get token() {
        return locked ? null : state.token || null;
      },
      get user() {
        return state.user || profile?.user || null;
      },
      async updateProfile(value) {
        await ready;
        if (locked || !state.user || String(value.id) !== String(state.user.id || state.user._id)) return false;
        state.user = { ...state.user, name: value.name };
        await persist();
        return true;
      },
      get shopKey() {
        return state.shopKey || profile?.shopKey || null;
      },
      get active() {
        return (
          (locked && !!profile) ||
          [state, ...(state.connections || [])].some(credential => !!credential.token &&
            (!credential.expiresAt || credential.expiresAt > Date.now() || !!credential.refreshToken))
        );
      },
      get managed() {
        return !!state.sessionId || !!state.connections?.length;
      },
      get resilient() {
        return !!state.routeKey && !!state.idempotentOrders;
      },
      get needsReconnect() {
        return !!state.blockedAccess;
      },
      async retryAccess() {
        delete state.blockedAccess;
        await persist();
      },
      get canTakeOrders() {
        const base = host.POSNIC?.server.baseUrl || state.lastRoute || state.base;
        const credential = [state, ...(state.connections || [])].find(c =>
          c.base === base || (c.routeKey && c.routes?.includes(base)));
        return (
          !locked &&
          !state.blockedAccess &&
          session.active &&
          !!credential &&
          (!credential.offlineUntil || Date.parse(credential.offlineUntil) > Date.now())
        );
      },
      allowsBase(base) {
        return base === state.base || verified.has(base);
      },
      hasCredential(base) {
        return [state, ...(state.connections || [])].some(c => c.base === base || (c.routeKey && c.routes?.includes(base)));
      },
      async request(path, options = {}) {
        await session.whenReady();
        if (state.blockedAccess)
          throw Object.assign(new Error(state.blockedAccess), {
            status: 403,
            code: "CAPTAIN_ACCESS",
          });
        try {
          await session.prepare(options.onlyBase);
        } catch (error) {
          if ([401, 403].includes(error.status) || !state.connections?.length)
            throw error;
        }
        await session.whenReady();
        void refreshConnections();
        if(!options.background)activeRequests++;
        try {
          const result = await transport(path, options);
          if (state.blockedAccess) {
            delete state.blockedAccess;
            await persist();
          }
          return result;
        } catch (error) {
          if (error.status === 403) {
            state.blockedAccess = error.message;
            await persist();
          }
          const selected = options.onlyBase || host.POSNIC?.server.baseUrl || state.lastRoute || state.base;
          const linked = state.connections?.find(c => c.base === selected || (c.routeKey && c.routes?.includes(selected)));
          if (error.status === 401 && linked?.refreshToken) {
            linked.expiresAt = 0;
            return await transport(path, options);
          }
          if (error.status === 401 && state.refreshToken && !linked) {
            state.expiresAt = 0;
            await session.prepare(options.onlyBase);
            return await transport(path, options);
          }
          throw error;
        } finally {
          if(!options.background)activeRequests--;
        }
      },
      get base() {
        return state.base || profile?.base;
      },
      get hasLocalConnection() {
        return [state, ...(state.connections || [])].some(credential =>
          credential.routeKey && [credential.base, ...(credential.routes || [])].some(base => local(base)));
      },
      async addAddress(base, signal, {remember = true} = {}) {
        const started = generation;
        await session.whenReady();
        if (signal?.aborted || generation !== started) throw new Error("Connection cancelled.");
        const clean = safeRoute(base);
        if (!clean || locked) throw new Error("Unlock this phone first.");
        for (const credential of [state, ...(state.connections || [])]) {
          if (signal?.aborted || generation !== started) throw new Error("Connection cancelled.");
          if (!credential.routeKey) continue;
          try {
            await prove(clean, credential, false, signal);
          } catch {
            if (signal?.aborted || generation !== started) throw new Error("Connection cancelled.");
            // Only proof failures can try another credential. A secure-storage
            // failure must not be presented as the wrong shop or as success.
            continue;
          }
          if (signal?.aborted || generation !== started) throw new Error("Connection cancelled.");
          const previousRoutes = credential.routes;
          const nextRoutes = [...new Set([...(previousRoutes || []), clean])];
          credential.routes = nextRoutes;
          try {
            await persist();
          } catch (error) {
            if (generation === started && credential.routes === nextRoutes) {
              if (previousRoutes === undefined) delete credential.routes;
              else credential.routes = previousRoutes;
            }
            throw error;
          }
          if (signal?.aborted || generation !== started) throw new Error("Connection cancelled.");
          verified.add(clean);
          if(remember)host.POSNIC?.server.recordShop(clean, state.shopKey);
          if(remember)host.POSNIC?.server.remember({
            [local(clean) ? "lan" : "cloud"]: clean,
          });
          return;
        }
        throw new Error(
          "This address is not the server that approved this phone.",
        );
      },
      refreshConnections,
      async start(grant) {
        await ready;
        generation++;
        nextConnectionCheck = 0;
        verified.clear();
        verified.add(grant.base);
        state = {
          ...grant,
          base: grant.base || host.POSNIC?.server.baseUrl,
          expiresAt:
            grant.expiresAt ||
            (grant.expiresIn ? Date.now() + grant.expiresIn * 1000 : null),
        };
        await persist();
        if (state.shopKey)
          host.POSNIC?.server.recordShop(
            state.base || host.POSNIC.server.baseUrl,
            state.shopKey,
          );
      },
      async link(grant, base) {
        await session.whenReady();
        const clean = safeRoute(base);
        if (!clean || !grant?.token || !state.token || !state.shopKey || !state.user?.id ||
            !state.branches?.[0]?.branch_id || !sameIdentity(grant))
          throw new Error('Reconnect the original staff member and server to keep saved orders separate.');
        if (locked || activeRequests) throw new Error('Try again in a moment.');
        const previous = state;
        const started = generation;
        // Credentials remain bound to the address that issued them. Never copy
        // a Wi-Fi bearer to a newly discovered Internet address.
        const credential = {...grant, base: clean, routes: [], connections: [],
          expiresAt: grant.expiresAt || (grant.expiresIn ? Date.now() + grant.expiresIn * 1000 : null)};
        const primaryBase = state.base || host.POSNIC?.server.baseUrl;
        state = clean === primaryBase
          ? {...state, ...credential, connections: state.connections || []}
          : {...state, base: primaryBase, connections: [...(state.connections || []).filter(c => c.base !== clean), credential]};
        try { await persist(); } catch (error) { if(generation === started) state = previous; throw error; }
        if(generation !== started || locked) throw new Error('Connection cancelled.');
        verified.add(clean);
        host.POSNIC?.server.recordShop(clean, state.shopKey);
        host.POSNIC?.server.remember({[local(clean) ? 'lan' : 'cloud']: clean});
      },
      async end() {
        await ready;
        generation++;
        const previous = state;
        await writing.catch(() => {});
        await plugin.clear();
        state = {};
        profile = null;
        locked = false;
        pinSet = false;
        storage.removeItem("posnic.session");
        storage.removeItem("posnic.connection-candidates");
        for (const credential of [previous, ...(previous.connections || [])])
          if (credential.sessionId && credential.token && credential.base) {
            // Local sign-out is immediate even when the till is unreachable.
            void (async () => {
              if (credential.routeKey)
                await prove(credential.base, credential, false);
              await fetcher(credential.base + "/captain/v1/logout", {
                method: "POST",
                credentials: "omit",
                headers: { Authorization: "Bearer " + credential.token },
                signal: AbortSignal.timeout(5000),
                redirect: "error",
              });
            })().catch(() => {});
          }
      },
      async whenReady() {
        await ready;
        let pending;
        do { pending = lifecycle; await pending; } while (pending !== lifecycle);
        if (suspended || locked)
          throw Object.assign(new Error("Unlock this phone first."), { code: "PIN_LOCKED" });
      },
      async prepare(selectedBase) {
        await session.whenReady();
        // A cloud session expiring must not delay or revoke the local session.
        const selected = selectedBase || host.POSNIC?.server.baseUrl || state.lastRoute || state.base;
        const primary = selected === state.base || (state.routeKey && state.routes?.includes(selected));
        if (!primary) return;
        if (locked)
          throw Object.assign(new Error("Unlock this phone first."), {
            code: "PIN_LOCKED",
          });
        if (
          !state.refreshToken ||
          (state.expiresAt > Date.now() + 60000 && !state.rotation)
        )
          return;
        if (!flight)
          flight = (async () => {
            const started = generation;
            state.rotation = state.rotation || random();
            await persist();
            if (started !== generation)
              throw new Error("Connection cancelled.");
            const grant = await transport(
              "/captain/v1/refresh",
              {},
              {
                sessionId: state.sessionId,
                refreshToken: state.refreshToken,
                nextToken: state.rotation,
              },
            );
            if (started !== generation)
              throw new Error("Connection cancelled.");
            await session.start({ ...state, ...grant, base: state.base });
          })()
            .catch(async (error) => {
              if ([401, 403].includes(error.status)) {
                state.blockedAccess = error.message;
                await persist();
                await session.suspend();
              }
              throw error;
            })
            .finally(() => {
              flight = null;
            });
        return flight;
      },
      suspend() {
        generation++;
        suspended = true;
        return transition(async () => {
          await ready;
          await writing.catch(() => {});
          await plugin.lock();
          state = {};
          locked = pinSet;
          suspended = true;
        });
      },
    };
    return {
      session,
      ready,
      post,
      random,
      get pinSet() {
        return pinSet;
      },
      get locked() {
        return locked;
      },
      async setPin(pin) {
        apply(await plugin.setPin({ pin }));
        return true;
      },
      async unlock(pin) {
        await lifecycle;
        const result = apply(await plugin.unlock({ pin }));
        suspended = false;
        if (!locked) {
          const candidates = JSON.parse(
            storage.getItem("posnic.connection-candidates") || "[]",
          );
          for (const base of candidates.slice(0, 2))
            await session.addAddress(base).catch(() => {});
          storage.removeItem("posnic.connection-candidates");
        }
        if (
          result.session?.offlineUntil &&
          Date.parse(result.session.offlineUntil) <= Date.now()
        ) {
          // Renew when possible. A PIN cannot extend an expired offline grant.
          try {
            state.expiresAt = 0;
            await session.prepare();
          } catch (error) {
            await session.suspend();
            throw error;
          }
        }
        return {
          ok: !locked && !!state.token,
          left: result.attempts,
          forgotten: !result.attempts,
        };
      },
      async removePin() {
        apply(await plugin.removePin());
      },
      resume,
    };
  }
  function bindVisibility(host) {
    let leavingPage = false, pending;
    host.addEventListener("pagehide", () => {
      leavingPage = true;
      host.clearTimeout(pending);
    });
    host.addEventListener("pageshow", () => { leavingPage = false; });
    host.document.addEventListener("visibilitychange", () => {
      host.clearTimeout(pending);
      if (host.document.hidden) {
        // Navigation also hides the document. Native onPause still locks
        // immediately when the app actually leaves the foreground.
        pending = host.setTimeout(() => {
          if (!leavingPage && host.document.hidden)
            void host.CaptainAccess.session.suspend().catch(() => {});
        }, 0);
      } else if (!leavingPage) {
        void Promise.all([host.CaptainPaperCapture?.waitForPhoto?.(),host.CaptainReferenceCapture?.waitForPhoto?.()])
          .then(() => host.CaptainAccess.resume())
          .then(() => {
            if (host.CaptainAccess.locked && !host.CaptainOnboarding?.busy)
              host.location.href = "index.html";
            else if(!host.CaptainAccess.locked)host.dispatchEvent?.(new Event("captain:resumed"));
          }).catch(() => {});
      }
    });
  }
  if (typeof module === "object" && module.exports)
    module.exports = { createAccess, bindVisibility };
  if (
    host.Capacitor?.isNativePlatform?.() &&
    (!host.Capacitor.getPlatform || ["android", "ios"].includes(host.Capacitor.getPlatform()))
  ) {
    const plugin =
      host.Capacitor.Plugins?.SecureSession ||
      host.Capacitor.registerPlugin("SecureSession");
    host.CaptainAccess = createAccess(
      plugin,
      host.localStorage,
      host.CaptainFetch,
    );
    host.CaptainAccess.ready.catch(() => {});
    if (!/\/(?:index.html)?$/.test(host.location.pathname)) {
      host.document.documentElement.style.visibility = "hidden";
      host.CaptainAccess.ready
        .then(() => {
          if (host.CaptainAccess.locked || !host.CaptainAccess.session.active)
            host.location.href = "index.html";
          else host.document.documentElement.style.visibility = "";
        })
        .catch(() => {
          host.location.href = "index.html";
        });
    }
    bindVisibility(host);
  }
})(typeof window !== "undefined" ? window : globalThis);
