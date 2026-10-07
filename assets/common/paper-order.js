/* Photo drafts stay on the phone until the ordinary durable order queue accepts them. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let draft, menu = [], tables = [], dialog, busy = false, cropStart, cropEnd, zoom = 1, cropCleared = false, selecting = false, previewObserver;
  let draftScope, capturePending, captureDone;
  const scope = () => `${POSNIC.session.shopKey || POSNIC.server.baseUrl}|${localStorage.getItem('branch_id') || ''}|${POSNIC.session.user?.id || ''}`;
  async function storage(value) {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('captain-paper-orders',1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try { return await new Promise((resolve,reject) => {
      const tx=db.transaction('drafts', value === undefined ? 'readonly':'readwrite');
      const store=tx.objectStore('drafts');
      const key=draftScope || scope();
      const request=value === undefined ? store.get(key) : value === null ? store.delete(key) : store.put(value,key);
      tx.oncomplete=()=>resolve(request.result); tx.onerror=()=>reject(tx.error);
    }); } finally { db.close(); }
  }
  function message(text) { dialog.querySelector('[role=status]').textContent=text; }
  function match(line) {
    const full = menu.filter(p => norm(p.name) === norm(line.text));
    if (full.length === 1) return { ...line, item: full[0].id, quantity: null }; // Chicken 65 isn't quantity 65.
    const hits=menu.filter(p => norm(p.name)===norm(line.name) || norm(p.code)===norm(line.name) || norm(p.name.split(/\s+/).map(w=>w[0]).join(''))===norm(line.name));
    return { ...line, item: hits.length===1 ? hits[0].id : '', reviewed: false };
  }
  async function open() {
    if (dialog && draftScope===scope()) { dialog.showModal(); return; }
    if(dialog){dialog.remove();dialog=null;}
    draftScope=scope();
    try {
      [menu, draft] = await Promise.all([getData('products'), storage()]);
      menu=Array.isArray(menu)?menu:[]; tables=[];
      draft=draft||{id:crypto.randomUUID(),rows:[],table:'',pax:'',original:''};
      for(const product of draft.extraProducts||[])if(!menu.some(p=>p.id===product.id))menu.push(product);
      dialog=document.createElement('dialog'); dialog.className='paper-order-dialog';dialog.setAttribute('aria-labelledby','paper-order-title');
      dialog.innerHTML=`<header><div class="paper-heading"><h2 id="paper-order-title">Paper order</h2><p data-stage-note hidden></p></div><button type="button" data-close aria-label="Close">×</button></header>
        <p role="status" aria-live="polite"></p><div data-content></div><footer class="paper-actions" hidden></footer>`;
      document.body.append(dialog); dialog.querySelector('[data-close]').onclick=()=>{if(!busy)dialog.close();};
      dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
      dialog.addEventListener('close',()=>document.getElementById('paper-order-open')?.focus({preventScroll:true}));
      dialog.showModal(); render();
      if(draft.original&&!draft.uploadId&&!draft.result)await uploadPhoto();
      if(draft.result){
        try{tables=CaptainTables.liveRows(await POSNIC.api.get("/captain/v1/tables"));render();}
        catch{message("Could not check paper scanning. Reconnect and try again. Your saved paper draft is kept.");}
      }
    } catch(e) { showErrorPopup(e.message||'Could not open paper orders.'); }
  }
  function render() {
    previewObserver?.disconnect();
    dialog.dataset.stage=draft.result?'review':draft.original?'photo':'capture';
    const host=dialog.querySelector('[data-content]');
    const actions=dialog.querySelector('.paper-actions');
    actions.replaceChildren();actions.hidden=true;
    dialog.querySelector("h2").textContent=draft.result?"Review order":draft.original?"Use this photo":"Paper order";
    const stageNote=dialog.querySelector("[data-stage-note]");
    stageNote.hidden=!draft.result||!!draft.submission;stageNote.textContent=stageNote.hidden?"":"Draft · not sent to kitchen";
    if(draft.submission){
      host.innerHTML='<p>Order saved. Retry sending the same order.</p><button type="button" data-retry>Retry</button>';
      host.querySelector('[data-retry]').onclick=send;return;
    }
    host.innerHTML=`${draft.result?`<details class="paper-photo-details"><summary><img src="${esc(draft.original)}" alt="Photo"><span>Photo</span></summary>`:''}<label class="paper-camera"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 5l1-2h6l1 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><circle cx="12" cy="12" r="4"/></svg><span>${draft.original?'Retake':'Take photo'}</span><input data-camera type="file" accept="image/*" capture="environment"></label>${!draft.original?'<label class="paper-camera paper-gallery"><span>Choose photo</span><input data-gallery type="file" accept="image/jpeg,image/png"></label>':''}
      ${draft.original?'<div class="paper-preview"><canvas aria-label="Drag to select the writing area"></canvas></div><div class="paper-photo-tools"><button type="button" data-select-area aria-pressed="false">Select area</button><label class="paper-zoom">Zoom<input data-zoom type="range" min="1" max="2" step="0.1" value="1"></label></div><p class="paper-crop-help">Drag around the writing to crop, or process the whole photo. The original is kept.</p><button type="button" data-process>Read photo</button><button type="button" data-reset>Whole photo</button>':''}
      ${draft.result?`</details><section>
      <div class="paper-seating"><label>Table<select data-table><option value="">Choose table</option>${tables.map(t=>`<option value="${esc(t.id)}" ${t.id===draft.table?'selected':''}>${esc(t.tableorder_value)}</option>`).join('')}</select></label><label>Guests (optional)<input data-pax type="number" min="1" max="999" value="${esc(draft.pax)}"></label></div>
      <div data-rows>${draft.rows.map((r,i)=>`<div class="paper-row" data-row="${i}">
      <div class="paper-item-top"><label>${esc(r.text||'Added item')}${r.confidence<90?' · Check handwriting':''}<button type="button" data-item class="paper-item-choice">${esc(menu.find(p=>p.id===r.item)?.name || "Choose menu item")}<span aria-hidden="true">⌕</span></button></label><button type="button" data-remove aria-label="Remove"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div>
      <div class="paper-item-bottom"><div class="paper-quantity"><button type="button" data-minus aria-label="Decrease quantity">−</button><input data-qty aria-label="Quantity" type="number" min="0.01" max="999" step="0.01" value="${esc(r.quantity??'')}"><button type="button" data-plus aria-label="Increase quantity">+</button></div><details class="paper-note" ${r.note?'open':''}><summary>Kitchen note</summary><input data-note aria-label="Kitchen note" maxlength="200" value="${esc(r.note||'')}"></details></div></div>`).join('')}</div>
      <button type="button" data-add>Add item</button><button class="paper-send" type="button" data-send>Send to kitchen</button></section>`:''}`;
    const photoChanged=async e=>{
      if(busy){finishCapture();return;} const file=e.target.files[0]; if(!file){finishCapture();return;}
      if(file.size>5*1024*1024){message('Choose a photo under 5 MB.');finishCapture();return;}
      busy=true;host.inert=true;actions.inert=true;
      try {
        const original=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reader.onabort=()=>reject(reader.error||new Error());reader.readAsDataURL(file);});
        const image=new Image();image.src=original;await image.decode();
        const replacement={id:crypto.randomUUID(),original,rows:[],table:'',pax:''};
        // Commit the new photo before replacing the reviewed draft in memory.
        // A failed read or write must leave its rows and provenance together.
        await storage(replacement);
        draft=replacement;cropStart=cropEnd=null;zoom=1;cropCleared=false;selecting=false;render();message('');
        await uploadPhoto();
      }catch{message('Photo could not be saved. Free phone storage and retry.');}
      finally{busy=false;host.inert=false;actions.inert=false;e.target.value='';finishCapture();}
    };
    host.querySelectorAll('input[type=file]').forEach(input=>{
      input.onchange=photoChanged;
      input.onclick=()=>{capturePending=new Promise(resolve=>captureDone=resolve);};
      input.oncancel=finishCapture;
    });
    if(draft.original) { draw(); host.querySelector('[data-process]').onclick=process;
      const select=host.querySelector('[data-select-area]');select.setAttribute('aria-pressed',String(selecting));
      select.onclick=()=>{selecting=!selecting;select.setAttribute('aria-pressed',String(selecting));host.querySelector('canvas').style.touchAction=selecting?'none':'auto';};
      const slider=host.querySelector('[data-zoom]');slider.value=String(zoom);
      slider.oninput=()=>{zoom=Number(slider.value);draw();};
      host.querySelector('[data-reset]').onclick=()=>{cropStart=cropEnd=null;cropCleared=true;selecting=false;select.setAttribute('aria-pressed','false');zoom=1;slider.value='1';draw();}; }
    if(!draft.result){
      if(draft.original){
        actions.append(host.querySelector('.paper-camera'),host.querySelector('[data-process]'));
        actions.hidden=false;
      }
      return;
    }
    host.querySelector('.paper-seating').after(host.querySelector('.paper-photo-details'));
    host.querySelector('[data-table]').onchange=e=>{draft.table=e.target.value;persist();updateSummary();};
    host.querySelector('[data-pax]').oninput=e=>{draft.pax=e.target.value;persist();};
    host.querySelectorAll('[data-row]').forEach(row=>{
      const i=Number(row.dataset.row);
      row.querySelector('[data-item]').onclick=()=>chooseItem(i);
      const quantity=row.querySelector('[data-qty]');
      const updateQuantity=()=>{draft.rows[i].quantity=quantity.value===''?null:Number(quantity.value);persist();updateSummary();};
      quantity.oninput=updateQuantity;
      for(const [selector,delta] of [['[data-minus]',-1],['[data-plus]',1]]) {
        row.querySelector(selector).onclick=()=>{
          const current=Number(quantity.value);
          if(!Number.isFinite(current))return;
          quantity.value=String(Math.round(Math.min(999,Math.max(0.01,current+delta))*100)/100);
          updateQuantity();
        };
      }
      row.querySelector('[data-note]').oninput=e=>{draft.rows[i].note=e.target.value;persist();};
      row.querySelector('[data-remove]').onclick=()=>{draft.rows.splice(i,1);persist();render();};
    });
    host.querySelector('[data-add]').onclick=()=>chooseItem(null);
    const sendButton=host.querySelector('[data-send]');
    sendButton.onclick=send;
    const summary=document.createElement('div');summary.className='paper-review-summary';summary.setAttribute('aria-live','polite');
    actions.append(summary,sendButton);actions.hidden=false;updateSummary();
  }
  function chooseItem(index) {
    const picker=document.createElement('dialog');picker.className='paper-menu-picker';
    picker.innerHTML='<header><h2>Choose menu item</h2><button type="button" data-back aria-label="Close">×</button></header><input type="search" aria-label="Search the menu" placeholder="Search the menu"><div data-results></div><footer><button type="button" data-quick>Custom item</button></footer>';
    dialog.append(picker);
    const back=event=>{if(!picker.open||event.defaultPrevented)return;event.preventDefault();event.stopImmediatePropagation();picker.close();picker.remove();};
    window.addEventListener('captain:back',back,true);
    picker.addEventListener('close',()=>{if(!picker.isConnected)window.removeEventListener('captain:back',back,true);});
    const choose=product=>{
      if(index===null)draft.rows.push({text:'',item:product.id,quantity:1,confidence:100});
      else draft.rows[index].item=product.id;
      persist();picker.close();picker.remove();render();
    };
    const search=picker.querySelector('input');
    const show=()=>{
      const words=search.value.toLocaleLowerCase().trim().split(/\s+/);
      const matches=menu.filter(p=>words.every(word=>(p.name+' '+(p.code||'')).toLocaleLowerCase().includes(word))).slice(0,80);
      const results=picker.querySelector('[data-results]');results.replaceChildren();
      for(const product of matches){const button=document.createElement('button');button.type='button';button.textContent=product.name;button.onclick=()=>choose(product);results.append(button);}
      if(!matches.length){const empty=document.createElement('p');empty.textContent='Nothing matched yet.';results.append(empty);}
    };
    picker.querySelector('[data-back]').onclick=()=>{picker.close();picker.remove();};
    picker.querySelector('[data-quick]').onclick=async()=>{
      const name=search.value.trim();if(!name){search.focus();return;}
      picker.close();dialog.close();
      try{
        const answer=await POSNIC.quickSale.ask(name);if(!answer)return;
        const product=await POSNIC.quickSale.createOneOff(name,answer.amount,answer.tax);
        menu.push(product);draft.extraProducts=[...(draft.extraProducts||[]),product];choose(product);
      }catch(e){message(e.message);}finally{dialog.showModal();if(picker.isConnected){picker.showModal();}}
    };
    search.oninput=show;show();picker.showModal();search.focus();
  }
  function updateSummary() {
    const summary=dialog.querySelector('.paper-review-summary');if(!summary)return;
    const count=draft.rows.length;
    const quantity=Math.round(draft.rows.reduce((sum,row)=>sum+(Number.isFinite(row.quantity)&&row.quantity>0?row.quantity:0),0)*100)/100;
    const table=tables.find(t=>t.id===draft.table);
    const countText=count===1?`${count} item · ${quantity} qty`:`${count} items · ${quantity} qty`;
    summary.innerHTML=`<span>${countText}</span>${table?`<span>Table ${esc(table.tableorder_value)}</span>`:''}`;
    dialog.querySelector('[data-send]').disabled=count===0;
  }
  function persist() { storage(draft).catch(()=>message('Changes could not be saved. Keep this screen open and retry.')); }
  function finishCapture(){captureDone?.();captureDone=null;capturePending=null;}
  // A PIN still locks immediately. Delay only navigation so the native file
  // callback can save under the owner captured before Android opened the picker.
  window.CaptainPaperCapture={waitForPhoto:()=>capturePending?new Promise(resolve=>{
    const timer=setTimeout(resolve,10000);
    capturePending.then(()=>{clearTimeout(timer);resolve();});
  }):Promise.resolve()};
  async function bitmap() { const img=new Image();img.src=draft.original;await img.decode();return img; }
  async function draw() {
    const canvas=dialog.querySelector('canvas'), img=await bitmap();
    canvas.style.touchAction=selecting?'none':'auto';
    canvas.width=img.width;canvas.height=img.height;
    const preview=canvas.parentElement;
    const fit=()=>{
      const scale=Math.min(preview.clientWidth/img.width,preview.clientHeight/img.height);
      canvas.style.width=`${img.width*scale*zoom}px`;canvas.style.height=`${img.height*scale*zoom}px`;
    };
    fit();previewObserver?.disconnect();previewObserver=new ResizeObserver(fit);previewObserver.observe(preview);
    const ctx=canvas.getContext('2d');
    const paint=()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);
      if(cropStart&&cropEnd){ctx.strokeStyle=getComputedStyle(dialog).getPropertyValue('--accent').trim()||'#2458dc';ctx.lineWidth=Math.max(3,img.width/150);ctx.strokeRect(cropStart.x,cropStart.y,cropEnd.x-cropStart.x,cropEnd.y-cropStart.y);}
    };paint();
    const point=e=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*canvas.height/r.height))};};
    let pointer=null;
    canvas.onpointerdown=e=>{if(busy||!selecting||!e.isPrimary||e.button!==0)return;pointer=e.pointerId;canvas.setPointerCapture(pointer);cropStart=point(e);cropEnd=null;};
    canvas.onpointermove=e=>{if(busy||pointer!==e.pointerId)return;cropEnd=point(e);paint();};
    canvas.onpointerup=e=>{if(busy||pointer!==e.pointerId)return;pointer=null;cropEnd=point(e);draw();};
    canvas.onpointercancel=e=>{if(pointer!==e.pointerId)return;pointer=null;cropStart=cropEnd=null;draw();};
  }
  async function uploadPhoto() {
    busy=true;dialog.dataset.stage='upload';
    dialog.querySelector('[data-content]').inert=true;
    dialog.querySelector('.paper-actions').inert=true;
    const status=dialog.querySelector('[role=status]');
    status.innerHTML='<progress aria-label="Uploading photo…"></progress><span>Uploading photo…</span>';
    try{
      const options=await POSNIC.api.get('/captain/v1/paper-orders/options');
      if(!options.enabled||!options.configured)throw new Error('Paper scanning needs server setup. Ask your manager to configure private photo storage and handwriting recognition in Captain App settings.');
      if(!options.stagedPhotoUpload)throw new Error('Paper scanning needs server setup. Ask your manager to configure private photo storage and handwriting recognition in Captain App settings.');
      const id=draft.uploadRequestId||crypto.randomUUID();draft.uploadRequestId=id;await storage(draft);
      await POSNIC.api.post('/captain/v1/paper-orders/upload',{id,original:draft.original},{timeout:90000});
      draft.uploadId=id;await storage(draft);render();message('Photo uploaded');
    }catch(e){
      status.textContent=e.message||'Could not save. Please try again.';
      const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.onclick=uploadPhoto;status.append(retry);
    }finally{busy=false;dialog.querySelector('[data-content]').inert=false;dialog.querySelector('.paper-actions').inert=false;}
  }
  async function process() {
    if(!draft.uploadId){await uploadPhoto();return;}
    if(busy)return;busy=true;dialog.querySelector('[data-content]').inert=true;dialog.querySelector('.paper-actions').inert=true;
    dialog.querySelector('[role=status]').innerHTML='<progress aria-label="Reading handwriting…"></progress><span>Reading handwriting…</span>';
    try {
      let options;
      try{options=await POSNIC.api.get('/captain/v1/paper-orders/options');}
      catch{throw new Error('Could not check paper scanning. Reconnect and try again. Your saved paper draft is kept.');}
      if(!options.enabled || !options.configured)throw new Error('Paper scanning needs server setup. Ask your manager to configure private photo storage and handwriting recognition in Captain App settings.');
      tables=CaptainTables.liveRows(await POSNIC.api.get('/captain/v1/tables'));
      let crop=cropCleared?undefined:(draft.crop||undefined);
      if(cropStart&&cropEnd){const width=Math.abs(cropEnd.x-cropStart.x),height=Math.abs(cropEnd.y-cropStart.y);
        if(width<20||height<20)throw new Error('Select a larger writing area.');
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        canvas.getContext('2d').drawImage(await bitmap(),Math.min(cropStart.x,cropEnd.x),Math.min(cropStart.y,cropEnd.y),width,height,0,0,width,height);crop=canvas.toDataURL('image/jpeg',0.9);
      }
      // A new crop is a new recognition request; retrying unchanged bytes keeps its ID.
      if((crop||'')!==(draft.crop||'')){draft.id=crypto.randomUUID();draft.crop=crop||'';}
      await storage(draft);
      const result=await POSNIC.api.post('/captain/v1/paper-orders/recognize',{id:draft.id,uploadId:draft.uploadId,crop:draft.crop||undefined},{timeout:90000});
      draft.result=true;draft.rows=result.lines.map(match);draft.pax=result.pax||'';
      draft.table=tables.find(t=>norm(t.tableorder_value)===norm(result.table))?.id||'';
      await storage(draft);render();message(result.truncated?'Some lines were not included. Add missing items before sending.':draft.rows.length?'':'No items found. Retake the photo or add items below.');
    }catch(e){message(e.message||'Could not read photo. Retry when connected.');}finally{busy=false;dialog.querySelector('[data-content]').inert=false;dialog.querySelector('.paper-actions').inert=false;}
  }
  async function send() {
    if(busy)return;busy=true;dialog.querySelector('[data-content]').inert=true;
    try {
      if(draft.submission){await queueSubmission();return;}
      const table=tables.find(t=>t.id===draft.table);
      if(!table)throw new Error('Choose a table.');
      if(!draft.rows.length)throw new Error('Add an item.');
      if(draft.pax!==''&&(!Number.isInteger(Number(draft.pax))||Number(draft.pax)<1||Number(draft.pax)>999))throw new Error('Check the guest count.');
      const items=[];
      for(const row of draft.rows){const product=menu.find(p=>p.id===row.item);
        if(!product||!Number.isFinite(row.quantity)||row.quantity<=0||row.quantity>999)throw new Error('Choose an item and quantity on every line.');
        // Let the established menu ask for preparations and daily prices.
        let price=Number(product.selling_price??product.subtotal??product.price), modifiers=[];
        if(MenuView.askPrice(product)||POSNIC.optionRules?.hasOptions(product)) {
          dialog.close();
          try {
            if(MenuView.askPrice(product)){price=await POSNIC.askPrice(product.name);if(!price)throw new Error('Price entry cancelled. Your draft is kept.');}
            modifiers=await POSNIC.askOptions(product);
            if(modifiers===null)throw new Error('Item options cancelled. Your draft is kept.');
          } finally {dialog.showModal();}
        }
        items.push({item_id:product.id,line_id:crypto.randomUUID(),item_name:product.name,item_quantity:row.quantity,
          item_price:price,item_description:row.note||'',modifiers:modifiers.map(m=>({group:m.group||'',name:m.name||''}))});
      }
      if(POSNIC.session.canTakeOrders===false)throw new Error('Reconnect your account before sending.');
      const branches=await getData(BRANCH_STORE), branch=branches?.[0]?.branch_id||branches?.[0]?.id||localStorage.getItem('branch_id');
      if(!branch)throw new Error('Choose a branch first.');
      draft.orderKey=draft.orderKey||OrderQueue.newKey();await storage(draft);
      const body={idempotencyKey:draft.orderKey,branch,items,paper_order_id:draft.id,
        client:POSNIC.thisDevice?.facts()||{},customerMobile:'',sale_method:'Table-Order',order:'Dine-in',dine_type:'Dine-in',
        kiosk_table_id:table.id,kiosk_table_no:table.tableorder_value,person_count:draft.pax===''?'':Number(draft.pax)};
      draft.submission=body;await storage(draft);
      await queueSubmission();
    }catch(e){if(draft.submission)render();message(e.message||'Order could not be saved. Retry.');}finally{busy=false;dialog.querySelector('[data-content]').inert=false;}
  }
  async function queueSubmission(){
    const body=draft.submission;
    if(!OrderQueue.all().some(r=>r.key===body.idempotencyKey)&&!OrderQueue.add({key:body.idempotencyKey,branch:body.branch,body,held:false}))throw new Error('Order could not be saved. Free phone storage and retry.');
    await storage(null);dialog.close();location.href='kot-management.html';
  }
  window.addEventListener('captain:back',event=>{
    if(event.defaultPrevented || !dialog?.open || document.querySelector('#posnic-lock.is-open'))return;
    if([...document.querySelectorAll('dialog[open]')].at(-1)!==dialog)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!busy)dialog.close();
  },true);
  document.addEventListener('DOMContentLoaded',async()=>{
    const button=document.getElementById('paper-order-open');if(!button)return;
    // Local capture stays discoverable; server opt-in is enforced at Read photo.
    button.hidden=false;
    button.onclick=async()=>{button.disabled=true;try{await open();}finally{button.disabled=false;}};
    button.disabled=false;
  });
})();
