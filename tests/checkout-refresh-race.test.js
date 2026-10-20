const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');

test('a menu refresh arriving during checkout cannot restore the submitted basket', async () => {
  const source = fs.readFileSync(require.resolve('../indexedDB.js'), 'utf8');
  const names = new Set(['queueCartMutation', 'checkout']);
  const functions = acorn.parse(source, {ecmaVersion:'latest'}).body
    .filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name))
    .map(node => source.slice(node.start,node.end)).join('\n');
  let rows = [{id:'meal',name:'Meal',quantity:1,price:100}];
  let releaseBranch, branchStarted, releaseRefresh;
  const branchWait = new Promise(resolve => {releaseBranch=resolve;});
  const branchSeen = new Promise(resolve => {branchStarted=resolve;});
  const refreshWait = new Promise(resolve => {releaseRefresh=resolve;});
  const orders = [];
  const context = vm.createContext({
    console:{log(){}}, waitForCartMutations:async()=>{},
    getCartData:async()=>rows.slice(),
    getData:async()=>{branchStarted();await branchWait;return [{id:'branch'}];},
    BRANCH_STORE:'branch', cartProductId:item=>item.id,
    ServiceDetails:{metadata:()=>({})}, submittedUnitPrice:item=>item.price,
    localStorage:{getItem:key=>key==='kiosk_table_no'?'5':null,removeItem(){}},
    currentOrderKey:()=> 'one-key', generateUniqueToken:()=> '1',
    POSNIC:{session:{canTakeOrders:true}},
    OrderQueue:{all:()=>orders,add:row=>{orders.push(row);return true;},update:()=>true},
    saveCartData:async next=>{rows=next;}, renderCart:async()=>{},
    window:{location:{}}, showErrorPopup:message=>{throw Error(message);}
  });
  vm.runInContext('let cartMutationTail=Promise.resolve();\n'+functions,context);
  const checkout = context.checkout();
  await branchSeen;
  const refresh = context.queueCartMutation(async()=>{
    const snapshot=rows.slice();
    await refreshWait;
    rows=snapshot;
  });
  releaseBranch();
  assert.equal(await checkout,true);
  releaseRefresh();
  await refresh;
  assert.equal(orders.length,1);
  assert.equal(orders[0].body.items.length,1);
  assert.equal(rows.length,0);
});
