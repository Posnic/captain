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
