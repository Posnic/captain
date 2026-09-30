import { test, expect } from "@playwright/test";
import { onTheMenu } from "./support/shop.js";
for (const width of [320, 900])
  test(`kitchen voice uses shared design and preserves a recording on Back at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.emulateMedia({ colorScheme: "dark" });
    await onTheMenu(page, "nothing");
    let statusCalls = 0;
    await page.route("**/captain/v1/kitchen-audio/status", (route) => {
      statusCalls++;
      return route.fulfill({
        json: {
          jobs: [
            {
              id: "old",
              complete: true,
              targets: [{ label: "Kitchen <main>", status: "completed" }],
            },
          ],
        },
      });
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
        },
      });
      window.MediaRecorder = class {
        constructor() {
          this.state = "inactive";
          this.mimeType = "audio/webm";
        }
        start() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          setTimeout(() => {
            this.ondataavailable({
              data: new Blob(["voice"], { type: "audio/webm" }),
            });
            this.onstop();
          }, 100);
        }
      };
    });
    await page.goto("/kitchen-message.html");
    await expect(page.locator(".voice-history-item")).toContainText(
      "Kitchen <main>",
    );
    await expect(page.locator(".voice-history-item main")).toHaveCount(0);
    await page.locator("#voice-refresh").click();
    await expect.poll(() => statusCalls).toBe(2);
    await page.locator("#voice-record").click();
    await expect(page.locator("#voice-status")).toHaveText("Recording…");
    await page.evaluate(() =>
      window.dispatchEvent(new Event("captain:back", { cancelable: true })),
    );
    await expect(page).toHaveURL(/kot-management.html$/);
    await page.goto("/kitchen-message.html");
    await expect(page.locator("#voice-status")).toHaveText(
      "Voice note saved on this phone",
    );
    await expect(page.locator("#voice-send")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-artifacts/kitchen-voice-${width}.png`,
      fullPage: true,
    });
    await page.locator("#voice-discard").click();
    await expect(page.locator("#voice-record")).toBeVisible();
    await page.locator(".me-back").click();
    await expect(page).toHaveURL(/kot-management.html$/);
  });
