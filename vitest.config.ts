import { defineConfig } from 'vitest/config';

// unit：驗收用單元測試；balance：數值平衡報表（npm run balance、npm run balance:parts）
export default defineConfig({
  test: {
    projects: [
      // 伺服器整合測試放在 server/tests（需要 Node 型別，由 server/tsconfig.json 檢查）
      { test: { name: 'unit', include: ['tests/**/*.test.ts', 'server/tests/**/*.test.ts'] } },
      { test: { name: 'balance', include: ['scripts/*-report.test.ts'] } },
    ],
  },
});
