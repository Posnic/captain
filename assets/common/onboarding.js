(function () {
  "use strict";
  let operation = null;
  const $ = (id) => document.getElementById(id);
  const note = (text) => {
    $("captain-note").textContent = text;
  };
  const bytes = (value) => new TextEncoder().encode(value);
  const hex = (array) =>
    [...new Uint8Array(array)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const sha = async (value) => crypto.subtle.digest("SHA-256", bytes(value));
  async function verify(base, code, enrolmentId, signal) {
    const nonce = CaptainAccess.random();
    const answer = await CaptainAccess.post(
      base,
      "/captain/v1/enrolment-proof",
      { enrolmentId, nonce },
      signal,
    );
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(hex(await sha(code))),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = hex(await crypto.subtle.sign("HMAC", key, bytes(nonce)));
    if (answer.proof !== expected)
      throw new Error(
        "This is not the till your manager approved. Scan its QR again.",
      );
  }
  async function run(work) {
    if (operation) return;
    operation = new AbortController();
    $("captain-cancel").hidden = false;
    try {
      await work(operation.signal);
    } catch (e) {
      if (!operation.signal.aborted)
        note(e.message || "Could not connect. Try again.");
    } finally {
      operation = null;
      $("captain-cancel").hidden = true;
    }
  }
  function secure() {
    if (!window.CaptainAccess)
      throw new Error(
        "Install the Android app for secure pairing and PIN access. Address sign-in is still available below.",
      );
  }
  async function pair(details, signal) {
    secure();
    await CaptainAccess.ready;
    const base = POSNIC.server.normalize(details.server);
    if (!base) throw new Error("Choose a shop address first.");
    const code = String(details.code || "")
      .replace(/[ -]/g, "")
      .toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(code))
      throw new Error("Enter the pairing code shown on the till.");
    if (details.enrolmentId)
      await verify(base, code, details.enrolmentId, signal);
    else {
      const hit = await POSNIC.discovery.probe(base, 3000);
      if (!hit) {
        const failure = POSNIC.discovery.probe.lastFailure;
        throw new Error(
          failure?.reason === "REFUSED"
            ? "The till refused this connection. Ask your manager to check Captain access."
            : failure?.reason === "NOT_POSNIC"
              ? "This address is not a Posnic till. Check the address with your manager."
              : "The till is not answering. Check the shop Wi-Fi and address, then retry or scan its QR.",
        );
      }
      if (!hit?.info?.features?.captainAccessV1)
        throw new Error(
          "Update Posnic on this till to approve Captain phones. Address sign-in remains available.",
        );
      if (!$("captain-confirm").checked)
        throw new Error(
          "Check this address with your manager, then confirm it below.",
        );
    }
    const waiting = OrderQueue.all();
    // Recovery can release the local lock, but never relabel queued orders.
    const grant = await CaptainAccess.post(
      base,
      "/captain/v1/pair",
      {
        code,
        device: POSNIC.thisDevice.facts(),
        codeVerifier: details.verifier,
      },
      signal,
    );
    if (
      waiting.some(
        (row) =>
          !row.owner ||
          row.owner.user !== grant.user.id ||
          row.owner.shop !== grant.shopKey ||
          row.owner.base !== base ||
          (row.owner.branch &&
            row.owner.branch !== grant.branches?.[0]?.branch_id),
      )
    )
      throw new Error(
        "Saved orders belong to another staff member or server. Reconnect that original account first. Nothing was deleted.",
      );
    if (signal?.aborted)
      throw new Error("Connection cancelled. Ask your manager for a new code.");
    if (CaptainAccess.locked) await POSNIC.session.end();
    POSNIC.server.pin(base);
    await POSNIC.session.start({ ...grant, base });
    localStorage.setItem("kiosk_branch_list", JSON.stringify(grant.branches));
    localStorage.setItem("user_id", grant.user.id);
    const branch = grant.branches[0];
    localStorage.setItem("branch_id", branch.branch_id);
    localStorage.setItem(
      "kiosk_selected_branch",
      branch.store_id || branch.branch_id,
    );
    note("Phone approved. Choose your daily unlock PIN.");
    if (!(await POSNIC.lock.choose())) {
      await POSNIC.session.end();
      note("Setup paused. Ask your manager for a new code when you are ready.");
      return;
    }
    await selectBranch(branch.store_id || branch.branch_id);
  }
  async function search(signal) {
    $("captain-results").replaceChildren();
    const plugin = window.Capacitor?.Plugins?.LocalNetwork;
    if (!plugin)
      throw new Error(
        "Wi-Fi search works in the installed phone app. You can scan a QR or enter an address here.",
      );
    const network = await bounded(
      plugin.getLocalIp(),
      3000,
      signal,
      "Could not read this phone’s Wi-Fi. Retry, scan the till’s QR, or enter its address.",
    );
    if (signal.aborted) return;
    if (!network.wifi || !network.ip)
      throw new Error("Connect this phone to the shop Wi-Fi and try again.");
    const subnet = network.ip.split(".").slice(0, 3).join(".");
    if (
      !/^\d{1,3}(\.\d{1,3}){3}$/.test(network.ip) ||
      network.ip.split(".").some((part) => Number(part) > 255)
    )
      throw new Error(
        "Could not read a usable Wi-Fi address. Scan the till’s QR or enter its address.",
      );
    const results = $("captain-results");
    results.replaceChildren();
    let count = 0;
    const seen = [];
    const found = new Set();
    const deadline = Date.now() + 20000;
    const searchOperation = operation;
    const stopped = () =>
      signal.aborted || operation !== searchOperation || Date.now() >= deadline;
    const collect = (hit) => {
      if (stopped() || found.has(hit.base)) return;
      found.add(hit.base);
      count++;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-btn-quiet";
      button.textContent =
        hit.base +
        (hit.info.features?.captainAccessV1
          ? ""
          : " · Update required for pairing");
      button.onclick = () => {
        if (operation && operation !== searchOperation) return;
        searchOperation.abort();
        $("captain-server").value = hit.base;
        // An address change always needs a fresh manager confirmation.
        $("captain-confirm").checked = false;
        $("captain-code-options").open = true;
        note(
          "Check this address with your manager. Finding a till does not sign you in.",
        );
      };
      results.append(button);
    };
    note("Checking saved till addresses…");
    const saved = [
      ...new Set([POSNIC.server.lan, POSNIC.server.baseUrl]),
    ].filter((base) => base && POSNIC.server.isLanUrl(base));
    await bounded(
      Promise.all(
        saved.map(async (base) => {
          const hit = await POSNIC.discovery.probe(base, 1200, { seen });
          if (hit) collect(hit);
        }),
      ),
      4000,
      signal,
      "Saved addresses did not answer.",
    ).catch((error) => {
      if (signal.aborted) throw error;
    });
    if (stopped()) return;
    await bounded(
      POSNIC.discovery.scanSubnet(subnet, {
        concurrency: 16,
        ownHost: Number(network.ip.split(".").pop()),
        seen,
        shouldStop: stopped,
        onProgress: (done, total) => {
          if (!stopped()) note(`Searching this Wi-Fi: ${done} / ${total}`);
        },
        collect,
      }),
      Math.max(1, deadline - Date.now()),
      signal,
      "Search timed out. Select a till already found, retry, or scan its QR.",
    );
    if (!signal.aborted)
      note(
        count
          ? "Select your till, then enter the manager’s pairing code."
          : seen.length
            ? "An address answered but refused access. Ask your manager to check the till address and Captain access."
            : "No compatible till found. Check that the till is open and both devices use the shop Wi-Fi, not guest Wi-Fi. Retry or scan its QR.",
      );
  }
  function bounded(work, milliseconds, signal, message) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (fn, value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        fn(value);
      };
      const abort = () => finish(reject, new Error("Connection cancelled."));
      if (signal.aborted) {
        Promise.resolve(work).catch(() => {});
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => finish(reject, new Error(message)),
        milliseconds,
      );
      Promise.resolve(work).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
  }
  async function cloud(intent, signal) {
    secure();
    const origin = "https://www.posnic.com";
    const capabilities = await fetch(origin + "/api/mobile/capabilities", {
      signal: AbortSignal.timeout(7000),
    });
    if (
      !capabilities.ok ||
      !(await capabilities.json()).applications?.includes("captain")
    )
      throw new Error(
        "Captain cloud approval is not available on this account server yet. Use the till’s QR or local address.",
      );
    const verifier = CaptainAccess.random();
    const challenge = btoa(
      String.fromCharCode(...new Uint8Array(await sha(verifier))),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const pending = await CaptainAccess.post(
      origin,
      "/api/mobile/requests",
      {
        application: "captain",
        codeChallenge: challenge,
        deviceId: POSNIC.thisDevice.deviceId(),
        deviceName: "Posnic Captain",
        intent,
      },
      signal,
    );
    const url = new URL(pending.authorizationUrl);
    if (url.origin !== origin || url.pathname !== "/api/mobile/authorize")
      throw new Error("Invalid account approval address.");
    note(
      "Approve Captain in your browser. Matching code: " +
        pending.request.slice(-6).toUpperCase() +
        ". Then return here.",
    );
    await window.Capacitor.Plugins.SecureSession.openBrowser({ url: url.href });
    const until = Date.now() + Math.min(900, pending.expiresIn) * 1000;
    while (Date.now() < until && !signal.aborted) {
      await new Promise((resolve) => {
        const timer = setTimeout(done, 5000);
        function done() {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        }
        signal.addEventListener("abort", done, { once: true });
      });
      if (signal.aborted) break;
      const grant = await CaptainAccess.post(
        origin,
        "/api/mobile/token",
        { request: pending.request, codeVerifier: verifier },
        signal,
      );
      if (grant.error === "authorization_pending") continue;
      // Local routes are considered only during enrollment, never for queued writes.
      for (const till of grant.localServers || [])
        for (const address of till.addresses || []) {
          const base = POSNIC.server.normalize(address);
          if (!base || !POSNIC.server.isLanUrl(base)) continue;
          try {
            await verify(base, till.code, till.enrolmentId, signal);
          } catch {
            continue;
          }
          return pair(
            {
              server: base,
              code: till.code,
              enrolmentId: till.enrolmentId,
              verifier,
            },
            signal,
          );
        }
      const endpoint = new URL(grant.baseUrl);
      if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password
      )
        throw new Error("Invalid cloud shop address.");
      // HTTPS account approval verified this exact endpoint, not discovery.
      $("captain-confirm").checked = true;
      return pair(
        { server: grant.baseUrl, code: grant.code, verifier },
        signal,
      );
    }
    throw new Error(
      signal.aborted ? "Connection cancelled." : "Approval expired. Try again.",
    );
  }
  window.CaptainOnboarding = {
    readQr(raw) {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return false;
      }
      if (data.app !== "captain" || !data.code) return false;
      POSNIC_CONNECT.stopScan();
      document.getElementById("serverModal").style.display = "none";
      sessionStorage.removeItem("posnic_editing_server");
      void run((signal) => pair(data, signal));
      return true;
    },
  };
  document.addEventListener("DOMContentLoaded", () => {
    $("captain-server").addEventListener("input", () => {
      $("captain-confirm").checked = false;
    });
    $("captain-scan").onclick = () => {
      if (operation) return;
      openServerModal();
      chooseScan();
    };
    $("captain-search").onclick = () => void run(search);
    $("captain-pair").onclick = () =>
      void run((signal) =>
        pair(
          { server: $("captain-server").value, code: $("captain-code").value },
          signal,
        ),
      );
    $("captain-cloud-login").onclick = () =>
      void run((signal) => cloud("login", signal));
    $("captain-cloud-signup").onclick = () =>
      void run((signal) => cloud("signup", signal));
    $("captain-cancel").onclick = () => {
      operation?.abort();
      POSNIC_CONNECT.stopScan();
      note("Connection cancelled.");
    };
    $("captain-legacy").open = POSNIC.server.isConfigured;
  });
})();
