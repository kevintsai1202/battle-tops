import { defineConfig } from 'vitest/config';

// unit：驗收用單元測試；balance：數值平衡報表（npm run balance、npm run balance:parts）
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/**/*.test.ts'] } },
      { test: { name: 'balance', include: ['scripts/*-report.test.ts'] } },
    ],
  },
});
