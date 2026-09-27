import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
import fs from 'node:fs';
const original = { _id:'order-1', status:'pending', dine_type:'Dine-in', table_number:'1', table_id:'table-1', person_count:2, total_amount:440, updated_date:'2026-09-27T10:00:00Z', items:[{_id:'line-1',product_id:'p-biryani',name:'Chicken Biryani',quantity:2,price:220}] };
async function editor(page, where='order-history.html', over={}) {
  await onTheMenu(page, 'nothing');
  const posts=[];
  await page.route('**/sales/getOrderHistory', route=>route.fulfill({json:{type:'success',data:{orders:[{...original,...over}]}}}));
  await page.route('**/sales/updateOrder', route=>{posts.push(route.request().postDataJSON());return route.fulfill({json:{type:'success'}});});
  await page.evaluate(()=>localStorage.setItem('kiosk_tableorders',JSON.stringify([{_id:'table-1',tableorder_value:'1'},{_id:'table-2',tableorder_value:'2'}])));
  await page.goto('/'+where);
  await page.waitForFunction(()=>typeof modifyKot==='function' && !!window.OrderEditor);
  await page.evaluate(()=>modifyKot('order-1'));
  await expect(page.locator('#editOrderModal')).toBeVisible();
  await expect(page.locator('#editOrderModal .modal-dialog').first()).toHaveCSS('transform','none');
  return posts;
}
async function setting(page, name) {
  await page.locator('#order-editor-details-open').click();
  await page.locator(`[data-editor-setting="${name}"]`).click();
}
async function apply(page) {
  await page.locator('#editor-setting-apply').click();
}
for (const where of ['order-history.html','kot-management.html']) {
 test(`items are primary and adding from the menu saves once on ${where}`,async({page})=>{
  const posts=await editor(page,where);
  await expect(page.locator('#save-order-changes')).toBeDisabled();
  await expect(page.locator('#edit-table-section')).toBeHidden();
  await expect(page.locator('#edit-pax-section')).toBeHidden();
  await expect(page.locator('#edit-type-section')).toBeHidden();
  await page.screenshot({path:`test-artifacts/editor-${where}.png`});
  await page.locator('#open-item-picker').click();
  await page.locator('#item-picker .btn-add[data-id="p-coffee"]').click();
  await expect(page.locator('#picker-item-count')).toHaveText('3 items');
  await page.screenshot({path:'test-artifacts/editor-menu.png'});
  await page.locator('#item-picker-done').click();
  await expect(page.locator('#current-order-items')).toContainText('Coffee');
  await expect(page.locator('.editor-added')).toHaveText('Added');
  expect(posts).toHaveLength(0);
  await page.locator('#save-order-changes').click();
  await expect(page.locator('#editOrderModal')).toBeHidden();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({table_number:'1',table_id:'table-1',person_count:2,dine_type:'Dine-in'});
  expect(posts[0].items.map(i=>[i.product_id,i.quantity])).toEqual([['p-biryani',2],['p-coffee',1]]);
 });
}
test('table changes are staged separately and preserve items and guests',async({page})=>{
 const posts=await editor(page);
 await setting(page,'table');
 await page.locator('label[for="edit_table_2"]').click();
 await page.locator('#editor-setting-back').click();
 await expect(page.locator('#editor-table-value')).toHaveText('1');
 await page.locator('[data-editor-setting="table"]').click();
 await page.locator('label[for="edit_table_2"]').click();
 await page.screenshot({path:'test-artifacts/editor-table.png'});
 await apply(page);
 await expect(page.locator('#order-editor-context')).toHaveText('Table 2');
 expect(posts).toHaveLength(0);
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts[0]).toMatchObject({table_number:'2',table_id:'table-2',person_count:2,dine_type:'Dine-in',seen_at:original.updated_date});
 expect(posts[0].items[0]).toMatchObject({product_id:'p-biryani',quantity:2});
});
test('takeaway clears the old table and guest count',async({page})=>{
 const posts=await editor(page);
 await setting(page,'type');
 await page.locator('label[for="edit-takeaway"]').click();
 await apply(page);
 await expect(page.locator('#order-editor-context')).toHaveText('Takeaway');
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts[0]).toMatchObject({table_number:'',table_id:'',person_count:'',dine_type:'Take away'});
});
test('guest edits can be applied and discarded without losing item edits',async({page})=>{
 await editor(page);
 await page.locator('.qty-btn[aria-label="Increase quantity"]').click();
 await setting(page,'guests');
 await page.locator('.edit-person-btn[data-person="4"]').click();
 await apply(page);
 await expect(page.locator('#order-editor-meta')).toContainText('4');
 page.once('dialog',dialog=>dialog.dismiss());
 await page.locator('#editOrderModal .modal-header .btn-close').click();
 await expect(page.locator('#editOrderModal')).toBeVisible();
 await expect(page.locator('.qty-display')).toHaveText('3');
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#editOrderModal .modal-header .btn-close').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 await page.evaluate(()=>editOrder('order-1'));
 await expect(page.locator('.qty-display')).toHaveText('2');
 await expect(page.locator('#order-editor-meta')).toContainText('2');
});
test('repeated taps cannot send twice and conflicts close safely',async({page})=>{
 const posts=await editor(page);
 let release;
 await page.route('**/sales/updateOrder',async route=>{posts.push(route.request().postDataJSON());await new Promise(resolve=>release=resolve);await route.fulfill({status:409,json:{message:'order_changed'}});});
 await page.locator('.qty-btn[aria-label="Increase quantity"]').click();
 await page.locator('#save-order-changes').click();
 await expect.poll(()=>posts.length).toBe(1);
 await page.evaluate(()=>saveOrderChanges());
 expect(posts).toHaveLength(1);
 release();
 await expect(page.locator('#editOrderModal')).toBeHidden();
});
test('Arabic and narrow screens keep actions in view and shop names unchanged',async({page})=>{
 await editor(page);
 await page.setViewportSize({width:320,height:700});
 await page.evaluate(()=>I18N.use('ar'));
 const words=JSON.parse(fs.readFileSync('assets/common/locales/ar.json','utf8'));
 await expect(page.locator('#open-item-picker')).toHaveText(words['Add items']);
 await expect(page.locator('#current-order-items')).toContainText('Chicken Biryani');
 expect(await page.locator('#editOrderModal').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
 const add=await page.locator('#open-item-picker').boundingBox();
 expect(add.x).toBeGreaterThanOrEqual(0);expect(add.x+add.width).toBeLessThanOrEqual(320);
 const save=await page.locator('#save-order-changes').boundingBox();
 expect(save.y+save.height).toBeLessThanOrEqual(700);
 await page.screenshot({path:'test-artifacts/editor-arabic.png'});
});
test('notes stay in the draft and a failed save retains them for retry',async({page})=>{
 const posts=await editor(page);
 await page.locator('.editor-note-link').click();
 await page.locator('#edit-item-notes-text').fill('Less spicy');
 await page.locator('#edit-item-notes-apply').click();
 await expect(page.locator('#editItemNotesModal')).toBeHidden();
 await expect(page.locator('#current-order-items .item-notes')).toHaveText('Less spicy');
 expect(posts).toHaveLength(0);
 await page.route('**/sales/updateOrder',route=>route.fulfill({json:{type:'error',message:'Unavailable'}}));
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#order-toast')).toContainText('Could not update');
 await expect(page.locator('#editOrderModal')).toBeVisible();
 await expect(page.locator('#save-order-changes')).toBeEnabled();
 await expect(page.locator('#current-order-items .item-notes')).toHaveText('Less spicy');
 await page.unroute('**/sales/updateOrder');
 await page.route('**/sales/updateOrder',route=>{posts.push(route.request().postDataJSON());return route.fulfill({json:{type:'success'}});});
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts[0].items[0].item_description).toBe('Less spicy');
});
test('adding a previously cancelled dish creates a new line',async({page})=>{
 await editor(page,'order-history.html',{items:[...original.items,{_id:'line-2',product_id:'p-coffee',name:'Coffee',quantity:0,cancelled:true,price:40}]});
 await page.locator('#open-item-picker').click();
 await page.locator('#item-picker .btn-add[data-id="p-coffee"]').click();
 await page.locator('#item-picker-done').click();
 await expect(page.locator('#current-order-items .order-item-card')).toHaveCount(3);
 await expect(page.locator('.item-cancelled-mark')).toHaveText('Cancelled');
 await expect(page.locator('.editor-added')).toHaveText('Added');
 expect(await page.evaluate(()=>linesForSave(orderBeingModified().items).map(i=>[i.product_id,i.quantity]))).toEqual([['p-biryani',2],['p-coffee',1]]);
});
