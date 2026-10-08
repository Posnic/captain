import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
import {readFileSync} from 'node:fs';

test('switch confirmations remain readable and actionable in all 30 languages',async({page})=>{
 await page.setViewportSize({width:320,height:740});
 await onTheMenu(page,'nothing');
 for(const {code} of JSON.parse(readFileSync('assets/common/locales/manifest.json','utf8'))){
  const words=JSON.parse(readFileSync(`assets/common/locales/${code}.json`,'utf8'));
  await page.evaluate(code=>{I18N.use(code);POSNIC.internetChoice.reset('https://smoke.posnic.io/api');localStorage.setItem('posnic.automatic-connections','0');POSNIC.server.pin('http://192.168.1.20:5555/api');POSNIC.internetChoice.setWifi(false);POSNIC.internetChoice.ask('https://smoke.posnic.io/api');},code);
  const sheet=page.locator('#captain-internet-consent');
  await expect(sheet.getByRole('heading')).toHaveText(words['Shop Wi-Fi isn’t available']);
  const accept=sheet.getByRole('button',{name:words['Use internet'],exact:true});
  await expect(accept).toBeInViewport();
  await expect(sheet.getByRole('button',{name:words['Connect to Wi-Fi'],exact:true})).toBeInViewport();
  await page.evaluate(()=>document.fonts.ready);
  for(const button of await sheet.getByRole('button').all()){
   const box=await button.boundingBox();
   expect(box.y,`${code}: action above viewport`).toBeGreaterThanOrEqual(0);
   expect(box.y+box.height,`${code}: action below viewport`).toBeLessThanOrEqual(740);
  }
  expect(await sheet.evaluate(el=>el.scrollWidth<=el.clientWidth),`${code}: horizontal overflow`).toBe(true);
  if(['ta','ne','ar','de','ja'].includes(code))await page.screenshot({path:`test-artifacts/connection-switch-${code}.png`});
  await accept.click();
 }
});
test('Wi-Fi fallback waits for consent and does not repeatedly prompt after refusal',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{
  localStorage.setItem('posnic.automatic-connections','0');
  POSNIC.server.pin('http://192.168.1.20:5555/api');
  window.switchResult=undefined;
  POSNIC.internetChoice.ask('https://smoke.posnic.io/api').then(v=>window.switchResult=v);
 });
 await expect(page.locator('#captain-internet-consent')).toBeVisible();
 await expect(page.locator('#captain-internet-consent')).toContainText('Your order stays safe');
 expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toContain('192.168.1.20');
 await page.getByRole('button',{name:'Wait for shop Wi-Fi',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.switchResult)).toBe(false);
 expect(await page.evaluate(()=>POSNIC.internetChoice.ask('https://smoke.posnic.io/api'))).toBe(false);
 await expect(page.locator('#captain-internet-consent')).toHaveCount(0);
 await page.locator('#captain-internet-choice').click();
 await expect(page.locator('#captain-internet-consent')).toBeVisible();
 await page.screenshot({path:'test-artifacts/internet-switch-consent.png'});
 await page.getByRole('button',{name:'Use internet',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>POSNIC.internetChoice.allowed('https://smoke.posnic.io/api'))).toBe(true);
});

test('returning Wi-Fi asks once and the confirmation can enable automatic switching',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{localStorage.setItem('posnic.automatic-connections','0');POSNIC.internetChoice.ask('http://192.168.1.20:5555/api');});
 await expect(page.getByRole('heading',{name:'Shop Wi-Fi is back'})).toBeVisible();
 await page.getByLabel('Switch automatically next time').check();
 await page.getByRole('button',{name:'Use shop Wi-Fi',exact:true}).click();
 expect(await page.evaluate(()=>localStorage.getItem('posnic.automatic-connections'))).toBe('1');
 expect(await page.evaluate(()=>POSNIC.internetChoice.ask('http://192.168.1.21:5555/api'))).toBe(true);
});

test('Wi-Fi off offers phone settings and never changes the route before consent',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{localStorage.setItem('posnic.automatic-connections','0');POSNIC.server.pin('http://192.168.1.20:5555/api');POSNIC.internetChoice.setWifi(false);window.Capacitor={Plugins:{LocalNetwork:{openWifiSettings:async()=>{window.openedWifi=true;}}}};POSNIC.internetChoice.ask('https://smoke.posnic.io/api');});
 await expect(page.getByRole('heading',{name:'Shop Wi-Fi isn’t available'})).toBeVisible();
 await page.getByRole('button',{name:'Connect to Wi-Fi',exact:true}).click();
 expect(await page.evaluate(()=>window.openedWifi)).toBe(true);
 expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toContain('192.168.1.20');
});

test('returning route needs three separated successful checks and failure resets stability',async({page})=>{
 await onTheMenu(page,'nothing');
 expect(await page.evaluate(()=>{let now=100000;const real=Date.now;Date.now=()=>now;const url='http://192.168.1.90:5555/api';try{const a=POSNIC.internetChoice.ready(url);const b=POSNIC.internetChoice.ready(url);now+=3000;const c=POSNIC.internetChoice.ready(url);now+=3000;const d=POSNIC.internetChoice.ready(url);POSNIC.internetChoice.failed(url);return[a,b,c,d,POSNIC.internetChoice.ready(url)];}finally{Date.now=real;}})).toEqual([false,false,false,true,false]);
});

test('declining Wi-Fi return lasts until the current connection fails, not each health tick',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.evaluate(()=>{localStorage.setItem('posnic.automatic-connections','0');POSNIC.internetChoice.ask('http://192.168.1.20:5555/api');});
 await page.getByRole('button',{name:'Stay on internet',exact:true}).click();
 expect(await page.evaluate(()=>POSNIC.internetChoice.ask('http://192.168.1.20:5555/api'))).toBe(false);
 await page.evaluate(()=>{POSNIC.internetChoice.failed(POSNIC.server.baseUrl);POSNIC.internetChoice.ask('http://192.168.1.20:5555/api');});
 await expect(page.locator('#captain-internet-consent')).toBeVisible();
 await page.getByRole('button',{name:'Stay on internet',exact:true}).click();
 expect(await page.evaluate(()=>{POSNIC.internetChoice.failed(POSNIC.server.baseUrl);return POSNIC.internetChoice.ask('http://192.168.1.20:5555/api');})).toBe(false);
});

for(const width of [320,390,768])for(const theme of ['light','dark'])test(`switch sheet fits ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:844});await onTheMenu(page,'nothing');
 await page.evaluate(theme=>{document.documentElement.setAttribute('data-color-scheme',theme);localStorage.setItem('posnic.automatic-connections','0');POSNIC.server.pin('http://192.168.1.20:5555/api');POSNIC.internetChoice.ask('https://smoke.posnic.io/api');},theme);
 const sheet=page.locator('#captain-internet-consent');await expect(sheet).toBeVisible();
 const bounds=await sheet.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(845);
 await expect(page.getByRole('button',{name:'Use internet',exact:true})).toBeInViewport();
 await page.screenshot({path:`test-artifacts/connection-switch-${width}-${theme}.png`});
});
