'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('takeaway cart renders one parcel charge and includes it in the send total', () => {
    const source = fs.readFileSync(path.join(__dirname, '../indexedDB.js'), 'utf8');
    const code = source.slice(source.indexOf('function takeawayParcelTotal('), source.indexOf('function removeCartItem('));
    const nodes = {'bill-totals':{}, 'bill-send-amount':{}};
    let type = 'Take away';
    const ctx = {localStorage:{getItem:()=>type}, document:{getElementById:id=>nodes[id]}, CaptainMoney:{display:n=>n.toFixed(2)}};
    vm.runInNewContext(code, ctx);
    const lines = [{quantity:1,parcel_charge:5},{quantity:1,parcel_charge:2}];
    function render(){
        const parcel = ctx.takeawayParcelTotal(lines);
        ctx.setBillTotals({quantity:2, subtotal:100, total:100+parcel, parcel});
    }
    render();
    assert.match(nodes['bill-totals'].innerHTML,/Parcel Charge<.span><span>7.00/);
    assert.equal(nodes['bill-send-amount'].textContent,'107.00');
    lines[0].quantity=2;
    render();
    assert.equal(nodes['bill-send-amount'].textContent,'112.00');
    type='Dine-in';
    render();
    assert.doesNotMatch(nodes['bill-totals'].innerHTML,/Parcel Charge/);
    assert.equal(nodes['bill-send-amount'].textContent,'100.00');
});
