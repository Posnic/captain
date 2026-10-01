/* Remember successful account names per server; passwords belong to the
 * device password manager and the existing secure session, never this store. */
(function () {
  "use strict";
  const key = "posnic.signin-names.v1";
  let selected = null;
  const normalize = base => window.POSNIC?.server.normalize(base) || "";
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter(row => row && typeof row.base === "string" &&
        Array.isArray(row.names)).slice(0, 10) : [];
    } catch { return []; }
  }
  function names(base) {
    return (read().find(row => row.base === normalize(base))?.names || [])
      .filter(name => typeof name === "string" && name.length > 0 && name.length <= 254).slice(0, 8);
  }
  function selectServer(base) {
    base = normalize(base);
    if (!base) return;
    const username = document.getElementById("username");
    const password = document.getElementById("password");
    const list = document.getElementById("saved-usernames");
    if (!username || !password || !list) return;
    if (selected && selected !== base) {
      username.value = "";
      password.value = "";
    }
    selected = base;
    const saved = names(base);
    list.replaceChildren(...saved.map(name => {
      const option = document.createElement("option");
      option.value = name;
      return option;
    }));
    // Never overwrite typing or a password-manager supplied username.
    if (!username.value && saved.length) username.value = saved[0];
  }
  function remember(base, username) {
    base = normalize(base);
    username = String(username || "").trim();
    if (!base || !username || username.length > 254) return;
    const entries = read().filter(row => row.base !== base);
    entries.unshift({ base, names: [username, ...names(base).filter(name => name !== username)].slice(0, 8) });
    try { localStorage.setItem(key, JSON.stringify(entries.slice(0, 10))); } catch { /* Sign-in must still work. */ }
    if (selected === base) selectServer(base);
  }
  window.CaptainSignIn = { selectServer, remember };
})();
