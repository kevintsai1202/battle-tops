import { test } from 'vitest';
import { ARENAS } from '../src/sim/arena';
import { BattleSim } from '../src/sim/battle';
import { cpuThink } from '../src/sim/cpu';
import { createRng } from '../src/sim/rng';
import { TOP_IDS, TOP_SPECS } from '../src/sim/tops';
import type { TopId, V2 } from '../src/sim/types';
/**
 * 線上對戰架構評估報表（不是驗收測試）：用 CPU 對打當作玩家的代理，量四件事——
 * 1. 延遲公平性：一方的操作晚 d 毫秒才生效（例如 P2P 時客人對主機），低延遲那方的勝率。
 * 2. 客戶端預測誤差：伺服器權威時，客戶端拿「晚 L 毫秒到的伺服器狀態」加上自己的操作往前算，
 *    和真實狀態差多少；對照「不預測、直接顯示晚到的狀態」差多少。
 * 3. 伺服器負擔：一步模擬要多久，一個 CPU 核心能同時跑幾個房間（120 Hz）。
 * 4. 頻寬：狀態快照與操作訊息的大小。
 * 執行：npx vitest run --project balance netcode-report --reporter=verbose
 */

const STEP = 1 / 120;
const HZ = 120;

/** 一步的操作（推移與是否按必殺） */
interface Input {
  control: V2;
  special: boolean;
}

/** 對戰組合：每顆陀螺對名鑑上另外 n 顆，場地練習場 */
function pairings(n: number): [TopId, TopId][] {
  const out: [TopId, TopId][] = [];
  TOP_IDS.forEach((a, i) => {
    for (let k = 1; k <= n; k++) out.push([a, TOP_IDS[(i + k * 3) % TOP_IDS.length]]);
  });
  return out;
}

/**
 * 延遲對打：每一步雙方都由 CPU 決策，但決策要晚 delays[id] 毫秒才生效（排隊）。
 * 雙方每一步都會呼叫 cpuThink，亂數用量和延遲無關，不同延遲的比較才公平。回傳勝者（0／1／null）。
 */
function playDelayed(a: TopId, b: TopId, seed: number, delays: [number, number]): 0 | 1 | null {
  const sim = new BattleSim(TOP_SPECS[a], TOP_SPECS[b], { seed, launch: [0.9, 0.9], arena: ARENAS.practice });
  const rng = createRng(seed * 7 + 3);
  const lag = delays.map((d) => Math.round((d / 1000) * HZ));
  const queues: { at: number; input: Input }[][] = [[], []];
  let step = 0;
  while (!sim.result && sim.time < 120) {
    for (const id of [0, 1]) {
      const ai = cpuThink(sim, id, rng);
      queues[id].push({ at: step + lag[id], input: { control: ai.control, special: ai.special } });
      while (queues[id].length && queues[id][0].at <= step) {
        const { input } = queues[id].shift()!;
        sim.setControl(id, input.control);
        if (input.special) sim.useSpecial(id);
      }
    }
    sim.step(STEP);
    sim.drainEvents();
    step++;
  }
  const w = sim.result?.winner;
  return w === 0 || w === 1 ? w : null;
}

/** 權威對打：記錄每一步雙方的操作，之後讓預測重播用 */
function recordMatch(a: TopId, b: TopId, seed: number): Input[][] {
  const sim = new BattleSim(TOP_SPECS[a], TOP_SPECS[b], { seed, launch: [0.9, 0.9], arena: ARENAS.practice });
  const rng = createRng(seed * 7 + 3);
  const log: Input[][] = [];
  while (!sim.result && sim.time < 60) {
    const row: Input[] = [];
    for (const id of [0, 1]) {
      const ai = cpuThink(sim, id, rng);
      row.push({ control: ai.control, special: ai.special });
      sim.setControl(id, ai.control);
      if (ai.special) sim.useSpecial(id);
    }
    log.push(row);
    sim.step(STEP);
    sim.drainEvents();
  }
  return log;
}

/**
 * 重播到第 until 步。from 之後對手（1 號）的操作換成 from 前最後一次已知的操作、而且不知道它按了必殺
 * （模擬客戶端只收到晚 L 毫秒的狀態）；from = until 時就是真實狀態。回傳兩顆的位置。
 */
function replay(a: TopId, b: TopId, seed: number, log: Input[][], until: number, from: number): V2[] {
  const sim = new BattleSim(TOP_SPECS[a], TOP_SPECS[b], { seed, launch: [0.9, 0.9], arena: ARENAS.practice });
  for (let s = 0; s < until && s < log.length; s++) {
    for (const id of [0, 1]) {
      const known = id === 1 && s >= from ? { control: log[from - 1][1].control, special: false } : log[s][id];
      sim.setControl(id, known.control);
      if (known.special) sim.useSpecial(id);
    }
    sim.step(STEP);
    sim.drainEvents();
  }
  return sim.tops.map((t) => ({ ...t.pos }));
}

/** 百分位數 */
function pct(xs: number[], p: number): number {
  const s = [...xs].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
}

const dist = (p: V2, q: V2) => Math.hypot(p.x - q.x, p.z - q.z);

test('線上對戰評估報表', { timeout: 3_600_000 }, () => {
  const lines: string[] = [];

  // ---------- 1. 延遲公平性 ----------
  lines.push('【1】一方操作延遲 d 毫秒、另一方 0 毫秒：低延遲那方的勝率（兩個座位各打一次；50% = 沒有影響）');
  const pairs = pairings(5);
  for (const d of [0, 50, 100, 200, 300]) {
    let win = 0;
    let n = 0;
    for (const [a, b] of pairs) {
      for (const seed of [1, 2]) {
        // 低延遲方坐 0 號座位
        const w0 = playDelayed(a, b, seed, [0, d]);
        if (w0 !== null) {
          n++;
          if (w0 === 0) win++;
        }
        // 低延遲方坐 1 號座位（同一組陀螺換邊）
        const w1 = playDelayed(b, a, seed, [d, 0]);
        if (w1 !== null) {
          n++;
          if (w1 === 1) win++;
        }
      }
    }
    lines.push(`  延遲差 ${String(d).padStart(3)} ms：低延遲方勝率 ${((win / n) * 100).toFixed(1)}%（${n} 場）`);
  }

  // ---------- 2. 客戶端預測誤差 ----------
  lines.push('【2】伺服器權威時客戶端看到的位置誤差（陀螺半徑約 0.35；中位數／90 百分位）');
  const samplePairs = pairings(1).slice(0, 20);
  for (const L of [50, 100, 150]) {
    const lag = Math.round((L / 1000) * HZ);
    // 顯示端再加 100 ms 插值緩衝時，不預測的畫面落後 L + 100 ms
    const buffer = Math.round(0.1 * HZ);
    const predOwn: number[] = [];
    const predOpp: number[] = [];
    const rawOwn: number[] = [];
    const rawOpp: number[] = [];
    samplePairs.forEach(([a, b], i) => {
      const seed = 50 + i;
      const log = recordMatch(a, b, seed);
      for (let t = 2 * HZ; t < log.length - 1; t += 2 * HZ) {
        const truth = replay(a, b, seed, log, t, t);
        const pred = replay(a, b, seed, log, t, t - lag);
        const stale = replay(a, b, seed, log, t - lag - buffer, t - lag - buffer);
        predOwn.push(dist(pred[0], truth[0]));
        predOpp.push(dist(pred[1], truth[1]));
        rawOwn.push(dist(stale[0], truth[0]));
        rawOpp.push(dist(stale[1], truth[1]));
      }
    });
    const f = (xs: number[]) => `${pct(xs, 0.5).toFixed(3)}／${pct(xs, 0.9).toFixed(3)}`;
    lines.push(`  單程延遲 ${L} ms（${predOwn.length} 個取樣）：預測—自己 ${f(predOwn)}、對手 ${f(predOpp)}；不預測（落後 ${L + 100} ms）—自己 ${f(rawOwn)}、對手 ${f(rawOpp)}`);
  }

  // ---------- 3. 伺服器負擔 ----------
  let steps = 0;
  const t0 = performance.now();
  for (const [a, b] of pairings(2)) {
    const sim = new BattleSim(TOP_SPECS[a], TOP_SPECS[b], { seed: 9, launch: [0.9, 0.9], arena: ARENAS.volcano });
    const rng = createRng(77);
    while (!sim.result && sim.time < 60) {
      for (const id of [0, 1]) sim.setControl(id, cpuThink(sim, id, rng).control);
      sim.step(STEP);
      sim.drainEvents();
      steps++;
    }
  }
  const usPerStep = ((performance.now() - t0) * 1000) / steps;
  lines.push(`【3】一步模擬（含兩次 CPU 決策，伺服器實際不需要）${usPerStep.toFixed(1)} µs；120 Hz 時一個核心約可同時跑 ${Math.floor(1e6 / (usPerStep * HZ))} 個房間`);

  // ---------- 4. 頻寬 ----------
  const sim = new BattleSim(TOP_SPECS.blaze, TOP_SPECS.turtle, { seed: 3, launch: [0.9, 0.9] });
  for (let i = 0; i < 600; i++) sim.step(STEP);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const snap = {
    t: r3(sim.time),
    s: sim.tops.map((t) => [r3(t.pos.x), r3(t.pos.z), r3(t.vel.x), r3(t.vel.z), r3(t.spin), r3(t.burst), r3(t.special), t.spinDir, t.alive ? 1 : 0, t.buff ? 1 : 0, t.hex ? 1 : 0]),
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(snap)).length;
  const binBytes = 4 + 2 * (7 * 4 + 4);
  const input = JSON.stringify({ q: 1234, x: 0.707, y: -0.707, s: 0 });
  // 每個封包的 TCP/IP + WebSocket 標頭約 60 bytes
  const perSec = (bytes: number, hz: number) => (((bytes + 60) * hz) / 1024).toFixed(1);
  lines.push(
    `【4】快照 JSON ${jsonBytes} bytes、二進位約 ${binBytes} bytes；每秒 30 次時下行約 ${perSec(jsonBytes, 30)} KB/s（JSON）／${perSec(binBytes, 30)} KB/s（二進位）；` +
      `操作訊息 JSON ${input.length} bytes，每秒 30 次上行約 ${perSec(input.length, 30)} KB/s`,
  );

  console.log(lines.join('\n'));
});
