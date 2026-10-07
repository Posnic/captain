/* Saved-shop settings. Transport and route authority stay in POSNIC. */
(function () {
  'use strict';
  const t = value => window.I18N?.t(value) || value;
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => {
    const paths = {back:'<path d="m12 19-7-7 7-7M5 12h14"/>',search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',check:'<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',grip:'<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>'};
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||''}</svg>`;
  };
  const health = new Map();
  let root, editing = null, busy = false, message = '', controller, draft = '';
  const label = kind => t(kind === 'lan' ? 'Shop Wi-Fi' : 'Internet');
  function shortAddress(value) { try { const url=new URL(value);return url.host+(url.pathname==='/api'||url.pathname==='/'?'':url.pathname); } catch(_){return value;} }
  const button = (text, action, cls = '') => `<button type="button" class="${cls}" data-connection-action="${action}">${escape(t(text))}</button>`;
  const bounded=(work,ms)=>new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),ms);Promise.resolve(work).then(value=>{clearTimeout(timer);resolve(value);},()=>{clearTimeout(timer);resolve(null);});});
  function shopName() {
    try {
      const branches = JSON.parse(localStorage.getItem('kiosk_branch_list') || '[]');
      const id = localStorage.getItem('branch_id');
      return branches.find(b => String(b.branch_id) === id)?.branch_name || branches[0]?.branch_name || t('Your shop');
    } catch (_) { return t('Your shop'); }
  }
  function status(base) {
    const answer = health.get(base);
    if (!base) return 'Not added';
    if (!answer || Date.now() - answer.at > 60000) return 'Not checked yet';
    if (answer.reachable && !answer.ok) return 'Sign-in required';
    if (!answer.ok) return 'Not reachable';
    return POSNIC.server.baseUrl === base ? 'Using now' : 'Ready as backup';
  }
  function draw() {
    if (!root) return;
    const signedIn = POSNIC.session.active && !POSNIC.session.needsReconnect;
    const reachable = status(POSNIC.server.baseUrl) === 'Using now';
    const saved=[POSNIC.server.lan,POSNIC.server.cloud].filter(Boolean);
    const unavailable=POSNIC.net.offline || (saved.length>0&&saved.every(base=>{const h=health.get(base);return h&&!h.ok&&!h.reachable;}));
    const title = !signedIn ? 'Please sign in again' : unavailable ? 'Can’t reach your shop' : reachable ? POSNIC.server.isLocal ? 'Connected on shop Wi-Fi' : 'Connected over internet' : 'Check your connections';
    const detail = !signedIn ? 'Your shop addresses are saved. Sign in again to continue.' : unavailable ? 'Your saved orders are safe. We’ll keep trying automatically.' : reachable ? localStorage.getItem('posnic.automatic-connections') === '1' ? 'Captain switches to your backup if needed.' : 'Automatic switching is off.' : 'Check which saved connections are available.';
    const kinds = POSNIC.server.priority === 'cloud' ? ['cloud','lan'] : ['lan','cloud'];
    root.innerHTML = `<header>${button('←','back')}<strong>${escape(t(editing ? 'Edit connection' : 'Shop connections'))}</strong></header><main>${editing ?
      `<h1>${escape(label(editing))}</h1><p>${escape(t('Only change this if your shop address has changed.'))}</p><label>${escape(label(editing))}<input id="shop-connection-address" inputmode="url" autocapitalize="none" spellcheck="false" value="${escape(draft)}"></label><p>${escape(t('A different shop requires its own sign-in.'))}</p>` :
      `<h1>${escape(shopName())}</h1><section class="shop-connection-state"><strong>${escape(t(title))}</strong><p>${escape(t(detail))}</p></section><h2>${escape(t('Saved connections'))}</h2><p>${escape(t('Try the first available connection. Drag to reorder, or use the arrows.'))}</p><div class="shop-connection-list">${kinds.map((kind,index) => `<div class="shop-connection-row" draggable="true" data-kind="${kind}"><span class="shop-connection-grip" aria-hidden="true">⠿</span><div><strong>${index+1}. ${escape(label(kind))}</strong><small translate="no">${escape(POSNIC.server[kind] || '—')}</small><small>${escape(t(status(POSNIC.server[kind])))}</small>${kind === 'lan' ? button('Search','search','shop-connection-search') : ''}</div><button type="button" data-connection-action="edit-${kind}" aria-label="${escape(t('Edit')+' '+label(kind))}">✎</button><button type="button" data-connection-action="reorder" aria-label="${escape(t(index ? 'Move up' : 'Move down'))}">${index ? '↑' : '↓'}</button></div>`).join('')}</div><label class="shop-connection-toggle"><span>${escape(t('Switch automatically'))}<small>${escape(t('Use the backup when the first connection fails.'))}</small></span><input id="shop-connection-auto" type="checkbox" ${localStorage.getItem('posnic.automatic-connections') === '1' ? 'checked' : ''}></label>`}<p class="shop-connection-message" role="status">${escape(t(message))}</p></main><footer>${button(editing ? 'Check & save' : signedIn ? 'Check connection' : 'Sign in again', editing ? 'save' : signedIn ? 'check' : 'signin', 'shop-connection-primary')}${button(editing ? 'Cancel' : 'Back to orders', editing ? 'cancel-edit' : 'orders', 'shop-connection-quiet')}</footer>`;
    root.querySelectorAll('button,input').forEach(node => node.disabled = busy && !['back','orders','cancel-edit'].includes(node.dataset.connectionAction));
    const back=root.querySelector('[data-connection-action=back]');back.innerHTML=icon('back');back.setAttribute('aria-label',t('Back to Account'));
    const searchButton=root.querySelector('[data-connection-action=search]');if(searchButton)searchButton.insertAdjacentHTML('afterbegin',icon('search'));
    root.querySelectorAll('.shop-connection-grip').forEach(grip=>grip.innerHTML=icon('grip'));
    const statePanel=root.querySelector('.shop-connection-state');if(statePanel)statePanel.dataset.connected=String(reachable&&signedIn&&!POSNIC.net.offline);
    if(reachable&&signedIn&&!POSNIC.net.offline)statePanel?.querySelector('strong').insertAdjacentHTML('afterbegin',icon('check'));
    root.querySelectorAll('.shop-connection-row').forEach(row=>{
      row.dataset.ready=String(['Using now','Ready as backup'].includes(status(POSNIC.server[row.dataset.kind])));
      const address=row.querySelector('small[translate]');address.textContent=shortAddress(POSNIC.server[row.dataset.kind])||'—';
      const edit=row.querySelector('[data-connection-action^="edit-"]');edit.textContent='';
      edit.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m16 3 5 5-13 13H3v-5L16 3Zm-3 3 5 5"/></svg>';
    });
    root.querySelector('#shop-connection-address')?.addEventListener('input',event=>{draft=event.target.value;});
    root.querySelector('#shop-connection-auto')?.addEventListener('change', event => localStorage.setItem('posnic.automatic-connections', event.target.checked ? '1' : '0'));
    root.querySelector('#shop-connection-auto')?.addEventListener('change',draw);
    root.querySelectorAll('[draggable]').forEach(row => {
      row.ondragstart = event => event.dataTransfer.setData('text/plain', row.dataset.kind);
      row.ondragover = event => event.preventDefault();
      row.ondrop = event => { event.preventDefault(); if(event.dataTransfer.getData('text/plain') !== row.dataset.kind) reorder(); };
      const grip = row.querySelector('.shop-connection-grip');
      grip.onpointerdown = event => {
        const start = event.clientY; grip.setPointerCapture(event.pointerId);
        grip.onpointerup = end => { if(Math.abs(end.clientY-start)>35) reorder(); };
      };
    });
  }
  function reorder() { POSNIC.server.setPriority(POSNIC.server.priority === 'lan' ? 'cloud' : 'lan'); draw(); }
  async function check() {
    busy = true; message = 'Checking saved connections…'; draw();
    try {
      let wifi = null;
      const network = window.Capacitor?.Plugins?.LocalNetwork;
      if (network?.getLocalIp) {
        try { wifi = (await Promise.race([network.getLocalIp(), new Promise(resolve => setTimeout(() => resolve(null),800))]))?.wifi; } catch (_) {}
      }
      await Promise.all(['lan','cloud'].map(async kind => {
        const base = POSNIC.server[kind]; if (!base) return;
        const hit = kind === 'lan' && wifi === false ? null : await bounded(POSNIC.discovery.probe(base,1200),1800);
        health.set(base,{reachable:!!hit,ok:!!hit && POSNIC.server.canAdopt(base),at:Date.now()});
      }));
      if(POSNIC.session.managed)await bounded(POSNIC.net.check(false),3500);
      message = [...health.values()].some(value => value.ok) ? 'Connection check finished.' : 'Still unavailable. We’ll keep trying.';
    } catch (_) { message = 'Could not check the connection. Try again.'; }
    finally { busy=false; draw(); }
  }
  async function save() {
    const base = POSNIC.server.normalize(root.querySelector('#shop-connection-address').value);
    if (!base || (editing === 'lan') !== POSNIC.server.isLanUrl(base)) { message='Check the shop code or address and try again.';draw();return; }
    busy=true;message='Checking saved connections…';controller=new AbortController();draw();
    const request=controller;
    const owner=POSNIC.session.shopKey+':'+POSNIC.session.user?.id;
    const timeout=setTimeout(()=>request.abort(),6000);
    try {
      const hit=await bounded(POSNIC.discovery.probe(base,1200),1800);
      if(!hit)throw new Error(t('The till is not answering. Check the shop Wi-Fi and address, then retry or scan its QR.'));
      if(request.signal.aborted)throw new Error(t('Connection cancelled.'));
      // A discovered address is not proof of shop identity. Never send a
      // bearer token to it before the existing route-proof mechanism succeeds.
      if(POSNIC.session.managed)await POSNIC.session.addAddress(base,request.signal);
      else if(POSNIC.session.active&&!POSNIC.server.canAdopt(base))throw new Error(t('Reconnect the original staff member and server to keep saved orders separate.'));
      if(request.signal.aborted||owner!==POSNIC.session.shopKey+':'+POSNIC.session.user?.id)return;
      POSNIC.server.remember({[editing]:base});health.set(base,{ok:true,at:Date.now()});editing=null;message='Saved';
    } catch(error) {if(!request.signal.aborted)message=error.message || 'Could not check the connection. Try again.';}
    finally {clearTimeout(timeout);if(controller===request){controller=null;busy=false;draw();}}
  }
  async function search() {
    const network=window.Capacitor?.Plugins?.LocalNetwork;
    if(network?.getLocalIp){
      try {const info=await Promise.race([network.getLocalIp(),new Promise(resolve=>setTimeout(()=>resolve(null),800))]);
        if(info?.wifi===false){message='Connect this phone to the shop Wi-Fi, then try again.';draw();return;}
      }catch(_){}
    }
    window.CaptainOnboarding.searchSaved();
  }
  document.addEventListener('DOMContentLoaded',()=>{
    // The approved setup explicitly defaults to automatic fallback. Never
    // overwrite an existing off preference.
    if(localStorage.getItem('posnic.automatic-connections')===null)localStorage.setItem('posnic.automatic-connections','1');
    root=document.createElement('section');root.id='shop-connections';
    document.getElementById('connection-addresses').append(root);
    root.addEventListener('click',event=>{
      const action=event.target.closest('[data-connection-action]')?.dataset.connectionAction;
      if(!action||(busy&&!['back','orders','cancel-edit'].includes(action)))return;
      if(action.startsWith('edit-')){editing=action.slice(5);draft=POSNIC.server[editing]||'';message='';draw();return;}
      if(action==='cancel-edit'){controller?.abort();controller=null;busy=false;editing=null;message='';draw();return;}
      if(action==='reorder')return reorder();
      if(action==='check')return void check();
      if(action==='save')return void save();
      if(action==='search'){void search();return;}
      if(action==='signin'){document.body.classList.remove('shop-connections-page');window.CaptainOnboarding.signInSaved();return;}
      if(action==='back')location.href='me.html';
      if(action==='orders')CaptainOnboarding.close();
    });
    const update=()=>{
      const showing=document.getElementById('captain-onboarding').dataset.setupView==='settings';
      document.body.classList.toggle('shop-connections-page',showing);
      if(showing){draw();if(!busy&&!editing)void check();}else controller?.abort();
    };
    new MutationObserver(update).observe(document.getElementById('captain-onboarding'),{attributes:true,attributeFilter:['data-setup-view']});
    window.addEventListener('posnic:route-health',event=>{const d=event.detail||{};if(d.base)health.set(d.base,{ok:!!d.reachable,at:Date.now()});if(!editing)draw();});
    ['posnic:server-changed','posnic:online','posnic:offline','posnic:session-changed'].forEach(name=>window.addEventListener(name,()=>{if(!editing)draw();}));
    draw();update();
    setInterval(()=>{if(!document.hidden&&document.body.classList.contains('shop-connections-page')&&!busy&&!editing&&POSNIC.net.offline)void check();},15000);
  });
})();
