import { defineConfig, devices } from '@playwright/test';

// 本地：自动启动 vite preview；Docker verify 服务：通过 BASE_URL=http://web:80 指向 compose 内服务
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    // 容器内（root、无 setuid 沙箱）标准启动参数
    launchOptions: {
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run preview -- --port 4173 --host 127.0.0.1',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        timeout: 60000,
      },
});
