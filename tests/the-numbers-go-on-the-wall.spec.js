import { test, expect } from '@playwright/test';
import { onTheMenu, item } from './support/shop.js';

/*
 * THE NUMBERS GO ON THE WALL.
 *
 * Owner: "self manage number. app user itself auto assign 1 to 200 for 200
 * items. if enter 33 then it shows..."
 *
 * Third of the three answers to reaching an item faster. The other two sit
 * behind the search box; this one is paper, because the fastest search is the
 * one a waiter never does. A dish somebody sells forty times a day should be
 * a number they know, and a number is only learnable if it is written
 * somewhere they already look.
 *
 * The test that matters is not that the page renders. It is that the paper
 * and the phone agree: a card saying 33 next to a dish the picker numbers 34
 * would send the wrong plate with more confidence than no card at all.
 */

const MENU = [
  {
    category_name: 'Starters',
    category_sort: 1,
    items: [item('p-65', 'Chicken 65', 180), item('p-gobi', 'Gobi Manchurian', 160)],
  },
  {
    category_name: 'Mains',
    category_sort: 2,
    items: [
      item('p-cb', 'Chicken Biryani', 220),
      item('p-mb', 'Mutton Biryani', 320),
      item('p-naan', 'Butter Naan', 40),
    ],
  },
];

/** Every row on the card, as the dish id and the number printed beside it. */
const onTheCard = (page) =>
  page.locator('#card-body li').evaluateAll((rows) =>
    rows.map((row) => [row.getAttribute('data-id'), row.querySelector('.n').textContent.trim()])
  );

test('every dish is on it, numbered straight through', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/number-card.html');

  await expect(page.locator('#card-body li').first()).toBeVisible();

  expect(await onTheCard(page)).toEqual([
    ['p-65', '1'],
    ['p-gobi', '2'],
    ['p-cb', '3'],
    ['p-mb', '4'],
    ['p-naan', '5'],
  ]);
});

test('the paper and the phone give a dish the same number', async ({ page }) => {
  /*
   * The whole point, and the thing that would rot quietly. The numbers on the
   * phone are the ones in the add-item sheet, which is where typing 33 means
   * something; the menu screen asks for none and gets none. Both sides count
   * over MenuView.fromFlat, so this agrees by construction rather than by two
   * lists happening to match today.
   */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/number-card.html');
  await expect(page.locator('#card-body li').first()).toBeVisible();
  const card = Object.fromEntries(await onTheCard(page));

  await page.goto('/order-history.html');
  await page.waitForFunction(() => typeof openItemPicker === 'function');
  await page.evaluate(() => {
    window.setOrderBeingModified({ items: [] });
    new window.bootstrap.Modal(document.getElementById('editOrderModal')).show();
    openItemPicker();
  });
  await expect(page.locator('#item-picker .dish').first()).toBeVisible();

  const inHand = Object.fromEntries(
    await page.locator('#item-picker .dish').evaluateAll((rows) =>
      rows
        .map((row) => [
          row.getAttribute('data-id'),
          row.querySelector('.dish-no') ? row.querySelector('.dish-no').textContent.trim() : '',
        ])
        .filter(([, n]) => n)
    )
  );

  expect(Object.keys(inHand).length).toBe(5);
  for (const [id, number] of Object.entries(inHand)) {
    expect(card[id], `dish ${id} is ${number} in the hand`).toBe(number);
  }
});

test('the sections are the shop’s, not the alphabet', async ({ page }) => {
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/number-card.html');

  expect(await page.locator('#card-body .card-group h2').allTextContents()).toEqual([
    'Starters',
    'Mains',
  ]);
});

test('a phone with no menu yet says so, rather than printing an empty sheet', async ({ page }) => {
  await page.goto('/number-card.html');

  await expect(page.locator('.card-empty')).toContainText('No menu on this phone yet');
});

test('the buttons are not part of what gets printed', async ({ page }) => {
  /*
   * A printed page with a Back button on it is a page somebody has to
   * explain. Asserted through the print stylesheet, which is the only way
   * this is observable without a printer.
   */
  await onTheMenu(page, 'nothing', { menu: MENU });
  await page.goto('/number-card.html');

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.card-actions')).toBeHidden();

  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.card-actions')).toBeVisible();
});
