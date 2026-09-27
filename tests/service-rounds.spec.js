import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for (const size of [{width:800,height:1280},{width:1280,height:800},{width:390,height:844}]) {
 test(`order rounds use the screen and serve partial quantities ${size.width}`,async({page})=>{
  await page.setViewportSize(size);await onTheMenu(page,'nothing');
  const rounds=[{id:'c0',ordered_at:'2026-09-27T08:00:00Z',items:Array.from({length:12},(_,i)=>({id:`c0i${i}`,name:`Dish ${i+1}`,note:i===2?'Less salt':'',quantity:3,served:0,remaining:3}))},
    {id:'c1',ordered_at:'2026-09-27T08:25:00Z',items:[{id:'c1i0',name:'New soup',quantity:1,served:0,remaining:1}]}];
  await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['1']}}}));
  await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[{_id:'sale1',items:[],kitchen_rounds:rounds,created_date:{$date:'2026-09-27T08:00:00Z'}}]}}}));
  let sent;
  await page.route('**/sales/serveKitchenItems',r=>{sent=r.request().postDataJSON();rounds[0].items[0].served=1;rounds[0].items[0].remaining=2;return r.fulfill({json:{type:'success',data:rounds}});});
  await page.goto('/kot-management.html');await page.locator('.floor-card').first().click();
  await expect(page.locator('.service-round')).toHaveCount(2);
  const dimensions=await page.locator('.kot-items-list').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
  expect(dimensions.height).toBeGreaterThan(300);expect(dimensions.height).toBe(dimensions.scroll);
  await page.locator('.service-action input').first().fill('1');
  await page.locator('[data-serve-line="c0i0"]').click();
  await expect(page.locator('.service-result')).toHaveText('Items marked served');
  expect(sent.items).toEqual([{id:'c0i0',quantity:1}]);
  await expect(page.locator('.service-line').first()).toContainText('1 / 3');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-artifacts/service-rounds-${size.width}.png`});
 });
}
