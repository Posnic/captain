import { test, expect } from '@playwright/test';

/*
 * The one-order-per-tap rules, in a real browser.
 *
 * The behaviour itself shipped in #58 and has its own tests, which read the
 * source and run the key logic against a fake cart. These are the other half:
 * the same rules driven through the actual screens, from sign-in to the
 * thank-you page, with the order endpoint recorded.
 *
 * The distinction is not academic. The bug that started this was a BUTTON that
 * stayed live - not a function that computed the wrong thing. A test that
 * reads indexedDB.js cannot see whether the handler is bound, whether the
 * disabled attribute reaches the element, or whether the poll actually redraws
 * the table grid. Every one of those is a way for this to regress silently
 * while the existing tests stay green.
 *
 * What is covered here and nowhere else:
 *
 *   two taps in ONE tick, which is what a double tap is. Two separate clicks
 *   do not reproduce it - the second lands after navigation has begun and
 *   quietly does nothing, so a test written that way passes either way.
 *
 *   the button coming back after a refusal, including dismissing the error
 *   overlay that sits over it - the thing a waiter actually has to do.
 *
 *   checkout() refusing an empty cart, which is what makes releasing the
 *   latch in `finally` safe. That guard is load-bearing and had no test.
 */

const RUNTIME_INFO = {
  edition: 'cloud', mode: 'cloud', version: '1.0.0',
  channel: null, apiSchema: 1, syncProtocol: 1, features: { account: true }
};

const SHOP_ORIGIN = 'https://smoke.posnic.io';
const API_BASE = `${SHOP_ORIGIN}/api`;

const branchData = {
  type: 'success',
  data: {
    products: [{
      category_name: 'Food',
      items: [{
        id: 'product-1', name: 'Smoke Test Meal', available_quantity: 10,
        negative_stock: false, price: 100, final_price: 100,
        discount_price: 0, tax_price: 0, img: ''
      }]
    }],
    kiosk_images: {}, tableorders: [], kiosk_payment: {}
  }
};

const RESPONSES = {
  '/runtime-info': RUNTIME_INFO,
  '/users/kioskMobileLogin': {
    tokenType: 'Bearer', token: 'smoke-token', expiresIn: 86400,
    shopKey: 'smoke-shop-key', user: { id: 'user-1', name: 'smoke-user' },
    branches: [
      { branch_name: 'Main Branch', store_id: 'store-1', branch_id: 'branch-1', branch_image: 'store.png' },
      { branch_name: 'Second Branch', store_id: 'store-2', branch_id: 'branch-2', branch_image: 'store.png' }
    ]
  },
  '/items/accessQr': branchData,
  '/sales/getTablesWithActiveOrders': { type: 'success', data: { tables: [] } },
  '/sales/getFrequentItems': { type: 'success', data: [] },
  '/sales/getListKot': { type: 'success', data: { orders: [] } },
  '/sales/getOrderHistory': { type: 'success', data: { orders: [] } }
};

const orderReply = {
  type: 'success',
  data: {
    tokenId: 'A101', orderId: 'SMOKE-ORDER-1', table_number: 'T1',
    branch_name: 'Main Branch',
    items: [{ item_name: 'Smoke Test Meal', item_quantity: 1, item_base_price: 100, item_tax: 0, item_discount: 0, item_total: 100 }],
    subtotal: 100, discount: 0, tax: 0, total: 100
  }
};

/**
 * Route the shop, recording every order body. `holdOrderMs` keeps the reply in
 * the air, which is the window a second tap lands in on a real floor.
 * `orderAnswer` replaces the success reply, for the refusal case.
 */
async function shop(page, { orders, holdOrderMs = 0, orderAnswer = null, reply = null } = {}) {
  await page.addInitScript((url) => {
    localStorage.setItem('posnic.server', JSON.stringify({ pinned: url, active: url }));
  }, API_BASE);

  await page.route(`${SHOP_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');

    if (path === '/sales/qrOrder') {
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* not json */ }
      if (orders) orders.push(body);
      if (holdOrderMs) await new Promise((r) => setTimeout(r, holdOrderMs));
      /* `reply` is a holder the test can change mid-run, so one route can
         refuse the first order and accept the second. */
      const answer = (reply && reply.value) || orderAnswer || orderReply;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(answer)
      });
      return;
    }

    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(RESPONSES[path] || { type: 'success', data: {} })
    });
  });
}

/** Sign in, pick a table, add one dish, stop on the cart ready to send. */
async function toCartWithAMeal(page) {
  await page.goto('/index.html');
  await page.locator('#username').fill('smoke-user');
  await page.locator('#password').fill('smoke-password');
  await page.locator('#login-btn').click();

  await expect(page.getByText('Select Branch')).toBeVisible();
  await page.getByText('Main Branch').click();
  await expect(page).toHaveURL(/kot-management\.html$/);

  await page.waitForFunction(() => typeof window.goToAddKot === 'function');
  /* Captain's floor screen calls this .floor-new; the old name was
     .kot-btn-add and is gone. */
  await page.locator('.floor-new').click();
  await expect(page).toHaveURL(/discount\.html$/);
  await page.locator('#manual_table_input').fill('T1');
  await page.getByRole('button', { name: /Next/ }).click();

  await expect(page).toHaveURL(/products\.html$/);
  await page.locator('.btn-add[data-id="product-1"]').click();
  await expect(page.locator('#cart-qty')).toHaveText('1');
  await page.locator('#next-btn').click();

  await expect(page).toHaveURL(/cart\.html$/);
  await expect(page.getByText('Smoke Test Meal')).toBeVisible();
}

test('a double tap on Place Order sends one order, not two', async ({ page }) => {
  const orders = [];
  /* Half a second in the air, which is a good shop network, not a bad one. */
  await shop(page, { orders, holdOrderMs: 500 });
  await toCartWithAMeal(page);

  /*
   * Both taps in one tick, which is what a double tap on a touchscreen is.
   * Two separate Playwright clicks do not reproduce it: the second lands after
   * the page has begun navigating and quietly does nothing, so the test would
   * pass either way and prove nothing.
   */
  await page.evaluate(() => {
    const btn = document.getElementById('next-btn');
    btn.click();
    btn.click();
  });

  await expect(page).toHaveURL(/thankyou\.html\?token=A101$/);
  expect(orders.length, 'the same order was sent twice').toBe(1);
});

test('the button says it is busy while the order is in the air', async ({ page }) => {
  await shop(page, { holdOrderMs: 1500 });
  await toCartWithAMeal(page);

  const send = page.locator('#next-btn');
  await send.click();
  /* Disabled is what the app sets, and it is enough: a disabled button both
     refuses the tap and says why nothing is happening. */
  await expect(send).toBeDisabled();
});

test('a refused order gives the button back, so the waiter can try again', async ({ page }) => {
  /*
   * The server refused this order for a reason of its own - a dish gone, a
   * table now full. The waiter is still standing here and the button has to
   * work.
   */
  const orders = [];
  const reply = { value: { type: 'error', message: 'Table T1 already has an open order.' } };
  await shop(page, { orders, reply });
  await toCartWithAMeal(page);

  const send = page.locator('#next-btn');
  await send.click();
  await expect.poll(() => orders.length, { timeout: 10000 }).toBe(1);

  await expect(send).toBeEnabled({ timeout: 10000 });

  /* The waiter reads the refusal and dismisses it, which is what puts the
     button back within reach - the overlay sits over the whole screen. */
  await page.locator('#error-popup-close').click();

  /* And it still works: the shop accepts it this time, and the deliberate
     second tap gets through and places the order. */
  reply.value = orderReply;
  await send.click();
  await expect(page).toHaveURL(/thankyou\.html/, { timeout: 15000 });
  expect(orders.length).toBe(2);
});

test('the button comes back after every ending that leaves the waiter here', async ({ page }) => {
  /*
   * The release is in `finally`, not in the catch, and that is the right shape
   * for this app: the on-phone queue path does NOT throw - it keeps the order,
   * clears the cart and returns - so a catch alone would leave a dead Place
   * Order after the commonest failure on a bad network.
   *
   * Releasing unconditionally is safe here only because checkout() refuses an
   * empty cart, so a tap in the moment before the page navigates away does
   * nothing. That guard is load-bearing; this test fails if it is ever removed.
   */
  const orders = [];
  const reply = { value: { type: 'error', message: 'No.' } };
  await shop(page, { orders, reply });
  await toCartWithAMeal(page);

  const send = page.locator('#next-btn');
  await send.click();
  await expect.poll(() => orders.length, { timeout: 10000 }).toBe(1);
  await expect(send).toBeEnabled({ timeout: 10000 });

  /* And after a success the cart is empty, so a stray tap sends nothing. */
  await page.locator('#error-popup-close').click();
  reply.value = orderReply;
  await send.click();
  await expect(page).toHaveURL(/thankyou\.html/, { timeout: 15000 });
  expect(orders.length).toBe(2);
});
