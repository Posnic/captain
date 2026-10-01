import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';

/*
 * MOVING AN ORDER TO ANOTHER TABLE.
 *
 * Guests move. A two turns into a four, a table by the door turns out to be
 * under the air conditioner, a party joins another party.
 *
 * This was already possible and almost nobody could find it: Modify, scroll
 * past every dish on the order, find the table strip, change it, Update. That
 * is the screen for adding and cancelling dishes, so moving a table meant
 * walking through the one place where a mis-tap changes what the kitchen
 * cooks.
 *
 * What these hold is the shape of the thing: the order's LINES go back
 * untouched, the new table's id goes with its number, and a waiter is told
 * which tables are already working before they choose one rather than after.
 */

const TABLES = [
  { tableorder_value: 4, _id: { $oid: 'tbl-four' } },
  { tableorder_value: 12, _id: { $oid: 'tbl-twelve' } },
  { tableorder_value: 15, _id: { $oid: 'tbl-fifteen' } },
];

const ORDERS = [
  {
    _id: 'ord-1',
    order_number: 'K1',
    status: 'pending',
    dine_type: 'Dine-in',
    table_number: '4',
    table_id: 'tbl-four',
    person_count: 2,
    total_amount: 220,
    items: [
      { product_id: 'p-cb', item_id: 'p-cb', name: 'Chicken Biryani', quantity: 1, price: 220 },
    ],
  },
  {
    _id: 'ord-2',
    order_number: 'K2',
    status: 'pending',
    dine_type: 'Dine-in',
    table_number: '15',
    table_id: 'tbl-fifteen',
    person_count: 4,
    total_amount: 40,
    items: [{ product_id: 'p-naan', item_id: 'p-naan', name: 'Butter Naan', quantity: 1, price: 40 }],
  },
  {
    _id: 'ord-3',
    order_number: 'K3',
    status: 'pending',
    dine_type: 'Take away',
    table_number: '',
    total_amount: 40,
    items: [{ product_id: 'p-naan', item_id: 'p-naan', name: 'Butter Naan', quantity: 1, price: 40 }],
  },
];

/** The order list, with a floor and three orders on it. */
async function onTheOrderList(page) {
  await onTheMenu(page, 'nothing');

  /*
   * Through the app's own loader, not by assigning window.allOrders. The
   * order list is a script-scoped binding, so a value hung on window is a
   * different variable that the screen never reads, and every test would then
   * be asking an empty list politely.
   */
  await page.route('**/sales/getOrderHistory', (route) =>
    route.fulfill({ json: { type: 'success', data: { orders: ORDERS } } })
  );

  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof moveOrder === 'function');
  await page.evaluate(
    ({ tables, orders }) => {
      localStorage.setItem('kiosk_tableorders', JSON.stringify(tables));
      /* The fixtures, for the cases that draw a card directly. Not the app's
         order list, which is script-scoped and cannot be written from here. */
      window.__orders = orders;
    },
    { tables: TABLES, orders: ORDERS }
  );
  await page.evaluate(() => loadOrderHistory());
}

/** What the sheet offers, as the number and whatever it says underneath. */
const offered = (page) =>
  page.locator('#move-table-list .move-table').evaluateAll((rows) =>
    rows.map((row) => [
      row.querySelector('.move-table-no').textContent.trim(),
      (row.querySelector('.move-table-note') || {}).textContent?.trim() || '',
    ])
  );

test('the floor is shown, with where it is now and what is already working', async ({ page }) => {
  await onTheOrderList(page);
  await page.evaluate(() => moveOrder('ord-1'));

  await expect(page.locator('#move-table-now')).toHaveText('Now on table 4');
  expect(await offered(page)).toEqual([
    ['4', 'here now'],
    ['12', ''],
    ['15', 'has an order'],
  ]);
});

test('the table it is already on cannot be chosen', async ({ page }) => {
  /* Moving a table to itself is a kitchen ticket for nothing. */
  await onTheOrderList(page);
  await page.evaluate(() => moveOrder('ord-1'));

  await expect(page.locator('.move-table[data-value="4"]')).toBeDisabled();
  await expect(page.locator('.move-table[data-value="12"]')).toBeEnabled();
});

test('choosing is not moving', async ({ page }) => {
  /*
   * The floor is not a place where anybody taps carefully. A tap that moved
   * the order the moment it landed would turn a mis-tap into a table change
   * the kitchen hears about.
   */
  await onTheOrderList(page);
  await page.evaluate(() => moveOrder('ord-1'));

  const sent = [];
  await page.route('**/sales/updateOrder', (route) => {
    sent.push(route.request().postDataJSON());
    route.fulfill({ json: { type: 'success', message: 'ok' } });
  });

  await page.locator('.move-table[data-value="12"]').click();

  expect(sent).toEqual([]);
  await expect(page.locator('#move-table-go')).toHaveText('Move to table 12');
});

test('the move carries the new table AND its id, with the lines untouched', async ({ page }) => {
  await onTheOrderList(page);
  await page.evaluate(() => moveOrder('ord-1'));

  let sent = null;
  await page.route('**/sales/updateOrder', (route) => {
    sent = route.request().postDataJSON();
    route.fulfill({ json: { type: 'success', message: 'Order updated' } });
  });

  await page.locator('.move-table[data-value="12"]').click();
  await page.locator('#move-table-go').click();
  await expect.poll(() => sent).not.toBeNull();

  expect(sent.order_id).toBe('ord-1');
  expect(sent.table_number).toBe('12');
  /* The id, which is the half the till used to drop on the floor. */
  expect(sent.table_id).toBe('tbl-twelve');

  /* Nothing else about the order moved with it. */
  expect(sent.items).toHaveLength(1);
  expect(sent.items[0].quantity).toBe(1);
  expect(sent.person_count).toBe(2);
  expect(sent.dine_type).toBe('Dine-in');
});

test('a takeaway has no table to move it to, and is not offered one', async ({ page }) => {
  await onTheOrderList(page);
  await page.evaluate(() => showOrderListScreen('all'));
  await expect(page.locator('.order-card').first()).toBeVisible();

  /* All three orders are listed; only the two on tables can be moved. */
  expect(await page.locator('.order-card').count()).toBe(3);
  expect(await page.locator('.order-card .move-btn').count()).toBe(2);

  /*
   * And it is the takeaway that is missing one, not whichever card happened
   * to be third. Found by the order's own id, because the card shows its
   * number in a format this test should not be asserting the shape of.
   */
  const takeaway = page.locator('.order-card[onclick*="ord-3"]');
  await expect(takeaway).toHaveCount(1);
  expect(await takeaway.locator('.move-btn').count()).toBe(0);
});
