import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
async function open(page){
 await onTheMenu(page,'nothing');let data={id:'branch',name:'Garden',revision:'first',branch_upi_id:'garden@bank',branch_upi_name:'Garden Restaurant'};const posts=[];let conflict=false;
 await page.route('**/captain/v1/branch-details',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:data});
  const body=route.request().postDataJSON();posts.push(body);
  if(conflict)return route.fulfill({status:409,json:{error:{message:'Settings changed'}}});
  data={...data,...body,revision:'next'};return route.fulfill({json:data});
 });await page.goto('/branch-details.html');await expect(page.locator('#branch-upi-id')).toHaveValue('garden@bank');
 return {posts,conflict(){conflict=true;data={...data,revision:'newer',branch_upi_id:'cashier@bank'};}};
}
test('branch UPI validates receiving details, saves to the server and supports Back',async({page})=>{
 const {posts}=await open(page);await page.locator('#branch-upi-id').fill('not a upi id');await page.locator('button[type=submit]').click();
 await expect(page.locator('#branch-message')).toContainText('valid UPI');expect(posts).toHaveLength(0);
 await page.locator('#branch-upi-id').fill('new@bank');await page.locator('button[type=submit]').click();await expect(page.locator('#branch-message')).toHaveText('Saved');
 expect(posts[0]).toMatchObject({branch_upi_id:'new@bank',branch_upi_name:'Garden Restaurant',revision:'first'});
 await page.locator('#branch-back').click();await expect(page).toHaveURL(/me.html/);
});
test('a changed payee keeps the draft until staff choose to refresh',async({page})=>{
 const server=await open(page);await page.locator('#branch-upi-id').fill('draft@bank');server.conflict();await page.locator('button[type=submit]').click();
 await expect(page.locator('#branch-message')).toContainText('Settings changed');await expect(page.locator('#branch-upi-id')).toHaveValue('draft@bank');
 page.once('dialog',dialog=>dialog.accept());await page.locator('#branch-retry').click();await expect(page.locator('#branch-upi-id')).toHaveValue('cashier@bank');
});
