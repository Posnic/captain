import {test,expect} from '@playwright/test';
import {onTheMenu,API_BASE} from './support/shop.js';
import {readFileSync} from 'node:fs';
const LAN='http://192.168.1.20:5555/api';

test('background route checks never open a switch confirmation in any language',async({page})=>{
 await onTheMenu(page,'nothing');
 for(const {code} of JSON.parse(readFileSync('assets/common/locales/manifest.json','utf8'))){
  const accepted=await page.evaluate(({code,LAN})=>{I18N.use(code);return POSNIC.internetChoice.ask(LAN);},{code,LAN});
  expect(accepted).toBe(false);
  await expect(page.locator('#captain-internet-consent')).toHaveCount(0);
  expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toBe(API_BASE);
 }
});

test('an old automatic preference migrates to manual without changing the selected server',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>localStorage.setItem('posnic.automatic-connections','1'));
 await page.reload();
 expect(await page.evaluate(()=>localStorage.getItem('posnic.automatic-connections'))).toBe('0');
 expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toBe(API_BASE);
});

for(const width of [320,390,768])for(const theme of ['light','dark'])test(`route sign-in fits ${width} ${theme} and Cancel preserves the working session`,async({page})=>{
 await page.setViewportSize({width,height:844});await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 await page.evaluate(({theme,LAN})=>{document.documentElement.setAttribute('data-color-scheme',theme);CaptainConnectionSignIn.open('lan',{base:LAN});},{theme,LAN});
 const sheet=page.locator('#connection-signin');await expect(sheet).toBeVisible();
 expect(await sheet.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(sheet.locator('[name=address]')).toHaveValue(LAN);
 await sheet.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toBe(API_BASE);
 expect(await page.evaluate(()=>POSNIC.session.active)).toBe(true);
});
