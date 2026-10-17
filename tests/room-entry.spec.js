import {test,expect} from '@playwright/test';
import {onTheMenu,item} from './support/shop.js';
test('room number and charge agreement survive Next without a table or guests',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[],roomVenues:[{code:'hotel',name:'Our hotel',room_charge:{enabled:true,name:'Room service',percent:5,taxed:false}}]}}));
 await page.goto('/discount.html');
 await page.locator('#room-option').click();
 await page.locator('#room-number').fill('35B');
 await page.screenshot({path:'test-artifacts/rooms-entry.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await expect(page).toHaveURL(/discount.html/);
 await expect(page.locator('#room-charge-accepted')).not.toBeChecked();
 await page.locator('#room-charge-accepted').check();
 await page.locator('.btn-next').click();
 await expect(page).toHaveURL(/products.html/);
 const saved=await page.evaluate(()=>({type:localStorage.getItem('orderType'),room:JSON.parse(localStorage.getItem('kiosk_room')),table:localStorage.getItem('kiosk_table_no')}));
 expect(saved.type).toBe('Room');expect(saved.room.unit).toBe('35B');expect(saved.room.accepted).toBe(true);expect(saved.table).toBe('Our hotel - 35B');
});
test('rooms remain hidden when the feature is not enabled',async({page})=>{
 await onTheMenu(page,'nothing');await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[],roomVenues:[]}}));
 await page.goto('/discount.html');await expect(page.locator('#room-option')).toBeHidden();
});

test('room checkout previews the charge and queues its reviewed rate with the room',async({page})=>{
 await onTheMenu(page,'nothing',{menu:[{category_name:'Meals',items:[item('meal','Meal',100)]}]});
 await page.evaluate(async()=>{
  await updateQuantity('meal',1);
  localStorage.setItem('orderType','Room');localStorage.setItem('kiosk_table_no','Hotel - 35B');
  localStorage.setItem('kiosk_room',JSON.stringify({venue:'hotel',unit:'35B',label:'Hotel - 35B',accepted:true,
   charge:{enabled:true,name:'Room service',percent:5,taxed:false},
   branch:localStorage.getItem('branch_id')||localStorage.getItem('kiosk_selected_branch'),shop:POSNIC.session.shopKey||''}));
 });
 await page.goto('/cart.html');
 await expect(page.locator('#bill-totals')).toContainText('Room service (5%)');
 const outcome=await page.evaluate(async()=>{
  OrderQueue.flush=async()=>{};
  const result=await checkout('room-check');
  return {result,body:OrderQueue.all()[0]?.body};
 });
 expect(outcome.result).toBe(true);expect(outcome.body.venue).toBe('hotel');expect(outcome.body.unit).toBe('35B');
 expect(outcome.body.room_charge_quote.percent).toBe(5);expect(outcome.body.room_charge_accepted).toBe(true);
});
