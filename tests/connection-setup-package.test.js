const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const setup=require('../packages/connection-setup');

test('native consumers import setup without browser, storage, auth or Captain globals',()=>{
  const context=vm.createContext({module:{exports:{}}});
  vm.runInContext(fs.readFileSync(require.resolve('../packages/connection-setup'),'utf8'),context);
  assert.deepEqual(Array.from(context.module.exports.methods({supported:['cloud','qr']}),m=>m.id),['cloud','qr']);
  assert.equal(context.module.exports.welcome({name:'Posnic Business'}).name,'Posnic Business');
});
test('unsupported methods stay absent and app order is respected without Wi-Fi',()=>{
  const options={supported:['qr','wifi','cloud','qr'],wifiAvailable:false};
  const methods=setup.methods(options);
  assert.deepEqual(methods.map(m=>m.id),['qr','cloud']);
  assert.equal(methods.find(m=>m.id==='cloud').recommended,true);
  assert.deepEqual(options.supported,['qr','wifi','cloud','qr']);
  assert.deepEqual(setup.methods({supported:[]}),[]);
  assert.throws(()=>setup.methods({supported:['unknown']}),/Unknown connection method/);
});
test('each app supplies its own copy and translations without changing other consumers',()=>{
  const pos=setup.welcome({name:'Posnic POS',steps:['Open your till'],copy:{continueLabel:'Set up this till'},translate:key=>'t:'+key});
  assert.equal(pos.continueLabel,'t:Set up this till');
  assert.deepEqual(pos.steps,['t:Open your till']);
  assert.equal(setup.welcome({name:'Captain'}).continueLabel,'Set up this phone');
  assert.equal(setup.methods({translate:key=>'t:'+key})[0].label,'t:Search this Wi-Fi');
});
test('Captain translations cover the extracted shared copy in every bundled language',()=>{
  const content=setup.welcome({name:'Captain'});
  const keys=[...[...setup.methods(),...setup.cloudRoles()].flatMap(method=>[method.label,method.description].filter(Boolean)),content.subtitle,content.title,content.eyebrow,content.description,content.continueLabel,...content.steps];
  const folder=require('node:path').join(__dirname,'../assets/common/locales');
  for(const file of fs.readdirSync(folder).filter(file=>file.endsWith('.json')&&file!=='manifest.json')){
    const messages=JSON.parse(fs.readFileSync(require('node:path').join(folder,file),'utf8'));
    for(const key of keys)assert.ok(messages[key],`${file}: ${key}`);
  }
});
