import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * A PLACE FOR EVERYTHING THAT IS NOT AN ORDER.
 *
 * Owner: "arrange profile update, logout, app setting or preferences and etc
 * make it professional arrangements... right now its like fucking shit", and
 * then "mobile app make it more professional, menu and options".
 *
 * Every control on this page already existed. What did not exist was anywhere
 * to look for them: signing out was on the floor screen and only on a shop
 * with one branch, the preferences were in a sheet behind a SERVER icon, and
 * the app version was printed on the sign-in screen, so the only way to read
 * it was to sign out.
 *
 * Three headings, in the order somebody asks the questions: who am I and what
 * have I sold, what is this phone set to, and what is this build.
 */

const MENU = [{ category_name: 'Mains', items: [item('p-cb', 'Chicken Biryani', 220)] }];

/** The floor screen, signed in, as a waiter sees it. */
async function onTheFloor(page) {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/kot-management.html');
  await expect(page.locator('.floor-new')).toBeVisible();
}

test('THE FLOOR SCREEN HAS A WAY IN, and it is not the server icon', async ({ page }) => {
  await onTheFloor(page);

  const me = page.locator('[aria-label="Me"]');
  await expect(me).toBeVisible();

  await me.click();
  await expect(page).toHaveURL(/me\.html$/);
});

test('it says who is signed in, and offers the day on the way past', async ({ page }) => {
  await onTheFloor(page);
  await page.goto('/me.html');

  await expect(page.locator('#me-who')).not.toBeEmpty();
  await expect(page.locator('#me-sales')).toHaveAttribute('href', 'my-sales.html');
});

test('THE THREE HEADINGS ARE ACCOUNT, THIS PHONE AND ABOUT', async ({ page }) => {
  /*
   * The arrangement is the feature. Signing out beside the language beside the
   * build number is a list of controls; these are three questions.
   */
  await onTheFloor(page);
  await page.goto('/me.html');

  /* Lowercased before comparing: the stylesheet uppercases them, and which
     three questions the page asks is the rule - not how the CSS shouts them. */
  const headings = await page.locator('.me-heading').allInnerTexts();
  expect(headings.map((h) => h.trim().toLowerCase())).toEqual(['account', 'this phone', 'about']);
});

test('everything that was scattered is on it', async ({ page }) => {
  await onTheFloor(page);
  await page.goto('/me.html');

  for (const id of ['me-sign-out', 'me-password', 'me-lock', 'me-language', 'me-copies', 'me-server']) {
    await expect(page.locator('#' + id)).toBeVisible();
  }
  await expect(page.getByRole('link', { name: /number card/i })).toBeVisible();
});

test('and the build is readable without signing out', async ({ page }) => {
  /*
   * It was on the sign-in screen only. "Which version am I on" is a question
   * somebody asks down a telephone while the shop is open.
   */
  await onTheFloor(page);
  await page.goto('/me.html');

  await expect(page.locator('#me-version')).toContainText(/Captain/);
});

test('CHANGE PASSWORD SAYS WHERE TO GO rather than half working', async ({ page }) => {
  /*
   * The till has an endpoint for it and stores the password base64-encoded
   * before hashing, while that endpoint writes it raw: a password changed from
   * a phone would still sign in here and on the till's main login, and would
   * fail the super-admin check. A row that says where to go beats a
   * half-broken account.
   */
  await onTheFloor(page);
  await page.goto('/me.html');

  await expect(page.locator('#me-password-why')).toHaveText('On the till');
});

test('SIGNING OUT ENDS THE SESSION, not just the menu', async ({ page }) => {
  await onTheFloor(page);
  await page.goto('/me.html');

  await page.locator('#me-sign-out').click();
  await expect(page).toHaveURL(/index\.html$/);

  /* The sign-in page is still loading its scripts when the URL changes, and
     asking a page that has no POSNIC yet reads as a failure that is only a
     race. */
  await page.waitForFunction(() => typeof POSNIC !== 'undefined' && !!POSNIC.session);
  expect(await page.evaluate(() => POSNIC.session.active)).toBe(false);
});

/* --------------------------------------------------------------- the money */

test('THE SALES PAGE IS A PAGE, not the first thing a waiter sees', async ({ page }) => {
  /*
   * Owner: "but no on the first page. seperate page." A waiter opens this app
   * to take an order; a screen that opens on money has decided the takings
   * matter more than the table waiting.
   */
  await onTheFloor(page);
  const floor = await page.locator('body').innerText();
  expect(floor).not.toMatch(/my sales/i);
});

test('it shows the total, the tables and the orders, from the till', async ({ page }) => {
  await onTheFloor(page);

  await page.route('**/sales/myDay', (route) =>
    route.fulfill({
      json: {
        type: 'success',
        data: {
          total: 4250,
          orders: 12,
          cancelled: 1,
          tables: [
            { table: 'T4', total: 1200, orders: 3 },
            { table: 'T1', total: 900, orders: 2 },
          ],
          recent: [
            { order_id: '1234', table_number: 'T4', total_amount: 380, created_at: new Date().toISOString() },
          ],
          user_name: 'anita',
          day: '2026-09-18',
        },
      },
    })
  );

  await page.goto('/my-sales.html');

  await expect(page.locator('#sales-total')).toContainText('4,250');
  await expect(page.locator('#sales-count')).toContainText('12 orders');
  await expect(page.locator('#sales-cancelled')).toContainText('1 cancelled');
  await expect(page.locator('#sales-tables')).toContainText('T4');
});

test('a till that will not answer is not "you have sold nothing"', async ({ page }) => {
  /* The difference matters on a screen about money. */
  await onTheFloor(page);
  await page.route('**/sales/myDay', (route) => route.abort('connectionrefused'));

  await page.goto('/my-sales.html');

  await expect(page.locator('#sales-tables')).not.toContainText('No tables yet');
  await expect(page.locator('#sales-total')).toBeEmpty();
});
