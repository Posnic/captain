import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
test('seating shows capacity and excludes tables that cannot hold the party',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>localStorage.setItem('kiosk_tableorders',JSON.stringify([
  {id:'small',tableorder_value:'T2',capacity:2,max_capacity:2,area:'Garden',shape:'round'},
  {id:'large',tableorder_value:'T6',capacity:4,max_capacity:6,area:'Main',shape:'rectangle'}
 ])));
 await page.goto('/discount.html');
 await expect(page.locator('label[for=table_T2]')).toBeVisible();
 await page.locator('label[for=table_T2]').click();
 for(let i=0;i<4;i++) await page.locator('#pax_more').click();
 await expect(page.locator('[name=table_no][value=T2]')).toBeDisabled();
 await expect(page.locator('[name=table_no][value=T2]')).not.toBeChecked();
 await expect(page.locator('[name=table_no][value=T6]')).toBeEnabled();
 await expect(page.locator('.table-seat-info').filter({hasText:'Garden'})).toContainText('Seat capacity: 2');
 await expect(page.locator('.table-seat-info').filter({hasText:'Main'})).toContainText('Maximum seats: 6');
});
