/* Order presentation. Mutations stay in the authenticated, recoverable services. */
(function(root){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function render(orders,{takeaway,financialActions}){
  return `<div class="order-workspace"><div class="order-scroll">${orders.map(order=>{
   const editable=order.payment_status!=='Paid'&&!root.kotIsCancelled(order);
   const id=esc(order._id);
   const rounds=Array.isArray(order.kitchen_rounds)?root.ServiceRounds.render({...order,dine_type:takeaway?'Take away':order.dine_type},editable):
    (order.items||[]).map(item=>`<div class="order-legacy-line${root.kotIsCancelled(order)||root.itemIsCancelled(item)?' is-cancelled':''}"><strong translate="no"${editable&&!root.itemIsCancelled(item)?' role="button" tabindex="0" data-item-note':''}>${esc(item.item_name||item.name)}</strong><span translate="no">×${esc(item.item_quantity??item.quantity)}</span>${(item.item_description??item.notes)?`<p class="order-legacy-note" translate="no">${esc(item.item_description??item.notes)}</p>`:''}${editable&&!root.itemIsCancelled(item)?root.FloorLineActions?.render(order,item)||'':''}</div>`).join('');
   return `<article class="kot-card order-sheet" data-order-id="${id}" data-takeaway="${Boolean(takeaway)}" data-payment-status="${esc(order.payment_status||'')}">
    <div class="order-identity"><span translate="no">#${esc(order.sales_id||order._id)}</span><span>${takeaway?'Take Away':`<span>Guests</span> · <span translate="no">${esc(order.person_count||'—')}</span>`}</span></div>
    <div class="order-items-heading"><h2>Order items</h2>${editable?`<button class="order-add" type="button" data-order-add="${id}"><i class="fas fa-plus" aria-hidden="true"></i> <span>Add items</span></button>`:''}</div>
    <div class="kot-items-list">${rounds}</div>
    ${editable&&order.preparation_notes?`<button class="order-note" type="button" data-floor-order-note="${id}"><span>Kitchen note</span>${order.preparation_note?`<span translate="no"> · ${esc(order.preparation_note)}</span>`:''}</button>`:order.preparation_note?`<p translate="no">${esc(order.preparation_note)}</p>`:''}
    <div class="order-more"><button type="button" class="order-more-trigger" data-order-more aria-haspopup="dialog"><span aria-hidden="true">•••</span><span>More options</span></button><div class="order-more-content" hidden>${root.OrderPhotos?.render(order)||''}</div></div>
    <div class="order-tax-summary" data-order-totals="${id}" data-bill-table="${takeaway?'':esc(order.table_number||'')}" aria-live="polite"><div class="order-summary"><span>Total:</span><strong>${root.CaptainMoney.html(Number(order.sales_total||0))}</strong></div><p class="order-tax-status">${esc(root.I18N?.t("Loading...")||"Loading...")}</p></div>
    ${editable?`<div class="order-secondary">${!takeaway?`<button type="button" data-floor-move-order="${id}"><i class="fas fa-exchange-alt" aria-hidden="true"></i> <span>Move table</span></button>`:''}<button class="order-cancel" type="button" data-order-cancel="${id}"><i class="far fa-trash-alt" aria-hidden="true"></i> <span>Cancel order</span></button></div>`:''}
   </article>`;
  }).join('')}</div><footer class="order-financial">${financialActions}</footer></div>`;
 }
 function actionSheet(sheet,photos=false){
  const t=value=>root.I18N?.t(value)||value;
  const dialog=document.createElement('dialog');dialog.className='order-action-sheet';
  const header=document.createElement('header');const title=document.createElement('h2');
  title.textContent=t(photos?'Order photos':'More options');title.id='order-action-title';dialog.setAttribute('aria-labelledby',title.id);
  const close=document.createElement('button');close.type='button';close.className='order-action-close';close.setAttribute('aria-label',t('Close'));close.textContent='×';header.append(title,close);dialog.append(header);
  const body=document.createElement('div');body.className='order-action-list';dialog.append(body);
  let marker,panel;
  const finish=()=>{if(marker)marker.replaceWith(panel);dialog.close();dialog.remove();root.removeEventListener('captain:back',back);sheet.querySelector('[data-order-more]')?.focus({preventScroll:true});};
  const back=event=>{event.preventDefault();event.stopImmediatePropagation();finish();};
  close.onclick=finish;dialog.addEventListener('cancel',back);root.addEventListener('captain:back',back);
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)finish();}});
  if(photos){
   panel=sheet.querySelector('.order-more-content .order-photos-panel');
   if(panel){marker=document.createComment('photos home');panel.before(marker);body.append(panel);if(!panel.querySelector('[data-order-photo]')){const empty=document.createElement('p');empty.className='order-photo-empty';empty.textContent=t('No photos yet.');body.append(empty);}}
  }else{
   const entries=[['[data-split-table]','Split bill','columns'],['.order-photos-panel','Order photos','camera'],['[data-transfer-order]','Transfer items','exchange-alt'],['[data-delivery-sale]','Kitchen delivery','utensils'],['[data-handover-sale]','Assign staff','user'],['[data-order-cancel]','Cancel order','trash-alt']];
   for(const [selector,label,icon] of entries){
    const source=sheet.querySelector('.order-more-content '+selector);if(!source)continue;
    const button=document.createElement('button');button.type='button';button.className='order-action-row';
    if(selector==='[data-order-cancel]')button.classList.add('is-danger');
    const symbol=document.createElement('span');symbol.className='order-action-symbol';symbol.setAttribute('aria-hidden','true');symbol.innerHTML=`<i class="fas fa-${icon}"></i>`;
    const name=document.createElement('span');name.textContent=t(label);const arrow=document.createElement('span');arrow.className='order-action-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');button.append(symbol,name,arrow);
    button.onclick=()=>{finish();if(selector==='.order-photos-panel')actionSheet(sheet,true);else source.click();};body.append(button);
   }
  }
  sheet.append(dialog);dialog.showModal();close.focus();
 }
 document.addEventListener('click',event=>{
  const more=event.target.closest('[data-order-more]');
  if(more)actionSheet(more.closest('.order-sheet'));
  const add=event.target.closest('[data-order-add]');
  if(add&&!add.disabled)root.addItemsToOrder(add.dataset.orderAdd);
  const cancel=event.target.closest('[data-order-cancel]');
  if(cancel&&!cancel.disabled)root.cancelKot(cancel.dataset.orderCancel);
 });
 async function loadTotals(node) {
  const owner=root.POSNIC.session.shopKey, user=root.POSNIC.session.user?.id, branch=localStorage.getItem('branch_id');
  const current=()=>node.isConnected&&root.POSNIC.session.active&&!root.CaptainAccess?.locked&&owner===root.POSNIC.session.shopKey&&user===root.POSNIC.session.user?.id&&branch===localStorage.getItem('branch_id');
  const t=value=>root.I18N?.t(value)||value;
  try {
   const table=node.dataset.billTable;
   let bill=await root.CaptainBill.read('/captain/v1/bill?'+(table?'table='+encodeURIComponent(table):'saleId='+encodeURIComponent(node.dataset.orderTotals)));
   if(table && !(bill.orderIds?.length===1 && String(bill.orderIds[0])===node.dataset.orderTotals)){
    const lines=(bill.lines||[]).filter(line=>String(line.id||'').startsWith(node.dataset.orderTotals+':'));
    if(!lines.length||lines.some(line=>!Number.isSafeInteger(line.amountMinor)))throw new Error('Order bill unavailable');
    bill={...bill,lines,totalMinor:lines.reduce((total,line)=>total+line.amountMinor,0)};
   }
   if(!current())return;
   if(!Array.isArray(bill.lines)||!Number.isSafeInteger(bill.totalMinor))throw new Error('Invalid bill');
   const parts=new Map();
   for(const line of bill.lines){
    if(!Array.isArray(line.components))throw new Error('Missing bill components');
    for(const part of line.components){
    if(!Number.isSafeInteger(part.minor))throw new Error('Invalid component');
    parts.set(part.key,(parts.get(part.key)||0)+part.minor);
   }}
   const sum=[...parts.values()].reduce((total,value)=>total+value,0);
   if(!Number.isSafeInteger(sum)||sum!==bill.totalMinor)throw new Error('Inconsistent bill components');
   const policy=root.CaptainMoney.snapshot(bill);
   const money=value=>esc(root.CaptainMoney.format(root.CaptainMoney.fromMinor(value,policy),policy));
   if(![...parts.keys()].some(key=>key.startsWith('tax:')))parts.set('tax:Tax',0);
   node.innerHTML='<dl class="order-tax-breakdown">'+[...parts].filter(([key,value])=>value!==0||key==='base'||key.startsWith('tax:')).map(([key,value])=>'<div><dt>'+esc(t(bill.labels?.[key]|| (key==='tax:Tax'?'Tax':key)))+'</dt><dd translate="no">'+money(value)+'</dd></div>').join('')+'<div class="order-tax-total"><dt>'+esc(t('Total'))+'</dt><dd translate="no">'+money(bill.totalMinor)+'</dd></div></dl>';
  }catch(error){
   if(!current())return;
   const status=node.querySelector('.order-tax-status');
   if(status){status.textContent=t('Could not load the bill.')+(error.status && error.message ? ' '+t(error.message) : '');const retry=document.createElement('button');retry.type='button';retry.textContent=t('Retry');retry.onclick=()=>{retry.disabled=true;void loadTotals(node);};status.append(' ',retry);}
  }
 }
 function arrange(container){
  const workspace=container.matches?.('.order-workspace')?container:container.querySelector('.order-workspace');
  if(!workspace)return;
  for(const sheet of workspace.querySelectorAll('.order-sheet')){
   const more=sheet.querySelector('.order-more-content');
   const toolbar=sheet.querySelector('.service-toolbar');
   if(toolbar){
    sheet.querySelector('.order-items-heading [data-serve-all]')?.parentElement.remove();
    const all=toolbar.querySelector('.service-action');
    if(all)sheet.querySelector('.order-items-heading').append(all);
    more.querySelectorAll('.service-order-options,.service-order-action:not(.service-action)').forEach(node=>node.remove());
    for(const node of [...toolbar.children])more.append(node);
   }
   const cancel=sheet.querySelector('.order-secondary .order-cancel');if(cancel)more.append(cancel);
   const move=sheet.querySelector('.order-secondary [data-floor-move-order]');
   if(move){move.classList.add('floor-bill-btn','order-move-direct');workspace.querySelector('.floor-bill-actions')?.append(move);}
   const secondary=sheet.querySelector('.order-secondary');if(secondary&&!secondary.children.length)secondary.remove();
  }
  const split=workspace.querySelector('.order-financial [data-split-table]');
  if(split)workspace.querySelector('.order-more-content')?.prepend(split);
 }
 function mount(container){arrange(container);container.querySelectorAll('[data-order-totals]').forEach(node=>void loadTotals(node));}
 root.CaptainOrderView={render,mount,arrange};
})(window);
