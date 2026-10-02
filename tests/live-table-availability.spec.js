import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
test('live Cleaning and Held states override cached menu tables without blocking another available table',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>localStorage.setItem('kiosk_tableorders',JSON.stringify(['4','6','8'].map(n=>({id:n,tableorder_value:n,service_state:'available'})))));
 let cleaning=true;
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[{tableorder_value:'4',status:cleaning?'cleaning':'available'},{tableorder_value:'6',status:'available'},{tableorder_value:'8',status:'held'}]}}));
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:[],table_details:[]}}}));
 await page.goto('/discount.html');
 await expect(page.locator('input.table-radio[value="4"]')).toBeDisabled();
 await expect(page.locator('input.table-radio[value="8"]')).toBeDisabled();
 await expect(page.locator('input.table-radio[value="6"]')).toBeEnabled();
 cleaning=false;
 await page.evaluate(()=>loadTablesFromTableorders(true));
 await expect(page.locator('input.table-radio[value="4"]')).toBeEnabled();
});
