/* Presentation for first-time setup. Discovery never grants route authority. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const text = value => window.I18N?.t(value) || value;
  function dialog(title) {
    const node = document.createElement('dialog');
    node.className = 'captain-setup-dialog';
    const heading = document.createElement('h2');
    heading.textContent = text(title); node.append(heading);
    document.body.append(node);
    return node;
  }
  function paragraph(node, value) { const p=document.createElement('p');p.textContent=text(value);node.append(p);return p; }
  function action(node, label, callback, secondary=false) {
    const button=document.createElement('button');button.type='button';button.className=secondary?'setup-link':'setup-primary';button.textContent=text(label);button.onclick=callback;node.append(button);return button;
  }
  async function found(hit, signal) {
    const node=dialog(hit.info?.connections?.shopName || 'Shop found');
    paragraph(node,'Sign in to this shop to start taking orders.');
    const addresses=document.createElement('dl');addresses.className='setup-found-addresses';node.append(addresses);
    const add=(label,url)=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=text(label);dd.textContent=url;addresses.append(dt,dd);};
    add(POSNIC.server.isLanUrl(hit.base)?'Shop Wi-Fi':'Internet',hit.base);
    const cloud=POSNIC.server.normalize(hit.info?.connections?.cloud);
    if(cloud&&!POSNIC.server.isLanUrl(cloud)&&cloud!==hit.base){add('Internet backup found',cloud);paragraph(node,'We’ll check this backup after you sign in.');}
    else if(POSNIC.server.isLanUrl(hit.base))paragraph(node,'No internet address was provided. You can still use shop Wi-Fi.');
    return new Promise(resolve=>{
      const aborted=()=>finish(false);
      const finish=accepted=>{signal?.removeEventListener('abort',aborted);node.close();node.remove();resolve(accepted);};
      action(node,'Sign in to this shop',()=>finish(true));
      action(node,'Choose another shop',()=>finish(false),true);
      node.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
      if(signal?.aborted)return finish(false);signal?.addEventListener('abort',aborted,{once:true});node.showModal();
    });
  }
  async function finishSetup(branchId) {
    if($('setup-remember'))localStorage.setItem('posnic.remember-session',$('setup-remember').checked?'1':'0');
    sessionStorage.setItem('posnic.current-session','1');
    localStorage.setItem('posnic.setup-complete','1');
    // Enabling the approved automatic flow does not authorize a new shop/route.
    if(localStorage.getItem('posnic.automatic-connections')===null)localStorage.setItem('posnic.automatic-connections','1');
    if(!POSNIC.server.priorityConfigured)POSNIC.server.setPriority('lan');
    POSNIC.server.unpin();
    if(branchId) {
      try {
        const owner=POSNIC.session.shopKey+':'+POSNIC.session.user?.id;
        const details=await Promise.race([
          POSNIC.api.post('/captain/v1/connections',{branch_id:branchId}),
          new Promise(resolve=>setTimeout(()=>resolve(null),1800))
        ]);
        if(owner===POSNIC.session.shopKey+':'+POSNIC.session.user?.id&&String(details?.branchId)===String(branchId)) {
          const cloud=POSNIC.server.normalize(details.cloud);
          if(cloud&&!POSNIC.server.isLanUrl(cloud)) {
            POSNIC.server.remember({cloud});
            // Only a successful proof may promote this discovery hint to a route.
            if(POSNIC.session.managed)await Promise.race([
              POSNIC.session.addAddress(cloud),
              new Promise(resolve=>setTimeout(resolve,1200))
            ]);
          }
        }
      } catch (_) { /* Older servers and unavailable peers must not block login. */ }
    }
    if($('setup-use-pin')?.checked&&!POSNIC.lock.isSet())await POSNIC.lock.choose();
  }
  window.CaptainSetupFlow={found,finishSetup};
  document.addEventListener('DOMContentLoaded',()=>{
    $('captain-cloud-login').textContent=text('Sign in with Posnic');
    $('captain-address-toggle').textContent=text('Other ways to connect');
    $('setup-start-hint').textContent=text('Find your shop on Wi-Fi, or sign in with Posnic. No server address needed.');
    const pin=document.createElement('label');pin.className='setup-confirm';
    pin.innerHTML='<input type="checkbox" id="setup-use-pin"><span>Use a PIN on this phone (optional)</span>';
    $('login-btn').before(pin);
    const remember=document.createElement('label');remember.className='setup-confirm';
    remember.innerHTML='<input type="checkbox" id="setup-remember"><span>Keep me signed in</span>';
    pin.before(remember);$('setup-remember').checked=localStorage.getItem('posnic.remember-session')!=='0';
    const help=document.createElement('p');help.className='setup-hint setup-session-help';help.textContent=text('Add or change your PIN anytime in Account.');pin.after(help);
    const priority=document.createElement('div');priority.className='setup-priority';
    priority.innerHTML='<h3>Connection priority</h3><p>Drag to reorder, or use the arrow button. The first available connection is used.</p><div id="setup-priority-rows"></div><label class="setup-confirm"><input type="checkbox" id="setup-auto-switch"> Switch automatically between saved connections</label>';
    $('connection-save').before(priority);
    const draw=()=>{
      const rows=$('setup-priority-rows');rows.replaceChildren();
      const kinds=POSNIC.server.priority==='cloud'?['cloud','lan']:['lan','cloud'];
      kinds.forEach((kind,index)=>{const row=document.createElement('div');row.className='setup-priority-row';row.draggable=true;row.dataset.kind=kind;
        const grip=document.createElement('span');grip.className='setup-priority-grip';grip.textContent='⠿';grip.setAttribute('aria-hidden','true');row.append(grip);
        const label=document.createElement('span');label.textContent=(index+1)+'. '+text(kind==='lan'?'Shop Wi-Fi':'Internet');row.append(label);
        const move=document.createElement('button');move.type='button';move.textContent=index?'↑':'↓';move.setAttribute('aria-label',text(index?'Move up':'Move down'));move.onclick=()=>{POSNIC.server.setPriority(POSNIC.server.priority==='lan'?'cloud':'lan');draw();};row.append(move);
        let origin=null;
        grip.onpointerdown=e=>{origin=e.clientY;grip.setPointerCapture(e.pointerId);row.classList.add('is-moving');};
        grip.onpointerup=e=>{row.classList.remove('is-moving');if(origin!==null&&((index===0&&e.clientY-origin>35)||(index===1&&origin-e.clientY>35)))move.click();origin=null;};
        grip.onpointercancel=()=>{origin=null;row.classList.remove('is-moving');};
        row.ondragstart=e=>e.dataTransfer.setData('text/plain',kind);row.ondragover=e=>e.preventDefault();row.ondrop=e=>{e.preventDefault();if(e.dataTransfer.getData('text/plain')!==kind)move.click();};rows.append(row);
      });
    };draw();
    $('setup-auto-switch').checked=localStorage.getItem('posnic.automatic-connections')==='1';
    $('setup-auto-switch').onchange=e=>localStorage.setItem('posnic.automatic-connections',e.target.checked?'1':'0');
    const network=window.Capacitor?.Plugins?.LocalNetwork;
    if(network?.getLocalIp)Promise.race([network.getLocalIp(),new Promise(resolve=>setTimeout(()=>resolve(null),800))]).then(info=>{
      if(info?.wifi===false){$('captain-search').hidden=true;$('setup-start-hint').textContent=text('Wi-Fi is off. Sign in with Posnic to find your shop.');}
      if(info?.wifi&&/^\d{1,3}(\.\d{1,3}){3}$/.test(info.ip)){
        const prefix=info.ip.split('.').slice(0,3).join('.')+'.';
        const label=document.createElement('label');label.className='setup-label';label.textContent=text('Last number of the billing computer’s address');
        const row=document.createElement('div');row.className='setup-ip-suffix';const fixed=document.createElement('span');fixed.textContent=prefix;
        const input=document.createElement('input');input.inputMode='numeric';input.maxLength=3;input.setAttribute('aria-label',text('Last number'));input.placeholder='200';
        input.oninput=()=>{if(/^\d{1,3}$/.test(input.value)&&Number(input.value)<=255){$('captain-server').value=prefix+input.value+':5555';$('captain-server').dispatchEvent(new Event('input'));}};
        row.append(fixed,input);label.append(row);$('setup-address-entry').prepend(label);
      }
    }).catch(()=>{});
    if(!POSNIC.server.isConfigured&&!POSNIC.session.active&&!localStorage.getItem('posnic.setup-intro-seen')){
      const node=dialog('Let’s get you ready.');node.classList.add('setup-welcome');
      paragraph(node,'First-time setup');
      paragraph(node,'We’ll connect this phone to your shop, then help you sign in. You only need to set this up once.');
      ['Find your shop','Sign in once','Start taking orders'].forEach((value,i)=>{const p=paragraph(node,(i+1)+'. '+text(value));p.className='setup-welcome-step';p.style.animationDelay=(i*120)+'ms';});
      const close=()=>{localStorage.setItem('posnic.setup-intro-seen','1');node.close();node.remove();};action(node,'Set up this phone',close);node.addEventListener('cancel',e=>{e.preventDefault();close();});node.showModal();
    }
  });
})();
