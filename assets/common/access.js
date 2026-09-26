(function (host) {
  "use strict";
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
    async function persist() {
      const started = generation;
      const result = await plugin.save({ session: state });
      if (generation === started) apply(result);
    }
    const ready = (async () => {
      apply(await plugin.status());
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
    async function prove(base) {
      const nonce = random();
      const answer = await post(
        base,
        "/captain/v1/route-proof",
        { sessionId: state.sessionId, nonce },
        null,
        2000,
      );
      const key = await cryptoApi.subtle.importKey(
        "raw",
        new TextEncoder().encode(state.routeKey),
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
      verified.add(base);
    }
    async function transport(path, options, refreshBody) {
      if (refreshBody && !state.routeKey)
        return post(state.base, path, refreshBody);
      const start = generation;
      const routes = [
        ...new Set(
          [state.base, ...(state.routes || [])].map(safeRoute).filter(Boolean),
        ),
      ].sort(
        (a, b) =>
          Number((cooling.get(a) || 0) > Date.now()) -
            Number((cooling.get(b) || 0) > Date.now()) ||
          Number(local(b)) - Number(local(a)),
      );
      let last;
      for (const base of routes) {
        let attempted = false;
        try {
          if (state.routeKey) await prove(base);
          else if (base !== state.base) continue;
          if (start !== generation || locked)
            throw Object.assign(new Error("Unlock this phone first."), {
              code: "PIN_LOCKED",
            });
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
                      Authorization: "Bearer " + state.token,
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
                    reject(Object.assign(new Error("The server did not answer in time."), { code: "TIMEOUT" }));
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
          cooling.delete(base);
          host.POSNIC?.server.adopt(base);
          host.POSNIC?.net.setOnline();
          return result;
        } catch (error) {
          last = error;
          if (error.code === "PIN_LOCKED") throw error;
          if (
            attempted &&
            error.status &&
            error.status < 500 &&
            error.status !== 408
          )
            throw error;
          cooling.set(base, Date.now() + 30000);
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
      get token() {
        return locked ? null : state.token || null;
      },
      get user() {
        return state.user || profile?.user || null;
      },
      get shopKey() {
        return state.shopKey || profile?.shopKey || null;
      },
      get active() {
        return (
          (locked && !!profile) ||
          (!!state.token &&
            (!state.expiresAt ||
              state.expiresAt > Date.now() ||
              !!state.refreshToken))
        );
      },
      get managed() {
        return !!state.sessionId;
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
        return (
          !locked &&
          !state.blockedAccess &&
          session.active &&
          (!state.offlineUntil || Date.parse(state.offlineUntil) > Date.now())
        );
      },
      allowsBase(base) {
        return base === state.base || verified.has(base);
      },
      async request(path, options = {}) {
        if (state.blockedAccess)
          throw Object.assign(new Error(state.blockedAccess), {
            status: 403,
            code: "CAPTAIN_ACCESS",
          });
        await session.prepare();
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
          if (error.status === 401 && state.refreshToken) {
            state.expiresAt = 0;
            await session.prepare();
            return transport(path, options);
          }
          throw error;
        }
      },
      get base() {
        return state.base || profile?.base;
      },
      async start(grant) {
        await ready;
        verified.clear();
        verified.add(grant.base);
        state = {
          ...grant,
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
      async end() {
        await ready;
        generation++;
        const previous = state;
        await plugin.clear();
        state = {};
        profile = null;
        locked = false;
        pinSet = false;
        storage.removeItem("posnic.session");
        if (previous.sessionId && previous.token && previous.base) {
          // Local sign-out is immediate even when the till is unreachable.
          void fetcher(previous.base + "/captain/v1/logout", {
            method: "POST",
            credentials: "omit",
            headers: { Authorization: "Bearer " + previous.token },
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          }).catch(() => {});
        }
      },
      async prepare() {
        await ready;
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
            await session.start({ ...grant, base: state.base });
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
      async suspend() {
        generation++;
        await plugin.lock();
        state = {};
        locked = pinSet;
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
        const result = apply(await plugin.unlock({ pin }));
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
      async resume() {
        apply(await plugin.status());
      },
    };
  }
  if (typeof module === "object" && module.exports)
    module.exports = { createAccess };
  if (
    host.Capacitor?.isNativePlatform?.() &&
    (!host.Capacitor.getPlatform || host.Capacitor.getPlatform() === "android")
  ) {
    const plugin =
      host.Capacitor.Plugins?.SecureSession ||
      host.Capacitor.registerPlugin("SecureSession");
    host.CaptainAccess = createAccess(
      plugin,
      host.localStorage,
      host.fetch.bind(host),
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
    host.document.addEventListener("visibilitychange", () => {
      if (host.document.hidden) void host.CaptainAccess.session.suspend();
      else
        void host.CaptainAccess.resume().then(() => {
          if (host.CaptainAccess.locked) host.location.href = "index.html";
        });
    });
  }
})(typeof window !== "undefined" ? window : globalThis);
