/*
 * Turning what a waiter said into an order.
 *
 * The danger here is not failing to hear. It is hearing confidently and
 * wrongly, and sending something nobody ordered to a kitchen. So the rules
 * that keep the tolerance narrow are pinned harder than the ones that make it
 * work at all.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ItemSearch = require(path.join(__dirname, '..', 'assets', 'common', 'item-search.js'));
const VoiceOrder = require(path.join(__dirname, '..', 'assets', 'common', 'voice-order.js'));

const MENU = [
  'Chicken Biryani', 'Mutton Biryani', 'Coffee', 'Toffee Pudding',
  'Masala Dosa', 'Butter Naan', 'Chicken 65', 'Paneer Butter Masala',
].map((name, id) => ({ id: String(id), name }));

const index = ItemSearch.index(MENU);
const heard = (text) => VoiceOrder.understand(text, index, ItemSearch);
const lines = (text) => heard(text).map((l) => `${l.quantity} x ${l.item ? l.item.name : '?'}`);

test('digits and spoken numbers both work', () => {
  assert.deepEqual(lines('2 chicken biryani, 3 coffee'), ['2 x Chicken Biryani', '3 x Coffee']);
  assert.deepEqual(lines('two chicken biryani and three coffee'), ['2 x Chicken Biryani', '3 x Coffee']);
});

test('"a" and "an" mean one', () => {
  assert.deepEqual(lines('a masala dosa'), ['1 x Masala Dosa']);
  assert.deepEqual(lines('an idli'), ['1 x ?']);
});

test('items separated by and, plus, or commas', () => {
  assert.equal(heard('coffee and coffee plus coffee, coffee').length, 4);
});

test('a number inside a name is part of the name', () => {
  /* "chicken 65" is a dish. Reading the 65 as a quantity is the difference
     between an order and an incident. */
  assert.deepEqual(lines('chicken 65'), ['1 x Chicken 65']);
  assert.deepEqual(lines('two chicken 65'), ['2 x Chicken 65']);
});

test('a mangled word still finds its dish', () => {
  /* What a recogniser actually returns in a loud room. */
  for (const said of ['briyani', 'biriyani', 'biryanee']) {
    const result = heard(`three ${said}`);
    assert.ok(result[0].item, `"${said}" found nothing`);
    assert.match(result[0].item.name, /Biryani/);
  }
});

test('a near match is reported as one, so the screen can say so', () => {
  assert.equal(heard('two chicken biryani')[0].exact, true);
  assert.equal(heard('two chicken briyani')[0].exact, false,
    'a corrected word must be shown differently from a certain one');
});

test('tolerance stays narrow enough to refuse a different word', () => {
  /* Coffee and Toffee Pudding are one edit apart and both on the menu. The
     exact match must win outright rather than the tolerant pass choosing. */
  const result = heard('three coffee');
  assert.equal(result[0].item.name, 'Coffee');
  assert.equal(result[0].exact, true);
});

test('something not on the menu is reported, never guessed', () => {
  const result = heard('five widgets');
  assert.equal(result[0].found, false);
  assert.equal(result[0].item, null);
  assert.equal(result[0].quantity, 5, 'the quantity is still understood, so it can be re-picked');
});

test('a short word is never corrected', () => {
  /* Three letters are too few to correct safely: almost everything is one
     edit from almost everything else. */
  const result = heard('two abc');
  assert.equal(result[0].found, false);
});

test('silence produces nothing rather than something', () => {
  assert.deepEqual(heard(''), []);
  assert.deepEqual(heard('   '), []);
  assert.deepEqual(heard('and and and'), []);
});

test('an absurd quantity is clamped, not obeyed', () => {
  assert.equal(VoiceOrder.quantityOf('99 coffee').quantity, 99);
  /* Three digits is not a quantity anybody speaks at a table. */
  assert.equal(VoiceOrder.quantityOf('500 coffee').quantity, 1);
});

test('two swapped letters count as one edit', () => {
  /* The commonest way a recogniser gets a word wrong. Plain Levenshtein
     charges two, which put the right dish outside a one-edit budget. */
  assert.equal(VoiceOrder.distance('briyani', 'biryani', 2), 1);
  assert.equal(VoiceOrder.distance('cofee', 'coffee', 2), 1);
});
