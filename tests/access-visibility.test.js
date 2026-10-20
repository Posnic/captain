const test = require("node:test");
const assert = require("node:assert/strict");
const { bindVisibility } = require("../assets/common/access");

function fixture() {
  const events = {}, timers = new Map();
  let id = 0, locks = 0;
  const host = {
    document: { hidden: true, addEventListener: (k, fn) => events[k] = fn },
    addEventListener: (k, fn) => events[k] = fn,
    setTimeout: fn => { timers.set(++id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    CaptainAccess: { session: { suspend: async () => { locks++; } } },
  };
  bindVisibility(host);
  return { events, flush: () => { for (const fn of timers.values()) fn(); timers.clear(); }, locks: () => locks };
}
for (const order of [["pagehide", "visibilitychange"], ["visibilitychange", "pagehide"]]) {
  test(`page navigation does not relock the unlocked destination: ${order.join(", ")}`, () => {
    const f = fixture();
    for (const event of order) f.events[event]();
    f.flush();
    assert.equal(f.locks(), 0);
  });
}
test("background visibility still locks the session", () => {
  const f = fixture();
  f.events.visibilitychange();
  f.flush();
  assert.equal(f.locks(), 1);
});

test('foreground completion announces restoration after secure state is ready',async()=>{
 const f=fixture();let restored=false;const events=[];
 f.events.pageshow();
 // Use a separate host to exercise the visible branch and delayed restoration.
 const handlers={};const host={document:{hidden:false,addEventListener:(name,fn)=>handlers[name]=fn},addEventListener:(name,fn)=>handlers[name]=fn,clearTimeout(){},CaptainAccess:{locked:false,resume:async()=>{await Promise.resolve();restored=true;}},dispatchEvent:event=>events.push([event.type,restored])};
 bindVisibility(host);handlers.visibilitychange();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,[['captain:resumed',true]]);
});
