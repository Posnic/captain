import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * ADDING TO AN ORDER, FROM THE MENU ITSELF.
 *
 * Owner, relaying a client: "for adding within that screen so conjested.
 * adding new item should have button like add item and same as first scree
 * menu item list other so many stuff should neatly available."
 *
 * The modify screen offered a text box and a list of names, squeezed into half
 * a column beside the order, the discount fields, the dine type, the table and
 * the cover count - on a phone. This checks the replacement is the REAL menu
 * and not a smaller copy of one, because a copy drifts from the original the
 * week after it is written.
 */

const MENU = [
  {
    category_name: 'Biryani',
    items: [
      item('p-1', 'Chicken Biryani', 220, { diet: 'non-veg' }),
      item('p-2', 'Mutton Biryani', 320, { diet: 'non-veg' }),
    ],
  },
  {
    category_name: 'Drinks',
    items: [item('p-3', 'Coffee', 40, { diet: 'veg' })],
  },
];

/** On the order history screen, with the menu cached the way a shift leaves it. */
async function atTheHistory(page) {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof openItemPicker === 'function');
}

test('the picker draws the real menu, with its sections', async ({ page }) => {
  await atTheHistory(page);

  await page.evaluate(() => openItemPicker());
  const picker = page.locator('#item-picker');
  await expect(picker).toBeVisible();

  /* Sections and a rail - the menu screen's own furniture, from MenuView. */
  await expect(picker.locator('.menu-section')).toHaveCount(2);
  await expect(picker.locator('.dish')).toHaveCount(3);
  await expect(picker.locator('#item-picker-rail .menu-chip')).toHaveCount(2);
});

test('a dish shows its price, not just its name', async ({ page }) => {
  /* The whole complaint: a list of names is not a menu. */
  await atTheHistory(page);
  await page.evaluate(() => openItemPicker());

  const row = page.locator('#item-picker .dish[data-id="p-1"]');
  await expect(row).toContainText('Chicken Biryani');
  await expect(row.locator('.dish-price')).toContainText('220');
});

test('tapping ADD hands the dish to the order being modified', async ({ page }) => {
  /*
   * Spied rather than read off editingOrder, and that is not laziness.
   * `let editingOrder` is a SCRIPT-SCOPED binding, so it shadows
   * window.editingOrder and a test cannot seed it from outside - the first
   * draft of this file tried and silently asserted against an object the app
   * never looked at. A function DECLARATION does live on window, so the call
   * itself can be watched, and the call is the picker's half of the contract.
   */
  await atTheHistory(page);
  await page.evaluate(() => {
    window.__added = [];
    window.addProductToOrder = (id, name, price) => window.__added.push({ id, name, price });
  });

  await page.evaluate(() => openItemPicker());
  await page.locator('#item-picker .btn-add[data-id="p-1"]').click();

  expect(await page.evaluate(() => window.__added)).toEqual([
    { id: 'p-1', name: 'Chicken Biryani', price: 220 },
  ]);
});

test('it is named from the menu it drew, not from the search box', async ({ page }) => {
  /*
   * THE BUG THIS CAUGHT WHILE BEING WRITTEN. The obvious helper,
   * addProductToOrderById, reads a map that only the SEARCH box fills in.
   * Nothing in the picker fills it, so routing through it would have logged
   * "Product not found" to a console nobody reads and added nothing - under a
   * row that said "Added".
   */
  await atTheHistory(page);
  await page.evaluate(() => {
    window.__added = [];
    window.addProductToOrder = (id, name, price) => window.__added.push({ id, name, price });
    window.searchedProducts = {}; // deliberately empty, as it is in real use
  });

  await page.evaluate(() => openItemPicker());
  await page.locator('#item-picker .btn-add[data-id="p-2"]').click();

  const added = await page.evaluate(() => window.__added[0]);
  expect(added && added.name).toBe('Mutton Biryani');
  expect(Number(added && added.price)).toBe(320);
});

test('nothing is sent to the till from inside the picker', async ({ page }) => {
  /*
   * Adding is a choice; committing is a separate decision. "Update the order"
   * on the screen behind is still the only thing that talks to the till, so a
   * waiter can put three dishes in, change their mind and leave.
   */
  const posted = [];
  await page.route('**/sales/updateOrder', (route) => {
    posted.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await atTheHistory(page);
  await page.evaluate(() => {
    window.editingOrder = { items: [], total_amount: '0.00' };
  });
  await page.evaluate(() => openItemPicker());
  await page.locator('#item-picker .btn-add[data-id="p-1"]').click();
  await page.locator('#item-picker-done').click();

  await expect(page.locator('#item-picker')).toBeHidden();
  expect(posted, 'the picker saved the order by itself').toEqual([]);
});

test('the form underneath cannot scroll while the menu is up', async ({ page }) => {
  /* Two scrolling things stacked is how a thumb ends up moving the wrong one. */
  await atTheHistory(page);
  await page.evaluate(() => openItemPicker());

  const locked = await page.evaluate(() => getComputedStyle(document.body).overflow);
  expect(locked).toBe('hidden');

  await page.locator('#item-picker-close').click();
  const freed = await page.evaluate(() => getComputedStyle(document.body).overflow);
  expect(freed).not.toBe('hidden');
});
