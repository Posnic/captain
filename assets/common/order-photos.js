(function () {
  'use strict';
  if(window.OrderPhotos)return;
  const t = text => window.I18N?.t ? I18N.t(text) : text;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
  const safeImage = value => typeof value === 'string' && value.length <= 7100000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value);
  const owner = () => JSON.stringify([POSNIC.session.shopKey || POSNIC.server.baseUrl, localStorage.getItem('branch_id'), POSNIC.session.user?.id]);
  async function storage(key, value) {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('captain-order-references',2);
      request.onupgradeneeded = () => {const store=request.result.objectStoreNames.contains('drafts')?request.transaction.objectStore('drafts'):request.result.createObjectStore('drafts');if(!store.indexNames.contains('owner'))store.createIndex('owner','owner');};
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try { return await new Promise((resolve,reject) => {
      const tx=db.transaction('drafts',value === undefined ? 'readonly' : 'readwrite');
      const store=tx.objectStore('drafts');
      let metadata;
      const request=value === undefined ? (key === null ? store.index('owner').openCursor(IDBKeyRange.only(owner())) : store.get(key)) : value === null ? store.delete(key) : store.put(value,key);
      if(key===null){metadata=[];request.onsuccess=()=>{const cursor=request.result;if(cursor){const {original,...row}=cursor.value;metadata.push({...row,original:row.thumb||''});cursor.continue();}};}
      tx.oncomplete=()=>resolve(metadata||request.result);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    }); } finally { db.close(); }
  }
  function render(order, {readOnly=false}={}) {
    const photos = [order?.paper_order, ...(Array.isArray(order?.order_photos) ? order.order_photos : [])];
    const ids = [...new Set(photos.map(photo => photo?.id).filter(validId))];
    const sale = !readOnly && /^[a-f0-9]{24}$/i.test(order?._id || '') ? order._id : '';
    const items = [...new Map((order?.items || []).filter(i=>/^[a-f0-9]{24}$/i.test(String(i.item_id||''))).map(i=>[String(i.item_id),{id:String(i.item_id),name:i.item_name||i.name||''}])).values()];
    return `<section class="order-photos-panel" data-photo-items="${esc(JSON.stringify(items))}" data-order-photos="${sale}"><header><h3>${t('Order photos')}</h3>${sale ? `<button class="order-photo-add" type="button" hidden>+ ${t('Photo')}</button>` : ''}</header><div class="order-photo-grid">${ids.map(id=>photoRow(id,id===order?.paper_order?.id?'Paper order':'Photo',photos.find(p=>p?.id===id)?.item_name)).join('')}</div><div data-photo-queue="${sale}"></div></section>`;
  }
  function photoRow(id,label='Photo',itemName='') {
    return `<section class="order-photo" data-order-photo="${id}"><button type="button" class="order-photo-open"><span class="order-photo-thumb" aria-hidden="true">▧</span><span><strong>${itemName?esc(itemName):t(label)}</strong><small>${t('View')}</small></span></button><span class="order-photo-status" role="status"></span></section>`;
  }
  let uploading=false, capturePending, finishCapture;
  const queueKey = row => row.owner+':photo:'+row.id;
  async function queued() { return (await storage(null)).filter(row=>row?.owner===owner() && validId(row.id) && row.saleId); }
  async function refreshQueue() {
    const rows=await queued();
    document.querySelectorAll('[data-photo-queue]').forEach(list=>{
      list.replaceChildren();
      for(const row of rows.filter(r=>r.saleId===list.dataset.photoQueue)) {
        const card=document.createElement('div');card.className='photo-queue-row';
        const img=document.createElement('img');img.src=row.original;img.alt=t('Photo');
        const status=document.createElement('span');status.textContent=(row.itemName?row.itemName+' · ':'')+t(row.state==='uploading'?'Uploading photo…':row.state==='failed'?'Retry':'Pending');status.setAttribute('role','status');
        card.append(img,status);
        if(row.state==='failed') { const retry=document.createElement('button');retry.textContent=t('Retry');retry.onclick=async()=>{const original=await storage(queueKey(row));if(!original||original.owner!==owner())return;original.next=0;original.state='pending';await storage(queueKey(original),original);void drain();};card.append(retry); }
        list.append(card);
      }
    });
  }
  async function drain() {
    if(uploading || !window.POSNIC?.session?.user || !navigator.onLine)return;
    uploading=true;
    try {
      for(const saved of await queued()) {
        const row=await storage(queueKey(saved));if(!row)continue;
        if(owner()!==row.owner)break;
        if(row.next>Date.now())continue;
        row.state='uploading';await storage(queueKey(row),row);await refreshQueue();
        try {
          if(owner()!==row.owner)break;
          const result=await POSNIC.api.post('/captain/v1/paper-orders/reference',{id:row.id,original:row.original,saleId:row.saleId,...(row.itemId?{itemId:row.itemId}:{})},{timeout:90000});
          if(result?.photo?.id!==row.id)throw new Error('Retry');
          if(row.itemId && result.photo.item_id!==row.itemId)throw new Error('Retry');
          await storage(queueKey(row),null);
          if(owner()===row.owner)document.querySelectorAll('[data-order-photos]').forEach(host=>{
            if(host.dataset.orderPhotos===row.saleId&&!host.querySelector(`[data-order-photo="${row.id}"]`)){
              host.querySelector('.order-photo-grid').insertAdjacentHTML('beforeend',photoRow(row.id,'Photo',result.photo.item_name||row.itemName));mount(host);
            }
          });
        }catch {row.state='failed';row.next=Date.now()+60000;await storage(queueKey(row),row);}
        await refreshQueue();
      }
    } catch { /* Storage remains the source of truth; retry on next visit. */ }
    finally {uploading=false;}
  }
  function attachment(host) {
    const dialog=document.createElement('dialog');dialog.classList.add('order-photo-viewer','order-photo-upload');
    const openedOwner=owner(),saleId=host.dataset.orderPhotos;
    let selectedItem=null;
    dialog.innerHTML=`<header><h2>${t('Order photos')}</h2><button type="button" data-close aria-label="${t('Close')}">×</button></header><div class="order-photo-full"><p>${t('For reference only')}</p><div class="photo-capture-actions"><label>${t('Take photo')}<input data-camera type="file" accept="image/*" capture="environment"></label><label>${t('Choose photo')}<input data-gallery type="file" accept="image/jpeg,image/png" multiple></label></div><p role="status"></p><div data-photo-queue="${saleId}"></div></div><footer><button type="button" data-close>${t('Done')}</button></footer>`;
    dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());
    dialog.addEventListener('close',()=>dialog.remove());
    const status=dialog.querySelector('[role=status]');
    if(host.dataset.itemPhotos==='true') {
      const items=JSON.parse(host.dataset.photoItems||'[]');
      if(items.length){
        const picker=document.createElement('section');picker.className='photo-dish-picker';
        picker.innerHTML=`<input type="search" placeholder="${esc(t('Search the menu'))}" aria-label="${esc(t('Search the menu'))}"><div class="photo-dish-options"></div>`;
        const search=picker.querySelector('input'),list=picker.querySelector('div');
        const draw=()=>{list.replaceChildren();for(const item of [null,...items.filter(i=>i.name.toLowerCase().includes(search.value.toLowerCase()))]){
          const button=document.createElement('button');button.type='button';button.textContent=item?.name||t('Order photos');button.setAttribute('aria-pressed',String(selectedItem?.id===item?.id));button.onclick=()=>{selectedItem=item;draw();};list.append(button);
        }};
        search.oninput=draw;draw();dialog.querySelector('.photo-capture-actions').before(picker);
      }
    }
    dialog.querySelectorAll('input[type=file]').forEach(input=>{
      input.onclick=()=>{capturePending=new Promise(resolve=>finishCapture=resolve);};
      input.oncancel=()=>{finishCapture?.();capturePending=null;};
      input.onchange=async()=>{
        const files=[...input.files];input.value='';
        const item=selectedItem;
        try {
          for(const file of files) {
            if(file.size>5*1024*1024){status.textContent=t('Choose a photo under 5 MB.');continue;}
            const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reader.onabort=reject;reader.readAsDataURL(file);});
            if(!safeImage(data))throw Error();
            const image=new Image();image.src=data;await image.decode();
            const canvas=document.createElement('canvas');const scale=Math.min(1,160/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
            const row={id:crypto.randomUUID(),owner:openedOwner,saleId,itemId:item?.id,itemName:item?.name,original:data,thumb:canvas.toDataURL('image/jpeg',0.75),state:'pending',created:Date.now()};
            await storage(queueKey(row),row);status.textContent=t('Saved');await refreshQueue();
          }
          void drain();
        }catch{status.textContent=t('Photo could not be saved. Free phone storage and retry.');}
        finally{finishCapture?.();capturePending=null;}
      };
    });
    (host.closest('.modal.show')||document.body).append(dialog);dialog.showModal();
    // Preserve any attachment saved by an earlier APK, including uncertain sends.
    const legacyKey=openedOwner+':'+saleId;
    storage(legacyKey).then(async old=>{if(validId(old?.id)&&safeImage(old.original)){const row={...old,owner:openedOwner,saleId,state:'pending'};await storage(queueKey(row),row);await storage(legacyKey,null);}await refreshQueue();void drain();}).catch(()=>{status.textContent=t('Photo could not be saved. Free phone storage and retry.');});
  }
  window.CaptainReferenceCapture={waitForPhoto:()=>capturePending?Promise.race([capturePending,new Promise(resolve=>setTimeout(resolve,10000))]):Promise.resolve()};
  window.addEventListener('online',()=>void drain());
  window.addEventListener('focus',()=>void drain());
  setInterval(()=>void drain(),60000);
  document.addEventListener('DOMContentLoaded',()=>void drain());
  function viewer(data, opener) {
    const dialog = document.createElement('dialog');
    dialog.className = 'order-photo-viewer';
    dialog.innerHTML = `<header><h2>${t('Photo')}</h2><button type="button" aria-label="${t('Close')}">×</button></header><div class="order-photo-full"><img alt="${t('Photo')}"></div>`;
    const image = dialog.querySelector('img');
    image.src = data;
    image.addEventListener('click', () => image.classList.toggle('order-photo-zoom'));
    dialog.querySelector('button').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { dialog.remove(); if (opener.isConnected) opener.focus(); });
    (opener.closest('.modal.show') || document.body).append(dialog);
    dialog.showModal();
  }
  function mount(root) {
    const attachments=[...root?.querySelectorAll('[data-order-photos]')||[]].filter(host=>host.dataset.orderPhotos && !host.dataset.attachMounted);
    if(attachments.length) {
      attachments.forEach(host=>{host.dataset.attachMounted='1';});
      POSNIC.api.get('/captain/v1/paper-orders/options').then(options=>{
        if(!options.enabled||!options.configured||!options.referenceAttachments)return;
        attachments.forEach(host=>{host.dataset.itemPhotos=String(options.itemReferenceAttachments===true);const add=host.querySelector('.order-photo-add');if(add){add.hidden=false;add.onclick=()=>attachment(host);}});
      }).catch(()=>{});
    }
    void refreshQueue().then(drain).catch(()=>{});
    root?.querySelectorAll('[data-order-photo]').forEach(host => {
      if (host.dataset.mounted) return;
      host.dataset.mounted = '1';
      const button = host.querySelector('button'), status = host.querySelector('[role=status]');
      let data, loading;
      async function load() {
        if (data) return data;
        if (loading) return loading;
        status.textContent = t('Loading...');
        loading = POSNIC.api.get('/captain/v1/paper-orders/photos/' + host.dataset.orderPhoto, {timeout:45000}).then(result => {
          if (!safeImage(result?.data)) throw new TypeError();
          data = result.data;
          if (host.isConnected) {
            const img = document.createElement('img'); img.src = data; img.alt = '';
            host.querySelector('.order-photo-thumb').replaceChildren(img);
            status.textContent = '';
          }
          return data;
        }).catch(() => { if (host.isConnected) status.textContent = t('Retry'); return null; })
          .finally(() => { loading = null; });
        return loading;
      }
      button.onclick = async () => {
        button.disabled = true;
        try { const photo = await load(); if (photo && host.isConnected) viewer(photo, button); }
        finally { button.disabled = false; }
      };
      // Authentication stays in POSNIC.api; never place a private S3 URL or a
      // credential in an image URL. Data is held only for this detail view.
      if(window.IntersectionObserver){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();void load();}});observer.observe(host);}else void load();
    });
  }
  window.OrderPhotos = {render, mount};
  window.addEventListener('captain:back', event => {
    if (event.defaultPrevented) return;
    const top = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (top?.classList.contains('order-photo-viewer')) { event.preventDefault(); if(!top.dataset.busy)top.close(); }
  });
})();
