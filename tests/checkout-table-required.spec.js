import {test,expect} from '@playwright/test';
import {onTheMenu,item} from './support/shop.js';
for(const value of [null,'','   '])test(`checkout keeps basket when table is missing: ${JSON.stringify(value)}`,async({page})=>{
 await onTheMenu(page,'nothing',{menu:[{category_name:'Meals',items:[item('meal','Meal',100)]}]});
 await page.evaluate(async value=>{await updateQuantity('meal',1);localStorage.setItem('orderType','Dine-in');if(value===null)localStorage.removeItem('kiosk_table_no');else localStorage.setItem('kiosk_table_no',value);},value);
 await page.goto('/cart.html');await page.waitForFunction(()=>typeof checkout==='function');
 const result=await page.evaluate(async()=>{window.showErrorPopup=message=>window.checkoutError=message;const before=OrderQueue.count();const ok=await checkout('test');return {ok,before,after:OrderQueue.count(),cart:await getCartData(),error:window.checkoutError};});
 expect(result.ok).toBe(false);expect(result.after).toBe(result.before);expect(result.cart).toHaveLength(1);expect(result.error).toBe('Choose a table first.');
});
