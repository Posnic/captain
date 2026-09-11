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

const SHOP_ORIGIN = 'https://smoke.posnic.io';
const API_BASE = `${SHOP_ORIGIN}/api`;

/* What a Posnic server says about itself. Discovery accepts nothing else. */
const RUNTIME_INFO = {
  edition: 'cloud',
  mode: 'cloud',
  version: '1.0.0',
  channel: null,
  apiSchema: 1,
  syncProtocol: 1,
  features: { account: true, idempotentOrders: true },
};

const item = (id, name, price) => ({
  id,
  name,
  available_quantity: 50,
  negative_stock: false,
  price,
  final_price: price,
  discount_price: 0,
  tax_price: 0,
  img: '',
});

const RESPONSES = {
  '/runtime-info': RUNTIME_INFO,
  '/users/kioskMobileLogin': {
    tokenType: 'Bearer',
    token: 'smoke-token',
    expiresIn: 86400,
    shopKey: 'smoke-shop-key',
    user: { id: 'user-1', name: 'smoke-user' },
    branches: [
      {
        branch_name: 'Main Branch',
        store_id: 'store-1',
        branch_id: 'branch-1',
        branch_image: 'store.png',
      },
    ],
  },
  '/items/accessQr': {
    type: 'success',
    data: {
      products: [
        {
          category_name: 'Food',
          items: [item('p-biryani', 'Chicken Biryani', 220), item('p-coffee', 'Coffee', 40)],
        },
      ],
      kiosk_images: {},
      tableorders: [],
      kiosk_payment: {},
    },
  },
  '/sales/getTablesWithActiveOrders': { type: 'success', data: { tables: [] } },
  '/sales/getFrequentItems': { type: 'success', data: [] },
  '/sales/getListKot': { type: 'success', data: { orders: [] } },
  '/sales/getOrderHistory': { type: 'success', data: { orders: [] } },
};

/**
 * A handset signed in, at a table, looking at the menu, with a recogniser that
 * will report `heard`.
 */
async function onTheMenu(page, heard) {
  await page.addInitScript(
    ({ url, heard }) => {
      localStorage.setItem('posnic.server', JSON.stringify({ pinned: url, active: url }));

      /* Stubbed before any page script runs, so the mic button is drawn as
         available and listening resolves without a microphone. */
      window.__voiceHeard = heard;
      function Recogniser() {
        this.start = () => {
          setTimeout(() => {
            if (this.onresult) {
              this.onresult({ results: [[{ transcript: window.__voiceHeard }]] });
            }
            if (this.onend) this.onend();
          }, 0);
        };
        this.stop = () => {};
      }
      /* BOTH names. Chromium defines the unprefixed SpeechRecognition as well
         as the webkit one, and speech.js reads the unprefixed first - so
         replacing only the prefixed name leaves the real recogniser in charge
         and the test asks a headless browser for a microphone. */
      for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
        Object.defineProperty(window, name, { configurable: true, value: Recogniser });
      }
    },
    { url: API_BASE, heard }
  );

  await page.route(`${SHOP_ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RESPONSES[path] || { type: 'success', data: {} }),
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('smoke-user');
  await page.locator('#password').fill('smoke-password');
  await page.locator('#login-btn').click();

  /* One branch, so the app chooses it rather than asking. basic-flow.spec.js
     covers the picker; this needs a handset at a table. */
  await expect(page).toHaveURL(/kot-management\.html$/);

  await page.waitForFunction(() => typeof window.goToAddKot === 'function');
  await page.locator('.kot-btn-add').click();
  await expect(page).toHaveURL(/discount\.html$/);
  await page.locator('#manual_table_input').fill('T1');
  await page.getByRole('button', { name: /Next/ }).click();

  await expect(page).toHaveURL(/products\.html$/);
  await expect(page.getByText('Chicken Biryani')).toBeVisible();
}

const sheet = (page) => page.locator('#posnic-voice-sheet');

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
  await page.locator('#posnic-voice-mic').click();

  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText('Chicken Biryani');
  await expect(sheet(page)).toContainText('Coffee');
  await expect(sheet(page)).toContainText('two chicken biryani and three coffee');

  /* Nothing is in the cart yet. This is the whole point of the sheet. */
  await expect(page.locator('#mobile-cart-count')).toHaveText('0');
});

test('Add is what puts it in the cart, in the quantities said', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani and three coffee');
  await page.locator('#posnic-voice-mic').click();
  await expect(sheet(page)).toBeVisible();

  await page.getByRole('button', { name: 'Add to order' }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#mobile-cart-count')).toHaveText('5');
});

test('closing the sheet orders nothing, and gives the menu back', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani');
  await page.locator('#posnic-voice-mic').click();
  await expect(sheet(page)).toBeVisible();

  await page.locator('#posnic-voice-sheet-close').click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('#mobile-cart-count')).toHaveText('0');

  await page.locator('.btn-add[data-id="p-coffee"]').click();
  await expect(page.locator('#mobile-cart-count')).toHaveText('1');
});

test('a dish that is not on the menu is shown, not invented', async ({ page }) => {
  await onTheMenu(page, 'two chicken biryani and one pizza');
  await page.locator('#posnic-voice-mic').click();

  await expect(sheet(page)).toContainText('pizza');
  await expect(sheet(page)).toContainText('not on this menu');

  /* The rest still goes. A line nobody could place must not take the ones
     that could with it. */
  await page.getByRole('button', { name: 'Add to order' }).click();
  await expect(page.locator('#mobile-cart-count')).toHaveText('2');
});

test('a rough match says so, so the waiter checks that one', async ({ page }) => {
  await onTheMenu(page, 'two chicken briyani');
  await page.locator('#posnic-voice-mic').click();

  await expect(sheet(page)).toContainText('Chicken Biryani');
  await expect(sheet(page)).toContainText('check this one');
});
