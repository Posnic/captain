import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

const menu = [{ category_name: 'Food', items: [
  item('mushroom', 'Mushroom Manchurian', 150),
  item('baby-corn', 'Baby Corn Starter', 120),
  item('soup', 'Sweet Corn Soup', 90),
] }];

test('concurrent adds and a note keep every dish and the correct note', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  const cart = await page.evaluate(async () => {
    await Promise.all([
      updateQuantity('mushroom', 1),
      updateQuantity('baby-corn', 1),
      updateQuantity('soup', 2),
      setCartItemNotes('baby-corn', 'Salt & pepper'),
    ]);
    return getCartData();
  });
  expect(cart.map(i => i.id).sort()).toEqual(['baby-corn', 'mushroom', 'soup']);
  expect(cart.find(i => i.id === 'baby-corn')).toMatchObject({ quantity: 1, notes: 'Salt & pepper' });
  expect(cart.find(i => i.id === 'mushroom')).toMatchObject({ quantity: 1, name: 'Mushroom Manchurian' });
  expect(cart.find(i => i.id === 'mushroom').notes || '').toBe('');
  expect(cart.find(i => i.id === 'soup').quantity).toBe(2);
});

test('a pending note save cannot add a different dish opened afterwards', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  await page.evaluate(() => {
    const original = setCartItemNotes;
    window.setCartItemNotes = async (...args) => {
      await new Promise(resolve => { window.releaseNote = resolve; });
      return original(...args);
    };
    $('.dish[data-id="baby-corn"]').trigger('click');
    $('#product-notes-text').val('Salt & pepper');
    $('#notes-apply-btn').trigger('click');
    // Let the tracked click capture the original editor before switching.
  });
  await page.waitForFunction(() => typeof window.releaseNote === 'function');
  await page.evaluate(() => {
    $('#notes-cancel-btn').trigger('click');
    $('.dish[data-id="mushroom"]').trigger('click');
    window.releaseNote();
  });
  await expect.poll(() => page.evaluate(async () => (await getCartData()).find(i => i.id === 'baby-corn')?.quantity)).toBe(1);
  expect(await page.evaluate(async () => (await getCartData()).some(i => i.id === 'mushroom'))).toBe(false);
  await expect(page.locator('#product-notes-modal')).toBeVisible();
});


test('View bill waits for the last Add tap to be saved', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  await page.evaluate(() => {
    const original = getProductById;
    window.getProductById = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 180));
      return original(...args);
    };
    $('.btn-add[data-id="mushroom"]').trigger('click');
    goToBill();
  });
  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.locator('#cart-item-mushroom')).toContainText('Mushroom Manchurian');
});


test('a delayed cart note updates only baby corn, even after another editor opens', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  await page.evaluate(async () => {
    await updateQuantity('mushroom', 1);
    await updateQuantity('baby-corn', 1);
  });
  await page.goto('/cart.html');
  await expect(page.locator('#cart-item-baby-corn')).toBeVisible();
  await page.evaluate(() => {
    const original = setCartItemNotes;
    window.setCartItemNotes = async (...args) => {
      await new Promise(resolve => { window.releaseNote = resolve; });
      return original(...args);
    };
    $('#cart-item-baby-corn .bill-body').trigger('click');
    $('#cart-notes-text').val('Salt & pepper');
    $('#cart-notes-save-btn').trigger('click');
  });
  await page.waitForFunction(() => typeof window.releaseNote === 'function');
  await page.evaluate(() => {
    $('#cart-notes-cancel-btn').trigger('click');
    $('#cart-item-mushroom .bill-body').trigger('click');
    window.releaseNote();
  });
  await expect(page.locator('#cart-item-baby-corn .bill-note')).toHaveText('Salt & pepper');
  await expect(page.locator('#cart-item-mushroom .bill-note')).toHaveCount(0);
  await expect(page.locator('#cart-notes-modal')).toBeVisible();
  await expect(page.locator('#cart-notes-product-name')).toHaveText('Mushroom Manchurian');
});

test('the kitchen payload keeps all dishes and notes on their own item IDs', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu });
  const payload = await page.evaluate(async () => {
    // Stop before navigation/delivery; inspect exactly what the durable queue receives.
    OrderQueue.add = entry => { window.sentBody = entry.body; return false; };
    updateQuantity('mushroom', 1);
    updateQuantity('baby-corn', 1);
    updateQuantity('soup', 2);
    setCartItemNotes('baby-corn', 'Salt & pepper');
    await checkout('regression');
    return window.sentBody.items;
  });
  expect(payload).toHaveLength(3);
  expect(payload.find(i => i.item_id === 'baby-corn')).toMatchObject({ item_quantity: 1, item_description: 'Salt & pepper' });
  expect(payload.find(i => i.item_id === 'mushroom')).toMatchObject({ item_quantity: 1, item_name: 'Mushroom Manchurian', item_description: '' });
  expect(payload.find(i => i.item_id === 'soup').item_quantity).toBe(2);
});
