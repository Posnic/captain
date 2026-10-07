import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC9kAAAAASUVORK5CYII=','base64');
async function setup(page,enabled=true) {
  await onTheMenu(page,'nothing');
  await page.route('**/captain/v1/paper-orders/options',r=>r.fulfill({json:{enabled,configured:true,stagedPhotoUpload:true}}));
  await page.route('**/captain/v1/paper-orders/upload',r=>r.fulfill({json:{id:r.request().postDataJSON().id,referenceOnly:true}}));
  await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[{id:'table-4',tableorder_value:'4',status:'available'}]}}));
  await page.route('**/captain/v1/paper-orders/recognize',r=>r.fulfill({json:{id:r.request().postDataJSON().id,table:'4',pax:null,lines:[{text:'CB 5',name:'CB',quantity:5,confidence:98}]}}));
  await page.goto('/kot-management.html');
}
test('scan stays visible while disabled scanning cannot upload',async({page})=>{
  await setup(page,false);
  let uploaded=false;page.on('request',r=>{if(r.url().endsWith('/paper-orders/recognize'))uploaded=true;});
  await expect(page.locator('#paper-order-open')).toBeVisible();await page.locator('#paper-order-open').click();
  await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await expect(page.locator('.paper-order-dialog [role=status]')).toContainText('Paper scanning needs server setup.');
  expect(uploaded).toBe(false);
});
test('photo draft is editable, optional pax remains empty, send carries photo reference',async({page})=>{
  await setup(page);
  await page.locator('#paper-order-open').click();
  await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await page.getByRole('button',{name:'Read photo',exact:true}).click();
  await expect(page.locator('[data-item]')).toContainText('Chicken Biryani');
  await expect(page.locator('[data-pax]')).toHaveValue('');
  await page.locator('[data-qty]').fill('6');
  await page.locator('.paper-note summary').click();
  await page.locator('[data-note]').fill('No onion');
  await page.screenshot({path:'test-artifacts/paper-order-review.png',fullPage:true});
  const sent=page.waitForRequest(r=>r.url().endsWith('/sales/qrOrder'));
  await page.route('**/sales/qrOrder',r=>r.fulfill({json:{type:'success',data:{order_id:'saved-order'}}}));
  await page.getByRole('button',{name:'Send to kitchen',exact:true}).click();
  const body=(await sent).postDataJSON();
  expect(body.paper_order_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(body.items[0]).toMatchObject({item_id:'p-biryani',item_quantity:6,item_description:'No onion'});
  expect(body.person_count).toBe('');expect(body.kiosk_table_no).toBe('4');
});

test('upload completes before area selection and draft menu is searchable',async({page})=>{
  await setup(page);
  let complete;const gate=new Promise(resolve=>complete=resolve);
  await page.route('**/captain/v1/paper-orders/upload',async r=>{await gate;await r.fulfill({json:{id:r.request().postDataJSON().id}});});
  await page.locator('#paper-order-open').click();
  await page.locator('[data-gallery]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await expect(page.locator('progress')).toBeVisible();
  await expect(page.locator('[data-select-area]')).toBeHidden();
  await expect(page.locator('[data-process]')).toBeHidden();
  await page.screenshot({path:'test-artifacts/paper-upload-progress.png',fullPage:true});
  complete();
  await expect(page.locator('[data-select-area]')).toBeVisible();
  const extracted=page.waitForRequest(r=>r.url().endsWith('/paper-orders/recognize'));
  await page.locator('[data-process]').click();
  const body=(await extracted).postDataJSON();expect(body.uploadId).toBeTruthy();expect(body.original).toBeUndefined();
  await page.locator('[data-item]').click();
  await page.getByRole('searchbox',{name:'Search the menu'}).fill('biryani');
  await page.locator('.paper-menu-picker [data-results] button').first().click();
  await expect(page.locator('[data-item]')).toContainText('Chicken Biryani');
  await page.locator('[data-add]').click();
  await page.getByRole('searchbox',{name:'Search the menu'}).fill('biryani');
  await page.locator('.paper-menu-picker [data-results] button').first().click();
  await expect(page.locator('[data-row]')).toHaveCount(2);
  await page.locator('[data-remove]').last().click();
  await expect(page.locator('[data-row]')).toHaveCount(1);
  await page.screenshot({path:'test-artifacts/paper-searchable-review.png',fullPage:true});
});

test('paper quick sale uses tax-aware creation and survives draft recovery',async({page})=>{
  await setup(page);await page.locator('#paper-order-open').click();
  await page.locator('[data-gallery]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await page.locator('[data-process]').click();
  await page.evaluate(()=>{POSNIC.quickSale.ask=async()=>({amount:100,tax:{id:'gst',rate:5}});});
  let created;
  await page.route('**/items/instanceItemInsert',r=>{created=r.request().postDataJSON();return r.fulfill({json:{type:'success',data:{id:'instant-cake',name:'Birthday cake',selling_price:100,tax:5}}});});
  await page.locator('[data-add]').click();
  await page.getByRole('searchbox',{name:'Search the menu'}).fill('Birthday cake');
  await page.locator('.paper-menu-picker [data-quick]').click();
  await expect(page.locator('[data-item]').last()).toContainText('Birthday cake');
  expect(created).toMatchObject({items_name:'Birthday cake',items_selling_price:100,quick_sale_default_tax:true,quick_sale_tax:{id:'gst',rate:5}});
  await page.reload();await page.locator('#paper-order-open').click();
  await expect(page.locator('[data-item]').last()).toContainText('Birthday cake');
});
test('failed recognition retains the photo across a page reload',async({page})=>{
  await setup(page);
  await page.route('**/captain/v1/paper-orders/recognize',r=>r.fulfill({status:422,json:{error:{message:'Recognition unavailable'}}}));
  await page.locator('#paper-order-open').click();
  await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await page.getByRole('button',{name:'Read photo',exact:true}).click();
  await expect(page.locator('.paper-order-dialog [role=status]')).toContainText('Recognition unavailable');
  await page.reload();await page.locator('#paper-order-open').click();
  await expect(page.getByRole('button',{name:'Read photo',exact:true})).toBeVisible();
});


test('enabled paper scanning explains missing configuration instead of disappearing',async({page})=>{
  await setup(page);
  await page.route('**/captain/v1/paper-orders/options',r=>r.fulfill({json:{enabled:true,configured:false}}));
  await page.reload();await page.locator('#paper-order-open').click();
  await expect(page.locator('.paper-order-dialog')).toBeVisible();
  await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await expect(page.locator('.paper-order-dialog [role=status]')).toContainText('Paper scanning needs server setup.');
  await expect(page.locator('.paper-preview canvas')).toBeVisible();
});

test('unreachable paper service still permits camera capture and preserves the photo',async({page})=>{
  await setup(page);
  await page.route('**/captain/v1/paper-orders/options',r=>r.fulfill({status:503,json:{message:'Unavailable'}}));
  await page.route('**/captain/v1/tables',r=>r.fulfill({status:503,json:{message:'Unavailable'}}));
  await page.reload();await page.locator('#paper-order-open').click();
  const input=page.locator('.paper-order-dialog input[data-camera]');
  await expect(input).toHaveAttribute('capture','environment');
  await expect(input).toHaveAttribute('accept','image/*');
  await expect(page.locator('[data-gallery]')).not.toHaveAttribute('capture');
  const chooser=page.waitForEvent('filechooser');await input.click();
  await (await chooser).setFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await expect(page.locator('.paper-order-dialog [role=status]')).toContainText('Unavailable');
  await expect(page.locator('#error-popup-overlay')).toBeHidden();
  await page.reload();await page.locator('#paper-order-open').click();
  await expect(page.locator('.paper-preview canvas')).toBeVisible();
});

for (const scheme of ['light', 'dark']) {
  for (const width of [320, 900]) {
    test(`paper capture stays inside ${width}px ${scheme} viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await setup(page);
      await page.evaluate(scheme => document.documentElement.dataset.colorScheme = scheme, scheme);
      await page.locator('#paper-order-open').click();
      const dialog = page.locator('.paper-order-dialog');
      await expect(dialog).toBeVisible();
      const geometry = await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const close = element.querySelector('[data-close]').getBoundingClientRect();
        const theme = getComputedStyle(document.documentElement);
        const surface = document.createElement('div');
        surface.style.backgroundColor = theme.getPropertyValue('--surface');
        document.body.append(surface);
        const expected = getComputedStyle(surface).backgroundColor;
        surface.remove();
        return { x:rect.x, y:rect.y, right:rect.right, bottom:rect.bottom, closeTop:close.top, closeBottom:close.bottom,
          background:getComputedStyle(element).backgroundColor, expected,
          header:getComputedStyle(element.querySelector('header')).backgroundColor };
      });
      expect(geometry.x).toBeGreaterThanOrEqual(10);
      expect(geometry.right).toBeLessThanOrEqual(width - 10);
      expect(geometry.y).toBeGreaterThanOrEqual(10);
      expect(geometry.bottom).toBeLessThanOrEqual(630);
      expect(geometry.closeTop).toBeGreaterThanOrEqual(geometry.y);
      expect(geometry.closeBottom).toBeLessThanOrEqual(geometry.bottom);
      expect(geometry.background).toBe(geometry.expected);
      expect(geometry.header).toBe(geometry.expected);
      await page.screenshot({ path:`test-artifacts/paper-capture-${width}-${scheme}.png` });
      await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
      await page.getByRole('button',{name:'Read photo',exact:true}).click();
      await expect(page.locator('[data-item]')).toContainText('Chicken Biryani');
      expect(await page.locator('.paper-order-dialog [data-content]').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
      await expect(page.getByRole('button',{name:'Send to kitchen',exact:true})).toBeInViewport();
      await page.screenshot({ path:`test-artifacts/paper-actual-review-${width}-${scheme}.png` });
    });
  }
}

test('paper review keeps sending and closing reachable with many rows', async ({page}) => {
  await page.setViewportSize({width:320,height:568});
  await setup(page);
  await page.locator('#paper-order-open').click();
  await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
  await page.getByRole('button',{name:'Read photo',exact:true}).click();
  for(let i=0;i<8;i++) {
    await page.getByRole('button',{name:'Add item',exact:true}).click();
    await page.locator('.paper-menu-picker [data-results] button').first().click();
  }
  const send=page.getByRole('button',{name:'Send to kitchen',exact:true});
  await expect(send).toBeInViewport();
  await expect(page.locator('.paper-order-dialog [data-close]')).toBeInViewport();
  await page.locator('.paper-order-dialog [data-content]').evaluate(el=>el.scrollTop=0);
  await expect(send).toBeInViewport();
  await expect(page.locator('[data-item]').first()).toBeInViewport();
  await page.screenshot({path:'test-artifacts/paper-review-pinned-phone.png'});
});


test('paper quantity buttons and notes survive reload without sending',async({page})=>{
 await setup(page);await page.locator('#paper-order-open').click();
 await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
 await page.getByRole('button',{name:'Read photo',exact:true}).click();
 await page.getByRole('button',{name:'Increase quantity',exact:true}).click();
 await expect(page.locator('[data-qty]')).toHaveValue('6');
 await page.getByRole('button',{name:'Decrease quantity',exact:true}).click();
 await expect(page.locator('[data-qty]')).toHaveValue('5');
 await page.locator('.paper-note summary').click();await page.locator('[data-note]').fill('Less spicy');
 await expect.poll(()=>page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('captain-paper-orders',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('drafts').objectStore('drafts').getAll();q.onsuccess=()=>{resolve(q.result[0]?.rows[0]?.note);db.close();};};}))).toBe('Less spicy');
 await page.reload();await page.locator('#paper-order-open').click();
 await expect(page.locator('[data-qty]')).toHaveValue('5');await expect(page.locator('[data-note]')).toHaveValue('Less spicy');
});

test('paper summary follows quantities, removals and restored drafts',async({page})=>{
 await setup(page);await page.locator('#paper-order-open').click();
 await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
 await page.getByRole('button',{name:'Read photo',exact:true}).click();
 const summary=page.locator('.paper-review-summary');
 await expect(summary).toContainText('1 item · 5 qty');await expect(summary).toContainText('Table 4');
 await page.locator('[data-qty]').fill('2.5');await expect(summary).toContainText('1 item · 2.5 qty');
 await page.getByRole('button',{name:'Increase quantity',exact:true}).click();await expect(summary).toContainText('1 item · 3.5 qty');
 await page.getByRole('button',{name:'Add item',exact:true}).click();
 await page.locator('.paper-menu-picker [data-results] button').first().click();await expect(summary).toContainText('2 items · 4.5 qty');
 await page.locator('[data-remove]').last().click();await expect(summary).toContainText('1 item · 3.5 qty');
 await page.locator('.paper-photo-details summary').click();await expect(page.locator('.paper-preview canvas')).toBeVisible();
 await page.locator('.paper-photo-details summary').click();
 await page.locator('[data-remove]').click();await expect(summary).toContainText('0 items · 0 qty');
 await expect(page.getByRole('button',{name:'Send to kitchen',exact:true})).toBeDisabled();
});

for (const failure of ['read', 'storage']) {
 test(`failed replacement photo ${failure} preserves the reviewed draft`,async({page})=>{
  await setup(page);await page.locator('#paper-order-open').click();
  const file={name:'order.png',mimeType:'image/png',buffer:photo};
  await page.locator('.paper-order-dialog input[data-camera]').setInputFiles(file);
  await page.getByRole('button',{name:'Read photo',exact:true}).click();
  await expect(page.locator('[data-qty]')).toHaveValue('5');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(failure=>{
   if(failure==='read')FileReader.prototype.readAsDataURL=function(){queueMicrotask(()=>this.onerror?.());};
   else {const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts')throw new DOMException('Storage full','QuotaExceededError');return put.apply(this,args);};}
  },failure);
  await page.locator('.paper-photo-details summary').click();
  await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({...file,name:'replacement.png'});
  await expect(page.locator('.paper-order-dialog [role=status]')).toContainText('Photo could not be saved');
  await expect(page.locator('[data-qty]')).toHaveValue('5');
  await expect(page.locator('[data-item]')).toContainText('Chicken Biryani');
  await expect(page.getByRole('button',{name:'Send to kitchen',exact:true})).toBeEnabled();
  expect(errors).toEqual([]);
  await page.reload();await page.locator('#paper-order-open').click();
  await expect(page.locator('[data-qty]')).toHaveValue('5');
  await expect(page.locator('[data-item]')).toContainText('Chicken Biryani');
 });
}

test('zoomed crop uses image coordinates and retains the full original',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:760});await setup(page);await page.locator('#paper-order-open').click();
 const original=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=400;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,400);ctx.fillStyle='black';ctx.fillRect(40,40,200,200);return c.toDataURL('image/png');});
 await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'crop.png',mimeType:'image/png',buffer:Buffer.from(original.split(',')[1],'base64')});
 const slider=page.locator('[data-zoom]');await expect(slider).toBeVisible();await slider.fill('2');
 const canvas=page.locator('.paper-preview canvas');const rect=await canvas.boundingBox();
 expect(rect.width).toBeGreaterThan(400);
 await expect(canvas).toHaveCSS('touch-action','auto');
 await page.getByRole('button',{name:'Select area',exact:true}).click();
 await expect(canvas).toHaveCSS('touch-action','none');
 await page.mouse.move(rect.x+30,rect.y+30);await page.mouse.down();await page.mouse.move(rect.x+150,rect.y+150);await page.mouse.up();
 await page.screenshot({path:'test-artifacts/paper-zoom-crop-390-light.png'});
 const sent=page.waitForRequest(r=>r.url().endsWith('/paper-orders/recognize'));
 await page.getByRole('button',{name:'Read photo',exact:true}).click();const body=(await sent).postDataJSON();
 expect(body.original).toBeUndefined();expect(body.uploadId).toBeTruthy();expect(body.crop).toMatch(/^data:image\/jpeg/);
 const size=await page.evaluate(async data=>{const img=new Image();img.src=data;await img.decode();return {width:img.width,height:img.height};},body.crop);
 expect(size.width).toBeCloseTo(Math.floor(120*400/rect.width),0);
 expect(size.height).toBe(size.width);
 await page.reload();await page.locator('#paper-order-open').click();
 await page.locator('.paper-photo-details summary').click();
 const retry=page.waitForRequest(r=>r.url().endsWith('/paper-orders/recognize'));
 await page.getByRole('button',{name:'Read photo',exact:true}).click();
 const retried=(await retry).postDataJSON();expect(retried.crop).toBe(body.crop);expect(retried.id).toBe(body.id);
 await expect(page.locator('[data-qty]')).toHaveValue('5');
 await page.locator('.paper-photo-details summary').click();await page.getByRole('button',{name:'Whole photo',exact:true}).click();await expect(slider).toHaveValue('1');
 const again=page.waitForRequest(r=>r.url().endsWith('/paper-orders/recognize'));await page.getByRole('button',{name:'Read photo',exact:true}).click();
 const full=(await again).postDataJSON();expect(full.original).toBeUndefined();expect(full.uploadId).toBe(body.uploadId);expect(full.crop).toBeUndefined();expect(full.id).not.toBe(body.id);expect(errors).toEqual([]);
});

test('Android Back closes paper review and retains the saved draft',async({page})=>{
 await setup(page);await page.locator('#paper-order-open').click();
 await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
 await page.getByRole('button',{name:'Read photo',exact:true}).click();
 await expect(page.locator('[data-qty]')).toHaveValue('5');
 const url=page.url();
 expect(await page.evaluate(()=>!window.dispatchEvent(new Event('captain:back',{cancelable:true})))).toBe(true);
 await expect(page.locator('.paper-order-dialog')).not.toBeVisible();
 await expect(page.locator('#paper-order-open')).toBeFocused();expect(page.url()).toBe(url);
 await page.locator('#paper-order-open').click();await expect(page.locator('[data-qty]')).toHaveValue('5');
});

test('Android Back cannot dismiss an in-flight photo recognition',async({page})=>{
 await setup(page);let release;const held=new Promise(resolve=>release=resolve);
 await page.route('**/captain/v1/paper-orders/recognize',async r=>{await held;await r.fulfill({status:503,json:{message:'Recognition unavailable'}});});
 await page.locator('#paper-order-open').click();
 await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
 const request=page.waitForRequest(r=>r.url().endsWith('/paper-orders/recognize'));
  await page.getByRole('button',{name:'Read photo',exact:true}).click();await request;
 await expect(page.locator('.paper-actions')).toHaveAttribute('inert','');
 expect(await page.evaluate(()=>!window.dispatchEvent(new Event('captain:back',{cancelable:true})))).toBe(true);
 await expect(page.locator('.paper-order-dialog')).toBeVisible();release();
 await expect(page.locator('.paper-order-dialog [role=status]')).toContainText('Recognition unavailable');
 await expect(page.locator('.paper-actions')).not.toHaveAttribute('inert','');
 await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
 await expect(page.locator('.paper-order-dialog')).not.toBeVisible();
 await page.locator('#paper-order-open').click();await expect(page.locator('.paper-preview canvas')).toBeVisible();
});

for(const scheme of ['light','dark']) for(const width of [320,900]) {
 test(`retake stays pinned and cancellation retains photo at ${width}px ${scheme}`,async({page})=>{
  await page.setViewportSize({width,height:640});await setup(page);
  await page.evaluate(scheme=>document.documentElement.dataset.colorScheme=scheme,scheme);
  await page.locator('#paper-order-open').click();
  const original=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=600;c.height=800;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,600,800);x.fillStyle='#25314c';x.font='28px sans-serif';x.fillText('Table 4',50,70);x.fillText('CB 5',50,125);return c.toDataURL('image/png');});
  await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:Buffer.from(original.split(',')[1],'base64')});
  const retake=page.locator('.paper-actions .paper-camera');await expect(retake).toHaveText('Retake');await expect(retake).toBeVisible();
  const imageBounds=await page.locator('.paper-preview canvas').boundingBox();
  const previewBounds=await page.locator('.paper-preview').boundingBox();
  expect(imageBounds.width).toBeLessThanOrEqual(previewBounds.width+1);
  expect(imageBounds.height).toBeLessThanOrEqual(previewBounds.height+1);
  expect(imageBounds.y).toBeGreaterThanOrEqual(previewBounds.y-1);
  expect(imageBounds.y+imageBounds.height).toBeLessThanOrEqual(previewBounds.y+previewBounds.height+1);
  const read=page.getByRole('button',{name:'Read photo',exact:true});
  for(const control of [retake,read]) {const rect=await control.boundingBox();expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.y+rect.height).toBeLessThanOrEqual(640);expect(rect.height).toBeGreaterThanOrEqual(44);}
  const chooser=page.waitForEvent('filechooser');await retake.click();await (await chooser).setFiles([]);
  await expect(retake).toBeVisible();await expect(page.locator('.paper-preview canvas')).toBeVisible();
  await page.screenshot({path:`test-artifacts/paper-retake-${width}-${scheme}.png`});
  await page.reload();await page.locator('#paper-order-open').click();
  const request=page.waitForRequest(r=>r.url().endsWith('/paper-orders/recognize'));
  await read.click();expect((await request).postDataJSON().uploadId).toBeTruthy();
  await expect(page.locator('[data-qty]')).toHaveValue('5');
 });
}

test('dragging a photo without Select area keeps whole-photo recognition',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await setup(page);await page.locator('#paper-order-open').click();
 await page.locator('.paper-order-dialog input[data-camera]').setInputFiles({name:'order.png',mimeType:'image/png',buffer:photo});
 await expect(page.locator('[data-select-area]')).toHaveAttribute('aria-pressed','false');
 const canvas=page.locator('.paper-preview canvas');await expect(canvas).toBeVisible();const rect=await canvas.boundingBox();
 await page.mouse.move(rect.x+20,rect.y+20);await page.mouse.down();await page.mouse.move(rect.x+80,rect.y+80);await page.mouse.up();
 const request=page.waitForRequest(r=>r.url().endsWith('/paper-orders/recognize'));
 await page.getByRole('button',{name:'Read photo',exact:true}).click();
 expect((await request).postDataJSON().crop).toBeUndefined();await expect(page.locator('[data-qty]')).toHaveValue('5');expect(errors).toEqual([]);
});

test('native picker return saves to the opening owner before PIN navigation',async({page})=>{
 await setup(page);await page.locator('#paper-order-open').click();
 const chooser=page.waitForEvent('filechooser');await page.locator('[data-camera]').click();
 await page.evaluate(()=>{
   window.originalSessionDescriptor=Object.getOwnPropertyDescriptor(POSNIC,'session');
   Object.defineProperty(POSNIC,'session',{configurable:true,value:{shopKey:'locked-session',user:null}});
   window.captureSettled=false;CaptainPaperCapture.waitForPhoto().then(()=>window.captureSettled=true);
 });
 expect(await page.evaluate(()=>window.captureSettled)).toBe(false);
 await (await chooser).setFiles({name:'order.png',mimeType:'image/png',buffer:photo});
 await expect.poll(()=>page.evaluate(()=>window.captureSettled)).toBe(true);
 await page.evaluate(()=>Object.defineProperty(POSNIC,'session',window.originalSessionDescriptor));
 await page.reload();await page.locator('#paper-order-open').click();
 await expect(page.locator('.paper-preview canvas')).toBeVisible();
});
