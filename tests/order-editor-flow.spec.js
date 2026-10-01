import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
import fs from 'node:fs';
const original = { _id:'order-1', status:'pending', dine_type:'Dine-in', table_number:'1', table_id:'table-1', person_count:2, total_amount:440, updated_date:'2026-09-27T10:00:00Z', items:[{_id:'line-1',product_id:'p-biryani',name:'Chicken Biryani',quantity:2,price:220}] };
async function editor(page, where='order-history.html', over={}, setup) {
  await onTheMenu(page, 'nothing');
  if (setup) await setup();
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
test('Back during guest capability discovery ignores the late response',async({page})=>{
 await editor(page);
 let answer;
 const waiting = new Promise(resolve=>{answer=resolve;});
 let requested;
 const started = new Promise(resolve=>{requested=resolve;});
 await page.route('**/captain/v1/tables',async route=>{requested();await waiting;await route.fulfill({json:{tables:[],capabilities:{legacyGuestUpdate:true}}});});
 await setting(page,'guests');await started;
 await expect(page.locator('[data-editor-setting="guests"]')).toBeDisabled();
 await page.locator('[data-editor-view="items"]').click();
 answer();
 await expect(page.locator('[data-editor-setting="guests"]')).toBeEnabled();
 await expect(page.locator('#order-editor-items')).toBeVisible();
 await expect(page.locator('#order-editor-settings')).toBeHidden();
});

test('failed guest capability discovery keeps Back available and creates no pending update',async({page})=>{
 await editor(page);
 await page.route('**/captain/v1/tables',route=>route.fulfill({status:503,json:{message:'Connection failed'}}));
 await setting(page,'guests');
 await expect(page.locator('[data-editor-setting="guests"]')).toBeEnabled();
 await expect(page.locator('#order-editor-details')).toBeVisible();
 expect(await page.evaluate(()=>CaptainGuestUpdate.pending('order-1'))).toBeNull();
 await page.locator('[data-editor-view="items"]').click();
 await expect(page.locator('#order-editor-items')).toBeVisible();
});
for (const where of ['order-history.html','kot-management.html']) {
 test(`older guest changes save separately on capable servers on ${where}`,async({page})=>{
  const posts=await editor(page,where), requests=[];
  await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[],capabilities:{legacyGuestUpdate:true}}}));
  await page.route('**/captain/v1/tables/guests',route=>{
   const body=route.request().postDataJSON();requests.push(body);return route.fulfill({json:{...body,state:'completed'}});
  });
  await setting(page,'guests');
  await expect(page.locator('#editor-setting-apply')).toHaveText('Save');
  await page.locator('.edit-person-btn[data-person="3"]').click();await apply(page);
  await expect(page.locator('#editOrderModal')).toBeHidden();
  expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({orderId:'order-1',guests:3});
  expect(requests[0].items).toBeUndefined();expect(posts).toHaveLength(0);
 });
 test(`claimed guest changes save separately without resending dishes on ${where}`,async({page})=>{
  const posts=await editor(page,where,{seating_request_id:'initial-seating'}), requests=[];
  await page.route('**/captain/v1/tables/guests',route=>{
    const body=route.request().postDataJSON();requests.push(body);
    return route.fulfill({json:{...body,state:'completed'}});
  });
  await setting(page,'guests');
  await expect(page.locator('#editor-setting-apply')).toHaveText('Save');
  await page.locator('.edit-person-btn[data-person="3"]').click();
  await apply(page);
  await expect(page.locator('#editOrderModal')).toBeHidden();
  expect(requests).toHaveLength(1);expect(requests[0]).toMatchObject({orderId:'order-1',guests:3});
  expect(requests[0].items).toBeUndefined();expect(posts).toHaveLength(0);
 });
}
for (const claimed of [true,false])test(`a failed guest save keeps the original count and request through Back and Retry (claimed=${claimed})`,async({page})=>{
 const posts=await editor(page,'order-history.html',claimed?{seating_request_id:'initial-seating'}:{}), requests=[];
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[],capabilities:{legacyGuestUpdate:true}}}));
 await page.route('**/captain/v1/tables/guests',route=>{
  const body=route.request().postDataJSON();requests.push(body);
  return requests.length===1?route.fulfill({status:503,json:{error:{message:'Please retry.'}}}):route.fulfill({json:{...body,state:'completed'}});
 });
 await setting(page,'guests');await page.locator('.edit-person-btn[data-person="3"]').click();await apply(page);
 await expect(page.locator('#editor-setting-apply')).toHaveText('Retry');
 await expect(page.locator('.edit-person-btn[data-person="4"]')).toBeDisabled();
 await page.locator('#editor-setting-back').click();
 await page.locator('[data-editor-setting="guests"]').click();
 await expect(page.locator('.edit-person-btn[data-person="3"]')).toHaveClass(/active/);
 await apply(page);await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(posts).toHaveLength(0);
});
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
test('older-server table changes use the shared selector and preserve items and guests',async({page})=>{
 const posts=await editor(page);
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[{id:'table-2',tableorder_value:'2',capacity:4,max_capacity:4,orders:[]}]}}));
 await setting(page,'table');
 await expect(page.locator('#editOrderModal')).toBeHidden();
 await expect(page.locator('#moveTableModal')).toBeVisible();
 await page.locator('#move-table-list [data-id="table-2"]').click();
 await page.screenshot({path:'test-artifacts/editor-table.png'});
 expect(posts).toHaveLength(0);
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
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
 await page.locator('#editOrderModal .modal-header .btn-close').click();
 await page.locator('#captain-discard [data-confirm-action=keep]').click();
 await expect(page.locator('#editOrderModal')).toBeVisible();
 await expect(page.locator('.qty-display')).toHaveText('3');
 await page.locator('#editOrderModal .modal-header .btn-close').click();
 await page.locator('#captain-discard [data-confirm-action=discard]').click();
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

for (const where of ['order-history.html', 'kot-management.html']) {
 test(`unchanged Modify can be cancelled and reopened on ${where}`, async ({page}) => {
  const posts=await editor(page,where);
  await expect(page.locator('#save-order-changes')).toBeDisabled();
  await page.locator('#cancel-order-changes').click();
  await expect(page.locator('#editOrderModal')).toBeHidden();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  expect(posts).toHaveLength(0);
  await page.evaluate(()=>modifyKot('order-1'));
  await expect(page.locator('#editOrderModal')).toBeVisible();
  await expect(page.locator('#editOrderModal .modal-dialog').first()).toHaveCSS('transform','none');
  await page.goBack();
  await expect(page.locator('#editOrderModal')).toBeHidden();
  await expect(page).toHaveURL(new RegExp(where.replace('.', '\\.')));
  expect(posts).toHaveLength(0);
 });
}

test('Android Back exits an unchanged editor without a save request',async({page})=>{
 const posts=await editor(page,'kot-management.html');
 const consumed=await page.evaluate(()=>!window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 expect(consumed).toBe(true);
 await expect(page.locator('#editOrderModal')).toBeHidden();
 await expect(page.locator('.modal-backdrop')).toHaveCount(0);
 expect(posts).toHaveLength(0);
});

test('claimed orders change to takeaway through a durable seating transition without resending their items',async({page})=>{
 const posts=await editor(page,'order-history.html',{seating_request_id:'initial-seating',seating_table_ids:['table-1'],seating_primary_id:'table-1'});
 const moves=[];
 await page.route('**/captain/v1/tables/move/**',route=>{
   const body=route.request().postDataJSON();moves.push({url:route.request().url(),body});
   return route.fulfill({json:{request_id:body.request_id,orderId:'order-1',state:route.request().url().endsWith('complete')?'submitting':'reserved',dineType:'Take away',tableIds:[]}});
 });
 await setting(page,'type');
 await page.locator('label[for="edit-takeaway"]').click();
 await apply(page);
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(0);
 expect(moves).toHaveLength(2);
 expect(moves[0].body).toMatchObject({orderId:'order-1',tableIds:[],primaryId:'',guests:0,dineType:'Take away'});
 expect(moves[1].body.request_id).toBe(moves[0].body.request_id);
});

test('claimed-table changes use the same capacity-aware move screen as order details',async({page})=>{
 const posts=await editor(page,'order-history.html',{seating_request_id:'initial-seating',seating_table_ids:['table-1'],seating_primary_id:'table-1'});
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[]}}));
 await setting(page,'table');
 await expect(page.locator('#editOrderModal')).toBeHidden();
 await expect(page.locator('#moveTableModal')).toBeVisible();
 expect(posts).toHaveLength(0);
});

test('a failed claimed-order type change locks its saved intent and retries the same request',async({page})=>{
 const posts=await editor(page,'order-history.html',{seating_request_id:'initial-seating',seating_table_ids:['table-1'],seating_primary_id:'table-1'});
 const bodies=[];let completes=0;
 await page.route('**/captain/v1/tables/move/**',route=>{
   const body=route.request().postDataJSON();bodies.push(body);
   if(route.request().url().endsWith('complete') && ++completes===1) return route.fulfill({status:503,json:{message:'Temporary problem'}});
   return route.fulfill({json:{request_id:body.request_id,orderId:'order-1',state:route.request().url().endsWith('complete')?'submitting':'reserved',dineType:'Take away',tableIds:[]}});
 });
 await setting(page,'type');
 await page.locator('label[for="edit-takeaway"]').click();
 await apply(page);
 await expect(page.locator('#editor-setting-apply')).toHaveText('Retry');
 await expect(page.locator('#edit-takeaway')).toBeDisabled();
 await expect(page.locator('#editor-setting-apply')).toBeEnabled();
 await apply(page);
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(0);
 expect(bodies).toHaveLength(4);
 expect(new Set(bodies.map(body=>body.request_id)).size).toBe(1);
});


for(const type of ['amount','price','fixed','percent'])test(`item edits preserve the existing ${type} bill discount`,async({page})=>{
 const posts=await editor(page,'order-history.html',{extra_discount:10,extra_discount_type:type,transfer_allocated:true});
 await expect(page.locator('#edit-discount-value')).toHaveValue('10');
 await expect(page.locator(type==='percent'?'#edit-discount-percent':'#edit-discount-amount')).toBeChecked();
 await page.locator('.qty-btn[aria-label="Increase quantity"]').click();
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(1);
 expect(posts[0]).toMatchObject({extra_discount:null,extra_discount_type:null});
});


test('ordinary fixed discount remains in legacy-server item updates',async({page})=>{
 const posts=await editor(page,'order-history.html',{extra_discount:10,extra_discount_type:'price'});
 await page.locator('.qty-btn[aria-label="Increase quantity"]').click();
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts[0]).toMatchObject({extra_discount:10,extra_discount_type:'amount'});
});

for(const where of ['order-history.html','kot-management.html'])test(`discount has a separate reversible step on ${where}`,async({page})=>{
 const posts=await editor(page,where,{extra_discount:10,extra_discount_type:'amount',transfer_allocated:true});
 await setting(page,'discount');
 await expect(page.locator('#edit-discount-section')).toBeVisible();
 await expect(page.locator('#edit-type-section')).toBeHidden();
 await page.locator('#edit-discount-value').fill('15');
 await page.locator('#editor-setting-back').click();
 await page.locator('[data-editor-setting="discount"]').click();
 await expect(page.locator('#edit-discount-value')).toHaveValue('10');
 await page.locator('#edit-discount-value').fill('0');
 await apply(page);
 await expect(page.locator('#edit-discount-section')).toBeVisible();
 await page.locator('#edit-discount-description').fill('Customer requested');
 await apply(page);
 await expect(page.locator('#order-editor-items')).toBeVisible();
 expect(posts).toHaveLength(0);
 await expect(page.locator('#save-order-changes')).toBeEnabled();
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(1);
 expect(posts[0]).toMatchObject({extra_discount:0,extra_discount_type:'amount',discount_description:'Customer requested'});
});

test('percentage discount cannot exceed 100 and back retains unsaved item edits',async({page})=>{
 const posts=await editor(page);
 await page.locator('.qty-btn[aria-label="Increase quantity"]').click();
 await setting(page,'discount');
 await page.locator('label[for="edit-discount-percent"]').click();
 await page.locator('#edit-discount-value').fill('101');
 await page.locator('#edit-discount-description').fill('Customer requested');
 await apply(page);
 await expect(page.locator('#edit-discount-section')).toBeVisible();
 await page.locator('#editor-setting-back').click();
 await page.locator('[data-editor-view="items"]').click();
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts[0].items[0].quantity).toBe(3);
 expect(posts[0].extra_discount).toBe(0);
});


test('discount step fits a narrow phone and uses the shop currency',async({page})=>{
 await page.setViewportSize({width:320,height:740});
 await editor(page);
 await setting(page,'discount');
 await expect(page.locator('label[for="edit-discount-amount"]')).toHaveText('₹');
 await expect(page.locator('#edit-discount-value')).toBeVisible();
 await expect(page.locator('#editor-setting-apply')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
 await page.screenshot({path:'test-artifacts/editor-discount-320.png'});
});


test('allocated discount review uses confirmed tax-inclusive total without compounding edits',async({page})=>{
 const posts=await editor(page,'order-history.html',{total_amount:95,subtotal:100,tax:5,discount:10,
   extra_discount:10,extra_discount_type:'amount',transfer_allocated:true,discount_basis:100});
 await expect(page.locator('#editor-total-value')).toHaveText('₹95.00');
 for(const [value,type,total] of [['15','amount','₹90.00'],['20','percent','₹85.00'],['0','amount','₹105.00']]){
   await setting(page,'discount');
   await page.locator(`label[for="edit-discount-${type}"]`).click();
   await page.locator('#edit-discount-value').fill(value);
   await page.locator('#edit-discount-description').fill('Customer requested');
   await apply(page);
   await expect(page.locator('#editor-total-value')).toHaveText(total);
 }
 expect(posts).toHaveLength(0);
});


test('opening and editing preserves stored unit-price precision',async({page})=>{
 const posts=await editor(page,'order-history.html',{total_amount:1.234,items:[{product_id:'p-biryani',name:'Chicken Biryani',quantity:1,price:1.234,unit_price:1.234}]});
 await page.evaluate(()=>CaptainMoney.remember({currencyCode:'KWD',currencySymbol:'KD'}));
 await page.locator('.qty-btn[aria-label="Increase quantity"]').click();
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts[0].items[0].price).toBe(1.234);
 expect(Number(posts[0].total_amount)).toBe(2.468);
});


for (const where of ['order-history.html','kot-management.html']) test(`server pricing ignores stale totals on ${where}`,async({page})=>{
 let release, started;
 const waiting=new Promise(resolve=>release=resolve), first=new Promise(resolve=>started=resolve);
 const setup=()=>page.route('**/captain/v1/orders/edit/preview',async route=>{
  const body=route.request().postDataJSON();
  if(body.items[0].quantity===2){started();await waiting;await route.fulfill({json:{total_amount:462}});}
  else await route.fulfill({json:{total_amount:693}});
 });
 const posts=await editor(page,where,{pricing_preview:true},setup); await first;
 await page.locator('.qty-btn[aria-label="Increase quantity"]').click();
 await expect(page.locator('#editor-total-value')).toContainText('693');
 release(); await page.waitForTimeout(100);
 await expect(page.locator('#editor-total-value')).toContainText('693');
 expect(posts).toHaveLength(0);
});
test('server pricing failure offers Retry without blocking Back',async({page})=>{
 let calls=0;
 const setup=()=>page.route('**/captain/v1/orders/edit/preview',route=>++calls===1?
  route.fulfill({status:503,json:{error:{message:'Please retry.'}}}):route.fulfill({json:{total_amount:462}}));
 await editor(page,'order-history.html',{pricing_preview:true},setup);
 await expect(page.locator('#editor-price-retry')).toBeVisible();
 await expect(page.locator('#editor-total-value')).toHaveText('—');
 await page.locator('#editor-price-retry').click();
 await expect(page.locator('#editor-total-value')).toContainText('462');
 await page.locator('#cancel-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
});
test('closing the editor ignores an outstanding pricing response',async({page})=>{
 let release, started;
 const waiting=new Promise(resolve=>release=resolve), first=new Promise(resolve=>started=resolve);
 const setup=()=>page.route('**/captain/v1/orders/edit/preview',async route=>{started();await waiting;await route.fulfill({json:{total_amount:999}});});
 await editor(page,'order-history.html',{pricing_preview:true},setup);await first;
 await page.locator('#cancel-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 release();await page.waitForTimeout(100);
 expect(await page.evaluate(()=>orderBeingModified())).toBeNull();
});


test('pricing deadline allows retry and ignores a late timed-out result',async({page})=>{
 let release,started,calls=0;
 const waiting=new Promise(resolve=>release=resolve), first=new Promise(resolve=>started=resolve);
 const setup=()=>page.route('**/captain/v1/orders/edit/preview',async route=>{
  if(++calls===1){started();await waiting;await route.fulfill({json:{total_amount:999}});}
  else await route.fulfill({json:{total_amount:462}});
 });
 await editor(page,'order-history.html',{pricing_preview:true},setup);await first;
 await expect(page.locator('#editor-price-retry')).toBeVisible({timeout:25000});
 await page.locator('#editor-price-retry').click();
 await expect(page.locator('#editor-total-value')).toContainText('462');
 release();await page.waitForTimeout(100);
 await expect(page.locator('#editor-total-value')).toContainText('462');
});


test('transfer screen selects preparations, reviews destination and confirms once',async({page})=>{
 await editor(page);await page.locator('#cancel-order-changes').click();
 const source='a'.repeat(24),table='b'.repeat(24),target='c'.repeat(24),writes=[];
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[{id:table,tableorder_value:'8',status:'available',capacity:4,max:4}]}}));
 await page.route('**/captain/v1/tables/transfer/preview',route=>route.fulfill({json:{sourceId:source,revision:'d'.repeat(64),currencyCode:'INR',currencyDigits:2,destination:{totalMinor:5250,rounds:[{name:'Corn',quantity:1,note:'Less salt',served:1}]},source:{totalMinor:5250}}}));
 await page.route('**/captain/v1/tables/transfer/complete',route=>{const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{requestId:body.requestId,sourceId:source,destinationId:target,sourceClosed:false,state:'completed'}});});
 await page.evaluate(source=>CaptainTransferScreen.open({_id:source,kitchen_rounds:[{ordered_at:'2026-09-30T13:30:00Z',items:[{id:'c0i0',name:'Corn',quantity:2,served:1}]}]}),source);
 const dialog=page.locator('.transfer-screen');
 await dialog.locator('[data-quantity]').fill('1');await dialog.locator('[data-served]').fill('1');
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await dialog.locator('input[type=checkbox]').check();
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(dialog).toContainText('52.50');await expect(dialog.locator('.transfer-review-line')).toContainText('Less salt');await expect(dialog.locator('.transfer-review-line')).toContainText('Served: 1');expect(writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'Back',exact:true}).click();
 await expect(dialog.locator('input[type=checkbox]')).toBeChecked();
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await dialog.getByRole('button',{name:'Save',exact:true}).click();
 await expect(dialog).not.toBeVisible();expect(writes).toHaveLength(1);
 expect(writes[0].items).toEqual([{id:'c0i0',quantity:1,servedQuantity:1}]);
 expect(writes[0].destination.tableIds).toEqual([table]);
});


test('transfer screen Back ignores late table results and keeps invalid quantities editable',async({page})=>{
 await editor(page);await page.locator('#cancel-order-changes').click();
 const source='a'.repeat(24);let release,started;
 const waiting=new Promise(resolve=>release=resolve),first=new Promise(resolve=>started=resolve);
 await page.route('**/captain/v1/tables',async route=>{started();await waiting;await route.fulfill({json:{tables:[]}});});
 await page.evaluate(source=>CaptainTransferScreen.open({_id:source,kitchen_rounds:[{items:[{id:'c0i0',name:'Corn',quantity:2,served:1}]}]}),source);
 const dialog=page.locator('.transfer-screen');
 await dialog.locator('[data-quantity]').fill('2');
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(dialog.locator('[role=alert]')).not.toBeEmpty();
 await expect(dialog.locator('[data-quantity]')).toHaveValue('2');
 await dialog.locator('[data-served]').fill('1');await dialog.getByRole('button',{name:'Continue',exact:true}).click();await first;
 await dialog.getByRole('button',{name:'Back',exact:true}).click();await expect(dialog).not.toBeVisible();
 release();await page.waitForTimeout(100);await expect(dialog).not.toBeVisible();
});


test('transfer action requires capability and permission and opens the registered order',async({page})=>{
 await editor(page);await page.locator('#cancel-order-changes').click();
 await page.evaluate(()=>{
  const order={_id:'a'.repeat(24),item_transfer:true,kitchen_rounds:[{items:[{id:'c0i0',name:'Corn',quantity:2,served:0,remaining:2}]}]};
  window.canMergeOrders=()=>false;
  if(ServiceRounds.render(order).includes('data-transfer-order'))throw new Error('permission');
  window.canMergeOrders=()=>true;
  if(ServiceRounds.render({...order,item_transfer:false}).includes('data-transfer-order'))throw new Error('capability');
  const host=document.createElement('div');host.innerHTML=ServiceRounds.render(order);document.body.append(host);
 });
 await page.locator('[data-transfer-order]').click();
 await expect(page.locator('.transfer-screen')).toBeVisible();
 await expect(page.locator('.transfer-screen')).toContainText('Corn');
});


test('transfer main table survives Back and review fits phone and RTL tablet',async({page})=>{
 await page.setViewportSize({width:320,height:740});await editor(page);await page.locator('#cancel-order-changes').click();
 const source='a'.repeat(24),one='b'.repeat(24),two='c'.repeat(24);
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[
  {id:one,tableorder_value:'8',status:'available',capacity:2,max:2,adjacent:[two]},
  {id:two,tableorder_value:'9',status:'available',capacity:2,max:2,adjacent:[one]}]}}));
 await page.route('**/captain/v1/tables/transfer/preview',route=>route.fulfill({json:{sourceId:source,revision:'d'.repeat(64),currencyCode:'INR',currencyDigits:2,destination:{totalMinor:5250,rounds:[{name:'Corn',quantity:1,note:'Less salt',served:1}]},source:{totalMinor:10500}}}));
 await page.evaluate(source=>CaptainTransferScreen.open({_id:source,table_number:'1',kitchen_rounds:[{items:[{id:'c0i0',name:'Corn',quantity:2,served:0}]}]}),source);
 const dialog=page.locator('.transfer-screen');await dialog.locator('[data-quantity]').fill('1');
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await dialog.locator('input[type=checkbox]').nth(0).check();await dialog.locator('input[type=checkbox]').nth(1).check();
 await dialog.locator('#transfer-primary').selectOption(two);await dialog.locator('#transfer-guests').fill('3');
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(dialog).toContainText('105.00');await expect(dialog).toContainText('52.50');await expect(dialog).toContainText('Main table: 9');
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:'test-artifacts/transfer-review-phone.png'});
 await dialog.getByRole('button',{name:'Back',exact:true}).click();await expect(dialog.locator('#transfer-primary')).toHaveValue(two);
 await expect(dialog.locator('#transfer-guests')).toHaveValue('3');
 await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await page.setViewportSize({width:800,height:1100});await page.evaluate(()=>document.documentElement.dir='rtl');
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:'test-artifacts/transfer-review-tablet-rtl.png'});
});


test('native Back exits a transfer and reopens the same interrupted request for Retry',async({page})=>{
 await editor(page);await page.locator('#cancel-order-changes').click();
 const source='a'.repeat(24),table='b'.repeat(24),target='c'.repeat(24),requests=[];
 await page.route('**/captain/v1/tables/transfer/complete',route=>{const body=route.request().postDataJSON();requests.push(body);return requests.length===1?route.fulfill({status:503,json:{error:{message:'Please retry.'}}}):route.fulfill({json:{requestId:body.requestId,sourceId:source,destinationId:target,sourceClosed:false,state:'completed'}});});
 await page.route('**/captain/v1/tables/transfer/status',route=>route.fulfill({json:{requestId:route.request().postDataJSON().requestId,state:'unknown'}}));
 await page.evaluate(async({source,table})=>{
  try{await CaptainItemTransfer.complete(source,{revision:'d'.repeat(64),items:[{id:'c0i0',quantity:1,servedQuantity:0}],destination:{tableIds:[table],primaryId:table,guests:1}});}catch{}
  CaptainTransferScreen.open({_id:source,kitchen_rounds:[]});
 },{source,table});
 const dialog=page.locator('.transfer-screen');await expect(dialog.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>!window.dispatchEvent(new Event('captain:back',{cancelable:true})))).toBe(true);
 await expect(dialog).not.toBeVisible();
 await page.evaluate(source=>CaptainTransferScreen.open({_id:source,kitchen_rounds:[]}),source);
 await dialog.getByRole('button',{name:'Retry',exact:true}).click();await expect(dialog).not.toBeVisible();
 expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
 expect(await page.evaluate(source=>CaptainItemTransfer.pending(source),source)).toBeNull();
});
test('native Back walks transfer steps and respects the lock overlay',async({page})=>{
 await editor(page);await page.locator('#cancel-order-changes').click();
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[]}}));
 await page.evaluate(()=>CaptainTransferScreen.open({_id:'a'.repeat(24),kitchen_rounds:[{items:[{id:'c0i0',name:'Corn',quantity:1,served:0}]}]}));
 const dialog=page.locator('.transfer-screen');await dialog.locator('[data-quantity]').fill('1');await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(dialog.locator('#transfer-guests')).toBeVisible();
 await page.evaluate(()=>{const lock=document.createElement('div');lock.id='posnic-lock';lock.className='is-open';document.body.append(lock);window.dispatchEvent(new Event('captain:back',{cancelable:true}));lock.remove();});
 await expect(dialog.locator('#transfer-guests')).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(dialog.locator('[data-quantity]')).toHaveValue('1');
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(dialog).not.toBeVisible();
});


test('confirmed transfer cancellation returns recovery to editable items',async({page})=>{
 await editor(page);await page.locator('#cancel-order-changes').click();
 const source='a'.repeat(24),table='b'.repeat(24);let reads=0;
 await page.route('**/captain/v1/tables/transfer/complete',route=>route.fulfill({status:409,json:{error:{message:'Please retry.'}}}));
 await page.route('**/captain/v1/tables/transfer/status',route=>route.fulfill({json:{requestId:route.request().postDataJSON().requestId,sourceId:source,state:++reads===1?'pending':'cancelled'}}));
 await page.evaluate(async({source,table})=>{
  try{await CaptainItemTransfer.complete(source,{revision:'d'.repeat(64),items:[{id:'c0i0',quantity:1,servedQuantity:0}],destination:{tableIds:[table],primaryId:table,guests:1}});}catch{}
  CaptainTransferScreen.open({_id:source,kitchen_rounds:[{items:[{id:'c0i0',name:'Corn',quantity:1,served:0}]}]});
 },{source,table});
 const dialog=page.locator('.transfer-screen');await dialog.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(dialog.locator('[data-quantity]')).toBeVisible();await expect(dialog.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();
 expect(await page.evaluate(source=>CaptainItemTransfer.pending(source),source)).toBeNull();
});


test('browser Back walks transfer steps without navigating or changing the order',async({page})=>{
 await editor(page);await page.locator('#cancel-order-changes').click();
 await page.waitForFunction(()=>!history.state?.captainOrderEditor);
 await page.route('**/captain/v1/tables',route=>route.fulfill({json:{tables:[]}}));
 const url=page.url();
 await page.evaluate(()=>CaptainTransferScreen.open({_id:'a'.repeat(24),kitchen_rounds:[{items:[{id:'c0i0',name:'Corn',quantity:1,served:0}]}]}));
 const dialog=page.locator('.transfer-screen');await dialog.locator('[data-quantity]').fill('1');await dialog.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(dialog.locator('#transfer-guests')).toBeVisible();
 await page.evaluate(()=>history.back());
 await expect(dialog.locator('[data-quantity]')).toHaveValue('1');expect(page.url()).toBe(url);
 await page.evaluate(()=>history.back());await expect(dialog).not.toBeVisible();expect(page.url()).toBe(url);
 expect(await page.evaluate(()=>history.state?.captainTransfer||false)).toBe(false);
});
test('closing transfer removes its history entry and rapid reopen keeps a working Back',async({page})=>{
 await editor(page);await page.locator('#cancel-order-changes').click();
 await page.waitForFunction(()=>!history.state?.captainOrderEditor);
 await page.evaluate(()=>{
  const order={_id:'a'.repeat(24),kitchen_rounds:[]};CaptainTransferScreen.open(order);
  window.dispatchEvent(new Event('captain:back',{cancelable:true}));CaptainTransferScreen.open(order);
 });
 const dialog=page.locator('.transfer-screen');await expect(dialog).toBeVisible();
 await page.waitForFunction(()=>history.state?.captainTransfer);
 await page.evaluate(()=>history.back());await expect(dialog).not.toBeVisible();
 expect(await page.evaluate(()=>history.state?.captainTransfer||false)).toBe(false);
});

for (const where of ['order-history.html', 'kot-management.html']) {
 test(`menu additions keep transferred portions separate on ${where}`, async({page})=>{
  const posts=await editor(page,where,{transfer_allocated:true});
  await page.locator('#current-order-items button[aria-label="Add items"]').click();
  await expect(page.locator('#item-picker')).toBeVisible();
  await page.locator('#item-picker .btn-increase[data-id="p-biryani"]').first().click();
  await page.locator('#item-picker .btn-increase[data-id="p-biryani"]').first().click();
  await page.locator('#item-picker-done').click();
  await expect(page.locator('#current-order-items .order-item-card')).toHaveCount(2);
  await expect(page.locator('.editor-added')).toHaveCount(1);
  await page.locator('#save-order-changes').click();
  await expect(page.locator('#editOrderModal')).toBeHidden();
  expect(posts).toHaveLength(1);
  expect(posts[0].items.map(item=>[item.product_id,item.quantity])).toEqual([['p-biryani',2],['p-biryani',2]]);
  expect(posts[0].items[1].line_id).toBeTruthy();
  expect(posts[0].items[1].line_id).not.toBe(posts[0].items[0].line_id);
 });
}

for (const where of ['order-history.html','kot-management.html']) {
 test(`new menu portions do not inherit another preparation note on ${where}`,async({page})=>{
  const posts=await editor(page,where,{transfer_allocated:true});
  await page.locator('#open-item-picker').click();
  await page.locator('#item-picker .btn-add[data-id="p-coffee"]').first().click();
  await page.locator('#item-picker-done').click();
  await page.locator('#current-order-items .order-item-card').nth(1).locator('.editor-note-link').click();
  await page.locator('#edit-item-notes-text').fill('Less sweet');
  await page.locator('#edit-item-notes-apply').click();
  await expect(page.locator('#editItemNotesModal')).toBeHidden();
  await page.locator('#open-item-picker').click();
  await page.locator('#item-picker .btn-increase[data-id="p-coffee"]').first().click();
  await page.locator('#item-picker .btn-increase[data-id="p-coffee"]').first().click();
  await page.locator('#item-picker-done').click();
  await expect(page.locator('#current-order-items .order-item-card')).toHaveCount(3);
  await page.locator('#save-order-changes').click();
  await expect(page.locator('#editOrderModal')).toBeHidden();
  expect(posts[0].items.slice(1).map(item=>[item.quantity,item.item_description||''])).toEqual([[1,'Less sweet'],[2,'']]);
  expect(posts[0].items[1].line_id).not.toBe(posts[0].items[2].line_id);
 });
}

test('clearing a legacy note clears both aliases before adding another portion',async({page})=>{
 const posts=await editor(page,'order-history.html',{items:[{...original.items[0],notes:'Less salt'}]});
 await page.locator('.editor-note-link').click();
 await expect(page.locator('#edit-item-notes-text')).toHaveValue('Less salt');
 await page.waitForFunction(()=>{const modal=bootstrap.Modal.getInstance(document.getElementById('editItemNotesModal'));return modal && !modal._isTransitioning;});
 await page.locator('#edit-item-notes-text').fill('');
 await expect(page.locator('#edit-item-notes-text')).toHaveValue('');
 await page.locator('#edit-item-notes-apply').click();
 await expect(page.locator('#editItemNotesModal')).toBeHidden();
 await page.locator('.editor-note-link').click();
 await expect(page.locator('#edit-item-notes-text')).toHaveValue('');
 await page.locator('#edit-item-notes-apply').click();
 await expect(page.locator('#editItemNotesModal')).toBeHidden();
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts[0].items[0].item_description||'').toBe('');
});
