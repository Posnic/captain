/* Add a separately authenticated route without signing out the working till. */
(function () {
  const t = value => window.I18N?.t(value) || value;
  const recoveryShown = new Set();
  window.addEventListener('posnic:connection-signin', event => {
    const base = event.detail?.base;
    if (!base || recoveryShown.has(base) || !POSNIC.session.user?.id || !POSNIC.session.shopKey || window.CaptainAccess?.locked) return;
    recoveryShown.add(base);
    window.CaptainConnectionSignIn.open(POSNIC.server.isLanUrl(base) ? 'lan' : 'cloud', {base});
  });
  window.CaptainConnectionSignIn = {
    open(kind, options={}) {
      if (document.getElementById('connection-signin')) return;
      const dialog = document.createElement('dialog');
      dialog.id = 'connection-signin';
      dialog.style.cssText = 'width:min(420px,calc(100% - 24px));box-sizing:border-box;margin:auto;max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--line,#ccd5e0);border-radius:22px;padding:24px;background:var(--surface,#fff);color:var(--ink,#172638)';
      dialog.innerHTML = '<h2></h2><p data-help></p><button type="button" data-search></button><div data-results></div><form><label><span data-address-label></span><input name="address" required autocomplete="url"></label><label><span data-user-label></span><input name="username" required autocomplete="username" autocapitalize="none"></label><label><span data-password-label></span><input name="password" type="password" required autocomplete="current-password"></label><p role="status"></p><button type="submit"></button></form><button type="button" data-cloud></button><button type="button" data-cancel></button>';
      dialog.querySelector('h2').textContent = t(kind === 'cloud' ? 'Internet' : 'Shop Wi-Fi');
      dialog.querySelector('[data-help]').textContent = t('Sign in to this shop to start taking orders.');
      for (const [selector, label] of [['[data-address-label]','Shop code or server address'],['[data-user-label]','Username'],['[data-password-label]','Password'],['[type=submit]','Sign in'],['[data-cloud]','Sign in with Posnic Cloud'],['[data-cancel]','Cancel']]) dialog.querySelector(selector).textContent=t(label);
      dialog.querySelector('[data-search]').textContent=t('Search this Wi-Fi');
      dialog.querySelector('[data-search]').hidden=kind!=='lan';
      const form=dialog.querySelector('form'), status=dialog.querySelector('[role=status]');
      let selectedDiscovery = null;
      form.elements.address.value=options.base||POSNIC.server[kind]||'';
      form.elements.address.readOnly=!!form.elements.address.value;
      const shop=document.createElement('p');
      try {const branches=JSON.parse(localStorage.getItem('kiosk_branch_list')||'[]');shop.textContent=branches.find(b=>String(b.branch_id)===localStorage.getItem('branch_id'))?.branch_name||branches[0]?.branch_name||'';}catch{}
      dialog.querySelector('h2').after(shop);
      dialog.querySelector('[data-cloud]').hidden=kind!=='cloud';
      if(kind==='cloud'){const hint=document.createElement('p');hint.textContent=t('Owner or admin connects this phone.');hint.style.cssText='font-size:12px;color:var(--ink-soft,#647084);margin:0 0 12px';dialog.querySelector('[data-cloud]').after(hint);}
      dialog.querySelectorAll('label').forEach(el=>el.style.cssText='display:grid;gap:6px;margin:14px 0');
      dialog.querySelectorAll('input,button').forEach(el=>el.style.cssText='width:100%;min-height:48px;padding:10px 12px;border:1px solid var(--line,#ccd5e0);border-radius:12px;background:var(--surface,#fff);color:var(--ink,#172638);font:inherit;box-sizing:border-box;margin-bottom:8px');
      form.querySelector('button').style.cssText+='background:var(--accent,#2458db);color:var(--accent-ink,#fff);border-color:transparent;font-weight:600';
      dialog.querySelector('[data-cancel]').style.borderColor='transparent';
      let controller=null, scan=null;
      const back=event=>{event.preventDefault();event.stopImmediatePropagation();close();};
      const close=()=>{scan?.abort();controller?.abort();window.removeEventListener('captain:back',back,true);dialog.close();dialog.remove();};
      window.addEventListener('captain:back',back,true);
      dialog.querySelector('[data-cancel]').onclick=close;
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
      dialog.querySelector('[data-cloud]').onclick=()=>{sessionStorage.setItem('captain.link-return-base',POSNIC.server.baseUrl);sessionStorage.setItem('captain.link-cloud','1');sessionStorage.setItem('posnic_editing_server','1');close();location.href='index.html';};
      dialog.querySelector('[data-search]').onclick=async()=>{
        if(scan){scan.abort();return;}
        const request=new AbortController();scan=request;
        const search=dialog.querySelector('[data-search]'), results=dialog.querySelector('[data-results]');
        search.textContent=t('Cancel');results.replaceChildren();status.textContent=t('Checking saved till addresses…');
        const timeout=setTimeout(()=>request.abort(),20000);
        const seen=new Set();
        const collect=hit=>{
          if(request.signal.aborted || seen.has(hit.base))return;
          seen.add(hit.base);
          const button=document.createElement('button');button.type='button';
          button.textContent=(hit.info?.connections?.shopName || new URL(hit.base).host);
          button.style.cssText='display:block;width:100%;padding:12px;margin:8px 0;text-align:left;border:1px solid var(--line,#ccd5e0);border-radius:12px;background:var(--surface,#fff);color:var(--ink,#172638);font:inherit';
          button.onclick=async()=>{
            request.abort();
            const confirm=document.createElement('dialog');
            confirm.style.cssText=dialog.style.cssText;
            const title=document.createElement('h2');title.textContent=hit.info?.connections?.shopName||new URL(hit.base).host;
            const address=document.createElement('p');address.textContent=hit.base;
            const cloud=document.createElement('p');cloud.textContent=hit.info?.connections?.cloud||'';
            const accept=document.createElement('button');accept.type='button';accept.textContent=t('Connect');
            const cancel=document.createElement('button');cancel.type='button';cancel.textContent=t('Choose another shop');
            for(const control of [accept,cancel])control.style.cssText='width:100%;min-height:48px;margin-top:12px;border-radius:12px;font:inherit';
            confirm.append(title,address,cloud,accept,cancel);document.body.append(confirm);
            const confirmed=await new Promise(resolve=>{const done=value=>{confirm.close();confirm.remove();resolve(value);};accept.onclick=()=>done(true);cancel.onclick=()=>done(false);confirm.oncancel=e=>{e.preventDefault();done(false);};confirm.showModal();});
            if(!confirmed||!dialog.isConnected)return;
            selectedDiscovery = hit;
            form.elements.address.value=hit.base;status.textContent='';form.elements.username.focus();
          };
          // Presentation metadata uses the same Wi-Fi-bound transport as orders.
          const details=new AbortController();const deadline=setTimeout(()=>details.abort(),1500);
          (window.CaptainFetch||fetch)(hit.base+'/captain/v1/discovery',{signal:details.signal,credentials:'omit',redirect:'error'})
            .then(r=>r.ok?r.json():null).then(data=>{if(data?.connections)hit.info={...hit.info,connections:data.connections};})
            .catch(()=>{}).finally(()=>{clearTimeout(deadline);button.textContent=(hit.info?.connections?.shopName||new URL(hit.base).host)+' · '+new URL(hit.base).host;});
          results.append(button);
        };
        try {
          const network=await Promise.race([window.Capacitor?.Plugins?.LocalNetwork?.getLocalIp(),new Promise(resolve=>setTimeout(()=>resolve(null),2500))]);
          if(!network?.wifi || !/^\d{1,3}(\.\d{1,3}){3}$/.test(network.ip||''))throw new Error(t('Connect this phone to the shop Wi-Fi, then try again.'));
          if(request.signal.aborted)return;
          const saved=POSNIC.server.lan;
          if(saved){const hit=await POSNIC.discovery.probe(saved,1200);if(hit)collect(hit);}
          await POSNIC.discovery.scanSubnet(network.ip.split('.').slice(0,3).join('.'),{concurrency:16,ownHost:Number(network.ip.split('.').pop()),shouldStop:()=>request.signal.aborted,collect});
          if(!request.signal.aborted)status.textContent=seen.size?'':t('No compatible till found. Check that the till is open and both devices use the shop Wi-Fi, not guest Wi-Fi. Retry or scan its QR.');
        } catch(error){if(!request.signal.aborted)status.textContent=error.message;}
        finally {clearTimeout(timeout);if(scan===request){scan=null;search.textContent=t('Search this Wi-Fi');}}
      };
      form.onsubmit=async event=>{
        event.preventDefault();if(controller)return;scan?.abort();
        const base=POSNIC.server.normalize(form.elements.address.value);
        if(!base || POSNIC.server.isLanUrl(base)!==(kind==='lan')){status.textContent=t('Check the shop code or address and try again.');return;}
        controller=new AbortController();const request=controller;
        const owner=POSNIC.session.shopKey+':'+POSNIC.session.user?.id;
        form.querySelector('button').disabled=true;status.textContent=t('Connecting to your shop…');
        try {
          const grant=await CaptainAccess.post(base,'/users/kioskMobileLogin',{username:form.elements.username.value.trim(),password:form.elements.password.value,device:POSNIC.thisDevice.facts()},request.signal);
          if(request.signal.aborted || owner!==POSNIC.session.shopKey+':'+POSNIC.session.user?.id)return;
          await window.CaptainValidateAccess(grant,base,request.signal);
          await POSNIC.session.link(grant,base);
          // Store the advertised address only after the selected till authenticates
          // as this shop; cloud credentials still require their own sign-in.
          if (selectedDiscovery?.base === base) {
            const cloud=POSNIC.server.normalize(selectedDiscovery.info?.connections?.cloud);
            if (cloud && !POSNIC.server.isLanUrl(cloud)) POSNIC.server.remember({cloud});
          }
          if(request.signal.aborted)return;
          await POSNIC.internetChoice.select(kind);
          recoveryShown.delete(base);
          close();
        } catch(error) {if(!request.signal.aborted)status.textContent=t(error.message||'Could not connect. Try again.');}
        finally{controller=null;if(dialog.isConnected)form.querySelector('button').disabled=false;}
      };
      document.body.append(dialog);dialog.showModal();
    }
  };
})();
