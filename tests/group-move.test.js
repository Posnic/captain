const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/common/group-move.js'),'utf8');
function app(storage=new Map()){
 const calls=[];
 const context={Map,JSON,Error,crypto:{randomUUID:()=> 'move-request-0001'},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},POSNIC:{session:{shopKey:'shop-1',user:{id:'staff-1'}},api:{post:async(url,body)=>{calls.push({url,body});return {request_id:body.request_id,orderId:'order-1',state:url.endsWith('complete')?'submitting':'reserved'};}}}};
 if(!storage.has('branch_id'))storage.set('branch_id','branch-1');
 vm.runInNewContext(source,context);
 return {context,api:context.CaptainGroupMove,calls,storage};
}
const choice={tableIds:['table-2'],primaryId:'table-2',guests:2};
test('lost response survives app reload and reuses the same request',async()=>{
 const first=app();first.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(first.api.move('order-1',choice));
 const saved=first.api.pending('order-1');
 const second=app(first.storage);
 await second.api.resume('order-1');
 assert.equal(second.calls[0].body.request_id,saved.body.request_id);
 assert.equal(second.calls[1].body.request_id,saved.body.request_id);
 assert.equal(second.api.pending('order-1'),null);
});
test('another staff or branch cannot see or resume the saved move',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.session.user.id='staff-2';assert.equal(a.api.pending('order-1'),null);
 assert.throws(()=>a.api.resume('order-1'));
 a.context.POSNIC.session.user.id='staff-1';a.storage.set('branch_id','branch-2');assert.equal(a.api.pending('order-1'),null);
});
test('storage failure prevents any API request',()=>{
 const a=app();a.context.localStorage.setItem=()=>{throw new Error('full');};
 assert.throws(()=>a.api.move('order-1',choice));assert.equal(a.calls.length,0);
});
test('session change after prepare cannot continue the previous staff move',async()=>{
 const a=app();
 a.context.POSNIC.api.post=async(url,body)=>{a.calls.push(url);a.context.POSNIC.session.user.id='staff-2';return {request_id:body.request_id,orderId:'order-1'};};
 await assert.rejects(a.api.move('order-1',choice));assert.equal(a.calls.length,1);
 a.context.POSNIC.session.user.id='staff-1';assert.ok(a.api.pending('order-1'));
});
