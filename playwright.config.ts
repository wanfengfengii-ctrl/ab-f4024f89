import { defineConfig, devices } from '@playwright/test';

/**
 * 浏览器验收配置。
 * - 本地：自动启动 vite preview（先 npm run build）。
 * - Docker Compose verify 服务：通过 BASE_URL 指向 web 服务，不再启动本地服务器。
 */
const baseURL = process.env.BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port 4173 --host',
        url: 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
