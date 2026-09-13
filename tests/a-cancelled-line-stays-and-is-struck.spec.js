import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * CANCELLING A DISH LEAVES A STRUCK LINE, NOT A GAP.
 *
 * Owner, after installing it: "strick not working. i see text without any
 * strick. may be exe print takes from something or its coz of esc/pos?"
 *
 * Neither. `confirmRemoveItem` ran `items.splice(index, 1)`, so the line
 * stopped existing - the rule that strikes cancelled lines was correct and had
 * nothing to be correct about. The unit tests passed because they asked the
 * rule about an object, and nothing asked what the screen did after a real
 * cancellation.
 *
 * So this cancels one the way a waiter does - the trash button, then the
 * confirmation - and looks at what is left.
 */

const MENU = [
  {
    category_name: 'Biryani',
    items: [item('p-1', 'Chicken Biryani', 220, {}), item('p-2', 'Mutton Biryani', 320, {})],
  },
];

/** A live order with two dishes the kitchen already knows about. */
async function anOrderBeingModified(page) {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof renderCurrentOrderItems === 'function');

  await page.evaluate(() => {
    /* `_id` on a line is what says the kitchen was told: a dish added in this
       session has none, and is simply removed rather than struck. */
    const order = {
      items: [
        { _id: 'l-1', product_id: 'p-1', name: 'Chicken Biryani', price: 220, selling_price: 220, quantity: 2 },
        { _id: 'l-2', product_id: 'p-2', name: 'Mutton Biryani', price: 320, selling_price: 320, quantity: 1 },
      ],
      total_amount: 760,
      person_count: 2,
    };
    /* Through the app's own way in, so the modify flow really holds it - a
       stubbed accessor would leave renderCurrentOrderItems reading the script
       binding and drawing nothing. */
    window.setOrderBeingModified(order);
    window.__order = order;
    new window.bootstrap.Modal(document.getElementById('editOrderModal')).show();
  });
}

/** Cancel the nth line the way the screen does: trash, then confirm. */
async function cancel(page, index) {
  await page.evaluate((i) => removeItem(i), index);
  await page.locator('#removeItemConfirmModal').waitFor({ state: 'visible' });
  await page.evaluate(() => confirmRemoveItem());
}

test('a cancelled dish is still on the screen, with a rule through its name', async ({ page }) => {
  await anOrderBeingModified(page);
  await page.evaluate(() => renderCurrentOrderItems());
  await expect(page.locator('#current-order-items .order-item-card')).toHaveCount(2);

  await cancel(page, 0);

  /* Still two lines: the cancelled one did not vanish. */
  const cards = page.locator('#current-order-items .order-item-card');
  await expect(cards).toHaveCount(2);

  const struck = page.locator('#current-order-items .order-item-card.is-cancelled');
  await expect(struck).toHaveCount(1);
  await expect(struck).toContainText('Chicken Biryani');
});

test('the rule is really drawn, not just a class name', async ({ page }) => {
  /*
   * The class could be right and the stylesheet missing, which is the same
   * thing as far as anybody looking at the screen is concerned.
   */
  await anOrderBeingModified(page);
  await page.evaluate(() => renderCurrentOrderItems());
  await cancel(page, 0);

  const decoration = await page
    .locator('#current-order-items .order-item-card.is-cancelled .line-name')
    .evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoration).toContain('line-through');
});

test('the dish beside it is untouched', async ({ page }) => {
  await anOrderBeingModified(page);
  await page.evaluate(() => renderCurrentOrderItems());
  await cancel(page, 0);

  const live = page.locator('#current-order-items .order-item-card:not(.is-cancelled)');
  await expect(live).toHaveCount(1);
  await expect(live).toContainText('Mutton Biryani');
  const decoration = await live
    .locator('.line-name')
    .evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoration).not.toContain('line-through');
});

test('a cancelled line carries no counter to argue with', async ({ page }) => {
  /* A minus that cannot go lower and a plus that would quietly un-cancel it
     are two ways to be confusing. */
  await anOrderBeingModified(page);
  await page.evaluate(() => renderCurrentOrderItems());
  await cancel(page, 0);

  const struck = page.locator('#current-order-items .order-item-card.is-cancelled');
  await expect(struck.locator('.qty-btn')).toHaveCount(0);
  await expect(struck.locator('.item-cancelled-mark')).toContainText(/cancelled/i);
});

test('a cancelled dish cannot be charged for', async ({ page }) => {
  /*
   * The whole reason it is safe to keep the line. Quantity 0, and the payload
   * drops zero-quantity lines before they reach the till.
   */
  await anOrderBeingModified(page);
  await page.evaluate(() => renderCurrentOrderItems());
  await cancel(page, 0);

  const quantity = await page.evaluate(
    () => window.__order.items.find((i) => i._id === 'l-1').quantity
  );
  expect(quantity).toBe(0);

  const billed = await page.evaluate(() =>
    window.__order.items.filter((i) => parseFloat(i.quantity || 0) > 0).map((i) => i.name)
  );
  expect(billed).toEqual(['Mutton Biryani']);
});

test('a dish added in this session is removed, not struck', async ({ page }) => {
  /*
   * Nobody cooked it and nobody was told about it, so there is nothing to
   * symbolise. Leaving a struck line for something that was never ordered
   * would read as a cancellation that never happened.
   */
  await anOrderBeingModified(page);
  await page.evaluate(() => {
    window.__order.items.push({
      product_id: 'p-2',
      name: 'Just Added',
      price: 50,
      selling_price: 50,
      quantity: 1,
    });
    renderCurrentOrderItems();
  });
  await expect(page.locator('#current-order-items .order-item-card')).toHaveCount(3);

  await cancel(page, 2);

  await expect(page.locator('#current-order-items .order-item-card')).toHaveCount(2);
  await expect(page.locator('#current-order-items')).not.toContainText('Just Added');
});
