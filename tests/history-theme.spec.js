import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
for (const theme of ['dark', 'light']) for (const width of [360, 800]) {
 test(`history palette and loading ${theme} ${width}`, async ({page}) => {
  await page.setViewportSize({width,height:800});
  await onTheMenu(page,'nothing');
  await page.evaluate(theme=>localStorage.setItem('captain_appearance',theme),theme);
  let release;
  await page.route('**/sales/getOrderHistory',async r=>{
   await new Promise(resolve=>{release=resolve;});
   const status=r.request().postDataJSON().status;
   await r.fulfill({json:{type:'success',data:{orders:status==='pending'||status==='cancelled'?[]:[{_id:'dark-check',order_id:'135',table_number:'P1',person_count:2,status:'completed',total_amount:304.5,items:[{name:'Coffee',quantity:2,price:20}]}]}}});
  });
  await page.goto('/order-history.html');
  for (const status of ['all','pending','completed','cancelled']) {
   if(status!=='all') await page.locator(`[data-status="${status}"]`).click();
   await expect(page.locator('#history-request-state')).toContainText('Loading');
   await expect(page.locator('#empty-state')).toBeHidden();
   await expect.poll(()=>typeof release).toBe('function');
   release(); release=undefined;
   await expect(page.locator('#history-request-state')).toBeHidden();
   const ground=theme==='dark'?'rgb(20, 27, 39)':'rgb(255, 255, 255)';
   await expect(page.locator('#orders-list')).toHaveCSS('background-color',ground);
   if(status==='pending'||status==='cancelled') {
    await expect(page.locator('#empty-state')).toBeVisible();
    await expect(page.locator('#empty-state')).toHaveCSS('background-color',ground);
   } else {
    await expect(page.locator('.table-number')).toHaveCSS('background-color',theme==='dark'?'rgb(34, 45, 62)':'rgb(244, 247, 251)');
    await expect(page.locator('.order-info h5')).toHaveCSS('color',theme==='dark'?'rgb(238, 243, 250)':'rgb(23, 36, 58)');
   }
   await page.screenshot({path:`test-artifacts/history-${theme}-${width}-${status}.png`});
  }
 });
}

test('failed history request offers retry instead of an empty result', async ({page})=>{
 await onTheMenu(page,'nothing');
 let fail=true;
 await page.route('**/sales/getOrderHistory',r=>r.fulfill({json:fail?{type:'error',message:'Unavailable'}:{type:'success',data:{orders:[]}}}));
 await page.goto('/order-history.html');
 await expect(page.locator('#history-request-state button')).toHaveText('Retry');
 await expect(page.locator('#empty-state')).toBeHidden();
 fail=false;
 await page.locator('#history-request-state button').click();
 await expect(page.locator('#empty-state')).toBeVisible();
 await expect(page.locator('#history-request-state')).toBeHidden();
});

test('internet banner uses the selected theme',async ({page})=>{
 await onTheMenu(page,'nothing');
 await page.goto('/kot-management.html');
 const banner=page.locator('#captain-connection-status');
 await expect(banner).toBeVisible();
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>CaptainAppearance.set(theme),theme);
  await expect(banner).toHaveCSS('background-color',theme==='dark'?'rgb(34, 45, 62)':'rgb(244, 247, 251)');
  await expect(banner).toHaveCSS('color',theme==='dark'?'rgb(238, 243, 250)':'rgb(23, 36, 58)');
  await page.screenshot({path:`test-artifacts/connection-banner-${theme}.png`});
 }
});
