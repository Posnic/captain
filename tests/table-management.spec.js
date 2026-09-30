import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
const initial = {id:'table-1',tableorder_value:'T1',capacity:4,max_capacity:6,area:'Garden',shape:'round',version:0,status:'available',orders:[]};
async function open(page,canManage=true,overrides={}) {
 await onTheMenu(page,'nothing');
 let row={...initial,...overrides},conflict=false;const posts=[];
 await page.route('**/captain/v1/tables**',async route=>{
  const request=route.request();
  if(request.method()==='GET')return route.fulfill({json:{canManage,tables:[row]}});
  const body=request.postDataJSON();posts.push(body);
  if(conflict)return route.fulfill({status:409,json:{message:'Table changed. Refresh and try again.'}});
  row={...row,...body,version:row.version+1};if(request.url().endsWith('/close'))row={...row,status:'cleaning',orders:[],closing:null};return route.fulfill({json:row});
 });
 await page.goto('/tables.html');await expect(page.locator('[data-table]')).toBeVisible();
 return {posts,conflict(){conflict=true;row={...row,version:2,capacity:5};}};
}
test('manager saves table details, cancels edits, and returns to account',async({page})=>{
 const {posts}=await open(page);
 await page.locator('[data-table]').click();await page.locator('[data-action=edit-table]').click();await page.locator('#capacity').fill('5');
 await page.locator('button[type=submit]').click();await expect(page.locator('[data-table]')).toContainText('Seat capacity: 5');
 expect(posts[0]).toMatchObject({capacity:'5',version:0,id:'table-1'});
 await page.locator('[data-table]').click();await page.locator('#tables-back').click();
 await expect(page.locator('[data-table]')).toBeVisible();await page.locator('#tables-back').click();await expect(page).toHaveURL(/me.html/);
});
test('staff can mark cleaning without gaining table settings access',async({page})=>{
 const {posts}=await open(page,false);await expect(page.locator('[data-action=add]')).toHaveCount(0);
 await page.locator('[data-table]').click();await expect(page.locator('#table-edit-form')).toHaveCount(0);
 await page.locator('[data-status=cleaning]').click();await expect(page.locator('[data-table]')).toContainText('Cleaning');
 expect(posts[0]).toEqual({id:'table-1',version:0,status:'cleaning'});
});
test('conflict preserves the draft until staff explicitly refresh',async({page})=>{
 const server=await open(page);await page.locator('[data-table]').click();await page.locator('[data-action=edit-table]').click();await page.locator('#capacity').fill('6');server.conflict();
 await page.locator('button[type=submit]').click();await expect(page.locator('#table-management-message')).toContainText('Table changed');
 await expect(page.locator('#capacity')).toHaveValue('6');
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('#tables-refresh').click();await expect(page.locator('#capacity')).toHaveValue('6');
 page.once('dialog',dialog=>dialog.accept());await page.locator('#tables-refresh').click();await expect(page.locator('[data-table]')).toContainText('Seat capacity: 5');
});

test('table management fits a narrow phone and a portrait tablet',async({page})=>{
 await open(page);
 for(const width of [320,768]){
  await page.setViewportSize({width,height:1024});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-artifacts/table-management-${width}.png`,fullPage:true});
 }
});

test('staff review closure separately and make the table available only after cleaning',async({page})=>{
 const {posts}=await open(page,false,{status:'occupied',orders:[{id:'paid-order',paid:true,guests:2}]});
 await page.locator('[data-table]').click();await page.locator('[data-action=close-review]').click();
 await expect(page.locator('#table-management-content')).toContainText('mark this table for cleaning');expect(posts).toHaveLength(0);
 await page.locator('[data-action=back]').click();await expect(page.locator('[data-action=close-review]')).toBeVisible();
 await page.locator('[data-action=close-review]').click();await page.locator('[data-action=close-confirm]').click();
 await expect(page.locator('[data-table]')).toContainText('Cleaning');expect(posts[0].orderIds).toEqual(['paid-order']);expect(posts[0].request_id).toBeTruthy();
 await page.locator('[data-table]').click();await page.locator('[data-status=available]').click();await expect(page.locator('[data-table]')).toContainText('Available');
});
test('unpaid orders cannot be closed from table controls',async({page})=>{
 const {posts}=await open(page,false,{status:'occupied',orders:[{id:'unpaid-order',paid:false}]});await page.locator('[data-table]').click();
 await expect(page.locator('[data-action=close-review]')).toHaveCount(0);await expect(page.locator('#table-management-content')).toContainText('Record the remaining payment first.');expect(posts).toHaveLength(0);
});
