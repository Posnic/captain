import {test,expect} from '@playwright/test';

test('Android discovery reaches a till behind silent hosts without expiring in the native queue',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('posnic.setup-intro-seen','1');
    let active=0,maxActive=0;const queue=[];
    const pump=()=>{while(active<8 && queue.length){const {request,resolve,reject}=queue.shift();active++;maxActive=Math.max(maxActive,active);
      const found=new URL(request.url).hostname==='192.168.1.31';
      setTimeout(()=>{active--;if(found)resolve({status:200,headers:{'Content-Type':'application/json'},data:btoa(JSON.stringify({edition:'community',mode:'desktop',version:'1.0.0',apiSchema:1,syncProtocol:1,features:{account:false}}))});else reject(Error('silent host'));pump();},found?30:800);
    }};
    window.Capacitor={getPlatform:()=> 'android',Plugins:{LocalNetwork:{getLocalIp:async()=>({wifi:true,ip:'192.168.1.100'}),request:request=>new Promise((resolve,reject)=>{queue.push({request,resolve,reject});pump();}),cancelRequest:async()=>{}}}};
    window.nativeScanStats=()=>({active,maxActive,queued:queue.length});
  });
  await page.goto('/index.html');
  await page.waitForFunction(()=>window.POSNIC?.discovery);
  const result=await page.evaluate(async()=>{
    const found=[];
    await POSNIC.discovery.scanSubnet('192.168.1',{hosts:Array.from({length:32},(_,i)=>i+1),ports:[5555],concurrency:64,collect:hit=>found.push(hit.base)});
    return {found,stats:window.nativeScanStats()};
  });
  expect(result.found).toEqual(['http://192.168.1.31:5555/api']);
  expect(result.stats.maxActive).toBeLessThanOrEqual(4);
  expect(result.stats.queued).toBe(0);
});
