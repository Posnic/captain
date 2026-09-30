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

test('cancel retry survives a lost acknowledgement without preparing again',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.api.post=async(url,body)=>{
   if(url.endsWith('prepare'))return {request_id:body.request_id,orderId:'order-1',state:'reserved'};
   throw new Error('lost cancel reply');
 };
 await assert.rejects(a.api.cancel('order-1'));
 assert.equal(a.api.pending('order-1').cancelReady,true);
 const b=app(a.storage);
 b.context.POSNIC.api.post=async(url,body)=>{b.calls.push(url);return {request_id:body.request_id,state:'cancelled'};};
 assert.equal((await b.api.resume('order-1')).cancelled,true);
 assert.deepEqual(b.calls,['/captain/v1/tables/move/cancel']);
 assert.equal(b.api.pending('order-1'),null);
});
test('cancellation reconciles an already applying move without claiming it was cancelled',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.api.post=async(url,body)=>{
   a.calls.push(url);
   return {request_id:body.request_id,orderId:'order-1',state:url.endsWith('prepare')?'applying':'submitting'};
 };
 const result=await a.api.cancel('order-1');
 assert.equal(result.cancelled,undefined);
 assert.equal(a.calls.some(url=>url.endsWith('cancel')),false);
 assert.equal(a.api.pending('order-1'),null);
});
test('completion winning cancellation race is reconciled',async()=>{
 const a=app();a.context.POSNIC.api.post=async()=>{throw new Error('offline');};
 await assert.rejects(a.api.move('order-1',choice));
 a.context.POSNIC.api.post=async(url,body)=>{
   if(url.endsWith('cancel'))throw Object.assign(new Error('applying'),{status:409});
   return {request_id:body.request_id,orderId:'order-1',state:url.endsWith('prepare')?'reserved':'submitting'};
 };
 assert.equal((await a.api.cancel('order-1')).cancelled,undefined);
 assert.equal(a.api.pending('order-1'),null);
});
