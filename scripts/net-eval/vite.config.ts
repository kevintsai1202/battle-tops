import { defineConfig } from 'vite';

// 把評估用的模擬測試組打包成瀏覽器可以直接載入的單檔（全域 NetEval），給 determinism.spec.ts 在各瀏覽器引擎執行。
// 不壓縮，避免讀起來混淆（壓縮不會改變浮點運算結果）。
export default defineConfig({
  build: {
    lib: { entry: 'scripts/net-eval/harness.ts', name: 'NetEval', formats: ['iife'], fileName: () => 'harness.js' },
    outDir: 'scripts/net-eval/dist',
    emptyOutDir: true,
    minify: false,
  },
});
