import { defineConfig, devices } from '@playwright/test';

/**
 * The screenshot harness, kept deliberately out of `playwright.config.ts`.
 *
 * These specs produce the before/after evidence in `design/audit/`; they assert almost nothing.
 * Running them in CI would spend minutes writing PNGs that no gate reads, so they get their own
 * config and are invoked by hand at the start and end of a design pass.
 */
const WEB_PORT = 5173;
const API_PORT = 8787;

const DEPLOYED = process.env.OVERLAP_BASE_URL;

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: DEPLOYED ?? `http://127.0.0.1:${String(WEB_PORT)}`,
    // Pinned so the captured grid reads the same on any machine — a screenshot set whose times
    // shift with the reviewer's laptop is not a comparison.
    timezoneId: 'America/New_York',
    locale: 'en-US',
  },

  projects: [{ name: 'capture', use: { ...devices['Desktop Chrome'] } }],

  webServer: DEPLOYED
    ? undefined
    : [
        {
          command: 'pnpm --filter @overlap/dev-server run start',
          port: API_PORT,
          reuseExistingServer: true,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command: 'pnpm --filter @overlap/web run dev',
          port: WEB_PORT,
          reuseExistingServer: true,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      ],
});
