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
