import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * SOMETHING THE MENU DOES NOT HAVE.
 *
 * Owner: "able to add item and price on demand. thats important."
 *
 * A bottle somebody brought in, a cake the kitchen agreed to plate, a sweet
 * that never got typed into the catalogue. A waiter meets these at the table,
 * and the only answer used to be walking to the till to ask somebody to add an
 * item first.
 *
 * NOT A NEW KIND OF LINE, which is the part worth holding. The till has done
 * this for years: it creates a real item marked INSTANT - the status that
 * keeps it off every menu - and sells it like any other. So this asks the till
 * for one and then adds it the ordinary way, and pricing, tax, the kitchen
 * ticket and the bill all work without knowing anything unusual happened.
 *
 * Offered at the moment somebody discovers the menu has not got it, because
 * that costs no room on a screen used forty times a service, and the name is
 * already typed.
 */

const MENU = [
  {
    category_name: 'Mains',
    items: [
      item('p-cb', 'Chicken Biryani', 220),
      /* The dish that blocked the owner: typing Fish finds THIS, so the
         search was never empty and nothing was ever offered. */
      item('p-fc', 'Fish Curry 1 bowl', 290),
    ],
  },
];

/** Search for something the shop does not sell. */
async function searchingForSomethingMissing(page, term = 'Water bottle') {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('#product-search-input').fill(term);
  await expect(page.locator('.menu-quick-sale-btn')).toBeVisible();
}

test('an empty search offers to add it, by the name just typed', async ({ page }) => {
  await searchingForSomethingMissing(page);

  await expect(page.locator('.menu-quick-sale-btn')).toContainText('Water bottle');
});

test('A SEARCH THAT FINDS SOMETHING ELSE STILL OFFERS IT', async ({ page }) => {
  /*
   * Owner, twice, the second time furious: "i cant add 'fish' coz already
   * fish briyani there and no way to add."
   *
   * This test used to assert the opposite - that a search with results offers
   * nothing - on the reasoning that a screen full of dishes should not invite
   * a duplicate. That covers the rare case and blocks the common one. Fish
   * finds Fish Curry, so the search is not empty, so nothing was ever
   * offered; and the + beside the box is a small circle he looked straight
   * past twice.
   *
   * Finding a dish whose name CONTAINS what was typed is not the same as the
   * menu having the thing somebody wants.
   */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('#product-search-input').fill('fish');

  await expect(page.locator('.dish[data-id="p-fc"]')).toBeVisible();
  await expect(page.locator('.menu-quick-sale-btn')).toBeVisible();
  await expect(page.locator('.menu-quick-sale-btn')).toContainText('fish');
});

test('and it comes after the results, not instead of them', async ({ page }) => {
  /* A waiter reads what the menu does have first. The offer is what is left
     when none of it was the thing. */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('#product-search-input').fill('fish');

  const dish = await page.locator('.dish[data-id="p-fc"]').boundingBox();
  const offer = await page.locator('.menu-quick-sale').boundingBox();
  expect(offer.y).toBeGreaterThan(dish.y);
});

test('THE NAME OF A DISH THAT IS ON THE MENU OFFERS NOTHING', async ({ page }) => {
  /*
   * The one thing the old reasoning had right. Typing the exact name of a
   * dish that exists and being offered a second one with that name is how a
   * menu grows duplicates nobody can tell apart on a bill.
   */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.locator('#product-search-input').fill('Chicken Biryani');

  await expect(page.locator('.dish[data-id="p-cb"]')).toBeVisible();
  await expect(page.locator('.menu-quick-sale-btn')).toHaveCount(0);
});

test('IT ASKS THE TILL FOR A REAL ITEM, in the till own words', async ({ page }) => {
  /*
   * The field names are the till's. This is its endpoint and its shape, and a
   * second vocabulary for one thing is how two sides drift.
   */
  await searchingForSomethingMissing(page);

  let sent = null;
  await page.route('**/items/instanceItemInsert', (route) => {
    sent = route.request().postDataJSON();
    route.fulfill({
      json: { type: 'success', data: { id: 'inst-1', name: 'Water bottle', selling_price: 20 } },
    });
  });

  await page.locator('.menu-quick-sale-btn').click();
  await page.locator('#ask-price-input').fill('20');
  await page.locator('#ask-price-ok, #ask-price-save, #ask-price-go').first().click();

  await expect.poll(() => sent).not.toBeNull();
  expect(sent.items_name).toBe('Water bottle');
  expect(Number(sent.items_selling_price)).toBe(20);
  expect(sent.items_quantity).toBe(1);
});

test('and then it is on the order like any other dish', async ({ page }) => {
  await searchingForSomethingMissing(page);

  await page.route('**/items/instanceItemInsert', (route) =>
    route.fulfill({
      json: { type: 'success', data: { id: 'inst-1', name: 'Water bottle', selling_price: 20 } },
    })
  );

  await page.locator('.menu-quick-sale-btn').click();
  await page.locator('#ask-price-input').fill('20');
  await page.locator('#ask-price-ok, #ask-price-save, #ask-price-go').first().click();

  const onTheOrder = await page.evaluate(async () => {
    for (let i = 0; i < 40; i += 1) {
      const cart = await getCartData();
      const line = cart.find((one) => one.id === 'inst-1');
      if (line) return { quantity: line.quantity, price: line.price, name: line.name };
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  });

  expect(onTheOrder).not.toBeNull();
  expect(onTheOrder.quantity).toBe(1);
  expect(onTheOrder.name).toBe('Water bottle');
});

test('backing out of the price adds nothing', async ({ page }) => {
  /* The same rule every other question here follows: changing your mind
     leaves the order exactly as it was. */
  await searchingForSomethingMissing(page);

  let asked = false;
  await page.route('**/items/instanceItemInsert', (route) => {
    asked = true;
    route.fulfill({ json: { type: 'success', data: { id: 'inst-1' } } });
  });

  await page.locator('.menu-quick-sale-btn').click();
  await expect(page.locator('#ask-price-scrim')).toBeVisible();
  await page.locator('#ask-price-cancel, #ask-price-back').first().click();

  await page.waitForTimeout(300);
  expect(asked).toBe(false);
});

test('a till that refuses says so, and nothing is added', async ({ page }) => {
  await searchingForSomethingMissing(page);

  await page.route('**/items/instanceItemInsert', (route) =>
    route.fulfill({ status: 400, json: { type: 'error', message: 'Branch context is required' } })
  );

  await page.locator('.menu-quick-sale-btn').click();
  await page.locator('#ask-price-input').fill('20');
  await page.locator('#ask-price-ok, #ask-price-save, #ask-price-go').first().click();

  const cart = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 600));
    return getCartData();
  });

  expect(cart.find((one) => one.id === 'inst-1')).toBeUndefined();
});
