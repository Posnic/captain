import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
test('tableless orders remain separate and open by sale ID',async({page})=>{
 await onTheMenu(page,'nothing');const ids=['507f1f77bcf86cd799439011','507f1f77bcf86cd799439012'],seen=[];
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[],has_takeaway:false,unassigned_orders:ids.map((id,i)=>({sale_id:id,number:String(i+1),payment_status:'Unpaid'}))}}}));
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[]}}));
 await page.route('**/captain/v1/kitchen-ready',r=>r.fulfill({json:{tickets:[],readiness:[]}}));
 await page.route('**/sales/getListKot?*',r=>{const f=JSON.parse(new URL(r.request().url()).searchParams.get('filters'));seen.push(f);return r.fulfill({json:{type:'success',data:{list:[{_id:f._id,payment_status:'Unpaid',items:[],sales_total:0}]}}});});
 await page.goto('/kot-management.html');
 await expect(page.locator('.floor-card[data-sale-id]')).toHaveCount(2);
 await page.locator('.floor-card[data-sale-id]').first().click();
 await expect.poll(()=>seen.some(f=>f._id===ids[0]&&!('table_number' in f))).toBe(true);
 await expect(page.locator('#panel-title')).toContainText('No table');
});
