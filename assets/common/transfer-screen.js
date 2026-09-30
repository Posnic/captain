/* Item transfer: select preparations, choose seating, review, then confirm. */
(function(root){
 'use strict';
 const t=s=>root.I18N?.t(s)||s;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const registered=new Map();
 let dialog,order,stage,items,tables,preview,destination,busy=false,generation=0,identity;
 const owner=()=>JSON.stringify([root.POSNIC.session?.shopKey,root.POSNIC.session?.user?.id,localStorage.getItem('branch_id'),root.POSNIC.session?.base]);
 const money=n=>new Intl.NumberFormat(root.I18N?.language?.()||'en',{style:'currency',currency:preview.currencyCode,minimumFractionDigits:preview.currencyDigits,maximumFractionDigits:preview.currencyDigits}).format(n/10**preview.currencyDigits);
 function close(){generation++;dialog.close();}
 function render(error=''){
  const pending=root.CaptainItemTransfer.pending(order._id);
  let body='';
  if(stage==='items')body=(order.kitchen_rounds||[]).map(round=>`<section><time>${esc(round.ordered_at?new Date(round.ordered_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'')}</time>${round.items.map(line=>`<fieldset data-line="${esc(line.id)}"><legend translate="no">${esc(line.name)}</legend>${line.note?`<p translate="no">${esc(line.note)}</p>`:''}<label>${t('Items')} <input type="number" min="0" max="${line.quantity}" step="0.001" value="${items?.find(i=>i.id===line.id)?.quantity||0}" data-quantity aria-label="${t('Items')}"></label><small translate="no"> / ${line.quantity}</small><label>${t('Served')} <input type="number" min="0" max="${line.served||0}" step="0.001" value="${items?.find(i=>i.id===line.id)?.servedQuantity||0}" data-served aria-label="${t('Served')}"></label></fieldset>`).join('')}</section>`).join('');
  if(stage==='tables')body=`<label>${t('Guests')} <input id="transfer-guests" type="number" min="1" max="1000" value="${destination?.guests||1}"></label><div class="transfer-tables">${tables.filter(row=>row.status==='available'&&!row.closing).map(row=>`<label><input type="checkbox" value="${esc(row.id)}" ${destination?.tableIds.includes(row.id)?'checked':''}> <span>${t('Table')} <b translate="no">${esc(row.tableorder_value)}</b><small>${t('Guests')}: ${row.max||row.capacity||'—'}</small></span></label>`).join('')}</div>`;
  if(stage==='review')body=`<section><h3>${t('Items')}</h3>${preview.destination.rounds.map(line=>`<p translate="no">${esc(line.name)} × ${line.quantity}</p>`).join('')}<p>${t('Table')} <b translate="no">${destination.tableIds.map(id=>esc(tables.find(row=>row.id===id)?.tableorder_value||id)).join(', ')}</b></p><p>${t('Guests')}: ${destination.guests}</p><p>${t('Total')}: <strong translate="no">${esc(money(preview.destination.totalMinor))}</strong></p></section>`;
  if(stage==='recovery')body=`<p>${t('Reconnect to the server that authorized this phone. Orders are retained.')}</p>`;
  dialog.innerHTML=`<header><button type="button" data-back>${t('Back')}</button><h2>${t('Transfer items')}</h2></header><form><main>${body}<p role="alert">${esc(error)}</p></main><footer><button type="submit" ${busy?'disabled':''}>${t(busy?'Loading':pending?'Retry':stage==='review'?'Save':'Continue')}</button></footer></form>`;
  dialog.querySelector('[data-back]').onclick=()=>{if(busy||stage==='items'||stage==='recovery'){close();return;}stage=stage==='review'?'tables':'items';render();};
  dialog.querySelector('form').onsubmit=event=>{event.preventDefault();void next();};
 }
 async function next(){
  if(busy)return;
  const current=++generation;
  const valid=()=>current===generation&&dialog.open&&identity===owner();
  try{
   if(identity!==owner())throw new Error(t('Sign in with your account'));
   if(stage==='items'){
    const choices=[...dialog.querySelectorAll('[data-line]')].map(row=>({id:row.dataset.line,quantity:Number(row.querySelector('[data-quantity]').value),servedQuantity:Number(row.querySelector('[data-served]').value)})).filter(row=>row.quantity!==0);
    items=choices;items=root.CaptainItemTransfer.selection(order.kitchen_rounds,choices);
    busy=true;render();const result=await root.POSNIC.api.get('/captain/v1/tables');
    if(!valid())return;tables=result.tables;stage='tables';
   }else if(stage==='tables'){
    const ids=[...dialog.querySelectorAll('input[type=checkbox]:checked')].map(input=>input.value);
    const guests=Number(dialog.querySelector('#transfer-guests').value);
    destination=root.CaptainGroupMove.selection(tables,ids,ids[0],guests);
    if(!destination.valid||!Number.isInteger(guests)||guests<1||guests>1000)throw new Error(t('Choose a table with enough seats.'));
    busy=true;render();const result=await root.POSNIC.api.post('/captain/v1/tables/transfer/preview',{orderId:order._id,items});
    if(!valid())return;preview=result;stage='review';
   }else{
    busy=true;render();
    const result=root.CaptainItemTransfer.pending(order._id)?await root.CaptainItemTransfer.resume(order._id):await root.CaptainItemTransfer.complete(order._id,{revision:preview.revision,items,destination});
    if(!valid())return;
    if(result.state==='completed'){close();window.showToast?.(t('Order updated'),'success');await window.loadOrderHistory?.();await window.loadTables?.();return;}
   }
   if(valid()){busy=false;render();}
  }catch(error){if(valid()){busy=false;if(root.CaptainItemTransfer.pending(order._id))stage='recovery';render(error.message||t('Connection failed'));}}
  finally{if(current===generation)busy=false;}
 }
 root.CaptainTransferScreen={register(value){registered.set(owner()+':'+value._id,value);},open(value){
  generation++;busy=false;order=value;identity=owner();items=null;destination=null;preview=null;tables=[];
  if(!dialog){dialog=document.createElement('dialog');dialog.className='transfer-screen';document.body.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});}
  stage=root.CaptainItemTransfer.pending(order._id)?'recovery':'items';render();dialog.showModal();
 }};
 document.addEventListener('click',event=>{const button=event.target.closest('[data-transfer-order]');if(!button)return;const current=registered.get(owner()+':'+button.dataset.transferOrder)||(typeof allOrders!=='undefined'?allOrders.find(row=>row._id===button.dataset.transferOrder):null);if(current)root.CaptainTransferScreen.open(current);});
})(globalThis);
