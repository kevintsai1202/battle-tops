import { test } from 'vitest';
import { BattleSim } from '../src/sim/battle';
import { cpuThink } from '../src/sim/cpu';
import { createRng } from '../src/sim/rng';
import { TOP_SPECS, TOP_TYPES } from '../src/sim/tops';
/**
 * 平衡報表（不是驗收測試）：每個對戰組合各跑 100 場 CPU 對打，
 * 印出平均回合長度、碰撞與強撞擊次數、勝率、平手數與終結方式分布。
 * 調整 src/sim/tops.ts 或 physics.ts 的數值後執行 `npm run balance` 觀察變化。
 */
test('平衡報表', () => {
  const rows: string[] = [];
  const total: Record<string, number> = { spin: 0, over: 0, burst: 0, none: 0 };
  for (const a of TOP_TYPES) for (const b of TOP_TYPES) {
    const agg = { spin: 0, over: 0, burst: 0, none: 0, t: 0, clash: 0, strong: 0, winA: 0, draw: 0 };
    for (let seed = 1; seed <= 100; seed++) {
      const rng = createRng(seed * 7 + 3);
      const sim = new BattleSim(TOP_SPECS[a], TOP_SPECS[b], { seed, launch: [0.8 + 0.2 * rng(), 0.8 + 0.2 * rng()] });
      while (!sim.result && sim.time < 120) {
        for (const id of [0, 1]) { const ai = cpuThink(sim, id, rng); sim.setControl(id, ai.control); if (ai.special) sim.useSpecial(id); }
        sim.step(1 / 120);
        for (const e of sim.drainEvents()) if (e.type === 'clash') { agg.clash++; if (e.intensity >= 6) agg.strong++; }
      }
      const f = sim.result?.finish ?? 'none'; (agg as any)[f]++; total[f]++; agg.t += sim.time; if (sim.result?.winner === 0) agg.winA++; if (sim.result && sim.result.winner === null) agg.draw++;
    }
    rows.push(`${a.padEnd(8)} vs ${b.padEnd(8)} t=${(agg.t / 100).toFixed(1)}s clash=${(agg.clash / 100).toFixed(1)} strong=${(agg.strong / 100).toFixed(1)} winA=${agg.winA}/100 draw=${agg.draw} spin=${agg.spin} over=${agg.over} burst=${agg.burst} none=${agg.none}`);
  }
  console.log(rows.join('\n') + '\n' + JSON.stringify(total));
});
