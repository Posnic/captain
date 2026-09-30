const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/common/item-transfer.js'),'utf8');
const order='a'.repeat(24),table='b'.repeat(24),destination='c'.repeat(24);
const input=()=>({revision:'d'.repeat(64),items:[{id:'c0i0',quantity:1}],destination:{tableIds:[table],primaryId:table,guests:2}});
function app(storage=new Map()){
 const calls=[];if(!storage.has('branch_id'))storage.set('branch_id','branch-1');
 const context={Map,Set,JSON,Error,Number,crypto:{randomUUID:()=> 'transfer-request-0001'},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  POSNIC:{session:{base:'https://shop/api',shopKey:'shop-1',user:{id:'staff-1'}},api:{post:async(url,body)=>{
   calls.push({url,body});return {requestId:body.requestId,sourceId:body.orderId,destinationId:destination,sourceClosed:false,state:'completed'};
  }}}};
 vm.runInNewContext(source,context);return {context,calls,storage,api:context.CaptainItemTransfer};
}
test('interrupted transfer survives reload and resends original intent',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.complete(order,input()));
 const b=app(a.storage),changed=input();changed.items[0].quantity=2;
 await b.api.complete(order,changed);
 assert.equal(b.calls.length,1);assert.equal(b.calls[0].body.items[0].quantity,1);
 assert.equal(b.calls[0].body.requestId,'transfer-request-0001');assert.equal(b.api.pending(order),null);
});
test('lost acknowledgement recovers completed status without resending',async()=>{
 const a=app();let writes=0;
 a.context.POSNIC.api.post=async(url,body)=>{
  if(url.endsWith('/complete')){writes++;throw new Error('lost');}
  return {requestId:body.requestId,sourceId:body.orderId,destinationId:destination,sourceClosed:false,state:'completed'};
 };
 assert.equal((await a.api.complete(order,input())).destinationId,destination);
 assert.equal(writes,1);assert.equal(a.api.pending(order),null);
});
for(const state of ['unknown','pending','cancelled','completed'])test('recovery retains uncertain or mismatched '+state,async()=>{
 const a=app();a.context.POSNIC.api.post=async(url,body)=>{
  if(url.endsWith('/complete'))throw new Error('lost');
  return {requestId:body.requestId,sourceId:state==='cancelled'?order:'wrong',state};
 };
 await assert.rejects(a.api.complete(order,input()));
 assert.equal(Boolean(a.api.pending(order)),state!=='cancelled');
});
test('storage failure prevents writes and invalid quantity is rejected',()=>{
 const a=app();a.context.localStorage.setItem=()=>{throw new Error('full');};
 assert.throws(()=>a.api.complete(order,input()));assert.equal(a.calls.length,0);
 const b=app(),bad=input();bad.items[0].quantity=-1;
 assert.throws(()=>b.api.complete(order,bad));assert.equal(b.calls.length,0);
});
test('issuer and staff changes never replay another owner transfer',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.complete(order,input()));
 a.context.POSNIC.session.base='https://other/api';await assert.rejects(a.api.resume(order),/Reconnect/);
 a.context.POSNIC.session.user.id='staff-2';assert.equal(a.api.pending(order),null);
 a.context.POSNIC.session.user.id='staff-1';a.storage.set('branch_id','other');assert.equal(a.api.pending(order),null);
});
test('session changes during completion retain the original request',async()=>{
 const a=app();a.context.POSNIC.api.post=async(url,body)=>{
  a.context.POSNIC.session.user.id='staff-2';return {requestId:body.requestId,sourceId:order,destinationId:destination,sourceClosed:false,state:'completed'};
 };
 await assert.rejects(a.api.complete(order,input()));
 a.context.POSNIC.session.user.id='staff-1';assert.ok(a.api.pending(order));
});
test('double taps share one transfer operation',async()=>{
 const a=app();let release,calls=0;const gate=new Promise(resolve=>release=resolve);
 a.context.POSNIC.api.post=async(url,body)=>{calls++;await gate;return {requestId:body.requestId,sourceId:order,destinationId:destination,sourceClosed:false,state:'completed'};};
 const first=a.api.complete(order,input()),second=a.api.complete(order,input());
 release();await Promise.all([first,second]);assert.equal(calls,1);
});
