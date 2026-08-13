import { defineConfig, devices } from '@playwright/test';

const WEB_PORT = 5173;
const API_PORT = 8787;

/**
 * Point the suite at a deployed origin to run it as a production smoke test.
 *
 * The same specs then exercise the real Worker, real Durable Objects, and real WebSockets over
 * the internet — which is a materially different claim from "it worked against a dev server on
 * localhost", and the only way to know a deploy is actually good.
 */
const DEPLOYED = process.env.OVERLAP_BASE_URL;
const baseURL = DEPLOYED ?? `http://127.0.0.1:${String(WEB_PORT)}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: 'on-first-retry',
    // Pinned so "renders in the viewer's own timezone" is a claim under test rather than an
    // accident of whichever machine happens to run the suite.
    timezoneId: 'America/New_York',
    locale: 'en-US',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      // The phone suite asserts touch input and a stacked layout, neither of which means
      // anything at 1280px.
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      // The grid has to stay usable under a thumb; only the tests that speak to that run here.
      testMatch: /mobile\.spec\.ts/,
    },
  ],

  // Two processes, matching `pnpm dev`: Vite serves the client and proxies /api to the Node
  // WebSocket server, so the suite drives the same code path a developer does. Skipped
  // entirely when running against a deployed origin.
  webServer: DEPLOYED
    ? undefined
    : [
        {
          command: 'pnpm --filter @overlap/dev-server run start',
          port: API_PORT,
          reuseExistingServer: !process.env.CI,
          stdout: 'ignore',
          stderr: 'pipe',
        },
        {
          command: 'pnpm --filter @overlap/web run dev',
          port: WEB_PORT,
          reuseExistingServer: !process.env.CI,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      ],
});
