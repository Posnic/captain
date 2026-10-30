import {test,expect} from '@playwright/test';
import {onTheMenu,RUNTIME_INFO} from './support/shop.js';
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
  window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',Plugins:{SecureSession:{status:async()=>status(),save:async({session})=>{localStorage.setItem('test.vault',JSON.stringify(session));return status()},clear:async()=>localStorage.removeItem('test.vault'),openBrowser:async()=>{}},LocalNetwork:{request:async({url,method,headers,body})=>{const r=await fetch(url,{method,headers,body});return {status:r.status,headers:Object.fromEntries(r.headers),data:btoa(String.fromCharCode(...new Uint8Array(await r.arrayBuffer()))) };},getLocalIp:async()=>({wifi:true,ip:'192.168.1.13'})}}};
 });
}

for(const role of ['owner','staff'])test(`Posnic Cloud ${role} finds Internet, then separate staff sign-in preserves the Wi-Fi grant`,async({page})=>{
 await nativePhone(page);await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 await page.evaluate(async()=>{await POSNIC.session.start({base:'http://192.168.1.20:5555/api',token:'wifi-token',shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]});POSNIC.server.remember({lan:'http://192.168.1.20:5555/api',cloud:'https://backup.example/api'});POSNIC.server.pin('http://192.168.1.20:5555/api');});
 await page.route('https://www.posnic.com/**',r=>r.fulfill({json:r.request().url().endsWith('/capabilities')?{applications:['captain']}:r.request().url().endsWith('/requests')?{request:'a'.repeat(43),authorizationUrl:'https://www.posnic.com/api/mobile/authorize?request='+'a'.repeat(43),expiresIn:900}:{baseUrl:'https://backup.example/api',code:'ABCDEF123456',application:'captain',localServers:[]}}));
 await page.route('https://backup.example/**',r=>r.fulfill({json:r.request().url().endsWith('/kioskMobileLogin')?{token:'cloud-token',shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]}:{connected:true}}));
 await page.locator('[data-route-signal=remote]').click();await page.locator('#connection-signin [data-cloud]').click();
 await expect(page).toHaveURL(/index.html/);
 await page.locator('#captain-cloud-'+role).click();
 if(role==='staff'){
   await page.evaluate(()=>{POSNIC.discovery.probe=async base=>({base,info:{}});});
   await page.locator('#captain-server').fill('backup.example');
   await page.locator('#captain-connect').click();
 }
 await expect(page).toHaveURL(/kot-management.html/,{timeout:20000});
 const sheet=page.locator('#connection-signin');await expect(sheet).toBeVisible();
 expect(await page.evaluate(()=>POSNIC.server.isLocal)).toBe(true);
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('test.vault')).connections||[])).toEqual([]);
 await sheet.locator('[name=username]').fill('staff');await sheet.locator('[name=password]').fill('password');await sheet.locator('[type=submit]').click();await expect(sheet).toHaveCount(0);
 const vault=await page.evaluate(()=>JSON.parse(localStorage.getItem('test.vault')));
 expect(vault.token).toBe('wifi-token');expect(vault.connections[0].token).toBe('cloud-token');
});

test('disabled Captain refuses a new route without saving its credential',async({page})=>{
 await nativePhone(page);await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 await page.route('https://disabled.example/**',r=>r.fulfill(r.request().url().includes('/getListKot')?{status:403,json:{error:{code:'CAPTAIN_DISABLED',message:'Captain is disabled.'}}}:{json:{token:'rejected-token',shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]}}));
 await page.evaluate(()=>CaptainConnectionSignIn.open('cloud',{base:'https://disabled.example/api'}));
 const sheet=page.locator('#connection-signin');await sheet.locator('[name=username]').fill('staff');await sheet.locator('[name=password]').fill('password');await sheet.locator('[type=submit]').click();
 await expect(sheet.locator('[role=status]')).toHaveText('Captain is disabled.');
 expect(await page.evaluate(()=>POSNIC.session.hasCredential('https://disabled.example/api'))).toBe(false);
 await sheet.getByRole('button',{name:'Cancel',exact:true}).click();await expect(sheet).toHaveCount(0);
});

test('Wi-Fi sign-in search selects a discovered till without switching the active route',async({page})=>{
 await nativePhone(page);await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 const before=await page.evaluate(()=>POSNIC.server.baseUrl);
 await page.route('http://192.168.1.11:5555/api/captain/v1/discovery',r=>r.fulfill({json:{connections:{shopName:'Test kitchen'}}}));
 await page.evaluate(()=>{POSNIC.discovery.probe=async()=>null;POSNIC.discovery.scanSubnet=async(subnet,options)=>{options.collect({base:'http://192.168.1.11:5555/api',info:{connections:{shopName:'Test kitchen'}}});};CaptainConnectionSignIn.open('lan');});
 const sheet=page.locator('#connection-signin');await sheet.getByRole('button',{name:'Search this Wi-Fi',exact:true}).click();await sheet.getByRole('button',{name:/Test kitchen/}).click();await page.locator('dialog').last().getByRole('button',{name:'Connect',exact:true}).click();
 await expect(sheet.locator('[name=address]')).toHaveValue('http://192.168.1.11:5555/api');expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toBe(before);
});

test('Captain disabled during service offers recovery without clearing the saved session',async({page})=>{
 await nativePhone(page);await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 await page.route('**/sales/getListKot?**',r=>r.fulfill({status:403,json:{error:{code:'CAPTAIN_DISABLED',message:'Captain is disabled.'}}}));
 await page.evaluate(async()=>{try{await POSNIC.api.get('/sales/getListKot?page=1&limit=1');}catch{}});
 const dialog=page.locator('#captain-disabled');await expect(dialog).toBeVisible();await expect(dialog).toContainText('Captain is disabled.');
 expect(await page.evaluate(()=>POSNIC.session.active)).toBe(true);
 await dialog.getByRole('button',{name:'Change server',exact:true}).click();await expect(page).toHaveURL(/index.html/);await expect(page.locator('#captain-onboarding')).toBeVisible();
});

for (const paired of [true,false]) test(`a reinstalled till reconnects without reinstalling Captain (${paired?'paired':'password-only'})`,async({page})=>{
 await nativePhone(page);await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 const base='http://192.168.1.20:5555/api',calls=[];
 await page.route(base+'/**',async route=>{
  const request=route.request();calls.push({url:request.url(),headers:request.headers()});
  if(request.url().endsWith('/runtime-info'))return route.fulfill({json:RUNTIME_INFO});
  if(request.headers().authorization==='Bearer old-token')return route.fulfill({status:401,json:{message:'Invalid token'}});
  if(request.url().endsWith('/route-proof'))return route.fulfill({status:404,json:{error:{code:'UNKNOWN_AUTHORITY',message:'This address cannot deliver orders for this session.'}}});
  if(request.url().endsWith('/kioskMobileLogin'))return route.fulfill({json:{token:'replacement-token',shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]}});
  return route.fulfill({json:{connected:true}});
 });
 await page.evaluate(async ({base,paired})=>{
  await POSNIC.session.start({base,token:'old-token',...(paired?{refreshToken:'old-refresh',routeKey:'a'.repeat(64),sessionId:'old-session',expiresAt:1}:{}),shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]});
  POSNIC.server.remember({lan:base});POSNIC.server.pin(base);
  localStorage.setItem('reinstall-test-draft','retained');
  try{await POSNIC.session.request('/captain/v1/session',{method:'GET',onlyBase:base});}catch{}
 },{base,paired});
 const dialog=page.locator('#connection-signin');await expect(dialog).toBeVisible();
 await expect(dialog.locator('[name=address]')).toHaveValue(base);
 if(paired)expect(calls.every(call=>!call.headers.authorization)).toBe(true);
 await dialog.locator('[name=username]').fill('staff');await dialog.locator('[name=password]').fill('password');await dialog.locator('[type=submit]').click();
 await expect(dialog).toHaveCount(0);
 expect(await page.evaluate(()=>POSNIC.session.token)).toBe('replacement-token');
 expect(await page.evaluate(()=>localStorage.getItem('reinstall-test-draft'))).toBe('retained');
});

test('an expired password-only login still opens the saved-address recovery form',async({page})=>{
 await nativePhone(page);await onTheMenu(page,'nothing');await page.goto('/kot-management.html');
 await page.evaluate(async()=>{
  const base='http://192.168.1.20:5555/api';
  await POSNIC.session.start({base,token:'expired-token',expiresAt:1,shopKey:'smoke-shop-key',user:{id:'user-1'},branches:[{branch_id:'branch-1'}]});
  POSNIC.server.remember({lan:base});POSNIC.server.pin(base);
  try{await POSNIC.session.request('/captain/v1/session',{method:'GET',onlyBase:base});}catch{}
 });
 await expect(page.locator('#connection-signin')).toBeVisible();
 await expect(page.locator('#connection-signin [name=address]')).toHaveValue('http://192.168.1.20:5555/api');
});
