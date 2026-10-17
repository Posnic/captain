/* Framework-independent setup content. No network, storage or authentication side effects. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PosnicConnectionSetup = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const definitions = Object.freeze({
    wifi: Object.freeze({label:'Search this Wi-Fi', icon:'wifi', group:'primary'}),
    qr: Object.freeze({label:'Scan shop QR code', icon:'qr', group:'primary'}),
    cloud: Object.freeze({label:'Posnic Cloud', description:'Connect over the Internet', icon:'posnic', group:'primary'}),
    other: Object.freeze({label:'Other ways to connect', icon:'more', group:'primary'}),
    code: Object.freeze({label:'Enter pairing code', icon:'code', group:'other'}),
    address: Object.freeze({label:'Shop code or server address', icon:'globe', group:'other'}),
    settings: Object.freeze({label:'Connection settings', icon:'settings', group:'other'})
  });
  const icons = Object.freeze({
    wifi:'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0M12 20h.01',
    qr:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 7h3v3H7zm7 0h3v3h-3zM7 14h3v3H7zm7 0h3v3h-3z',
    code:'M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM7 10h2m2 0h2m2 0h2M7 14h10',
    globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M16 12c0 5-2 9-4 9s-4-4-4-9 2-9 4-9 4 4 4 9M3 12h18',
    settings:'M4 7h7m4 0h5M4 17h3m4 0h9M15 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0M11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    more:'M5 12h.01M12 12h.01M19 12h.01',
    arrow:'m9 5 7 7-7 7'
  });
  function methods({supported=Object.keys(definitions),wifiAvailable=true,translate=value=>value}={}) {
    const ids = [...new Set(supported)];
    for (const id of ids) if (!Object.prototype.hasOwnProperty.call(definitions,id)) throw new TypeError('Unknown connection method: '+id);
    return ids.filter(id=>id!=='wifi'||wifiAvailable).map(id=>Object.freeze({id,...definitions[id],label:translate(definitions[id].label),description:definitions[id].description?translate(definitions[id].description):undefined,recommended:id===(wifiAvailable?'wifi':'cloud')}));
  }
  function welcome({name,subtitle='By Posnic',steps=['Find your shop','Sign in once'],copy={},translate=value=>value}={}) {
    if (typeof name!=='string'||!name.trim()) throw new TypeError('An app name is required');
    return {name,subtitle:translate(subtitle),title:translate(copy.title ?? 'Let’s get you ready.'),eyebrow:translate(copy.eyebrow ?? 'First-time setup'),description:translate(copy.description ?? 'We’ll connect this phone to your shop, then help you sign in. You only need to set this up once.'),steps:steps.map(step=>translate(step)),continueLabel:translate(copy.continueLabel ?? 'Set up this phone')};
  }
  function cloudRoles({translate=value=>value}={}) {
    return [
      {id:'owner',label:'Owner or admin',description:'Sign in with Posnic. No shop address needed.',icon:'posnic'},
      {id:'staff',label:'Staff',description:'Enter your shop address, then sign in.',icon:'globe'}
    ].map(role=>Object.freeze({...role,label:translate(role.label),description:translate(role.description)}));
  }
  return Object.freeze({methods,cloudRoles,welcome,icons});
});
