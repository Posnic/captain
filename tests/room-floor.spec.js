import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
for (const theme of ['light','dark']) test(`room floor identity ${theme}`,async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(t=>{localStorage.setItem('posnic-theme',t);document.documentElement.setAttribute('data-theme',t);},theme);
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['SA - 56','T2'],table_details:[{table_number:'SA - 56',dine_type:'Room',room_number:'56',venue_name:'SA',orders:1,item_count:4},{table_number:'T2',dine_type:'Dine-in',orders:1,item_count:2}]}}}));
 await page.goto('/kot-management.html');
 await page.evaluate(t=>document.documentElement.setAttribute('data-color-scheme',t),theme);
 const room=page.locator('.floor-card.is-room');
 await expect(room).toBeVisible();
 await expect(room.locator('.floor-card-label')).toHaveText('Room 56SA');
 await expect(room.locator('.floor-card-label small')).toHaveText('SA');
 await expect(room.locator('.room-type-icon')).toBeVisible();
 await expect(room).not.toContainText('Table');
 await expect(page.locator('.floor-card:not(.is-room)')).toContainText('Table T2');
 expect(await room.locator('.room-heading').evaluate(e=>getComputedStyle(e).color)).toBe(theme==='dark'?'rgb(153, 184, 255)':'rgb(36, 89, 222)');
 expect(await room.locator('.room-heading').evaluate(e=>getComputedStyle(e).borderTopStyle)).toBe('double');
 await page.screenshot({path:`test-artifacts/room-floor-${theme}.png`,fullPage:true});
});
