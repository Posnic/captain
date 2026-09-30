(function(){
 "use strict";
 const at=id=>document.getElementById(id),t=value=>window.I18N?.t(value)||value;
 let details,busy=false,dirty=false,generation=0;
 const message=value=>at('branch-message').textContent=t(value);
 function back(){if(busy)return;if(dirty&&!confirm(t('Discard changes?')))return;generation++;location.href=new URLSearchParams(location.search).get('source')==='payments'?'payment-settings.html':'me.html#preferences';}
 async function load(){
  if(busy)return;if(dirty&&!confirm(t('Discard changes?')))return;
  const ticket=++generation;at('branch-details-form').hidden=true;message('Loading...');at('branch-retry').hidden=true;
  try{
   const result=await POSNIC.api.get('/captain/v1/branch-details');if(ticket!==generation)return;
   if(!result.id||!result.revision)throw new Error('invalid_branch_response');
   details=result;dirty=false;at('branch-name').textContent=result.name;
   at('branch-upi-id').value=result.branch_upi_id;at('branch-upi-name').value=result.branch_upi_name;
   at('branch-details-form').hidden=false;message('');
  }catch(error){if(ticket!==generation)return;message(error.status===403?'Permission is required.':'Connection failed');at('branch-retry').hidden=error.status===403;}
 }
 document.addEventListener('DOMContentLoaded',()=>{
  const form=at('branch-details-form');at('branch-back').onclick=back;at('branch-cancel').onclick=back;at('branch-retry').onclick=load;
  form.addEventListener('input',()=>{dirty=true;at('branch-upi-id').setCustomValidity('');at('branch-upi-name').required=!!at('branch-upi-id').value.trim();});
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy||!details)return;
   const value=Object.fromEntries(new FormData(form));value.branch_upi_id=value.branch_upi_id.trim();value.branch_upi_name=value.branch_upi_name.trim();
   if(value.branch_upi_id&&(!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}@[A-Za-z][A-Za-z0-9.-]{1,31}$/.test(value.branch_upi_id)||!value.branch_upi_name||/[<>\x00-\x1f\x7f]/.test(value.branch_upi_name))){message('Enter a valid UPI ID and receiving name.');return;}
   busy=true;form.querySelectorAll('input,button').forEach(el=>el.disabled=true);message('Loading...');
   try{details=await POSNIC.api.post('/captain/v1/branch-details',{...value,revision:details.revision});dirty=false;at('branch-upi-id').value=details.branch_upi_id;at('branch-upi-name').value=details.branch_upi_name;message('Saved');}
   catch(error){message(error.status===409?'Settings changed. Refresh and try again.':error.status===403?'Permission is required.':'Could not save. Please try again.');at('branch-retry').hidden=error.status!==409;}
   finally{busy=false;form.querySelectorAll('input,button').forEach(el=>el.disabled=false);}
  });void load();
 });
 window.addEventListener('captain:back',event=>{if(event.defaultPrevented || document.querySelector('dialog[open], #posnic-lock.is-open'))return;event.preventDefault();back();});
})();
