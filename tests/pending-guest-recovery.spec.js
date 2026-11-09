import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

async function refusedGuestOrder(page) {
  await onTheMenu(page, 'nothing');
  await page.goto('/kot-management.html');
  await page.waitForFunction(() => window.POSNIC_ORDER_QUEUE_UI && POSNIC.session.active);
  await page.evaluate(() => {
    OrderQueue.add({key:'guest-recovery-key',branch:'branch-1',body:{idempotencyKey:'guest-recovery-key',branch:'branch-1',kiosk_table_no:'8A',person_count:0,items:[{item_id:'p-dosa',item_name:'Dynamite Prawn',item_quantity:1,item_price:100}]}});
    OrderQueue.update('guest-recovery-key',{state:'attention',message:'Enter the number of guests.'});
  });
  await page.goto('/pending.html');
}

test('missing pax can be corrected without re-entering dishes or changing the request ID',async({page})=>{
  const sent=[];
  await refusedGuestOrder(page);
  await page.route('**/sales/qrOrder',async route=>{sent.push(route.request().postDataJSON());await route.fulfill({json:{type:'success',data:{order_id:'guest-recovered'}}});});
  const guests=page.getByRole('spinbutton',{name:'How many guests?'});
  await expect(guests).toBeVisible();
  await page.getByRole('button',{name:'Retry this order',exact:true}).click();
  expect(sent).toHaveLength(0);
  await guests.fill('0');await page.getByRole('button',{name:'Retry this order',exact:true}).click();expect(sent).toHaveLength(0);
  await guests.fill('2');
  await page.evaluate(()=>window.dispatchEvent(new Event('posnic:online')));
  await expect(guests).toHaveValue('2');
  await page.getByRole('button',{name:'Retry this order',exact:true}).click();
  await expect.poll(()=>sent.length).toBe(1);
  expect(sent[0]).toMatchObject({idempotencyKey:'guest-recovery-key',person_count:2,items:[{item_id:'p-dosa',item_name:'Dynamite Prawn',item_quantity:1,item_price:100}]});
  await expect(page.getByText('All orders sent',{exact:true})).toBeVisible();
});

test('guest correction storage failure sends nothing and keeps the original order',async({page})=>{
  const sent=[];
  await refusedGuestOrder(page);
  await page.route('**/sales/qrOrder',async route=>{sent.push(route.request().postDataJSON());await route.abort('failed');});
  await page.getByRole('spinbutton',{name:'How many guests?'}).fill('3');
  await page.evaluate(()=>{OrderQueue.update=()=>false;});
  await page.getByRole('button',{name:'Retry this order',exact:true}).click();
  await expect(page.getByText('Could not finish saving this order. Keep the app data and retry.',{exact:true})).toBeVisible();
  expect(sent).toHaveLength(0);
  expect(await page.evaluate(()=>OrderQueue.all()[0].body.person_count)).toBe(0);
});

test('corrected guest count remains durable after an uncertain send',async({page})=>{
 const sent=[];await refusedGuestOrder(page);
 await page.route('**/sales/qrOrder',async route=>{sent.push(route.request().postDataJSON());await route.abort('failed');});
 await page.getByRole('spinbutton',{name:'How many guests?'}).fill('2');
 await page.getByRole('button',{name:'Retry this order',exact:true}).click();
 await expect.poll(()=>sent.length).toBeGreaterThan(0);
 const saved=await page.evaluate(()=>OrderQueue.all()[0]);
 expect(saved.key).toBe('guest-recovery-key');expect(saved.body.person_count).toBe(2);
 expect(saved.body.items).toHaveLength(1);
});
