import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
test('globe offers actionable sign-in, cancellation preserves Wi-Fi, and login links separate credentials',async({page})=>{
 await nativePhone(page);
 await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 await page.route('http://192.168.1.20:5555/**',r=>r.fulfill({json:{connected:true}}));
 const posts=[];
 await page.route('https://backup.example/**',async r=>{if(r.request().url().endsWith('/kioskMobileLogin')){posts.push(r.request().headers());await r.fulfill({json:{token:'cloud-token',shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]}})}else await r.fulfill({json:{connected:true}})});
 await page.evaluate(async()=>{await POSNIC.session.start({base:'http://192.168.1.20:5555/api',token:'wifi-token',shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]});POSNIC.server.remember({lan:'http://192.168.1.20:5555/api',cloud:'https://backup.example/api'});POSNIC.server.pin('http://192.168.1.20:5555/api');});
 const globe=page.locator('[data-route-signal=remote]').first();
 await globe.click();const sheet=page.locator('#connection-signin');await expect(sheet).toBeVisible();
 await expect(sheet.getByRole('button',{name:'Sign in with Posnic Cloud',exact:true})).toBeVisible();
 await sheet.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(await page.evaluate(()=>POSNIC.server.isLocal)).toBe(true);
 await globe.click();await sheet.locator('[name=username]').fill('staff');await sheet.locator('[name=password]').fill('password');await sheet.locator('[type=submit]').click();
 await expect(sheet).toHaveCount(0);expect(await page.evaluate(()=>POSNIC.server.isLocal)).toBe(false);
 expect(posts).toHaveLength(1);expect(posts[0].authorization).toBeUndefined();
 expect(await page.evaluate(()=>POSNIC.session.hasCredential('http://192.168.1.20:5555/api'))).toBe(true);
});



async function nativePhone(page){
 await page.addInitScript(()=>{
  const status=()=>({session:JSON.parse(localStorage.getItem('test.vault')||'{}'),pinSet:false,locked:false});
  window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',Plugins:{SecureSession:{status:async()=>status(),save:async({session})=>{localStorage.setItem('test.vault',JSON.stringify(session));return status()},clear:async()=>localStorage.removeItem('test.vault'),openBrowser:async()=>{}},LocalNetwork:{getLocalIp:async()=>({wifi:true,ip:'192.168.1.13'})}}};
 });
}

test('Posnic Cloud approval adds Internet without replacing the Wi-Fi grant',async({page})=>{
 await nativePhone(page);await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 await page.evaluate(async()=>{await POSNIC.session.start({base:'http://192.168.1.20:5555/api',token:'wifi-token',shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]});POSNIC.server.remember({lan:'http://192.168.1.20:5555/api',cloud:'https://backup.example/api'});POSNIC.server.pin('http://192.168.1.20:5555/api');});
 await page.route('https://www.posnic.com/**',r=>r.fulfill({json:r.request().url().endsWith('/capabilities')?{applications:['captain']}:r.request().url().endsWith('/requests')?{request:'a'.repeat(43),authorizationUrl:'https://www.posnic.com/api/mobile/authorize?request='+'a'.repeat(43),expiresIn:900}:{baseUrl:'https://backup.example/api',code:'ABCDEF123456',application:'captain',localServers:[]}}));
 await page.route('https://backup.example/**',r=>r.fulfill({json:r.request().url().endsWith('/pair')?{token:'cloud-token',shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]}:{connected:true}}));
 await page.locator('[data-route-signal=remote]').click();await page.locator('#connection-signin [data-cloud]').click();
 await expect(page).toHaveURL(/index.html/);
 await expect(page).toHaveURL(/kot-management.html/,{timeout:20000});
 const vault=await page.evaluate(()=>JSON.parse(localStorage.getItem('test.vault')));
 expect(vault.token).toBe('wifi-token');expect(vault.connections[0].token).toBe('cloud-token');
});
