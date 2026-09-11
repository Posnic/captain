import { test, expect } from '@playwright/test';

/*
 * Saying an order, in a real browser.
 *
 * voice-order-ui.test.js checks the data path against a hand-built DOM. This
 * checks what that test cannot: that the sheet actually appears, that it does
 * not cover the menu when it is closed, and that the words only become a cart
 * after somebody presses Add.
 *
 * The recogniser is stubbed. What is tested is what the app does with a
 * transcript, not whether a browser can hear.
 *
 * The route to the menu is walked rather than jumped to. products.html reads
 * state that the pages before it write - the branch, the table, the cart - and
 * a handset that arrives there without them shows an empty screen, which is
 * exactly what a shortcut here produced.
 */

/*
 * The journey to the menu lives in tests/support/shop.js, because two specs
 * walk it and a second copy of a fixture always drifts.
 */
import { onTheMenu } from './support/shop.js';

const sheet = (page) => page.locator('#posnic-voice-sheet');
const hud = (page) => page.locator('#posnic-voice-hud');

/**
 * Press the microphone, speak, and let go. What a waiter does.
 *
 * A real hold, not a click: the button records between pointerdown and
 * pointerup, and a press shorter than the tap threshold is deliberately NOT a
 * recording.
 */
async function holdAndSpeak(page, ms = 700) {
  const mic = page.locator('#posnic-voice-mic');
  await mic.hover();
  await page.mouse.down();
  await expect(hud(page)).toBeVisible();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test('the mic button is there when the device can listen', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await expect(page.locator('#posnic-voice-mic')).toBeVisible();
});

test('the sheet does not cover the menu while it is closed', async ({ page }) => {
  /*
   * The bug this exists for: an inline display beats the browser's rule for
   * [hidden], so a full-screen sheet set hidden is still laid out - invisible,
   * over everything, swallowing every tap. order-queue-ui.js shipped with it
   * and the symptom was a Place Order button that did nothing. Tapping an item
   * is the proof that nothing is in the way.
   */
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('.btn-add[data-id="p-coffee"]').click();
  await expect(page.locator('#mobile-cart-count')).toHaveText('1');
});

test('what was said is shown for a person to read, and adds nothing yet', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani and three coffee');
  await holdAndSpeak(page);

  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText('Chicken Biryani');
  await expect(sheet(page)).toContainText('Coffee');
  await expect(sheet(page)).toContainText('two chicken biryani and three coffee');

  /* Nothing is in the cart yet. This is the whole point of the sheet. */
  await expect(page.locator('#mobile-cart-count')).toHaveText('0');
});

test('Add is what puts it in the cart, in the quantities said', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani and three coffee');
  await holdAndSpeak(page);
  await expect(sheet(page)).toBeVisible();

  await page.locator('#posnic-voice-sheet-add').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#mobile-cart-count')).toHaveText('5');
});

test('closing the sheet orders nothing, and gives the menu back', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await holdAndSpeak(page);
  await expect(sheet(page)).toBeVisible();

  await page.locator('#posnic-voice-sheet-close').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#mobile-cart-count')).toHaveText('0');

  await page.locator('.btn-add[data-id="p-coffee"]').click();
  await expect(page.locator('#mobile-cart-count')).toHaveText('1');
});

test('a dish that is not on the menu is shown, not invented', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani and one pizza');
  await holdAndSpeak(page);

  await expect(sheet(page)).toContainText('pizza');
  await expect(sheet(page)).toContainText('not on this menu');

  /* The rest still goes. A line nobody could place must not take the ones
     that could with it. */
  await page.locator('#posnic-voice-sheet-add').click();
  await expect(page.locator('#mobile-cart-count')).toHaveText('2');
});

test('a rough match says so, so the waiter checks that one', async ({ page }) => {
  await onTheMenu(page, 'two chicken briyani');
  await holdAndSpeak(page);

  await expect(sheet(page)).toContainText('Chicken Biryani');
  await expect(sheet(page)).toContainText('check this one');
});

/* ------------------------------------------------------------- the gesture */

test('a TAP starts it, and a second tap stops it', async ({ page }) => {
  /* Like a voice note: tap and it listens until you tap again, hold and it
     listens until you let go. Both are the same intention, and the app
     should not have an opinion about which somebody used. */
  await onTheMenu(page, 'two chicken biryani and three coffee');

  await page.locator('#posnic-voice-mic').click();
  await expect(hud(page)).toBeVisible();
  await expect(hud(page)).toContainText('tap the mic again to stop');

  await page.locator('#posnic-voice-mic').click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText('Chicken Biryani');
});

test('while held, the screen says it is listening', async ({ page }) => {
  /*
   * Several seconds of a screen that does not move reads as a dead button,
   * and the waiter presses again and loses the first half of the order.
   */
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('#posnic-voice-mic').hover();
  await page.mouse.down();

  await expect(hud(page)).toBeVisible();
  await expect(hud(page)).toContainText('Slide left to cancel');
  await expect(page.locator('#posnic-voice-hud-words')).toHaveText(/chicken biryani/i);

  /* Held past the tap threshold, or releasing reads as a tap and deliberately
     keeps listening - see "a TAP starts it" above. */
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(hud(page)).toBeHidden();
});

test('sliding left cancels, and nothing is transcribed', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  const box = await page.locator('#posnic-voice-mic').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(hud(page)).toBeVisible();

  await page.mouse.move(box.x - 150, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(hud(page)).toBeHidden();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#mobile-cart-count')).toHaveText('0');
});

test('sliding up locks it, so letting go does not end the order', async ({ page }) => {
  /* A long order, or a hand carrying plates. */
  await onTheMenu(page, 'two chicken biryani and three coffee');
  const box = await page.locator('#posnic-voice-mic').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 120, { steps: 10 });
  await expect(hud(page)).toContainText('Hands free');
  await page.mouse.up();

  /* Still going. */
  await expect(hud(page)).toBeVisible();
  await page.locator('#posnic-voice-hud-stop').click();

  await expect(sheet(page)).toBeVisible();
  await page.locator('#posnic-voice-sheet-add').click();
  await expect(page.locator('#mobile-cart-count')).toHaveText('5');
});

/* --------------------------------------------- all at once, or one by one */

test('a second hold ADDS to the order rather than replacing it', async ({ page }) => {
  /*
   * The whole reason "say the table in one breath" and "say the items one at
   * a time" are the same feature. Replacing would mean the second press
   * silently deleted what the waiter had already said.
   */
  await onTheMenu(page, 'two chicken biryani');
  await holdAndSpeak(page);
  await expect(sheet(page)).toContainText('Chicken Biryani');

  await page.locator('#posnic-voice-sheet-close').click();
  await page.evaluate(() => {
    window.__voiceHeard = 'one masala dosa';
  });
  await holdAndSpeak(page);

  await expect(sheet(page)).toContainText('Chicken Biryani');
  await expect(sheet(page)).toContainText('Masala Dosa');

  await page.locator('#posnic-voice-sheet-add').click();
  await expect(page.locator('#mobile-cart-count')).toHaveText('3');
});

test('Start again is the one thing that clears it, and it says so', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await holdAndSpeak(page);
  await expect(sheet(page)).toContainText('Chicken Biryani');

  await page.getByRole('button', { name: 'Start again' }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#mobile-cart-count')).toHaveText('0');

  await page.evaluate(() => {
    window.__voiceHeard = 'one coffee';
  });
  await holdAndSpeak(page);
  await expect(sheet(page)).not.toContainText('Chicken Biryani');
  await expect(sheet(page)).toContainText('Coffee');
});

test('a quantity heard wrong is one tap to fix, not a whole order again', async ({ page }) => {
  await onTheMenu(page, 'three coffee');
  await holdAndSpeak(page);
  await expect(sheet(page)).toContainText('Coffee');

  await page.locator('#posnic-voice-sheet [data-act="less"]').first().click();
  await page.locator('#posnic-voice-sheet-add').click();
  await expect(page.locator('#mobile-cart-count')).toHaveText('2');
});

/* ------------------------------------------------- a choice of one is none */

/*
 * A shop with a single branch was asked to pick a branch - most often after
 * something else had gone wrong, because an empty menu used to clear the
 * branch and force the picker. So a waiter met a screen asking them to choose
 * between one thing, about a problem choosing could not fix.
 */

test('a single-branch shop is never asked which branch', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  /* onTheMenu signs in with one branch and expects to land on kot-management
     without a picker; this states it outright rather than by implication. */
  await expect(page).not.toHaveURL(/index\.html$/);
  await expect(page.getByText('Select Branch')).toHaveCount(0);
});

test('and is not offered a Change Branch button either', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await page.goto('/kot-management.html');
  await expect(page.locator('#kot-change-branch')).toBeHidden();
});

test('an empty menu keeps the branch when there is nowhere else to go', async ({ page }) => {
  /* Choosing a different branch cannot fix an empty menu, and with one branch
     there is nothing to choose. The branch must survive. */
  await onTheMenu(page, 'two chicken biryani');

  const kept = await page.evaluate(() => {
    localStorage.setItem('kiosk_branch_list', JSON.stringify([{ branch_id: 'branch-1' }]));
    return {
      branch: localStorage.getItem('kiosk_selected_branch'),
      forced: localStorage.getItem('kiosk_force_branch_select'),
    };
  });
  expect(kept.branch).toBeTruthy();
  expect(kept.forced).toBeNull();
});

/* ------------------------------------------------ searching needs the room */

/*
 * A waiter types two letters and the soft keyboard covers the bottom half of
 * the phone. What is left has to be results - but the page kept the header,
 * the category strip, the frequently-ordered row and the repeat-last button,
 * so a search for "cof" showed one and a half cards through a letterbox.
 */

test('searching clears the screen of everything that is not a result', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');

  await expect(page.locator('.mobile-header')).toBeVisible();
  await expect(page.locator('.fixed-categories')).toBeVisible();

  await page.locator('#product-search-input').fill('cof');
  await expect(page.locator('.mobile-header')).toBeHidden();
  await expect(page.locator('.fixed-categories')).toBeHidden();

  /* And the results are still there, with room for them. */
  await expect(page.getByText('Coffee')).toBeVisible();
});

test('and gives it all back when the box is empty', async ({ page }) => {
  /* A search is a temporary state, not a different page. */
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('#product-search-input').fill('cof');
  await expect(page.locator('.mobile-header')).toBeHidden();

  await page.locator('#product-search-input').fill('');
  await expect(page.locator('.mobile-header')).toBeVisible();
  await expect(page.locator('.fixed-categories')).toBeVisible();
});

test('the count is one small line, not a heading', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('#product-search-input').fill('cof');

  const count = page.locator('#search-count');
  await expect(count).toHaveText('1 item');
  /* Small enough not to cost a result its place on the screen. */
  const box = await count.boundingBox();
  expect(box.height).toBeLessThan(30);
});

test('a search that matches nothing says so, and says what to try', async ({ page }) => {
  /*
   * WHERE THIS MOVED, and why.
   *
   * It used to be the small grey count line, above an empty list. One line of
   * 12px grey over a blank screen is indistinguishable from a screen that
   * failed to load, and the difference matters most to the person least able
   * to tell.
   *
   * Nothing-found is now the only thing on the screen, so it gets the room to
   * be useful: what did not match, and the trick that would have worked. The
   * count line stays small for the case it was made small for, which is
   * counting results that are actually there.
   */
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('#product-search-input').fill('zzzz');

  const said = page.locator('.menu-nothing');
  await expect(said).toContainText('Nothing matches');
  await expect(said).toContainText('zzzz');
  /* The one thing a waiter needs to know about this search box. */
  await expect(said).toContainText('cb');

  /* And the count line is empty rather than saying "0 items" underneath it. */
  await expect(page.locator('#search-count')).toHaveText('');
});
