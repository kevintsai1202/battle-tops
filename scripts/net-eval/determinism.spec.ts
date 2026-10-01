import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { determinismRun, type RunRecord } from './harness';

/**
 * 跨瀏覽器確定性檢查：同一批固定種子的對打，在 Node（V8）與各瀏覽器引擎算出的每秒狀態指紋是否完全相同。
 * 相同 → 只傳輸入（lockstep／rollback）可行；不同 → 必須由伺服器（或主機）權威，或改寫數學函式。
 * 執行（PowerShell）：
 *   npx vite build --config scripts/net-eval/vite.config.ts
 *   npx playwright test --config scripts/net-eval/playwright.config.ts
 */

const COUNT = 40;

test('各引擎算出的對打結果與 Node 逐位元相同', async ({ page, browserName }) => {
  test.setTimeout(600_000);
  const reference = determinismRun(COUNT);
  await page.setContent('<!doctype html><title>net-eval</title>');
  await page.addScriptTag({ content: readFileSync('scripts/net-eval/dist/harness.js', 'utf8') });
  const got = (await page.evaluate((n) => (window as unknown as { NetEval: { determinismRun(n: number): RunRecord[] } }).NetEval.determinismRun(n), COUNT)) as RunRecord[];

  // 每場：第一次出現差異的秒數（-1 = 完全相同）、最大位置差、勝負是否改變
  const rows = reference.map((r, i) => {
    const g = got[i];
    const at = r.checkpoints.findIndex((c, k) => g.checkpoints[k] !== c);
    let maxPos = 0;
    const n = Math.min(r.samples.length, g.samples.length);
    for (let k = 0; k < n; k++) for (let j = 0; j < 4; j++) maxPos = Math.max(maxPos, Math.abs(r.samples[k][j] - g.samples[k][j]));
    const outcome = r.finish !== g.finish || r.loser !== g.loser || r.time !== g.time;
    return { pair: r.pair, at: at >= 0 ? at + 1 : r.checkpoints.length !== g.checkpoints.length ? n : -1, maxPos, outcome, detail: `${r.finish}@${r.time}s / ${g.finish}@${g.time}s` };
  });
  const bad = rows.filter((d) => d.at >= 0);
  const flipped = rows.filter((d) => d.outcome);
  const worst = Math.max(0, ...rows.map((d) => d.maxPos));
  console.log(
    `[${browserName}] ${COUNT} 場：${bad.length} 場數值與 Node 不同、${flipped.length} 場勝負或終結時間不同、最大位置差 ${worst.toExponential(2)}（陀螺半徑約 0.35）` +
      (flipped.length ? '\n' + flipped.map((d) => `  ${d.pair}：第 ${d.at} 秒開始不同，最大位置差 ${d.maxPos.toExponential(2)}，Node／瀏覽器 ${d.detail}`).join('\n') : ''),
  );
  expect.soft(bad.length, `${browserName} 與 Node 的結果不同`).toBe(0);
});
