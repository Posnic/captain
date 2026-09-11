import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    /* Edge is what is installed on the desk this is developed at. A CI
       runner has Playwright's own Chromium and no Edge, and naming a channel
       it cannot find fails before a single test runs. */
    channel: process.env.CI ? undefined : 'msedge',
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    /* `npm.cmd` exists on Windows and nowhere else, so this ran at the desk
       and failed on a runner with "npm.cmd: not found" - the same shape of
       bug as the hard-coded gradlew.bat in build-apk.js. */
    command: `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run dev -- --host 127.0.0.1 --port 4173`,
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
