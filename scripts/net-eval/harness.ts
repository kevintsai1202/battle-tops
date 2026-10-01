import { ARENAS } from '../../src/sim/arena';
import { BattleSim } from '../../src/sim/battle';
import { cpuThink } from '../../src/sim/cpu';
import { createRng } from '../../src/sim/rng';
import { TOP_IDS, TOP_SPECS } from '../../src/sim/tops';
import type { TopState } from '../../src/sim/types';

/**
 * 線上對戰架構評估用的模擬測試組（純邏輯，Node 與瀏覽器都能跑）。
 * determinismRun：固定種子跑一批 CPU 對打，記錄每秒的狀態指紋（完整精度），
 * 用來比較不同 JS 引擎（V8／SpiderMonkey／JavaScriptCore）算出的結果是否逐位元相同——
 * 這決定「只傳輸入（lockstep）」能不能跨瀏覽器對戰。
 */

const STEP = 1 / 120;

/** FNV-1a 雜湊（32 位元，十六進位字串） */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 一顆陀螺的完整狀態字串（數字用最短可還原表示，位元不同就會不同） */
function stateString(t: TopState): string {
  return [t.pos.x, t.pos.z, t.vel.x, t.vel.z, t.spin, t.burst, t.special, t.angle, t.tilt, t.spinDir, t.alive ? 1 : 0].map(String).join(',');
}

/** 一場對打的結果：每秒一個指紋與原始數值、最後的終結方式、敗者與時間 */
export interface RunRecord {
  pair: string;
  checkpoints: string[];
  /** 每秒的兩顆陀螺位置與轉速 [x0, z0, x1, z1, spin0, spin1]（量差異大小用） */
  samples: number[][];
  finish: string;
  loser: number;
  time: number;
}

/** 位置與轉速的原始數值 */
const sample = (sim: BattleSim) => [sim.tops[0].pos.x, sim.tops[0].pos.z, sim.tops[1].pos.x, sim.tops[1].pos.z, sim.tops[0].spin, sim.tops[1].spin];

/**
 * 跑 count 場固定種子的 CPU 對打（每場最多 maxSeconds 秒），回傳每場每秒的狀態指紋。
 * 陀螺組合依序取名鑑，場地輪流用五個場地，涵蓋碰撞、必殺、場地機關等所有分支。
 */
export function determinismRun(count = 40, maxSeconds = 40): RunRecord[] {
  const arenas = Object.values(ARENAS);
  const out: RunRecord[] = [];
  for (let k = 0; k < count; k++) {
    const a = TOP_IDS[k % TOP_IDS.length];
    const b = TOP_IDS[(k * 7 + 3) % TOP_IDS.length];
    const arena = arenas[k % arenas.length];
    const seed = 1000 + k;
    const rng = createRng(seed * 7 + 3);
    const sim = new BattleSim(TOP_SPECS[a], TOP_SPECS[b], { seed, launch: [0.8 + 0.2 * rng(), 0.8 + 0.2 * rng()], arena, aim: [0.2, -0.1] });
    const checkpoints: string[] = [];
    const samples: number[][] = [];
    let steps = 0;
    while (!sim.result && sim.time < maxSeconds) {
      for (const id of [0, 1]) {
        const ai = cpuThink(sim, id, rng);
        sim.setControl(id, ai.control);
        if (ai.special) sim.useSpecial(id);
      }
      sim.step(STEP);
      sim.drainEvents();
      if (++steps % 120 === 0) {
        checkpoints.push(fnv(sim.tops.map(stateString).join('|')));
        samples.push(sample(sim));
      }
    }
    checkpoints.push(fnv(sim.tops.map(stateString).join('|')));
    samples.push(sample(sim));
    out.push({ pair: `${a} vs ${b} @${arena.id}`, checkpoints, samples, finish: sim.result?.finish ?? 'none', loser: sim.result?.loser ?? -1, time: Math.round(sim.time * 1000) / 1000 });
  }
  return out;
}
