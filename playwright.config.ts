import { defineConfig } from '@playwright/test';

/**
 * 本機對戰伺服器的埠（預設 8787）：機器上別的專案占用 8787 時用 GAME_PORT 改，
 * 同時把 GAME_SERVER 設成 ws://localhost:<埠>/ws（online.spec、lang.spec 連這個網址）。
 */
const GAME_PORT = process.env.GAME_PORT ?? '8787';

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
    // 瀏覽器語言：遊戲第一次打開時依瀏覽器語言選版本（英文→英文版），既有測試都假設預設日文版；
    // 英文版的自動偵測在 lang.spec 另外用 en-US 測
    locale: 'ja-JP',
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
          url: `http://localhost:${GAME_PORT}/health`,
          reuseExistingServer: true,
          timeout: 60_000,
          // 伺服器紀錄（建房、加入、重連、錯誤）印在測試輸出，線上對戰失敗時看得到伺服器端發生什麼
          stdout: 'pipe',
          // 組隊第 2 步的時限縮成 30 秒（正式 60 秒），online.spec 的逾時測試才不用等太久
          env: { PORT: GAME_PORT, ARRANGE_MS: '30000' },
        },
      ],
});
