import { defineConfig, devices } from '@playwright/test';

// 跨瀏覽器確定性檢查的設定：同一個測試在 Chromium（V8）、Firefox（SpiderMonkey）、WebKit（JavaScriptCore）各跑一次。
// 不需要遊戲伺服器，測試組以腳本內容直接注入空白頁。
export default defineConfig({
  testDir: '.',
  testMatch: ['determinism.spec.ts', 'live-ws.spec.ts', 'two-browsers-perf.spec.ts'],
  workers: 1,
  outputDir: '../../test-results/net-eval',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
