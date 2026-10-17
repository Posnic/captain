const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 const calls=[],native=[];
 const host={location:{href:'http://localhost/'},crypto:require('node:crypto').webcrypto,Capacitor:{getPlatform:()=> 'android',Plugins:{LocalNetwork:{request:async x=>{native.push(x);return {status:200,headers:{'Content-Type':'application/json'},data:Buffer.from('{"tables":[]}').toString('base64')};},cancelRequest:async()=>{}}}},fetch:async(...args)=>{calls.push(args);return {ok:true};}};
 vm.runInNewContext(fs.readFileSync('assets/common/access.js','utf8'),{window:host,URL,Headers,Response,Uint8Array,atob,DOMException,module:{exports:{}}});
 return {host,calls,native};
}
test('local API is sent through Wi-Fi while cloud stays on default network',async()=>{
 const f=fixture();const r=await f.host.CaptainFetch('http://192.168.1.200:5555/api/captain/v1/tables',{headers:{Authorization:'Bearer local'}});
 assert.deepEqual(await r.json(),{tables:[]});assert.equal(f.calls.length,0);assert.equal(f.native[0].headers.authorization,'Bearer local');
 await f.host.CaptainFetch('https://azure.posnic.io/api/captain/v1/tables');assert.equal(f.calls.length,1);assert.equal(f.native.length,1);
});
test('local failed order is never resent through another transport',async()=>{
 const f=fixture();f.host.Capacitor.Plugins.LocalNetwork.request=async()=>{throw Error('reply lost');};
 await assert.rejects(f.host.CaptainFetch('http://10.0.0.2:5555/api/sales/qrOrder',{method:'POST',body:'{}'}),/reply lost/);assert.equal(f.calls.length,0);
});
test('abort before dispatch sends no order; during request asks native to cancel',async()=>{
 const f=fixture(),c=new AbortController();c.abort();await assert.rejects(f.host.CaptainFetch('http://172.16.0.2/api/sales/qrOrder',{signal:c.signal}),{name:'AbortError'});assert.equal(f.native.length,0);
 let cancelled=false;f.host.Capacitor.Plugins.LocalNetwork.request=()=>new Promise(()=>{});f.host.Capacitor.Plugins.LocalNetwork.cancelRequest=async()=>{cancelled=true;};
 const d=new AbortController(),pending=f.host.CaptainFetch('http://192.168.1.2/api/runtime-info',{signal:d.signal});d.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);
});


test('missing native Wi-Fi bridge fails closed instead of using cellular fetch',async()=>{
 const f=fixture();delete f.host.Capacitor.Plugins.LocalNetwork.request;
 await assert.rejects(f.host.CaptainFetch('http://192.168.1.2/api/sales/qrOrder',{method:'POST',body:'{}'}),/Wi-Fi transport/);
 assert.equal(f.calls.length,0);
});
test('Android offline flag does not prevent a Wi-Fi bound request',async()=>{
 const f=fixture();f.host.navigator={onLine:false};
 assert.equal((await f.host.CaptainFetch('http://192.168.1.2/api/runtime-info')).status,200);
 assert.equal(f.native.length,1);assert.equal(f.calls.length,0);
});
