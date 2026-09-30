/* Recovery stays navigable, even when the server cannot answer. */
(function () {
  "use strict";
  const at=id=>document.getElementById(id), t=text=>window.I18N?.t(text)||text;
  let flight, confirmed=false, routeRevision=0;
  function paint() {
    at('help-route').textContent=t(POSNIC.server.isLocal?'Wi-Fi':'Internet server');
    at('help-address').textContent=POSNIC.server.baseUrl || '';
    at('help-status').textContent=t(flight?'Checking':POSNIC.session.needsReconnect?'Reconnect required':(!confirmed || POSNIC.net.offline)?'Not connected':POSNIC.server.isLocal?'Connected in the shop':'Connected over the internet');
  }
  function retry() {
    if(flight)return flight;
    const revision=routeRevision;
    at('help-retry').disabled=true;
    flight=(async()=>{
      try {
        await POSNIC.session.ready;
        if(POSNIC.session.needsReconnect) await POSNIC.session.retryAccess();
        const reachable = POSNIC.server.isConfigured && await POSNIC.net.check(true) === true;
        if(revision===routeRevision)confirmed=reachable;
      } catch { if(revision===routeRevision)confirmed=false; }
      finally { if(revision===routeRevision){flight=null;at('help-retry').disabled=false;paint();} }
    })();
    paint();return flight;
  }
  document.addEventListener('DOMContentLoaded',()=>{
    at('help-back').onclick=()=>location.href='me.html';
    at('help-retry').onclick=retry;
    at('help-server').onclick=()=>{sessionStorage.setItem('posnic_change_server','1');sessionStorage.setItem('posnic_connection_view','settings');location.href='index.html';};
    at('help-pending').onclick=()=>sessionStorage.setItem('captain_pending_return','help.html');
    const build=window.POSNIC_BUILD;
    at('help-version').textContent=build?.version?'Captain '+build.version+(build.commit?' ('+build.commit+')':''):'Captain dev build';
    MobileGestures.setRefresh(retry);
    void retry();
    window.addEventListener('posnic:offline',paint);window.addEventListener('posnic:online',()=>{confirmed=true;paint();});window.addEventListener('posnic:server-changed',()=>{routeRevision++;confirmed=false;flight=null;at('help-retry').disabled=false;paint();});
  });
  window.addEventListener('captain:back',event=>{event.preventDefault();location.href='me.html';});
})();
