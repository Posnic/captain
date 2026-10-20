import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
async function setup(page, patch = {}) {
  await onTheMenu(page, 'nothing');
  const state = { enabled: true, canManage: false, branchId: 'b1', shift: null, ...patch };
  const posts = [];
  await page.route('**/captain/v1/attendance', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: state });
    const body = route.request().postDataJSON(); posts.push(body);
    const shift = { id: 's1', branchId: 'b1', clockIn: new Date().toISOString(), status: 'open' };
    if (body.action === 'end') { shift.status = 'closed'; shift.clockOut = new Date().toISOString(); }
    state.shift = shift.status === 'open' ? shift : null;
    return route.fulfill({ json: { confirmed: true, shift } });
  });
  await page.goto('/me.html#shift');
  return { state, posts };
}
test('staff starts and ends a shift; reload preserves the server record', async ({ page }) => {
  const { posts } = await setup(page);
  await expect(page.locator('#shift-status')).toHaveText('Not on shift');
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await expect(page.locator('#shift-status')).toHaveText('On shift');
  await page.reload();
  await expect(page.locator('#shift-status')).toHaveText('On shift');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'End shift', exact: true }).click();
  await expect(page.locator('#shift-status')).toHaveText('Shift ended');
  expect(posts.map(p => p.action)).toEqual(['start', 'end']);
  await expect(page.locator('#shift-settings')).toBeHidden();
});
test('attendance stays off until manager saves opt-in', async ({ page }) => {
  const { state } = await setup(page, { enabled: false, canManage: true });
  await page.route('**/captain/v1/attendance/settings', route => {
    state.enabled = route.request().postDataJSON().enabled;
    return route.fulfill({ json: { saved: true, enabled: state.enabled } });
  });
  await expect(page.locator('#shift-action')).toBeHidden();
  await expect(page.locator('#shift-enabled')).not.toBeChecked();
  await page.locator('#shift-enabled').check();
  await page.locator('#shift-save').click();
  await expect(page.locator('#shift-action')).toBeVisible();
});
test('Internet cannot record attendance; Wi-Fi explanation remains actionable', async ({ page }) => {
  await setup(page);
  await page.route('**/captain/v1/attendance', route => route.fulfill({ status: 409, json: { error: { code: 'ATTENDANCE_WIFI_REQUIRED', message: 'Wi-Fi required' } } }));
  await page.locator('#shift-refresh').click();
  await expect(page.locator('#shift-status')).toHaveText('Connect to the shop Wi-Fi to record your shift.');
  await expect(page.locator('#shift-action')).toBeHidden();
  await expect(page.locator('#shift-refresh')).toBeEnabled();
});
test('lost mutation response requires refresh, never optimistic success', async ({ page }) => {
  await setup(page);
  await page.route('**/captain/v1/attendance', route => route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Unavailable' } } }));
  await page.locator('#shift-action').click();
  await expect(page.locator('#shift-status')).toHaveText('Could not confirm your shift. Refresh before trying again.');
  await expect(page.locator('#shift-action')).toBeHidden();
});
for (const theme of ['light', 'dark']) test(`shift screen fits a small phone in ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await setup(page, { canManage: true });
  await page.evaluate(theme => window.CaptainAppearance.set(theme), theme);
  await expect(page.locator('#shift-action')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/attendance-${theme}.png`, fullPage: true });
});
