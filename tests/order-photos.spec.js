import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
const id='12345678-1234-1234-1234-123456789abc';
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC9kAAAAASUVORK5CYII=';
async function openPhotos(page){
 await page.locator('[data-order-more]').click();
 await page.getByRole('button',{name:'Order photos',exact:true}).click();
}
async function setup(page, handler, attachments=false) {
  await onTheMenu(page,'nothing');
  await page.route('**/captain/v1/paper-orders/photos/*',handler);
  await page.route('**/captain/v1/paper-orders/options',r=>r.fulfill({json:{enabled:attachments,configured:true,referenceAttachments:true}}));
  await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['4']}}}));
  await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[{_id:'507f1f77bcf86cd799439011',items:[],sales_total:100,paper_order:{id,url:'https://untrusted.invalid/ignored'}}]}}}));
  await page.goto('/kot-management.html');
  await page.locator('.floor-card').first().click();
  await openPhotos(page);
}
test('saved photo thumbnail opens, zooms and returns without leaving the order',async({page})=>{
  let reads=0;
  await setup(page,r=>{reads++;return r.fulfill({json:{data:photo}});});
  await expect(page.locator('.order-photo-thumb img')).toHaveAttribute('src',photo);
  await page.locator('.order-photo-open').click();
  await expect(page.locator('.order-photo-viewer')).toBeVisible();
  await page.locator('.order-photo-full img').click();
  await expect(page.locator('.order-photo-full img')).toHaveClass('order-photo-zoom');
  await page.locator('.order-photo-viewer button').click();
  await expect(page.locator('.order-photo-viewer')).toHaveCount(0);
  await expect(page.locator('.order-photo-open')).toBeFocused();
  await expect(page.locator('.kot-card')).toHaveCount(1);
  expect(reads).toBe(1);
});
test('photo failure retries safely and never loads a server-provided external URL',async({page})=>{
  let reads=0;
  await setup(page,r=>r.fulfill(++reads===1?{status:503,json:{message:'Offline'}}:{json:{data:photo}}));
  await expect(page.locator('.order-photo-status')).toHaveText('Retry');
  await page.locator('.order-photo-open').click();
  await expect(page.locator('.order-photo-viewer img')).toHaveAttribute('src',photo);
  expect(reads).toBe(2);
});

test('history photo closes with Android Back while keeping order details open',async({page})=>{
  await setup(page,r=>r.fulfill({json:{data:photo}}));
  const order={_id:'507f1f77bcf86cd799439011',table_number:'4',status:'completed',items:[],total_amount:100,paper_order:{id}};
  await page.route('**/sales/getOrderHistory',r=>r.fulfill({json:{type:'success',data:{orders:[order]}}}));
  await page.goto('/order-history.html');
  await page.waitForFunction(()=>typeof viewOrderDetails==='function' && allOrders.length===1);
  await page.evaluate(orderId=>viewOrderDetails(orderId),order._id);
  await page.locator('.order-photo-open').click();
  await expect(page.locator('.order-photo-viewer')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page.locator('.order-photo-viewer')).toHaveCount(0);
  await expect(page.locator('#orderDetailsModal')).toBeVisible();
});


const file={name:'dish.png',mimeType:'image/png',buffer:Buffer.from(photo.split(',')[1],'base64')};
test('multiple reference photos queue and upload after the screen closes without OCR',async({page})=>{
 await setup(page,r=>r.fulfill({json:{data:photo}}),true);
 let finish;const gate=new Promise(r=>finish=r),bodies=[];let ocr=0;
 page.on('request',r=>{if(r.url().endsWith('/recognize'))ocr++;});
 await page.route('**/captain/v1/paper-orders/reference',async r=>{const b=r.request().postDataJSON();bodies.push(b);await gate;await r.fulfill({json:{photo:{id:b.id}}});});
 await page.locator('.order-photo-add').click();
 await expect(page.locator('[data-camera]')).toHaveAttribute('accept','image/*');
 await page.locator('[data-gallery]').setInputFiles([file,{...file,name:'dish2.png'}]);
 await expect(page.locator('.order-photo-upload .photo-queue-row')).toHaveCount(2);
 await page.locator('.order-photo-upload [data-close]').first().click();
 await expect(page.locator('.order-photo-upload')).toHaveCount(0);
 finish();await expect(page.locator('[data-order-photo]')).toHaveCount(3);
 expect(bodies).toHaveLength(2);expect(bodies[0].id).not.toBe(bodies[1].id);expect(ocr).toBe(0);
 expect(bodies.every(b=>b.saleId==='507f1f77bcf86cd799439011')).toBe(true);
 await page.screenshot({path:'test-artifacts/order-reference-gallery.png'});
});
test('failed photo retries its original id after reload and retains multiple queued photos',async({page})=>{
 await setup(page,r=>r.fulfill({json:{data:photo}}),true);const bodies=[];let failing=true;
 await page.route('**/captain/v1/paper-orders/reference',r=>{const b=r.request().postDataJSON();bodies.push(b);return r.fulfill(failing?{status:503,json:{message:'offline'}}:{json:{photo:{id:b.id}}});});
 await page.locator('.order-photo-add').click();await page.locator('[data-gallery]').setInputFiles([file,{...file,name:'dish2.png'}]);
 await expect(page.locator('.order-photo-upload .photo-queue-row button')).toHaveCount(2);
 await page.reload();await page.locator('.floor-card').first().click();
 await openPhotos(page);
 await expect(page.locator('.photo-queue-row')).toHaveCount(2);
 failing=false;await page.locator('.photo-queue-row button').first().click();
 await expect(page.locator('.photo-queue-row')).toHaveCount(1);
 await page.locator('.photo-queue-row button').click();await expect(page.locator('.photo-queue-row')).toHaveCount(0);
 expect(bodies[2]).toEqual(bodies[0]);expect(bodies[3]).toEqual(bodies[1]);
});
test('optional photo attachment stays off and private saved photos remain viewable',async({page})=>{
 await setup(page,r=>r.fulfill({json:{data:photo}}));await expect(page.locator('.order-photo-add')).toBeHidden();await expect(page.locator('.order-photo-open')).toBeVisible();
});
test('queued references never upload as a different signed-in staff member',async({page})=>{
 await setup(page,r=>r.fulfill({json:{data:photo}}),true);let calls=0;
 await page.route('**/captain/v1/paper-orders/reference',r=>{calls++;return r.fulfill({status:503,json:{message:'offline'}});});
 await page.locator('.order-photo-add').click();await page.locator('[data-gallery]').setInputFiles(file);
 await expect(page.locator('.order-photo-upload .photo-queue-row button')).toHaveCount(1);
 await page.locator('.order-photo-upload [data-close]').first().click();
 await page.evaluate(()=>{POSNIC.session.user.id='different-staff';window.dispatchEvent(new Event('online'));});
 await page.locator('.order-photo-add').click();await expect(page.locator('.order-photo-upload .photo-queue-row')).toHaveCount(0);expect(calls).toBe(1);
});

test('uploads resume on another app page after navigation interrupts the response',async({page})=>{
 await setup(page,r=>r.fulfill({json:{data:photo}}),true);const bodies=[];
 await page.route('**/captain/v1/paper-orders/reference',async r=>{const b=r.request().postDataJSON();bodies.push(b);if(bodies.length===1){await new Promise(resolve=>setTimeout(resolve,4000));}await r.fulfill({json:{photo:{id:b.id}}}).catch(()=>{});});
 await page.locator('.order-photo-add').click();await page.locator('[data-gallery]').setInputFiles(file);
 await expect.poll(()=>bodies.length).toBe(1);await page.goto('/products.html');
 await expect.poll(()=>bodies.length).toBe(2);expect(bodies[1]).toEqual(bodies[0]);
});
for(const theme of ['light','dark'])test(`history shows reference photos without editing controls at phone width in ${theme}`,async({page})=>{
 await setup(page,r=>r.fulfill({json:{data:photo}}),true);
 const order={_id:'507f1f77bcf86cd799439011',table_number:'4',status:'pending',item_transfer:true,kitchen_rounds:[{ordered_at:'2026-10-05T07:00:00Z',items:[{name:'Butter Naan',quantity:2,remaining:2,line_key:'line-1'}]}],items:[],total_amount:100,order_photos:[{id}]};
 await page.route('**/sales/getOrderHistory',r=>r.fulfill({json:{type:'success',data:{orders:[order]}}}));
 await page.setViewportSize({width:360,height:800});await page.goto('/order-history.html');
 await page.waitForFunction(()=>typeof viewOrderDetails==='function'&&allOrders.length===1);
 await page.evaluate(({id,theme})=>{document.documentElement.setAttribute('data-color-scheme',theme);window.canMergeOrders=()=>true;viewOrderDetails(id);},{id:order._id,theme});
 await expect(page.locator('[data-transfer-order]')).toHaveCount(0);
 await expect(page.locator('.order-photo-add')).toHaveCount(0);
 await page.locator('.order-photo-open').click();
 await expect(page.locator('.order-photo-full img')).toBeVisible();
 await page.screenshot({path:`test-artifacts/reference-picker-${theme}.png`});
 expect(await page.locator('.order-photo-viewer').evaluate(e=>e.getBoundingClientRect().right)).toBeLessThanOrEqual(361);
});

test('dish selection follows multiple photos through failed upload and reload',async({page})=>{
 await setup(page,r=>r.fulfill({json:{data:photo}}),true);
 const itemId='507f1f77bcf86cd799439022';
 await page.route('**/captain/v1/paper-orders/options',r=>r.fulfill({json:{enabled:true,configured:true,referenceAttachments:true,itemReferenceAttachments:true}}));
 await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[{_id:'507f1f77bcf86cd799439011',items:[{item_id:itemId,item_name:'Butter Naan',item_quantity:2}],sales_total:100}]}}}));
 let failing=true;const bodies=[];
 await page.route('**/captain/v1/paper-orders/reference',r=>{const b=r.request().postDataJSON();bodies.push(b);return r.fulfill(failing?{status:503,json:{message:'offline'}}:{json:{photo:{id:b.id,item_id:b.itemId,item_name:'Butter Naan'}}});});
 await page.reload();await page.locator('.floor-card').first().click();await openPhotos(page);await page.locator('.order-photo-add').click();
 await page.locator('.photo-dish-picker input').fill('naan');
 await page.locator('.photo-dish-options button').filter({hasText:'Butter Naan'}).click();
 await expect(page.locator('.photo-dish-options button[aria-pressed=true]')).toHaveText('Butter Naan');
 await page.locator('[data-gallery]').setInputFiles([file,{...file,name:'second.png'}]);
 await expect(page.locator('.order-photo-upload .photo-queue-row button')).toHaveCount(2);
 await page.setViewportSize({width:360,height:800});await page.screenshot({path:'test-artifacts/dish-reference-picker.png'});
 await page.reload();await page.locator('.floor-card').first().click();await openPhotos(page);failing=false;
 await page.locator('.photo-queue-row button').first().click();await expect(page.locator('.photo-queue-row')).toHaveCount(1);
 await page.locator('.photo-queue-row button').click();await expect(page.locator('.photo-queue-row')).toHaveCount(0);
 expect(bodies).toHaveLength(4);expect(bodies.every(b=>b.itemId===itemId)).toBe(true);
 expect(bodies[2]).toEqual(bodies[0]);expect(bodies[3]).toEqual(bodies[1]);
 await expect(page.locator('.order-photo-open strong')).toHaveText(['Butter Naan','Butter Naan']);
});
