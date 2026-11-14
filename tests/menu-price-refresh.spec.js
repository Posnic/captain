import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

const menu = price => [{category_name:'Food',items:[item('p-coffee','Coffee',price,{price_mode:'fixed'})]}];
const response = price => ({type:'success',data:{products:menu(price),kiosk_images:[],tableorders:[]}});

async function ready(page) {
  await onTheMenu(page,'nothing',{menu:menu(40)});
  await page.goto('/kot-management.html');
  await page.waitForFunction(()=>window.POSNIC_ORDER_QUEUE_UI && POSNIC.session.active);
}
async function send(page) {
  await page.evaluate(async()=>{
    OrderQueue.add({key:'price-refresh-key',branch:'branch-1',body:{idempotencyKey:'price-refresh-key',branch:'branch-1',kiosk_table_no:'4',items:[{item_id:'p-coffee',item_name:'Coffee',item_quantity:1,item_price:40}]}});
    await POSNIC_ORDER_QUEUE_UI.flush();
  });
}
test('an accepted price difference refreshes the saved menu and successful sync time without changing another draft',async({page})=>{
  await ready(page);
  await page.evaluate(()=>saveCartData([{id:'draft-line',name:'Agreed draft',quantity:2,price:35,selling_price:35}]));
  const before=await page.evaluate(()=>CaptainMenuSync.last('branch-1'));
  let refreshed=0,sent=0;
  await page.route('**/items/accessQr',async route=>{refreshed++;await route.fulfill({json:response(55)});});
  await page.route('**/sales/qrOrder',async route=>{sent++;await route.fulfill({json:{type:'success',data:{items:[{item:'p-coffee',unit_price:52.38,pricing:{version:1,selling_price:55}}]}}});});
  await send(page);
  await expect.poll(()=>page.evaluate(()=>OrderQueue.count())).toBe(0);
  await expect.poll(()=>page.evaluate(async()=>(await getProductById('p-coffee')).selling_price)).toBe(55);
  expect(sent).toBe(1);expect(refreshed).toBe(1);
  expect(await page.evaluate(()=>CaptainMenuSync.last('branch-1').at)).toBeGreaterThan(before.at);
  expect(await page.evaluate(()=>getCartData())).toEqual([{id:'draft-line',name:'Agreed draft',quantity:2,price:35,selling_price:35}]);
});
test('failed menu refresh cannot resend an accepted order or advance the successful sync timestamp',async({page})=>{
  await ready(page);
  const before=await page.evaluate(()=>CaptainMenuSync.last('branch-1'));
  let sent=0,refreshed=0;
  await page.route('**/items/accessQr',async route=>{refreshed++;await route.abort();});
  await page.route('**/sales/qrOrder',async route=>{sent++;await route.fulfill({json:{type:'success',data:{items:[{item:'p-coffee',pricing:{version:1,selling_price:55}}]}}});});
  await send(page);
  await expect.poll(()=>refreshed).toBe(1);
  await page.evaluate(()=>POSNIC_ORDER_QUEUE_UI.flush(true));
  expect(sent).toBe(1);
  expect(await page.evaluate(()=>OrderQueue.count())).toBe(0);
  expect(await page.evaluate(()=>CaptainMenuSync.last('branch-1'))).toEqual(before);
  expect(await page.evaluate(async()=>(await getProductById('p-coffee')).selling_price)).toBe(40);
});
test('tax-exclusive unit differences do not cause a refresh when the agreed selling price matches',async({page})=>{
  await ready(page);
  let refreshed=0;
  await page.route('**/items/accessQr',async route=>{refreshed++;await route.fulfill({json:response(40)});});
  await page.route('**/sales/qrOrder',route=>route.fulfill({json:{type:'success',data:{items:[{item:'p-coffee',unit_price:38.1,pricing:{version:1,selling_price:40}}]}}}));
  await send(page);
  expect(await page.evaluate(()=>OrderQueue.count())).toBe(0);
  expect(refreshed).toBe(0);
});
test('a cache diagnostic throwing synchronously cannot turn an accepted order into a retry',async({page})=>{
  await ready(page);
  let sent=0;
  await page.route('**/sales/qrOrder',async route=>{sent++;await route.fulfill({json:{type:'success',data:{items:[{item:'p-coffee',pricing:{version:1,selling_price:55}}]}}});});
  await page.evaluate(()=>{CaptainMenuSync.refresh=()=>{throw new Error('Storage unavailable');};});
  await send(page);
  await page.evaluate(()=>POSNIC_ORDER_QUEUE_UI.flush(true));
  expect(await page.evaluate(()=>OrderQueue.count())).toBe(0);
  expect(sent).toBe(1);
});
test('an older server price refusal corrects and retries without staff action or a new order ID',async({page})=>{
  await ready(page);
  const sent=[];
  await page.route('**/items/accessQr',route=>route.fulfill({json:response(55)}));
  await page.route('**/sales/qrOrder',route=>{
    sent.push(route.request().postDataJSON());
    return route.fulfill({json:sent.length===1?{type:'error',message:'Coffee: price changed or does not match this selling channel. Refresh the menu before saving.'}:{type:'success',data:{order_id:'corrected'}}});
  });
  await send(page);
  await expect.poll(()=>page.evaluate(async()=>(await getProductById('p-coffee')).selling_price)).toBe(55);
  const rows=await page.evaluate(()=>OrderQueue.all());
  expect(rows).toHaveLength(0);
  expect(sent).toHaveLength(2);
  expect(sent.map(body=>body.idempotencyKey)).toEqual(['price-refresh-key','price-refresh-key']);
  expect(sent[1].items[0].item_price).toBe(55);
  await expect(page.locator('[data-needs-attention]')).toBeHidden();
});
test('concurrent refreshes share one request and a branch switch rejects the old response and timestamp',async({page})=>{
  await ready(page);
  let release,requested=0;
  const waiting=new Promise(resolve=>{release=resolve;});
  await page.route('**/items/accessQr',async route=>{requested++;await waiting;await route.fulfill({json:response(55)});});
  await page.evaluate(()=>{window.priceRefreshA=CaptainMenuSync.refresh('branch-1',{force:true});window.priceRefreshB=CaptainMenuSync.refresh('branch-1',{force:true});});
  await expect.poll(()=>requested).toBe(1);
  await page.evaluate(()=>localStorage.setItem('branch_id','other-branch'));
  release();
  expect(await page.evaluate(()=>priceRefreshA)).toBe(false);
  expect(await page.evaluate(()=>priceRefreshB)).toBe(false);
  expect(await page.evaluate(()=>CaptainMenuSync.last('other-branch'))).toBeNull();
  expect(await page.evaluate(async()=>(await getProductById('p-coffee')).selling_price)).toBe(40);
});

const priceError={type:'error',message:'Coffee: price changed or does not match this selling channel. Refresh the menu before saving.'};
test('a failed automatic price refresh stays in background and resumes without sending the outdated quote again',async({page})=>{
  await ready(page);
  const sent=[];let offline=true;
  await page.route('**/items/accessQr',route=>offline?route.abort():route.fulfill({json:response(55)}));
  await page.route('**/sales/qrOrder',route=>{
    sent.push(route.request().postDataJSON());
    return route.fulfill({json:sent.length===1?priceError:{type:'success',data:{order_id:'fixed'}}});
  });
  await send(page);
  let rows=await page.evaluate(()=>OrderQueue.all());
  expect(rows[0]).toMatchObject({state:'waiting',priceRecovery:true,body:{idempotencyKey:'price-refresh-key'}});
  await expect(page.locator('[data-needs-attention]')).toBeHidden();
  expect(sent).toHaveLength(1);
  offline=false;
  await page.evaluate(()=>POSNIC_ORDER_QUEUE_UI.flush(true));
  expect(sent.map(body=>body.items[0].item_price)).toEqual([40,55]);
  expect(await page.evaluate(()=>OrderQueue.count())).toBe(0);
});
test('continuous price changes get a bounded retry and never show a price-action prompt',async({page})=>{
  await ready(page);let sends=0;
  await page.route('**/items/accessQr',route=>route.fulfill({json:response(55)}));
  await page.route('**/sales/qrOrder',route=>{sends++;return route.fulfill({status:409,json:priceError});});
  await send(page);
  expect(sends).toBe(2);
  const rows=await page.evaluate(()=>OrderQueue.all());
  expect(rows[0]).toMatchObject({state:'waiting',priceRecovery:true,body:{idempotencyKey:'price-refresh-key'}});
  await expect(page.locator('[data-needs-attention]')).toBeHidden();
});
test('a lost send response never triggers repricing',async({page})=>{
  await ready(page);let refreshes=0;
  await page.route('**/items/accessQr',route=>{refreshes++;return route.fulfill({json:response(55)});});
  await page.route('**/sales/qrOrder',route=>route.abort());
  await send(page);
  const rows=await page.evaluate(()=>OrderQueue.all());
  expect(rows[0]).toMatchObject({state:'waiting',body:{idempotencyKey:'price-refresh-key',items:[{item_id:'p-coffee',item_name:'Coffee',item_quantity:1,item_price:40}]}});
  expect(rows[0].priceRecovery).not.toBe(true);
  expect(refreshes).toBe(0);
});
test('a correction must be stored before retrying the order',async({page})=>{
  await ready(page);let sends=0;
  await page.route('**/items/accessQr',route=>route.fulfill({json:response(55)}));
  await page.route('**/sales/qrOrder',route=>{sends++;return route.fulfill({status:422,json:priceError});});
  await page.evaluate(()=>{const original=OrderQueue.update;OrderQueue.update=(key,values)=>values.body?false:original(key,values);});
  await send(page);
  expect(sends).toBe(1);
  expect((await page.evaluate(()=>OrderQueue.all()))[0]).toMatchObject({state:'waiting',priceRecovery:true,body:{idempotencyKey:'price-refresh-key',items:[{item_id:'p-coffee',item_name:'Coffee',item_quantity:1,item_price:40}]}});
});

test('a real quick sale keeps its entered base price and tax through mixed-order correction and menu refresh',async({page})=>{
  await onTheMenu(page,'nothing',{menu:menu(40)});
  await page.route('**/items/instanceItemInsert',route=>route.fulfill({json:{type:'success',data:{id:'quick-custom',name:'Special plate',selling_price:275,tax:5,tax_type:'exclusive'}}}));
  await page.evaluate(async()=>{
    const quick=await POSNIC.quickSale.createOneOff('Special plate',275,{id:'gst5',name:'GST',rate:5,type:'exclusive'});
    await saveOne('products',[quick]);
    await updateQuantity(quick.id,1);
    await updateQuantity('p-coffee',1);
  });
  const sent=[];let entered;
  await page.route('**/items/accessQr',route=>route.fulfill({json:response(55)}));
  await page.route('**/sales/qrOrder',async route=>{
    sent.push(route.request().postDataJSON());
    if(sent.length===1) entered=await page.evaluate(()=>OrderQueue.all()[0].enteredPriceLines);
    await route.fulfill({json:sent.length===1?priceError:{type:'success',data:{order_id:'mixed-order'}}});
  });
  await page.goto('/cart.html');
  await page.waitForFunction(()=>typeof checkout==='function');
  await page.evaluate(()=>checkout('test'));
  await expect.poll(()=>sent.length).toBe(2);
  expect(entered).toContain('quick-custom');
  for(const body of sent) {
    expect(body.items.find(line=>line.item_id==='quick-custom')).toMatchObject({item_price:275,item_subtotal:275,gst:13.75});
    expect(body.enteredPriceLines).toBeUndefined();
  }
  expect(sent[1].items.find(line=>line.item_id==='p-coffee').item_price).toBe(55);
  expect(sent[1].idempotencyKey).toBe(sent[0].idempotencyKey);
  await expect.poll(()=>page.evaluate(()=>OrderQueue.count())).toBe(0);
  expect(await page.evaluate(async()=>(await getProductById('quick-custom')).selling_price)).toBe(275);
});

test('an older queued quick sale without recovery metadata remains at the entered price',async({page})=>{
  await ready(page);
  const sent=[];
  await page.route('**/items/accessQr',route=>route.fulfill({json:response(55)}));
  await page.route('**/sales/qrOrder',route=>{
    sent.push(route.request().postDataJSON());
    return route.fulfill({json:sent.length===1?priceError:{type:'success',data:{order_id:'legacy-mixed'}}});
  });
  await page.evaluate(async()=>{
    OrderQueue.add({key:'legacy-quick',branch:'branch-1',body:{idempotencyKey:'legacy-quick',branch:'branch-1',items:[
      {item_id:'p-coffee',item_price:40,item_quantity:1},
      {item_id:'old-quick-not-in-menu',item_price:199,item_quantity:2,item_subtotal:398,item_description:'Birthday plate'},
    ]}});
    await POSNIC_ORDER_QUEUE_UI.flush();
  });
  expect(sent).toHaveLength(2);
  expect(sent[1].items[1]).toEqual(sent[0].items[1]);
  expect(sent[1].items[0].item_price).toBe(55);
  expect(await page.evaluate(()=>OrderQueue.count())).toBe(0);
});

test('an entered market quote is preserved while a fixed menu line is corrected',async({page})=>{
  const market=item('market','Market fish',500,{open_price:true,price_mode:'open'});
  await onTheMenu(page,'nothing',{menu:[{category_name:'Food',items:[...menu(40)[0].items,market]}]});
  await page.evaluate(async()=>{await updateQuantity('market',1,{askedPrice:850});await updateQuantity('p-coffee',1);});
  const sent=[];let entered;
  await page.route('**/items/accessQr',route=>route.fulfill({json:{type:'success',data:{products:[{category_name:'Food',items:[...menu(55)[0].items,{...market,price:999}]}],kiosk_images:{},tableorders:[]}}}));
  await page.route('**/sales/qrOrder',async route=>{
    sent.push(route.request().postDataJSON());
    if(sent.length===1) entered=await page.evaluate(()=>OrderQueue.all()[0].enteredPriceLines);
    await route.fulfill({json:sent.length===1?priceError:{type:'success',data:{order_id:'market-order'}}});
  });
  await page.goto('/cart.html');await page.waitForFunction(()=>typeof checkout==='function');
  await page.evaluate(()=>checkout('test'));
  await expect.poll(()=>sent.length).toBe(2);
  expect(entered).toContain('market');
  expect(sent[1].items.find(line=>line.item_id==='market').item_price).toBe(850);
  expect(sent[1].items.find(line=>line.item_id==='p-coffee').item_price).toBe(55);
  expect(sent[1].idempotencyKey).toBe(sent[0].idempotencyKey);
});
