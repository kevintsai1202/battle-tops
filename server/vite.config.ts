import { defineConfig } from 'vite';

// 伺服器打包：以 SSR 模式把伺服器程式、共用的模擬程式與 ws 打成單一 CommonJS 檔（dist-server/index.cjs），
// 部署時不需要 npm install。ws 的兩個選用原生加速套件不打包（執行時載入失敗會自動退回純 JS 實作）。
export default defineConfig({
  // 伺服器不需要前端的 public/（語音檔等）
  publicDir: false,
  build: {
    ssr: 'server/src/index.ts',
    outDir: 'dist-server',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rolldownOptions: {
      external: ['bufferutil', 'utf-8-validate'],
      output: { format: 'cjs', entryFileNames: 'index.cjs' },
    },
  },
  ssr: { noExternal: true },
});
