import { test, expect } from '@playwright/test';
import { onTheMenu } from './support/shop.js';
async function open(page) {
  await onTheMenu(page,'nothing');
  await page.route('**/captain/v1/profile', async route=>route.fulfill({json:{id:'user-1',name:route.request().method()==='POST'?route.request().postDataJSON().name:'Staff',email:'staff@example.test',phone:'+919000000000'}}));
  await page.goto('/me.html#account');
}
test('profile edits persist through the API and Back returns to the account page',async({page})=>{
  await open(page);await page.locator('#me-profile').click();
  await expect(page.locator('#profile-name')).toHaveValue('Staff');
  await page.locator('#profile-name').fill('Floor captain');
  await page.locator('#profile-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('Saved');
  await page.locator('#me-back').click();
  await expect(page.locator('#me-who')).toHaveText('Floor captain');
  await expect(page.locator('#me-password')).toBeVisible();
});
test('password validation preserves typing and a successful change keeps saved orders on the phone',async({page})=>{
  await open(page);const posts=[];
  await page.route('**/captain/v1/password',route=>{posts.push(route.request().postDataJSON());return route.fulfill({json:{saved:true,reauthenticate:true}})});
  await page.evaluate(()=>localStorage.setItem('profile-test-preserved','saved-order'));
  await page.locator('#me-password').click();
  await page.locator('#currentPassword').fill('old-secret-123');
  await page.locator('#newPassword').fill('new-secret-123');
  await page.locator('#confirmPassword').fill('mismatch');
  await page.locator('#profile-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toContainText('repeat');expect(posts).toHaveLength(0);
  await expect(page.locator('#newPassword')).toHaveValue('new-secret-123');
  await page.locator('#confirmPassword').fill('new-secret-123');
  await page.locator('#profile-form button[type=submit]').click();
  await expect(page).toHaveURL(/index.html/);
  expect(posts).toHaveLength(1);
  expect(await page.evaluate(()=>localStorage.getItem('profile-test-preserved'))).toBe('saved-order');
});

for (const action of ['header', 'cancel', 'native', 'browser']) {
  test(`unsaved profile survives declined ${action} Back`, async ({page}) => {
    await open(page);
    await page.locator('#me-back').click();
    await page.locator('a[href="#account"]').click();
    await page.locator('#me-profile').click();
    await page.locator('#profile-name').fill('Unsaved captain');
    let accept = false;
    const dialogs = [];
    page.on('dialog', async dialog => {
      dialogs.push(dialog.message());
      await (accept ? dialog.accept() : dialog.dismiss());
    });
    const leave = async () => {
      if (action === 'header') await page.locator('#me-back').click();
      else if (action === 'cancel') await page.locator('[data-profile-back]').click();
      else if (action === 'native') await page.evaluate(() => window.dispatchEvent(new Event('captain:back', {cancelable:true})));
      else await page.goBack();
    };
    await leave();
    await expect.poll(() => dialogs.length).toBe(1);
    await expect(page.locator('#profile-name')).toHaveValue('Unsaved captain');
    await expect(page.locator('.me-title')).toHaveText('Profile details');
    await expect(page).toHaveURL(/#account$/);
    accept = true;
    // Use the visible Back button after a declined browser history traversal.
    await page.locator('#me-back').click();
    await expect(page.locator('#me-password')).toBeVisible();
    expect(dialogs).toEqual(['Discard changes?', 'Discard changes?']);
  });
}

test('failed password save preserves the draft and cancel requires confirmation', async ({page}) => {
  await open(page);
  await page.route('**/captain/v1/password', route => route.fulfill({status:400,json:{message:'incorrect'}}));
  await page.locator('#me-password').click();
  await page.locator('#currentPassword').fill('wrong-secret');
  await page.locator('#newPassword').fill('new-secret-123');
  await page.locator('#confirmPassword').fill('new-secret-123');
  await page.locator('#profile-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('The current password is incorrect.');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#me-back').click();
  await expect(page.locator('#newPassword')).toHaveValue('new-secret-123');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-profile-back]').click();
  await expect(page.locator('#me-password')).toBeVisible();
});


async function phoneScreen(page) {
  await open(page);
  await page.locator('#me-profile').click();
  await page.locator('#profile-name').fill('Draft name');
  await page.locator('[data-profile-phone]').click();
  await page.locator('#phone-password').fill('staff-password');
}
const challenge = {challenge:'phone-challenge',expiresAt:'2099-01-01T00:00:00Z',retryAfter:60};

test('phone verification saves only after confirmation and preserves the name draft', async ({page}) => {
  await phoneScreen(page);
  const posts=[];
  await page.route('**/captain/v1/profile/phone/*', route => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({json:route.request().url().endsWith('/start') ? challenge : {saved:true,phone:'+919111111111'}});
  });
  await page.locator('#phone-number').fill('+91 91111 11111');
  await page.locator('[data-phone-send]').click();
  await expect(page.locator('#phone-code')).toBeVisible();
  await expect(page.locator('[data-phone-resend]')).toBeDisabled();
  await page.locator('#phone-code').fill('012345');
  await page.locator('#phone-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('Saved');
  await expect(page.locator('#profile-name')).toHaveValue('Draft name');
  await expect(page.locator('.profile-detail').last()).toContainText('+919111111111');
  expect(posts).toEqual([{phone:'+919111111111',currentPassword:'staff-password'},{challenge:'phone-challenge',code:'012345'}]);
});

test('expired code can be resent, invalid code keeps typing, and native Back steps out', async ({page}) => {
  await phoneScreen(page);
  let starts=0, verifies=0;
  await page.route('**/captain/v1/profile/phone/*', route => {
    if(route.request().url().endsWith('/start')) { starts++; return route.fulfill({json:challenge}); }
    verifies++;
    return route.fulfill({status:verifies===1?400:409,json:{message:'Invalid'}});
  });
  await page.locator('#phone-number').fill('+919111111111');
  await page.locator('[data-phone-send]').click();
  await page.locator('#phone-code').fill('123456');
  await page.locator('#phone-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('Check the verification code.');
  await expect(page.locator('#phone-code')).toHaveValue('123456');
  await page.locator('#phone-form button[type=submit]').click();
  await expect(page.locator('#profile-message')).toHaveText('Request a new verification code.');
  await page.locator('[data-phone-resend]').click();
  await expect.poll(()=>starts).toBe(2);
  await expect(page.locator('#phone-code')).toHaveValue('');
  await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));
  await expect(page.locator('#phone-number')).toHaveValue('+919111111111');
  await page.locator('[data-profile-back]').click();
  await expect(page.locator('#profile-name')).toHaveValue('Draft name');
  await expect(page.locator('.profile-detail').last()).toContainText('+919000000000');
});

for(const status of [400,404,503]) test(`phone start failure ${status} preserves the number`,async({page})=>{
  await phoneScreen(page);
  await page.route('**/captain/v1/profile/phone/start',route=>route.fulfill({status,json:{message:'Unavailable'}}));
  await page.locator('#phone-number').fill('+919111111111');
  await page.locator('[data-phone-send]').click();
  await expect(page.locator('#profile-message')).toContainText(status===400?'current password is incorrect':status===404?'too old':'SMS settings');
  await expect(page.locator('#phone-number')).toHaveValue('+919111111111');
  await expect(page.locator('[data-phone-send]')).toBeEnabled();
});


for (const width of [320,768]) test(`phone change fits ${width}px and clears password when leaving`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await phoneScreen(page);
  await expect(page.locator('#phone-password')).toHaveAttribute('autocomplete','current-password');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('[data-profile-back]').click();
  await page.locator('[data-profile-phone]').click();
  await expect(page.locator('#phone-password')).toHaveValue('');
  await expect(page.locator('#phone-number')).toHaveValue('+919000000000');
});
