import {test,expect} from '@playwright/test';
import {onTheMenu,item} from './support/shop.js';
test('serving labels survive caching, update with branch time and never hide the menu',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-09-30T03:00:00Z'));
 await onTheMenu(page,'nothing',{menu:[{category_name:'Food',items:[item('p-breakfast','Breakfast plate',100,{serving_time_zone:'Asia/Kolkata',serving_periods:[{name:'Breakfast',hours:{wed:[{open:420,close:660}]}}]}),item('p-all','All day plate',50)]}]});
 await expect(page.locator('.dish-serving.is-current')).toContainText('Breakfast');
 await expect(page.locator('.dish-serving.is-current')).toContainText('Available');
 await expect(page.locator('.dish')).toHaveCount(2);
 await page.clock.setFixedTime(new Date('2026-09-30T05:30:00Z'));
 await page.evaluate(()=>ServingPeriods.refresh());
 await expect(page.locator('.dish-serving.is-current')).toHaveCount(0);
 await expect(page.locator('.dish')).toHaveCount(2);
 await expect(page.locator('[data-id="p-breakfast"] .btn-add')).toBeEnabled();
 await page.reload();
 await expect(page.locator('.dish-serving')).toContainText('Breakfast');
 await expect(page.locator('.dish-serving.is-current')).toHaveCount(0);
});
