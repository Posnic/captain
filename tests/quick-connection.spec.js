import {test,expect} from '@playwright/test';
import {onTheMenu,RUNTIME_INFO,API_BASE} from './support/shop.js';
const lan='http://192.168.1.20:5555/api';
async function setup(page){
 await onTheMenu(page,'nothing');
 await page.route('http://192.168.1.20:5555/**',r=>r.fulfill({json:RUNTIME_INFO}));
 await page.goto('/kot-management.html');
 await page.evaluate(lan=>{POSNIC.server.remember({lan,cloud:POSNIC.server.baseUrl});POSNIC.server.recordShop(lan,POSNIC.session.shopKey);POSNIC.server.recordShop(POSNIC.server.baseUrl,POSNIC.session.shopKey);localStorage.setItem('posnic.automatic-connections','0');},lan);
}
test('corner icons switch both ways and remain manually selected without opening settings',async({page})=>{
 await setup(page);
 await page.locator('[data-route-signal=local]').click();
 await expect.poll(()=>page.evaluate(()=>POSNIC.server.baseUrl)).toBe(lan);
 await expect(page.locator('[data-route-signal=local]')).toHaveClass(/is-active/);
 await expect(page).toHaveURL(/kot-management.html/);
 expect(await page.evaluate(()=>[POSNIC.server.priority,POSNIC.server.pinned,localStorage.getItem('posnic.automatic-connections')])).toEqual(['lan',lan,'0']);
 await page.locator('[data-route-signal=remote]').click();
 await expect.poll(()=>page.evaluate(()=>POSNIC.server.baseUrl)).toBe(API_BASE);
 expect(await page.evaluate(()=>POSNIC.server.priority)).toBe('cloud');
 await expect(page.locator('#captain-internet-consent')).toHaveCount(0);
});
test('Wi-Fi off preserves the working internet route and manual preference',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{localStorage.setItem('posnic.automatic-connections','0');window.Capacitor={Plugins:{LocalNetwork:{getLocalIp:async()=>({wifi:false})}}};});
 await page.locator('[data-route-signal=local]').click();
 await expect(page.locator('#captain-connection-status')).toContainText('Connect this phone');
 expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toBe(API_BASE);
 expect(await page.evaluate(()=>localStorage.getItem('posnic.automatic-connections'))).toBe('0');
});
test('untrusted target is refused without moving the session',async({page})=>{
 await setup(page);
 await page.evaluate(lan=>POSNIC.server.recordShop(lan,'different-shop'),lan);
 await page.locator('[data-route-signal=local]').click();
 await expect(page.locator('#captain-connection-status')).toContainText('Sign-in required');
 expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toBe(API_BASE);
});
test('direct switch waits while a managed request is active',async({page})=>{
 await setup(page);
 await page.evaluate(()=>Object.defineProperty(POSNIC.session,'busy',{get:()=>true,configurable:true}));
 await page.locator('[data-route-signal=local]').click();
 await expect(page.locator('#captain-connection-status')).toContainText('Try again in a moment.');
 expect(await page.evaluate(()=>POSNIC.server.baseUrl)).toBe(API_BASE);
});
