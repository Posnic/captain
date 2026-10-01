/* Device preferences never alter order delivery or hide customer requests. */
(function (root) {
  "use strict";
  const keys = { sound: "posnic.phone.sound", vibration: "posnic.phone.vibration" };
  function enabled(name) {
    if (!Object.hasOwn(keys, name)) return false;
    try { return globalThis.localStorage.getItem(keys[name]) !== "off"; }
    catch { return true; }
  }
  function set(name, value) {
    if (!Object.hasOwn(keys, name) || typeof value !== "boolean") return false;
    try { globalThis.localStorage.setItem(keys[name], value ? "on" : "off"); return true; }
    catch { return false; }
  }
  function vibrate(pattern) {
    if (!enabled("vibration")) return false;
    try { return !!globalThis.navigator?.vibrate?.(pattern); }
    catch { return false; }
  }
  root.CaptainPhone = { enabled, set, vibrate };
})(globalThis);
