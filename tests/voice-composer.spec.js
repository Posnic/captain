import { test, expect } from "@playwright/test";
import { onTheMenu } from "./support/shop.js";
async function open(page) {
  await onTheMenu(page, "nothing");
  await page.route("**/captain/v1/kitchen-audio/status", (r) =>
    r.fulfill({ json: { jobs: [] } }),
  );
  await page.addInitScript(() => {
    window.stoppedTracks = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const context = new AudioContext(),
            oscillator = context.createOscillator(),
            destination = context.createMediaStreamDestination();
          oscillator.frequency.value = 440;
          oscillator.connect(destination);
          oscillator.start();
          for (const track of destination.stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              window.stoppedTracks++;
              stop();
              oscillator.stop();
              context.close();
            };
          }
          return destination.stream;
        },
      },
    });
  });
  await page.goto("/kitchen-message.html");
  await expect(page.locator("#voice-record")).toBeEnabled();
}
for (const width of [320, 900])
  test(`voice composer records, previews, resumes and sends once at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    await open(page);
    await expect(page.locator("#voice-record")).toHaveCSS("border-radius", "50%");
    let uploads = [];
    await page.route("**/captain/v1/kitchen-audio/start", (r) =>
      r.fulfill({ json: { id: "voice-message" } }),
    );
    await page.route("**/captain/v1/kitchen-audio/voice", async (r) => {
      uploads.push(r.request().postDataJSON());
      await r.fulfill({ json: { id: "voice-message", queued: true } });
    });
    await page
      .getByRole("button", { name: "Record voice note", exact: true })
      .click();
    await expect(page.locator("#voice-composer")).toHaveAttribute(
      "data-recording",
      "true",
    );
    await expect(page.locator("#voice-discard")).toBeVisible();
    await expect(page.locator("#voice-send")).toBeVisible();
    await expect(page.locator("#voice-duration")).toHaveText("0:01", {
      timeout: 5000,
    });
    await page
      .getByRole("button", { name: "Pause recording", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume recording", exact: true }),
    ).toBeEnabled();
    expect(await page.evaluate(() => stoppedTracks)).toBe(1);
    await page
      .getByRole("button", { name: "Play recording", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause playback", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Pause playback", exact: true })
      .click();
    const duration = await page.evaluate(
      () =>
        JSON.parse(
          localStorage.getItem(
            Object.keys(localStorage).find((k) =>
              k.startsWith("posnic.kitchen-voice:"),
            ),
          ),
        ).duration,
    );
    await page.screenshot({
      path: `test-artifacts/voice-paused-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Resume recording", exact: true })
      .click();
    await expect(page.locator("#voice-duration")).toHaveText("0:02", {
      timeout: 5000,
    });
    await page
      .getByRole("button", { name: "Pause recording", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Resume recording", exact: true }),
    ).toBeEnabled();
    const resumed = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          Object.keys(localStorage).find((k) =>
            k.startsWith("posnic.kitchen-voice:"),
          ),
        ),
      ),
    );
    expect(resumed.duration).toBeGreaterThan(duration);
    expect(resumed.data).toMatch(/^data:audio\/wav;base64,/);
    const audioLength = await page.evaluate(async () => {
      const audio = new AudioContext();
      try {
        return (
          await audio.decodeAudioData(
            await (
              await fetch(document.getElementById("voice-preview").src)
            ).arrayBuffer(),
          )
        ).duration;
      } finally {
        await audio.close();
      }
    });
    expect(audioLength).toBeGreaterThan(1.5);
    await page
      .getByRole("button", { name: "Resume recording", exact: true })
      .click();
    await expect(page.locator("#voice-duration")).toHaveText("0:03", {
      timeout: 5000,
    });
    await page
      .getByRole("button", { name: "Send to kitchen", exact: true })
      .click();
    await expect(page.locator("#voice-status")).toHaveText(
      "Queued for playback",
    );
    expect(uploads).toHaveLength(1);
    expect(uploads[0].data).toMatch(/^data:audio\/wav;base64,/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Record voice note", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Discard recording", exact: true })
      .click();
    await expect(page.locator("#voice-send")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Record voice note", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          Object.keys(localStorage).filter((k) =>
            k.startsWith("posnic.kitchen-voice:"),
          ).length,
      ),
    ).toBe(0);
  });

test("paused draft survives reload and resumes into playable audio", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Record voice note", exact: true })
    .click();
  await expect(page.locator("#voice-duration")).toHaveText("0:01", {
    timeout: 5000,
  });
  await page
    .getByRole("button", { name: "Pause recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume recording", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page
    .getByRole("button", { name: "Resume recording", exact: true })
    .click();
  await expect(page.locator("#voice-duration")).toHaveText("0:02", {
    timeout: 5000,
  });
  await page
    .getByRole("button", { name: "Pause recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play recording", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause playback", exact: true }),
  ).toBeVisible();
});

test("permission denial leaves a usable microphone and no sendable empty draft", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(
    () =>
      (navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("Denied", "NotAllowedError");
      }),
  );
  await page
    .getByRole("button", { name: "Record voice note", exact: true })
    .click();
  await expect(page.locator("#voice-error")).toHaveText(
    "Microphone unavailable. Check app permissions.",
  );
  await expect(
    page.getByRole("button", { name: "Record voice note", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#voice-send")).toBeHidden();
});
