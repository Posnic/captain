import { test, expect } from '@playwright/test';

/*
 * WHERE THIS PHONE CONNECTS, IN ONE PLACE AND IN PLAIN WORDS.
 *
 * Owner: "both able to configurable. easy set up. in one page... need very
 * simple configuration not to make so much confusion. lan or internet all
 * should be internal. user dont know much about networking stuff. however if
 * someone know we have option everything work only local or together."
 *
 * Two audiences, one screen. A waiter gets a sentence and a dot: which door is
 * open, and that the app changes doors by itself - which is the fact that
 * stops somebody fiddling with settings the moment they walk out of range.
 * Anyone who knows what a subnet is gets the two addresses and a way to force
 * one door, a single tap below.
 *
 * The three ways are the SAME pin the app has always had, said in words:
 * automatic is no pin, either of the others pins that address.
 */

const LAN = 'http://192.168.1.8:5555/api';
const CLOUD = 'https://azure.posnic.io/api';

/** The connect sheet, on a handset that already knows its shop. */
async function atTheConnectionPage(page, { lan = LAN, cloud = CLOUD, pinned = null } = {}) {
  /*
   * Straight to the page, the way server-resolution.spec.js does it. Signing
   * in first sends a handset PAST this screen to the floor, so a harness that
   * signs in is a harness that never sees the thing it is testing.
   */
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof openServerModal === 'function');

  await page.evaluate(
    ({ lan, cloud, pinned }) => {
      if (lan || cloud) POSNIC.server.remember({ lan, cloud });
      if (pinned) POSNIC.server.pin(pinned);
      else POSNIC.server.unpin();
      openServerModal();
    },
    { lan, cloud, pinned }
  );

  await expect(page.locator('#connectState')).toBeVisible();
}

test('a waiter gets one sentence, not a network setting', async ({ page }) => {
  await atTheConnectionPage(page);

  /* No address, no jargon, nothing to decide. */
  const said = await page.locator('#connectState .conn-said').innerText();
  expect(said).not.toMatch(/\b(LAN|subnet|IP|port|http)\b/i);
  expect(said).toMatch(/Connected/i);

  /* And the addresses are not on screen until asked for. */
  await expect(page.locator('#connMore')).toBeHidden();
});

test('it says the app changes doors by itself', async ({ page }) => {
  /*
   * The one fact that stops somebody opening settings in a car park. Without
   * it, "Connected in the shop" reads as something that will break when they
   * leave.
   */
  await atTheConnectionPage(page);
  await expect(page.locator('#connNote')).toContainText(/by itself/i);
});

test('the addresses and the choices are one tap away, then gone again', async ({ page }) => {
  await atTheConnectionPage(page);

  await page.locator('#connMoreBtn').click();
  await expect(page.locator('#connMore')).toBeVisible();
  await expect(page.locator('#connLan')).toHaveText('192.168.1.8:5555');
  await expect(page.locator('#connCloud')).toHaveText('azure.posnic.io');

  await page.locator('#connMoreBtn').click();
  await expect(page.locator('#connMore')).toBeHidden();
});

test('the three ways are the pin, in words', async ({ page }) => {
  await atTheConnectionPage(page);
  await page.locator('#connMoreBtn').click();

  /* Automatic to begin with, which is no pin at all. */
  await expect(page.locator('input[name="conn_way"][value="auto"]')).toBeChecked();

  await page.locator('input[name="conn_way"][value="lan"]').check();
  expect(await page.evaluate(() => POSNIC.server.pinned)).toBe(LAN);

  await page.locator('input[name="conn_way"][value="cloud"]').check();
  expect(await page.evaluate(() => POSNIC.server.pinned)).toBe(CLOUD);

  await page.locator('input[name="conn_way"][value="auto"]').check();
  expect(await page.evaluate(() => POSNIC.server.pinned)).toBeNull();
});

test('a way with no address behind it cannot take the phone off the air', async ({ page }) => {
  /*
   * "Only in the shop" with no till found would leave the handset unable to
   * reach anything, and the fix would be on the screen it had just left.
   */
  await atTheConnectionPage(page, { lan: null, cloud: CLOUD });
  await page.locator('#connMoreBtn').click();

  /* Clicked, not checked: `check()` insists the box STAYS ticked, and the
     whole point here is that it does not - the refusal puts it back. */
  await page.locator('input[name="conn_way"][value="lan"]').click();

  expect(await page.evaluate(() => POSNIC.server.pinned)).toBeNull();
  await expect(page.locator('#serverSaveMsg')).toContainText(/has not been found/i);
  /* And the radio goes back to the truth rather than showing a choice that
     was refused. */
  await expect(page.locator('input[name="conn_way"][value="auto"]')).toBeChecked();
});

test('a pinned phone is told it will stay put', async ({ page }) => {
  /* Somebody who forced a door months ago should not have to work out why the
     app no longer moves. */
  await atTheConnectionPage(page, { pinned: CLOUD });
  await expect(page.locator('#connNote')).toContainText(/stay on the internet/i);
});

test('a handset with no shop yet sees the ways in, not a status about nothing', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof openServerModal === 'function');
  await page.evaluate(() => openServerModal());

  await expect(page.locator('#connectState')).toBeHidden();
  await expect(page.locator('#connectChoices')).toBeVisible();
});

test('the till not answering is not a thing to configure', async ({ page }) => {
  /*
   * When it is down the honest advice is to wait: the app retries on its own,
   * and a settings page that implies otherwise gets somebody pinning an
   * address at the worst possible moment.
   */
  await atTheConnectionPage(page);
  await page.evaluate(() => {
    POSNIC.net.setOffline();
    renderConnection();
  });

  await expect(page.locator('#connDot')).toHaveClass(/is-down/);
  await expect(page.locator('#connNote')).toContainText(/Trying again by itself/i);
});
