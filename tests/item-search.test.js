/*
 * Finding an item while somebody is standing at a table waiting.
 *
 * The ranking IS the feature. A change that quietly demotes the row somebody
 * expects first is invisible in a screenshot and surfaces months later as a
 * shop saying the app "got slower to use", so the order is pinned here rather
 * than left to whatever the sort happens to do.
 *
 * Node, not Playwright: this is pure logic and deserves to be checked in
 * milliseconds without a browser.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ItemSearch = require(path.join(__dirname, '..', 'assets', 'common', 'item-search.js'));

const MENU = [
  'Chicken Biryani',
  'Chicken 65',
  'Mutton Biryani',
  'Masala Dosa',
  'Masala Dosa Paper Roast',
  'Plain Dosa',
  'Butter Chicken',
  'Crème Brûlée',
  'Cold Coffee',
].map((name, id) => ({ id: String(id), name }));

const index = ItemSearch.index(MENU);
const names = (term, options) => ItemSearch.search(index, term, options).map((i) => i.name);

test('a plain substring still works', () => {
  assert.deepEqual(names('biry'), ['Mutton Biryani', 'Chicken Biryani']);
});

test('two words narrow instead of finding nothing', () => {
  /* The old search tested one substring, so "chick biry" matched nothing:
     those two words never appear together in that order. */
  assert.deepEqual(names('chick biry'), ['Chicken Biryani']);
});

test('initials find the thing a waiter sells all day', () => {
  /* "cb" is what somebody types two hundred times a shift. */
  assert.ok(names('cb').includes('Chicken Biryani'));
  assert.deepEqual(names('mdp'), ['Masala Dosa Paper Roast']);
});

test('a single letter does not match by initials', () => {
  /* One letter would make every item an initials match and turn the list into
     noise. Prefixes still apply, which is what a single letter should do. */
  const single = names('c');
  assert.ok(single.every((n) => ItemSearch.fold(n).split(' ').some((w) => w.startsWith('c'))),
    'a single letter matched something it does not begin');
});

test('accents are not a barrier on a kitchen keyboard', () => {
  assert.deepEqual(names('creme'), ['Crème Brûlée']);
  assert.deepEqual(names('brulee'), ['Crème Brûlée']);
  assert.deepEqual(names('crème'), ['Crème Brûlée']);
});

test('numbers in a name are findable', () => {
  assert.deepEqual(names('65'), ['Chicken 65']);
});

test('an exact name outranks everything', () => {
  assert.equal(names('masala dosa')[0], 'Masala Dosa',
    'the longer name that also matches must not come first');
});

test('a prefix outranks a word in the middle', () => {
  const result = names('chicken');
  assert.equal(result[0], 'Chicken 65');
  assert.ok(result.indexOf('Butter Chicken') > result.indexOf('Chicken Biryani'),
    'a name starting with the term belongs above one merely containing it');
});

test('what the shop sells breaks a tie, and only a tie', () => {
  /* "cb" fits Chicken Biryani and Crème Brûlée equally by initials, and
     nothing in the text separates them. The shop's own sales do. */
  const cold = names('cb');
  const biryaniSells = names('cb', { popular: new Set(['0']) });
  assert.notEqual(cold[0], undefined);
  assert.equal(biryaniSells[0], 'Chicken Biryani');

  /* But popularity must never beat a better text match, or typing more
     letters would move the row somebody was aiming at. */
  assert.equal(names('creme', { popular: new Set(['0']) })[0], 'Crème Brûlée');
});

test('nothing matching returns nothing, not everything', () => {
  assert.deepEqual(names('zzz'), []);
});

test('an empty search returns the menu untouched', () => {
  assert.equal(ItemSearch.search(index, '').length, MENU.length);
  assert.equal(ItemSearch.search(index, '   ').length, MENU.length);
});

test('a code matches whole, never partially', () => {
  /* Half a barcode is a coincidence, not an intent. */
  const coded = ItemSearch.index([{ id: 'x', name: 'Sparkling Water', sku: '8901234' }]);
  assert.equal(ItemSearch.search(coded, '8901234').length, 1);
  assert.equal(ItemSearch.search(coded, '89012').length, 0);
});

/*
 * Quantity typed before the item.
 *
 * Adding three of something meant finding it and tapping plus three times.
 * Every till lets you say the number first, and a waiter taking a table of six
 * says "three biryani" before they say which biryani.
 */

test('a number in front is a quantity', () => {
  assert.deepEqual(ItemSearch.parseTerm('3 cb'), { quantity: 3, term: 'cb' });
  assert.deepEqual(ItemSearch.parseTerm('12 masala dosa'), { quantity: 12, term: 'masala dosa' });
});

test('a bare number is still a search', () => {
  /* "65" is Chicken 65, not an order for sixty-five of the next thing
     touched. */
  assert.deepEqual(ItemSearch.parseTerm('65'), { quantity: 1, term: '65' });
});

test('a number can be searched for after a quantity', () => {
  assert.deepEqual(ItemSearch.parseTerm('2 65'), { quantity: 2, term: '65' });
});

test('a slipped finger cannot send ninety-nine mains', () => {
  /* Three digits is not a quantity anybody means, so it stays a search. */
  assert.equal(ItemSearch.parseTerm('999 cb').quantity, 1);
  assert.equal(ItemSearch.parseTerm('999 cb').term, '999 cb');
  /* And zero is one, not nothing. */
  assert.equal(ItemSearch.parseTerm('0 cb').quantity, 1);
});
