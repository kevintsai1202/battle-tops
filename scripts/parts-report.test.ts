import { test } from 'vitest';
import { ARENAS, type ArenaId } from '../src/sim/arena';
import { BattleSim } from '../src/sim/battle';
import { cpuThink } from '../src/sim/cpu';
import { DISK_IDS, DRIVER_IDS, PARTS, type Loadout, type PartId } from '../src/sim/parts';
import { createRng } from '../src/sim/rng';
import { buildSpec, TOP_IDS, TOP_SPECS } from '../src/sim/tops';
import type { TopId, TopSpec } from '../src/sim/types';
/**
 * 零件平衡報表（不是驗收測試）：每顆陀螺換上每一件備用零件後，對「全部原廠陀螺」的勝率，
 * 和它原廠組合的勝率相比差多少。用來確認沒有哪件零件換上去就穩贏（取捨要有代價）。
 * 執行：`npm run balance:parts`。
 * 環境變數：ARENA 指定場地（預設 practice）、GAMES 每組對戰的種子數（預設 3；每個種子兩個座位各一場）、
 * COMBOS=1 另外跑「盤＋軸同時換」的全部組合（每組 2 場），列出勝率最高的組合。
 * 備註：座位本身有偏差（練習場 A 座勝率約 44%，出場口不對稱），所以兩個座位都要打。
 */
/** Node 的環境變數（tsconfig 沒有 node 型別，直接從 globalThis 取） */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** CPU 對打一場，回傳 0（a 勝）、1（b 勝）或 null（平手／時間到） */
function play(a: TopSpec, b: TopSpec, seed: number, arenaId: ArenaId): 0 | 1 | null {
  const rng = createRng(seed * 7 + 3);
  const sim = new BattleSim(a, b, { seed, launch: [0.8 + 0.2 * rng(), 0.8 + 0.2 * rng()], arena: ARENAS[arenaId] });
  while (!sim.result && sim.time < 120) {
    for (const id of [0, 1]) {
      const ai = cpuThink(sim, id, rng);
      sim.setControl(id, ai.control);
      if (ai.special) sim.useSpecial(id);
    }
    sim.step(1 / 120);
    sim.drainEvents();
  }
  const w = sim.result?.winner;
  return w === 0 || w === 1 ? w : null;
}

/**
 * spec 對全部原廠陀螺（不含自己）的勝率。每個種子兩個座位各打一場：
 * 座位（開場位置、發射力道的亂數順序）對勝負影響很大，只打一邊時結果會被少數種子左右。
 */
function rateVsField(spec: TopSpec, self: TopId, games: number, arenaId: ArenaId): number {
  let win = 0;
  let n = 0;
  for (const opp of TOP_IDS) {
    if (opp === self) continue;
    for (let seed = 1; seed <= games; seed++) {
      for (const asA of [true, false]) {
        const w = asA ? play(spec, TOP_SPECS[opp], seed, arenaId) : play(TOP_SPECS[opp], spec, seed, arenaId);
        if (w === null) continue;
        n++;
        if ((asA && w === 0) || (!asA && w === 1)) win++;
      }
    }
  }
  return n ? win / n : 0;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signed = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

test('零件平衡報表', { timeout: 3_600_000 }, () => {
  const arenaId = (env.ARENA ?? 'practice') as ArenaId;
  const games = Number(env.GAMES ?? 3);
  const base = new Map<TopId, number>(TOP_IDS.map((id) => [id, rateVsField(TOP_SPECS[id], id, games, arenaId)]));

  const lines: string[] = [`[${arenaId}] 每組 ${games * 2} 場；差值 = 換零件後對全部原廠陀螺的勝率 − 原廠組合的勝率（百分點）`];
  /** 所有「單換一件」的結果，最後列出勝率最高的 */
  const all: { top: TopId; part: PartId; rate: number; delta: number }[] = [];
  for (const part of [...DISK_IDS, ...DRIVER_IDS]) {
    const slot = PARTS[part].slot;
    const deltas: { top: TopId; rate: number; delta: number }[] = [];
    for (const top of TOP_IDS) {
      if (TOP_SPECS[top].stock[slot] === part) continue;
      const lo: Loadout = { disk: null, driver: null, [slot]: part };
      const rate = rateVsField(buildSpec(top, lo), top, games, arenaId);
      deltas.push({ top, rate, delta: rate - base.get(top)! });
      all.push({ top, part, rate, delta: rate - base.get(top)! });
    }
    const mean = deltas.reduce((a, d) => a + d.delta, 0) / (deltas.length || 1);
    const sorted = [...deltas].sort((x, y) => y.delta - x.delta);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    lines.push(
      `${PARTS[part].nameZh.padEnd(6, '　')} 平均 ${signed(mean).padStart(6)}　最佳 ${best.top}(${signed(best.delta)})　最差 ${worst.top}(${signed(worst.delta)})　裝的陀螺數 ${deltas.length}`,
    );
  }
  lines.push('原廠勝率：' + TOP_IDS.map((id) => `${id} ${pct(base.get(id)!)}`).join('、'));
  lines.push('單換一件勝率最高的 10 組：');
  for (const r of [...all].sort((x, y) => y.rate - x.rate).slice(0, 10)) {
    lines.push(`  ${r.top.padEnd(9)} + ${PARTS[r.part].nameZh}　${pct(r.rate)}（${signed(r.delta)}）`);
  }

  if (env.COMBOS) {
    const combos: { top: TopId; disk: PartId; driver: PartId; rate: number }[] = [];
    for (const top of TOP_IDS) {
      for (const disk of DISK_IDS) {
        for (const driver of DRIVER_IDS) {
          const spec = buildSpec(top, { disk, driver });
          if (spec === TOP_SPECS[top]) continue;
          combos.push({ top, disk, driver, rate: rateVsField(spec, top, 1, arenaId) });
        }
      }
    }
    lines.push('盤＋軸組合勝率最高的 15 組（每組 2 場，種子 1 兩個座位）：');
    for (const c of combos.sort((x, y) => y.rate - x.rate).slice(0, 15)) {
      lines.push(`  ${c.top.padEnd(9)} ${PARTS[c.disk].nameZh}＋${PARTS[c.driver].nameZh}　${pct(c.rate)}（原廠 ${pct(base.get(c.top)!)}）`);
    }
  }
  console.log(lines.join('\n'));
});
