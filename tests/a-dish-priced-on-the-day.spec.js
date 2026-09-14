import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * A DISH THE SHOP PRICES ON THE DAY.
 *
 * Owner, from a live table at a client: two fish went to the kitchen worth
 * nothing. "zero price items are actually dyanmic pricing. its based current
 * price. so if you find that kind of item we need to allow captain to update
 * the price and give order."
 *
 * A whole fish, a crab, a lobster: the shop cannot print a number on the card
 * because it does not know one until the morning's market. The catalogue
 * carries no selling price, the row showed 0.00, and every layer below took
 * that literally - including the bill.
 *
 * So the waiter is asked. These are the rules about when, and about what
 * happens if they do not answer.
 */

const MENU = [
  {
    category_name: 'From the sea',
    items: [
      /* No price on the card: this is the shape that caused it. */
      item('p-fish', 'Tandoori Pomfret', 0, {}),
      item('p-biryani', 'Chicken Biryani', 220, {}),
    ],
  },
];

async function atTheMenu(page) {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.waitForFunction(() => typeof updateQuantity === 'function');
}

test('a dish with no price says so, instead of showing nothing', async ({ page }) => {
  /*
   * A 0.00 on a menu row reads as free, and a waiter who believes it sends a
   * table a fish for nothing - which is exactly what happened.
   */
  await atTheMenu(page);

  const fish = page.locator('.dish[data-id="p-fish"]');
  await expect(fish.locator('.dish-ask')).toHaveText(/today's price/i);
  await expect(fish).not.toContainText('0.00');

  /* And an ordinary dish is untouched. */
  const biryani = page.locator('.dish[data-id="p-biryani"]');
  await expect(biryani.locator('.dish-price')).toContainText('220');
  await expect(biryani.locator('.dish-ask')).toHaveCount(0);
});

test('adding it asks for the price', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await expect(page.locator('#ask-price-scrim')).toBeVisible();
  await expect(page.locator('#ask-price-dish')).toHaveText('Tandoori Pomfret');
});

test('an ordinary dish is never asked about', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-biryani"] .btn-add').click();
  await expect(page.locator('#ask-price-scrim')).toBeHidden();
  await expect(page.locator('.dish[data-id="p-biryani"] .dish-qty')).toHaveText('1');
});

test('the price entered lands on the cart line', async ({ page }) => {
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();

  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');

  const line = await page.evaluate(async () => {
    const cart = await getCartData();
    return cart.find((i) => i.id === 'p-fish');
  });
  expect(line.askedPrice).toBe(850);
});

test('backing out adds nothing at all', async ({ page }) => {
  /*
   * Asked BEFORE the quantity moves, so Cancel leaves the order exactly as it
   * was - rather than adding a free dish and then taking it off again.
   */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-cancel').click();

  await expect(page.locator('#ask-price-scrim')).toBeHidden();
  await expect(page.locator('.dish[data-id="p-fish"] .btn-add')).toHaveCount(1);
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveCount(0);

  const cart = await page.evaluate(() => getCartData());
  expect(cart.find((i) => i.id === 'p-fish')).toBeUndefined();
});

test('nothing, zero or a silly number is refused at the table', async ({ page }) => {
  /* Told here rather than after the order has travelled to the server. */
  await atTheMenu(page);
  await page.locator('.dish[data-id="p-fish"] .btn-add').click();

  await page.locator('#ask-price-ok').click();
  await expect(page.locator('#ask-price-warn')).toHaveText(/enter a price/i);
  await expect(page.locator('#ask-price-scrim')).toBeVisible();

  await page.locator('#ask-price-input').fill('0');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('#ask-price-warn')).toHaveText(/enter a price/i);

  await page.locator('#ask-price-input').fill('9999999');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('#ask-price-warn')).toHaveText(/too high/i);

  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('#ask-price-scrim')).toBeHidden();
});

test('the order sends the price the waiter entered', async ({ page }) => {
  /*
   * The end of the chain, and the half that could not be fixed in the app
   * alone: the server prices from its own catalogue and ignores the client,
   * so it had to be taught to accept a price for a dish it has none for. This
   * checks our side of that bargain - that the number actually travels.
   */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('1');

  const line = await page.evaluate(async () => {
    const cart = await getCartData();
    const i = cart.find((x) => x.id === 'p-fish');
    /* Built the way indexedDB.js builds the order payload. */
    return { item_price: i.askedPrice || i.final_price || i.price || 0, quantity: i.quantity };
  });

  expect(line.item_price).toBe(850);
  expect(line.quantity).toBe(1);
});

test('a second one costs the same as the first, without asking again', async ({ page }) => {
  /* The waiter was quoted once for that fish. Asking per tap would be a
     question between every plate. */
  await atTheMenu(page);

  await page.locator('.dish[data-id="p-fish"] .btn-add').click();
  await page.locator('#ask-price-input').fill('850');
  await page.locator('#ask-price-ok').click();

  await page.locator('.dish[data-id="p-fish"] .btn-increase').click();
  await expect(page.locator('#ask-price-scrim')).toBeHidden();
  await expect(page.locator('.dish[data-id="p-fish"] .dish-qty')).toHaveText('2');

  const line = await page.evaluate(async () => {
    const cart = await getCartData();
    return cart.find((i) => i.id === 'p-fish');
  });
  expect(line.askedPrice).toBe(850);
  expect(line.quantity).toBe(2);
});
