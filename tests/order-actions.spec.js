import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
test('restricted edits collect a reason and order-bound approval before saving',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{window.approvalCalls=[];POSNIC.api.post=async(path,body)=>{approvalCalls.push({path,body:JSON.parse(JSON.stringify(body))});if(path.includes('verify-pin'))return {data:{approval_token:'scoped-token'}};if(!body.change_reason)throw new Error('Enter a reason for this change.');if(!body.approval_tokens)throw new Error('Manager approval required: cancellation');return {type:'success'};};window.saved=CaptainOrderActions.save({order_id:'order-1',items:[]});});
 await page.getByLabel('Reason',{exact:true}).fill('Customer changed their mind');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByLabel('Manager PIN',{exact:true}).fill('1234');await page.getByRole('button',{name:'Continue',exact:true}).click();
 expect(await page.evaluate(()=>window.saved)).toMatchObject({type:'success'});
 const calls=await page.evaluate(()=>approvalCalls);expect(calls[2].body).toMatchObject({sale_id:'order-1',action:'void_sale'});expect(calls[3].body.approval_tokens.void_sale).toBe('scoped-token');
 await expect(page.locator('dialog')).toHaveCount(0);
});


test('common reasons are editable and native Back cancels without retrying the change',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{
  window.reasonCalls=[];
  POSNIC.api.post=async(path,body)=>{reasonCalls.push({...body});if(!body.change_reason)throw new Error('Enter a reason for this change.');return {type:'success'};};
  window.reasonResult=CaptainOrderActions.save({order_id:'order-1',status:'cancelled'}).catch(error=>({error:error.message}));
 });
 await page.getByRole('button',{name:'Entered by mistake',exact:true}).click();
 await expect(page.getByLabel('Reason',{exact:true})).toHaveValue('Entered by mistake');
 await expect(page.getByRole('button',{name:'Entered by mistake',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByLabel('Reason',{exact:true}).fill('Entered by mistake — wrong table');
 await expect(page.getByRole('button',{name:'Entered by mistake',exact:true})).toHaveAttribute('aria-pressed','false');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 expect(await page.evaluate(()=>reasonResult)).toEqual({type:'success'});
 expect(await page.evaluate(()=>reasonCalls[1].change_reason)).toBe('Entered by mistake — wrong table');
 await page.evaluate(()=>{window.reasonCalls=[];window.reasonResult=CaptainOrderActions.save({order_id:'order-2',status:'cancelled'}).catch(error=>({error:error.message}));});
 await expect(page.locator('.change-reason-choices button')).toHaveCount(5);
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(page.locator('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>reasonCalls.length)).toBe(1);
 expect(await page.evaluate(()=>reasonResult)).toEqual({error:'Changes were not saved.'});
});

for(const language of ['ta','ar']) test(`common reasons are translated and fit a narrow phone in ${language}`,async({page})=>{
 await onTheMenu(page,'nothing');await page.setViewportSize({width:320,height:844});
 await page.evaluate(language=>{I18N.use(language);POSNIC.api.post=async()=>{throw new Error('Enter a reason for this change.');};window.reasonResult=CaptainOrderActions.save({order_id:'order-1'}).catch(()=>{});},language);
 const dialog=page.locator('.captain-action-dialog');await expect(dialog).toBeVisible();
 await expect(dialog.locator('.change-reason-choices button')).toHaveCount(5);
 expect(await dialog.locator('.change-reason-choices button').first().textContent()).not.toBe('Customer requested');
 await dialog.locator('.change-reason-choices button').first().click();
 expect(await dialog.locator('input').inputValue()).toBe(await dialog.locator('.change-reason-choices button').first().textContent());
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:`test-artifacts/reasons-${language}.png`,fullPage:true});
});


test('handover requires selection, retries the same request and cannot close during save',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{
  document.body.insertAdjacentHTML('beforeend','<div class="service-order-options"><button data-handover-sale="order-1" data-handover-branch="branch-1">Transfer test</button><p class="service-assignee">Original captain</p></div>');
  window.handoverCalls=[];window.staffLoads=0;
  POSNIC.api.get=async()=>{if(++staffLoads===1)throw new Error('Could not load staff.');return {type:'success',data:[{id:'staff-2',name:'Next captain'}]};};
  POSNIC.api.post=async(path,body)=>{handoverCalls.push(JSON.parse(JSON.stringify(body)));if(handoverCalls.length===1)return new Promise((resolve,reject)=>{window.rejectHandover=()=>reject(new Error('Could not save. Please try again.'));});return {type:'success',data:{staff:{id:'staff-2',name:'Next captain'}}};};
 });
 await page.locator('[data-handover-sale]').click();
 const dialog=page.locator('[data-handover-dialog]');
 await expect(dialog.locator('[role=status]')).toHaveText('Could not load staff.');
 await dialog.locator('[data-retry]').click();
 await expect(dialog.locator('select')).toBeEnabled();
 await expect(dialog.locator('[type=submit]')).toBeDisabled();
 await dialog.locator('select').selectOption('staff-2');
 await dialog.locator('[type=submit]').click();
 await expect(dialog).toHaveAttribute('aria-busy','true');
 await expect(dialog.locator('select')).toBeDisabled();
 await page.keyboard.press('Escape');
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(dialog).toBeVisible();
 await page.evaluate(()=>window.rejectHandover());
 await expect(dialog.locator('[type=submit]')).toBeEnabled();
 await expect(page.locator('.service-assignee')).toHaveText('Original captain');
 await dialog.locator('[type=submit]').click();
 await expect(dialog).toHaveCount(0);
 await expect(page.locator('.service-assignee')).toHaveText('Next captain');
 const calls=await page.evaluate(()=>handoverCalls);
 expect(calls).toHaveLength(2);expect(calls[0]).toEqual(calls[1]);
 expect(calls[0]).toMatchObject({saleId:'order-1',branchId:'branch-1',staffId:'staff-2'});
});

test('Back closes a loading handover and a late staff response cannot reopen it',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{
  document.body.insertAdjacentHTML('beforeend','<button data-handover-sale="order-1" data-handover-branch="branch-1">Transfer test</button>');
  POSNIC.api.get=()=>new Promise(resolve=>{window.finishStaff=()=>resolve({type:'success',data:[]});});
 });
 await page.locator('[data-handover-sale]').click();
 await expect(page.locator('[data-handover-dialog]')).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(page.locator('[data-handover-dialog]')).toHaveCount(0);
 await page.evaluate(()=>window.finishStaff());
 await expect(page.locator('[data-handover-sale]')).toBeFocused();
 await expect(page.locator('[data-handover-dialog]')).toHaveCount(0);
});


test('delivery status lists every printer and preserves reports when refresh fails',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{
  document.body.insertAdjacentHTML('beforeend','<button data-delivery-sale="order-1">Delivery test</button>');
  window.deliveryLoads=0;
  POSNIC.api.get=async()=>{
   if(++deliveryLoads===2)throw new Error('Could not load delivery status.');
   return {type:'success',data:{displays:[{till:'Kitchen display',at:new Date().toISOString(),recent:true}],reports:[{at:new Date().toISOString(),printers:[{name:'Hot kitchen',state:'accepted'},{name:'Bar',state:'failed',reason:'Paper empty'},{name:'Cold kitchen',state:'pending'}]}]}};
  };
 });
 await page.locator('[data-delivery-sale]').click();
 const dialog=page.locator('[data-delivery-dialog]');
 await expect(dialog.locator('.delivery-body')).toContainText('Hot kitchen · Accepted by printer system');
 await expect(dialog.locator('.delivery-body')).toContainText('Bar · Printing failed');
 await expect(dialog.locator('.delivery-body')).toContainText('Paper empty');
 await expect(dialog.locator('.delivery-body')).toContainText('Cold kitchen · Printing pending');
 await dialog.locator('[data-refresh]').click();
 await expect(dialog.locator('[role=status]')).toHaveText('Could not load delivery status.');
 await expect(dialog.locator('.delivery-body')).toContainText('Hot kitchen');
 await dialog.locator('[data-refresh]').click();
 await expect(dialog.locator('[role=status]')).toBeEmpty();
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(dialog).toHaveCount(0);await expect(page.locator('[data-delivery-sale]')).toBeFocused();
});

test('delivery Back works during loading and late reports do not reopen the dialog',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{
  document.body.insertAdjacentHTML('beforeend','<button data-delivery-sale="order-1">Delivery test</button>');
  POSNIC.api.get=()=>new Promise(resolve=>{window.finishDelivery=()=>resolve({type:'success',data:{displays:[],reports:[]}});});
 });
 await page.locator('[data-delivery-sale]').click();
 await expect(page.locator('[data-delivery-dialog]')).toHaveAttribute('aria-busy','true');
 await expect(page.locator('[data-refresh]')).toBeDisabled();
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await page.evaluate(()=>window.finishDelivery());
 await expect(page.locator('[data-delivery-dialog]')).toHaveCount(0);
 await expect(page.locator('[data-delivery-sale]')).toBeFocused();
});

test('cancellation reasons are selectable, editable and never submit until confirmed',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{window.reasonCalls=[];POSNIC.api.post=async(path,body)=>{reasonCalls.push({...body});if(!body.change_reason)throw new Error('Enter a reason for this change.');return {type:'success'};};window.saved=CaptainOrderActions.save({order_id:'order-1',status:'cancelled'});});
 const dialog=page.locator('.captain-action-dialog');
 await expect(dialog.getByRole('button',{name:'Customer requested',exact:true})).toBeFocused();
 for(const reason of ['Customer requested','Customer left','Entered by mistake','Item unavailable','Duplicate order']){
  const choice=dialog.getByRole('button',{name:reason,exact:true});await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed','true');await expect(dialog.getByLabel('Reason',{exact:true})).toHaveValue(reason);
 }
 expect(await page.evaluate(()=>reasonCalls.length)).toBe(1);
 await dialog.getByLabel('Reason',{exact:true}).fill('Customer left before preparation');
 await expect(dialog.locator('[aria-pressed="true"]')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 expect(await page.evaluate(()=>window.saved)).toMatchObject({type:'success'});
 expect(await page.evaluate(()=>reasonCalls.at(-1).change_reason)).toBe('Customer left before preparation');
});

test('native Back dismisses cancellation reason without saving',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{window.reasonCalls=0;POSNIC.api.post=async()=>{reasonCalls++;throw new Error('Enter a reason for this change.');};window.saved=CaptainOrderActions.save({order_id:'order-1',status:'cancelled'}).catch(error=>error.message);});
 await expect(page.locator('.captain-action-dialog')).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(page.locator('.captain-action-dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>window.saved)).toBe('Changes were not saved.');
 expect(await page.evaluate(()=>reasonCalls)).toBe(1);
});
