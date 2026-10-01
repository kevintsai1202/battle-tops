import { defineConfig } from '@playwright/test';

// e2e 設定：對 build 後的產物（vite preview）跑，不用 dev server
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  // headless 用軟體 WebGL（SwiftShader）很吃 CPU，平行跑會互相拖慢到逾時，所以一次只跑一個
  workers: 1,
  outputDir: 'test-results',
  use: {
    // 設定 BASE_URL 可以改測線上網址（例如 GitHub Pages），此時不啟動本機 preview
    baseURL: process.env.BASE_URL ?? 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // headless 需要軟體 WebGL；自動播放政策放寬，讓 AudioContext 不必等手勢
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  // 本機：遊戲預覽（4173）＋線上對戰伺服器（8787，online.spec.ts 用 ?server=ws://localhost:8787/ws 連）
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          command: 'npm run preview',
          url: 'http://localhost:4173',
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          command: 'npm run server:build && node dist-server/index.cjs',
          url: 'http://localhost:8787/health',
          reuseExistingServer: true,
          timeout: 60_000,
          // 伺服器紀錄（建房、加入、重連、錯誤）印在測試輸出，線上對戰失敗時看得到伺服器端發生什麼
          stdout: 'pipe',
          env: { PORT: '8787' },
        },
      ],
});
