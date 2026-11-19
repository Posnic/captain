import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

test('takeaway shows the sum of menu parcel rates once beside the food total', async ({page}) => {
  const menu = [{category_name:'Lunch', items:[
    item('a','Dish A',100,{parcel_charge:5}), item('b','Dish B',50,{parcel_charge:2})
  ]}];
  await onTheMenu(page,'nothing',{menu});
  await page.evaluate(async () => {
    localStorage.setItem('orderType','Take away');
    await updateQuantity('a',1);
    await updateQuantity('b',1);
  });
  await page.goto('/cart.html');
  const parcel = page.locator('#bill-totals .bill-row').filter({hasText:'Parcel Charge'});
  await expect(parcel).toHaveCount(1);
  await expect(parcel).toContainText('7.00');
  await expect(page.locator('#bill-send-amount')).toContainText('157.00');
  await expect(page.locator('#cart-summary [data-bill="more"]')).toHaveCount(2);
});
