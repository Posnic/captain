/* Route indicators use server responses, never the phone's Wi-Fi attachment. */
(function () {
  "use strict";
  const seen = new Map();
  const t = text => window.I18N?.t(text) || text;
  let wifi = null;
  function paint() {
    if (!window.POSNIC) return;
    const {server,net} = POSNIC;
    wifi=POSNIC.internetChoice?.wifi ?? wifi;
    const anchor=document.querySelector('.floor-section');
    if(anchor){
      let banner=document.getElementById('captain-connection-status');
      if(!banner){banner=document.createElement('div');banner.id='captain-connection-status';banner.setAttribute('role','status');banner.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;margin:0 0 12px;border-radius:12px;background:var(--surface-sunk,#f3f6fb);color:var(--ink,#172638);font:500 13px/1.5 Inter,system-ui';anchor.before(banner);}
      banner.replaceChildren();
      const text=document.createElement('span');text.textContent=t(net.offline?'Reconnecting':server.isLocal?'Shop Wi-Fi':'Internet');banner.append(text);
      if(!net.offline&&!server.isLocal&&wifi===false){
        const action=document.createElement('button');action.type='button';action.textContent=t('Connect to Wi-Fi');action.style.cssText='border:0;background:transparent;color:var(--accent,#2356dc);min-height:44px;font:inherit';action.onclick=()=>POSNIC.internetChoice.openWifi();banner.append(action);
      }
    }
    document.querySelectorAll("[data-route-signal]").forEach(button => {
      const local = button.dataset.routeSignal === "local";
      const base = (local ? server.lan : server.cloud) || (server.isLocal === local ? server.baseUrl : null);
      const answer = seen.get(base);
      const active = !!base && server.baseUrl === base && !net.offline;
      const reachable = !!answer?.reachable && Date.now() - answer.at < 60000;
      button.classList.toggle("is-reachable", reachable);
      button.classList.toggle("is-active", active && reachable);
      const name = local ? "Wi-Fi" : "Internet server";
      const status = reachable ? (local ? "Connected in the shop" : "Connected over the internet") : "Not connected";
      button.setAttribute("aria-label", t(name) + ": " + t(status));
      button.title = t(name) + ": " + t(status);
      button.dataset.reachable = String(reachable);
    });
  }
  window.addEventListener("posnic:route-health", event => {
    const {base,reachable} = event.detail || {};
    if (base && window.POSNIC?.server.canAdopt(base)) seen.set(base,{reachable,at:Date.now()});
    paint();
  });
  window.addEventListener("posnic:online", () => {
    if (window.POSNIC?.server.baseUrl) seen.set(POSNIC.server.baseUrl,{reachable:true,at:Date.now()});
    paint();
  });
  window.addEventListener("posnic:offline", () => { seen.clear(); paint(); });
  window.addEventListener("posnic:server-changed", paint);
  window.addEventListener('posnic:wifi-state',event=>{wifi=event.detail;paint();});
  document.addEventListener("visibilitychange", paint);
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-route-signal]").forEach(button => button.addEventListener("click", () => {
      sessionStorage.setItem("posnic_change_server", "1");
      sessionStorage.setItem("posnic_connection_view", "settings");
      location.href = "index.html";
    }));
    paint();
    setInterval(() => { if (!document.hidden) paint(); },15000);
  });
})();
