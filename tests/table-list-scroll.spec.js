import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for(const [width,height] of [[390,640],[768,1024]]) test(`all tables scroll above navigation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height});await onTheMenu(page,'nothing');
 const tables=Array.from({length:40},(_,i)=>({id:String(i+1),tableorder_value:String(i+1),capacity:4,shape:'square',status:'available',orders:[]}));
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables}}));
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[],table_details:[],has_takeaway:false}}}));
 await page.goto('/kot-management.html');await page.locator('[data-floor-filter=all]').click();
 await expect(page.locator('.floor-card')).toHaveCount(40);
 await page.locator('.floor-card').last().scrollIntoViewIfNeeded();
 const result=await page.locator('.floor-card').last().evaluate(el=>{const r=el.getBoundingClientRect(),nav=document.querySelector('.captain-navigation').getBoundingClientRect();return {bottom:r.bottom,top:r.top,navTop:nav.top,scroll:document.scrollingElement.scrollHeight,viewport:innerHeight};});
 expect(result.scroll).toBeGreaterThan(result.viewport);expect(result.top).toBeGreaterThanOrEqual(0);expect(result.bottom).toBeLessThanOrEqual(result.navTop);
 await page.screenshot({path:`artifacts/table-scroll-${width}.png`});
});
