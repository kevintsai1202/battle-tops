import { test } from 'vitest';
import { ARENAS, type ArenaId } from '../src/sim/arena';
import { BattleSim } from '../src/sim/battle';
import { cpuThink } from '../src/sim/cpu';
import { createRng } from '../src/sim/rng';
import { TOP_IDS, TOP_SPECS } from '../src/sim/tops';
/**
 * 平衡報表（不是驗收測試）：每個對戰組合各跑 GAMES 場 CPU 對打，
 * 印出每顆陀螺的總勝率、平均回合長度、平手數與終結方式分布。
 * 調整 src/sim/stats.ts、tops.ts 或 physics.ts 的數值後執行 `npm run balance` 觀察變化。
 * 環境變數：ARENA 指定場地（預設 practice）、GAMES 指定每組場數（預設 10；20 顆 × 20 顆組合很多）、
 * DETAIL=1 另外列出每一組對戰。
 */
/** Node 的環境變數（tsconfig 沒有 node 型別，直接從 globalThis 取） */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

test('平衡報表', { timeout: 1_800_000 }, () => {
  const arena = ARENAS[(env.ARENA ?? 'practice') as ArenaId];
  const games = Number(env.GAMES ?? 10);
  const rows: string[] = [];
  const total: Record<string, number> = { spin: 0, over: 0, burst: 0, none: 0 };
  /** 每顆陀螺的 [勝, 場]（不含鏡像對戰） */
  const record = new Map<string, [number, number]>(TOP_IDS.map((id) => [id, [0, 0]]));
  let time = 0;
  let count = 0;
  for (const a of TOP_IDS) {
    for (const b of TOP_IDS) {
      const agg = { spin: 0, over: 0, burst: 0, none: 0, t: 0, winA: 0, draw: 0 };
      for (let seed = 1; seed <= games; seed++) {
        const rng = createRng(seed * 7 + 3);
        const sim = new BattleSim(TOP_SPECS[a], TOP_SPECS[b], { seed, launch: [0.8 + 0.2 * rng(), 0.8 + 0.2 * rng()], arena });
        while (!sim.result && sim.time < 120) {
          for (const id of [0, 1]) {
            const ai = cpuThink(sim, id, rng);
            sim.setControl(id, ai.control);
            if (ai.special) sim.useSpecial(id);
          }
          sim.step(1 / 120);
          sim.drainEvents();
        }
        const f = sim.result?.finish ?? 'none';
        agg[f]++;
        total[f]++;
        agg.t += sim.time;
        time += sim.time;
        count++;
        const w = sim.result?.winner;
        if (w === 0) agg.winA++;
        if (sim.result && w === null) agg.draw++;
        if (a !== b && w !== null && w !== undefined) {
          const winner = w === 0 ? a : b;
          const loser = w === 0 ? b : a;
          record.get(winner)![0]++;
          record.get(winner)![1]++;
          record.get(loser)![1]++;
        }
      }
      rows.push(`${a.padEnd(9)} vs ${b.padEnd(9)} t=${(agg.t / games).toFixed(1)}s winA=${agg.winA}/${games} draw=${agg.draw} spin=${agg.spin} over=${agg.over} burst=${agg.burst} none=${agg.none}`);
    }
  }
  const rate = [...record]
    .map(([id, [w, n]]) => ({ id, r: n ? w / n : 0, type: TOP_SPECS[id].type }))
    .sort((x, y) => y.r - x.r)
    .map((x) => `${x.id.padEnd(9)} ${x.type.padEnd(8)} ${(x.r * 100).toFixed(1)}%`);
  console.log(
    `[${arena.id}] 每組 ${games} 場，平均回合 ${(time / count).toFixed(1)} 秒\n` +
      (env.DETAIL ? rows.join('\n') + '\n' : '') +
      JSON.stringify(total) +
      '\n勝率：\n' +
      rate.join('\n'),
  );
});
