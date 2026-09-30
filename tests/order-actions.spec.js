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
