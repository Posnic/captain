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
 await expect(page.locator('.change-reason-choices button')).toHaveCount(4);
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(page.locator('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>reasonCalls.length)).toBe(1);
 expect(await page.evaluate(()=>reasonResult)).toEqual({error:'Changes were not saved.'});
});

for(const language of ['ta','ar']) test(`common reasons are translated and fit a narrow phone in ${language}`,async({page})=>{
 await onTheMenu(page,'nothing');await page.setViewportSize({width:320,height:844});
 await page.evaluate(language=>{I18N.use(language);POSNIC.api.post=async()=>{throw new Error('Enter a reason for this change.');};window.reasonResult=CaptainOrderActions.save({order_id:'order-1'}).catch(()=>{});},language);
 const dialog=page.locator('.captain-action-dialog');await expect(dialog).toBeVisible();
 await expect(dialog.locator('.change-reason-choices button')).toHaveCount(4);
 expect(await dialog.locator('.change-reason-choices button').first().textContent()).not.toBe('Customer requested');
 await dialog.locator('.change-reason-choices button').first().click();
 expect(await dialog.locator('input').inputValue()).toBe(await dialog.locator('.change-reason-choices button').first().textContent());
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:`test-artifacts/reasons-${language}.png`,fullPage:true});
});
