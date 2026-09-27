import { test, expect } from "@playwright/test";
import { onTheMenu } from "./support/shop.js";
async function setup(page) {
  await onTheMenu(page, "nothing");
  await page.route("**/captain/v1/payment-options", (r) =>
    r.fulfill({ json: { enabled: true } }),
  );
  await page.goto("/kot-management.html");
  await page.waitForFunction(() => !!window.CaptainPayments);
  const plan = {
    id: "plan1",
    table: "T1",
    currency: "₹",
    totalMinor: 10001,
    paidMinor: 0,
    dueMinor: 10001,
    version: 0,
    enabled: true,
    methods: ["Cash", "Card", "Upi"],
    guests: [
      { name: "Guest 1", totalMinor: 5001, paid: false },
      { name: "Guest 2", totalMinor: 5000, paid: false },
    ],
    payments: [],
  };
  await page.route("**/captain/v1/payments/table", (r) =>
    r.fulfill({ json: plan }),
  );
  await page.route("**/captain/v1/payments/release", (r) =>
    r.fulfill({ json: { released: true } }),
  );
  await page.evaluate(() => CaptainPayments.open("T1"));
  await expect(page.locator("#cp-guest")).toBeVisible();
  return plan;
}
test("guest cash payment shows change and updates remaining balance; card requires confirmation", async ({
  page,
}) => {
  const plan = await setup(page);
  const posts = [];
  await page.route("**/captain/v1/payments/record", (r) => {
    const p = r.request().postDataJSON();
    posts.push(p);
    plan.guests[0].paid = true;
    return r.fulfill({
      json: {
        ...plan,
        version: 1,
        paidMinor: 5001,
        dueMinor: 5000,
        confirmed: p.request_id,
      },
    });
  });
  await page.locator("#cp-guest").selectOption("0");
  await page.locator("#cp-received").fill("60");
  await expect(page.locator("#cp-change")).toHaveText("₹9.99");
  await page.screenshot({
    path: "test-artifacts/captain-cash-payment.png",
    fullPage: true,
  });
  await page.locator("#captain-payments [data-action=record]").click();
  await expect(page.locator(".cp-balance strong")).toHaveText("₹50.00");
  expect(posts[0].amountMinor).toBe(5001);
  expect(posts[0].receivedMinor).toBe(6000);
  await page.locator("[data-method=Card]").click();
  await page.locator("#captain-payments [data-action=record]").click();
  expect(posts).toHaveLength(1);
  await expect(page.locator(".cp-error")).toContainText("verified");
  await page.screenshot({
    path: "test-artifacts/captain-card-payment.png",
    fullPage: true,
  });
});
test("uncertain request persists across closing and retries the same payment identifier", async ({
  page,
}) => {
  const plan = await setup(page);
  const posts = [];
  await page.route("**/captain/v1/payments/record", (r) => {
    posts.push(r.request().postDataJSON());
    return r.abort("failed");
  });
  await page.locator("#captain-payments [data-action=record]").click();
  await expect(page.locator(".cp-error")).toContainText(
    "do not collect the money again",
  );
  await page.locator("#captain-payments footer [data-action=close]").click();
  await page.evaluate(() => CaptainPayments.open("T1"));
  await page.route("**/captain/v1/payments/record", (r) => {
    const body = r.request().postDataJSON();
    posts.push(body);
    return r.fulfill({
      json: {
        ...plan,
        dueMinor: 0,
        paidMinor: 10001,
        confirmed: body.request_id,
      },
    });
  });
  await page.locator("#captain-payments [data-action=record]").click();
  await expect(page.locator("#captain-payments")).toContainText(
    "Payment recorded",
  );
  expect(
    posts.every((p) => JSON.stringify(p) === JSON.stringify(posts[0])),
  ).toBe(true);
});
test("cancel returns to active tables and releases an untouched payment draft", async ({
  page,
}) => {
  await setup(page);
  const requests = [];
  await page.route("**/captain/v1/payments/release", (r) => {
    requests.push(r.request().postDataJSON());
    return r.fulfill({ json: { released: true } });
  });
  await page.locator("#captain-payments footer [data-action=close]").click();
  await expect(page.locator("#captain-payments")).not.toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
});
test('enabled collection continues from split review without printing unpaid bills',async({page})=>{
 await setup(page);
 await page.locator('#captain-payments footer [data-action=close]').click();
 await page.route('**/sales/guestBills/table?**',r=>r.fulfill({json:{type:'success',data:{table:'T1',revision:'v1',currency:'₹',totalMinor:10001,guests:2,lines:[{id:'line1',name:'Soup',quantity:1,amountMinor:10001,components:[{key:'base',minor:10001}]}]}}}));
 const preparations=[];
 await page.route('**/captain/v1/payments/table',r=>{preparations.push(r.request().postDataJSON());return r.fulfill({json:{id:'p2',table:'T1',currency:'₹',totalMinor:10001,dueMinor:10001,paidMinor:0,version:0,enabled:true,methods:['Cash'],guests:[{name:'Guest 1',totalMinor:5001,paid:false},{name:'Guest 2',totalMinor:5000,paid:false}]}});});
 await page.evaluate(()=>GuestBills.open('T1'));
 await page.locator('#guest-bills [data-action=next]').click();
 await expect(page.locator('#guest-bills [data-action=next]')).toHaveText('Collect payment');
 await page.locator('#guest-bills [data-action=next]').click();
 await expect(page.locator('#captain-payments')).toBeVisible();
 expect(preparations[0].plan).toMatchObject({mode:'equal',guests:['Guest 1','Guest 2']});expect(preparations[0].revision).toBe('v1');
});
for (const code of ['ta','ur']) test(`payment controls fit a small ${code} phone`,async({page})=>{
 await page.addInitScript(code=>localStorage.setItem('posnic.language',code),code);
 await page.setViewportSize({width:320,height:740});await setup(page);
 expect(await page.locator('#captain-payments').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
 const box=await page.locator('#captain-payments [data-action=record]').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(740);
 const text=await page.locator('#captain-payments').innerText();expect(text).not.toContain('Amount received');
 await page.screenshot({path:`test-artifacts/captain-payment-${code}.png`,fullPage:true});
});
