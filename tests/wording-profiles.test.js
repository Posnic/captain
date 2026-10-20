const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('branch wording survives offline refresh and never leaks across shops or branches', async () => {
  const storage = new Map([['branch_id', 'branch-one']]);
  const context = vm.createContext({
    document: { readyState: 'loading', documentElement: null, addEventListener() {} },
    addEventListener() {}, setInterval() {},
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    POSNIC: { server: { baseUrl: 'http://till/api' }, session: { active: true, shopKey: 'shop-one' },
      api: { get: async () => ({ data: { schemaVersion: 1, branchId: 'branch-one', locale: 'en', values: { lang_takeaway: 'Parcel' } } }) } }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/common/i18n.js'), 'utf8'), context);
  await context.I18N.refreshWording();
  assert.equal(context.I18N.t('Takeaway'), 'Parcel');
  assert.equal(context.I18N.t('Takeaway noodles'), 'Takeaway noodles');
  context.POSNIC.api.get = async () => { throw Error('offline'); };
  await context.I18N.refreshWording();
  assert.equal(context.I18N.t('Takeaway'), 'Parcel');
  storage.set('branch_id', 'branch-two');
  assert.equal(context.I18N.t('Takeaway'), 'Takeaway');
  await context.I18N.refreshWording();
  assert.equal(context.I18N.t('Takeaway'), 'Takeaway');
  storage.set('branch_id', 'branch-one');
  await context.I18N.refreshWording();
  assert.equal(context.I18N.t('Takeaway'), 'Parcel');
  context.POSNIC.session.shopKey = 'shop-two';
  assert.equal(context.I18N.t('Takeaway'), 'Takeaway');
});
