import {test,expect} from '@playwright/test';

async function standalone(page) {
  await page.route('**/package-host.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body><main id="setup"></main></body></html>'}));
  await page.goto('/package-host.html');
  await page.addScriptTag({url:'/packages/connection-setup/index.js'});
  await page.addScriptTag({url:'/packages/connection-setup/browser.js'});
  await page.addStyleTag({url:'/packages/connection-setup/styles.css'});
}
test('standalone host renders only supported methods and disposes its callbacks',async({page})=>{
  await standalone(page);
  await page.evaluate(()=>{
    window.selected=[];
    window.dispose=PosnicConnectionSetupUI.mountMethods(document.querySelector('main'),{
      supported:['cloud','address'],posnicLogo:'/packages/connection-setup/assets/posnic-mark.svg',onSelect:id=>selected.push(id)
    });
  });
  await expect(page.getByRole('button')).toHaveCount(2);
  await page.getByRole('button',{name:'Posnic Cloud'}).click();
  expect(await page.evaluate(()=>selected)).toEqual(['cloud']);
  expect(await page.evaluate(()=>typeof POSNIC)).toBe('undefined');
  expect(await page.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await page.evaluate(()=>dispose());await expect(page.getByRole('button')).toHaveCount(0);
});
test('separate brands mount safely, support translation and keyboard selection',async({page})=>{
  await standalone(page);
  await page.setViewportSize({width:320,height:800});
  await page.evaluate(()=>{
    const root=document.querySelector('main');root.dir='rtl';root.style.cssText='--surface:#151c27;--ink:#eef3fa;--surface-sunk:#212d3f;--line:#354154;--accent:#8bb3ff';
    window.continued=[];
    for(const name of ['Captain','Posnic POS','Posnic Business']){
      const section=document.createElement('section');root.append(section);
      PosnicConnectionSetupUI.renderWelcome(section,{name,logo:'/packages/connection-setup/assets/posnic-mark.svg',steps:['<img src=x onerror=alert(1)>'],copy:{continueLabel:'Continue '+name},onContinue:()=>continued.push(name)});
    }
  });
  await expect(page.locator('strong')).toHaveText(['Captain','Posnic POS','Posnic Business']);
  await expect(page.locator('.pc-welcome-step img')).toHaveCount(0);
  await page.getByRole('button',{name:'Continue Posnic Business'}).focus();await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>continued)).toEqual(['Posnic Business']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('Captain keeps real cloud, QR and other-method handlers after shared rendering',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('posnic.setup-intro-seen','1'));
  await page.goto('/index.html');
  await expect(page.locator('#captain-cloud-login img')).toBeVisible();
  await page.getByRole('button',{name:'Other ways to connect'}).click();
  await page.getByRole('button',{name:'Shop code or server address',exact:true}).click();
  await expect(page.locator('#captain-server')).toBeVisible();
  await page.locator('#connection-back').click();
  await page.getByRole('button',{name:'Posnic Cloud',exact:true}).click();
  await expect(page.locator('#captain-cloud-staff')).toBeVisible();
  await page.locator('#captain-cloud-owner').click();
  await expect(page.locator('#captain-note')).toContainText('Install the Android app');
});
