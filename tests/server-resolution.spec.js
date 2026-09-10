import { test, expect } from '@playwright/test';

/*
 * How the app decides which server to talk to.
 *
 * The rule, in order: an address someone pinned, then the shop's own server on
 * this Wi-Fi, then the shop's online address. Re-decided whenever the active
 * one stops answering, so a waiter walking out of range keeps working instead
 * of hitting a wall.
 */

const RUNTIME_INFO = {
  edition: 'community',
  mode: 'desktop',
  version: '1.0.0',
  channel: null,
  apiSchema: 1,
  syncProtocol: 1,
  features: { account: false }
};

const LAN = 'http://192.168.1.8:5555/api';
const LAN_ORIGIN = 'http://192.168.1.8:5555';
const CLOUD = 'https://azure.posnic.io/api';
const CLOUD_ORIGIN = 'https://azure.posnic.io';

/** Answer /runtime-info like a Posnic server, and everything else emptily. */
function serve(page, origin, { info = RUNTIME_INFO, extra = {}, seen } = {}) {
  return page.route(`${origin}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (seen && path !== '/runtime-info') seen.push(path);
    const body = path === '/runtime-info' ? info : (extra[path] || { type: 'success', data: {} });
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(body)
    });
  });
}

/** Nothing at this address at all. */
const refuse = (page, origin) =>
  page.route(`${origin}/**`, route => route.abort('connectionrefused'));

/** Seed the one key the app keeps its server choice in. */
const seed = (page, state) => page.addInitScript(
  (value) => localStorage.setItem('posnic.server', JSON.stringify(value)), state);

const signedInAs = (page, shopKey) => page.addInitScript(
  (key) => localStorage.setItem('posnic.session', JSON.stringify({ token: 't', shopKey: key })),
  shopKey);

const baseUrl = (page) => page.evaluate(() => POSNIC.server.baseUrl);

test('a shop code becomes the shop’s online address', async ({ page }) => {
  await page.goto('/index.html');
  expect(await page.evaluate(() => POSNIC.server.normalize('azure'))).toBe(CLOUD);
});

test('addresses the user might type are all understood', async ({ page }) => {
  await page.goto('/index.html');
  const results = await page.evaluate(() => ({
    bareIp: POSNIC.server.normalize('192.168.1.8'),
    ipWithPort: POSNIC.server.normalize('192.168.1.8:5555'),
    fullLan: POSNIC.server.normalize('http://192.168.1.8:5555/'),
    cloudHost: POSNIC.server.normalize('azure.posnic.io'),
    ownDomain: POSNIC.server.normalize('https://pos.myshop.com/api'),
    nothing: POSNIC.server.normalize('   '),
  }));

  /* A till holds no certificate, so a private address is http, gets the port,
     and gets the /api prefix every server answers under. */
  expect(results.bareIp).toBe(LAN);
  expect(results.ipWithPort).toBe(LAN);
  expect(results.fullLan).toBe(LAN);
  expect(results.cloudHost).toBe(CLOUD);
  // A path the user gave is theirs, and is left exactly as typed.
  expect(results.ownDomain).toBe('https://pos.myshop.com/api');
  expect(results.nothing).toBeNull();
});

test('the Wi-Fi server is preferred over the online one', async ({ page }) => {
  await seed(page, { lan: LAN, cloud: CLOUD, active: CLOUD });
  await serve(page, LAN_ORIGIN);
  await serve(page, CLOUD_ORIGIN);

  await page.goto('/index.html');
  await expect.poll(() => baseUrl(page)).toBe(LAN);
  expect(await page.evaluate(() => POSNIC.server.isLocal)).toBe(true);
});

test('the online address takes over when the Wi-Fi server is gone', async ({ page }) => {
  await seed(page, { lan: LAN, cloud: CLOUD, active: LAN });
  await refuse(page, LAN_ORIGIN);
  await serve(page, CLOUD_ORIGIN, { info: { ...RUNTIME_INFO, mode: 'cloud', edition: 'cloud' } });

  await page.goto('/index.html');
  await expect.poll(() => baseUrl(page), { timeout: 15000 }).toBe(CLOUD);
  expect(await page.evaluate(() => POSNIC.server.isLocal)).toBe(false);
});

test('a pinned address is never swapped out from under the user', async ({ page }) => {
  await seed(page, { pinned: CLOUD, lan: LAN, active: CLOUD });
  await serve(page, LAN_ORIGIN);   // reachable, and still must not be chosen
  await serve(page, CLOUD_ORIGIN);

  await page.goto('/index.html');
  await page.waitForTimeout(1500);
  expect(await baseUrl(page)).toBe(CLOUD);
});

test('the app refuses to drift onto a server holding a different shop', async ({ page }) => {
  /*
   * Two Posnic tills on one estate's Wi-Fi is not hypothetical. A server is
   * adopted automatically only once it is recorded as holding the shop this
   * device is signed in to.
   */
  await seed(page, {
    lan: LAN, cloud: CLOUD, active: CLOUD,
    servers: { [CLOUD]: 'shop-a', [LAN]: 'shop-b' },
  });
  await signedInAs(page, 'shop-a');
  await serve(page, LAN_ORIGIN);
  await serve(page, CLOUD_ORIGIN);

  await page.goto('/index.html');
  await page.waitForTimeout(1500);
  // The LAN server answers first and is faster, but it is the wrong shop.
  expect(await baseUrl(page)).toBe(CLOUD);
});

test('a stranger on port 5555 is not mistaken for a till', async ({ page }) => {
  /*
   * The old probe accepted any reply at all from port 5555 - a printer status
   * page, a router admin panel - and the app would then try to sign in against
   * it. A Posnic server has to say what it is.
   */
  await page.route(`${LAN_ORIGIN}/**`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' })
  }));

  await page.goto('/index.html');
  const hit = await page.evaluate((url) => POSNIC.discovery.probe(url, 3000), LAN);
  expect(hit).toBeNull();
});

test('a read that fails is retried on the other server', async ({ page }) => {
  /*
   * The point of the whole arrangement: the staff member waiting on this
   * request gets an answer from the other address rather than an error.
   */
  await seed(page, { lan: LAN, cloud: CLOUD, active: LAN });

  let lanUp = true;
  await page.route(`${LAN_ORIGIN}/**`, async route => {
    if (!lanUp) return route.abort('connectionrefused');
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(path === '/runtime-info' ? RUNTIME_INFO : { type: 'success', data: 'lan' })
    });
  });
  await serve(page, CLOUD_ORIGIN, { extra: { '/items/accessQr': { type: 'success', data: 'cloud' } } });

  await page.goto('/index.html');
  await expect.poll(() => baseUrl(page)).toBe(LAN);

  lanUp = false;
  const body = await page.evaluate(async () => {
    const result = await POSNIC.api.post('/items/accessQr', {});
    return result.data;
  });

  expect(body).toBe('cloud');
  expect(await baseUrl(page)).toBe(CLOUD);
});

test('a failed order is NOT replayed on the other server', async ({ page }) => {
  /*
   * A network error says the reply did not arrive. It does not say the order
   * was not written: it may have landed a millisecond before the Wi-Fi
   * dropped. Replaying it would write the order twice, and because the till
   * and the cloud sync to each other the duplicate comes back, so the kitchen
   * makes two of everything.
   *
   * The app still moves onto the working server, so the staff member's next
   * attempt lands in the right place. Only the silent replay is withheld.
   */
  await seed(page, { lan: LAN, cloud: CLOUD, active: LAN });

  let lanUp = true;
  const cloudCalls = [];
  await page.route(`${LAN_ORIGIN}/**`, async route => {
    if (!lanUp) return route.abort('connectionrefused');
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(path === '/runtime-info' ? RUNTIME_INFO : { type: 'success', data: 'lan' })
    });
  });
  await serve(page, CLOUD_ORIGIN, { seen: cloudCalls });

  await page.goto('/index.html');
  await expect.poll(() => baseUrl(page)).toBe(LAN);

  lanUp = false;
  const failed = await page.evaluate(async () => {
    try {
      await POSNIC.api.post('/sales/qrOrder', { items: [] });
      return false;
    } catch (e) {
      return e.name === 'ApiError';
    }
  });

  expect(failed, 'the order must surface as a failure, not be replayed').toBe(true);
  expect(cloudCalls).not.toContain('/sales/qrOrder');
  expect(await baseUrl(page)).toBe(CLOUD);
});

test('every request carries the credential from sign-in', async ({ page }) => {
  /*
   * The order, KOT and history routes refuse an anonymous caller. Without this
   * the app signs in successfully and then loads nothing at all.
   */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.addInitScript(() => localStorage.setItem(
    'posnic.session', JSON.stringify({ token: 'the-token', shopKey: 'shop-a' })));

  let auth = null;
  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path !== '/runtime-info') auth = route.request().headers()['authorization'];
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(path === '/runtime-info' ? RUNTIME_INFO : { type: 'success', data: {} })
    });
  });

  await page.goto('/index.html');
  await page.evaluate(() => POSNIC.api.post('/sales/getOrderHistory', {}));
  expect(auth).toBe('Bearer the-token');
});

test('a rejected credential is dropped rather than resent', async ({ page }) => {
  /*
   * A token the server will not accept is worse than none: every later request
   * carries it and fails the same way, and nothing ever returns the user to
   * the sign-in screen.
   */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.addInitScript(() => localStorage.setItem(
    'posnic.session', JSON.stringify({ token: 'stale', shopKey: 'shop-a' })));

  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/runtime-info') {
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(RUNTIME_INFO)
      });
    }
    await route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'nope' } })
    });
  });

  await page.goto('/index.html');
  const status = await page.evaluate(async () => {
    try {
      await POSNIC.api.post('/sales/getOrderHistory', {});
      return null;
    } catch (e) {
      return e.status;
    }
  });

  expect(status).toBe(401);
  expect(await page.evaluate(() => POSNIC.session.token)).toBeNull();
});

test('auto detect checks the known local server before sweeping', async ({ page }) => {
  await seed(page, { lan: LAN, active: LAN });
  await serve(page, LAN_ORIGIN);

  await page.goto('/index.html');
  await page.getByTitle('Server Settings').click();
  await page.locator('#serverUrlInput').fill('');
  await page.locator('#serverAutoDetectBtn').click();

  await expect(page.locator('#serverUrlInput')).toHaveValue(LAN);
  await expect(page.locator('#serverSaveMsg')).toContainText(`Found the till at ${LAN}`);
  /* One button, always usable. Test and Save were two, in a required order,
     so the obvious one did nothing until the other had been pressed. */
  await expect(page.locator('#serverSaveBtn')).toBeEnabled();
  await expect(page.locator('#serverSaveBtn')).toHaveText('Connect');
});

test('signing in against an older server still finds the shop', async ({ page }) => {
  /*
   * Every deployed shop runs 1.6.1, which answers a sign-in with the older
   * envelope - { type, message, data } - and no credential. Reading only the
   * new shape made a successful sign-in show an empty shop: the branches were
   * in `data` and nothing looked at them.
   */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const bodies = {
      '/runtime-info': RUNTIME_INFO,
      '/users/kioskMobileLogin': {
        type: 'success',
        message: 'Successfully login',
        data: [
          { branch_name: 'Old Server Branch', store_id: 'store-9', branch_id: 'branch-9', user_id: 'user-9' },
          { branch_name: 'Second', store_id: 'store-8', branch_id: 'branch-8', user_id: 'user-9' }
        ],
      },
    };
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(bodies[path] || { type: 'success', data: {} })
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('someone');
  await page.locator('#password').fill('a-password');
  await page.locator('#login-btn').click();

  await expect(page.getByText('Select Branch')).toBeVisible();
  await expect(page.getByText('Old Server Branch')).toBeVisible();
});

test('an older server refusing a password says so, rather than looking broken', async ({ page }) => {
  /* 1.6.1 answers 404 for a refused sign-in, which otherwise reads to the
     user as "the app is broken" rather than "that password is wrong". */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/runtime-info') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RUNTIME_INFO) });
    }
    await route.fulfill({
      status: 404, contentType: 'application/json',
      body: JSON.stringify({ type: 'error', message: 'Invalid account. Please contact your branch manager.', data: null })
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('someone');
  await page.locator('#password').fill('wrong');
  await page.locator('#login-btn').click();

  await expect(page.locator('#login-message')).toContainText('Invalid account');
});

test('signing in with no server chosen says so, instead of failing the password', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('#username').fill('someone');
  await page.locator('#password').fill('a-password');
  await page.locator('#login-btn').click();

  await expect(page.locator('#login-message')).toContainText('Choose your shop server first');
  await expect(page.locator('#serverModal')).toBeVisible();
});

test('a locked-out device is told to wait, not that its password is wrong', async ({ page }) => {
  /*
   * The server answered 404 for every failure, so a lockout, a typo and a
   * wrong address were indistinguishable to the app and to the user.
   */
  await seed(page, { pinned: CLOUD, active: CLOUD });
  await page.route(`${CLOUD_ORIGIN}/**`, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/runtime-info') {
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(RUNTIME_INFO)
      });
    }
    await route.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '60' },
      body: JSON.stringify({
        error: { code: 'TOO_MANY_ATTEMPTS', message: 'You tried to sign in too many times' }
      })
    });
  });

  await page.goto('/index.html');
  await page.locator('#username').fill('someone');
  await page.locator('#password').fill('a-password');
  await page.locator('#login-btn').click();

  await expect(page.locator('#login-message')).toContainText('too many times');
});
