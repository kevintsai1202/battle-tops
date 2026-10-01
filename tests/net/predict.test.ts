import { describe, expect, test } from 'vitest';
import { ClockSync } from '../../src/net/clock';
import { Predictor } from '../../src/net/predict';
import { ARENAS } from '../../src/sim/arena';
import { BattleSim, type SimSnapshot } from '../../src/sim/battle';
import { cpuThink } from '../../src/sim/cpu';
import { createRng } from '../../src/sim/rng';
import { TOP_SPECS } from '../../src/sim/tops';
import type { V2 } from '../../src/sim/types';

const STEP = 1 / 120;

describe('時鐘同步', () => {
  test('對稱延遲時算出正確的時差與往返時間', () => {
    const c = new ClockSync();
    // 伺服器時鐘比本機快 5000 ms，單程 30 ms
    c.add(1000, 1000 + 5000 + 30, 1060);
    expect(c.offset).toBeCloseTo(5000, 6);
    expect(c.rtt).toBeCloseTo(60, 6);
    expect(c.toLocal(8000)).toBeCloseTo(3000, 6);
    expect(c.serverNow(2000)).toBeCloseTo(7000, 6);
  });

  test('往返特別久的樣本（主執行緒忙、封包排隊）不拿來算時差', () => {
    const c = new ClockSync();
    c.add(0, 5030, 60);
    // 回程多卡了 400 ms：用這筆算會偏 200 ms
    c.add(1000, 6030, 1460);
    c.add(2000, 7030, 2060);
    expect(c.offset).toBeCloseTo(5000, 6);
  });

  test('往返時間取中位數（給預測用），只保留最近的樣本', () => {
    const c = new ClockSync();
    for (let i = 0; i < 20; i++) c.add(i * 1000, i * 1000 + 40, i * 1000 + 80 + (i % 3) * 10);
    expect(c.rtt).toBe(90);
    expect(c.ready).toBe(true);
    expect(new ClockSync().ready).toBe(false);
  });
});

/** 模擬網路的預測測試：伺服器權威、單程延遲 lagSteps 步、每 6 步一次快照 */
function runNet(lagSteps: number, predict: boolean): number[] {
  const server = new BattleSim(TOP_SPECS.pegasus, TOP_SPECS.turtle, { seed: 4, launch: [0.95, 0.9], arena: ARENAS.practice });
  const client = new Predictor(server.snapshot(), 0);
  const brain = createRng(8);
  const oppBrain = createRng(9);
  /** 還在路上的操作與快照（到達的步數） */
  const toServer: { at: number; seq: number; control: V2 }[] = [];
  const toClient: { at: number; snap: SimSnapshot; ack: number }[] = [];
  /** 伺服器每一步之後自己陀螺的位置 */
  const truth: V2[] = [];
  /** 客戶端每一步畫面上的位置 */
  const shown: V2[] = [];
  let lastSnap = server.snapshot();
  let applied = 0;
  let seq = 0;
  for (let k = 0; k < 120 * 12 && !server.result; k++) {
    // 客戶端：依自己的畫面決定操作（CPU 當玩家），立刻套用到預測並送出
    const d = cpuThink(client.sim, 0, brain);
    client.setControl(d.control);
    toServer.push({ at: k + lagSteps, seq: ++seq, control: d.control });
    // 伺服器：套用到達的操作，對手由伺服器上的 CPU 控制
    while (toServer.length && toServer[0].at <= k) {
      const m = toServer.shift()!;
      server.setControl(0, m.control);
      applied = m.seq;
    }
    server.setControl(1, cpuThink(server, 1, oppBrain).control);
    server.step(STEP);
    server.drainEvents();
    truth.push({ ...server.tops[0].pos });
    if (k % 6 === 0) toClient.push({ at: k + lagSteps, snap: server.snapshot(), ack: applied });
    // 客戶端：收到快照就校正，再往前推一步
    while (toClient.length && toClient[0].at <= k) {
      const m = toClient.shift()!;
      lastSnap = m.snap;
      if (predict) client.reconcile(m.snap, m.ack, lagSteps * 2);
    }
    if (predict) {
      client.advance(STEP);
      shown.push({ ...client.renderPos(0) });
    } else shown.push({ ...lastSnap.tops[0].pos });
    client.decay(STEP);
  }
  // 客戶端第 k 步看到的，應該是伺服器收到這些操作時（k + lag 步）的狀態
  const err: number[] = [];
  for (let k = 0; k + lagSteps < truth.length; k++) {
    err.push(Math.hypot(shown[k].x - truth[k + lagSteps].x, shown[k].z - truth[k + lagSteps].z));
  }
  return err.sort((a, b) => a - b);
}

describe('預測與校正', () => {
  test('單程 60 ms：預測的自己位置誤差中位數遠小於「直接顯示晚到的快照」', () => {
    const pred = runNet(7, true);
    const naive = runNet(7, false);
    const med = (e: number[]) => e[Math.floor(e.length / 2)];
    const p90 = (e: number[]) => e[Math.floor(e.length * 0.9)];
    console.log(`單程 60 ms：預測 中位 ${med(pred).toFixed(4)}／90% ${p90(pred).toFixed(4)}；不預測 中位 ${med(naive).toFixed(4)}／90% ${p90(naive).toFixed(4)}（陀螺半徑約 0.35）`);
    expect(med(pred)).toBeLessThan(0.02);
    expect(med(naive)).toBeGreaterThan(med(pred) * 5);
  });

  test('按下必殺：預測立刻套用（看得到增益），伺服器確認前的校正會重新套用，不會重複發動', () => {
    const server = new BattleSim(TOP_SPECS.blaze, TOP_SPECS.turtle, { seed: 2, launch: [0.95, 0.9] });
    for (let i = 0; i < 120; i++) server.step(STEP);
    server.drainEvents();
    server.tops[0].special = 1;
    const client = new Predictor(server.snapshot(), 0);
    client.special(1);
    expect(client.sim.tops[0].specialUsed).toBe(true);
    expect(client.sim.tops[0].buff).not.toBeNull();
    // 伺服器還沒收到：快照裡沒有發動，ack 0 → 校正後預測仍然有發動
    client.reconcile(server.snapshot(), 0, 10);
    expect(client.sim.tops[0].specialUsed).toBe(true);
    // 伺服器收到並套用：ack 1 → 不再重新套用（快照本身就有）
    server.useSpecial(0);
    server.step(STEP);
    client.reconcile(server.snapshot(), 1, 10);
    expect(client.sim.tops[0].specialUsed).toBe(true);
    expect(client.pendingCount).toBe(0);
  });

  test('校正造成的位置跳動用畫面偏移慢慢收斂；太大的跳動直接跳過去', () => {
    const server = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.wolf, { seed: 3, launch: [0.9, 0.9] });
    const client = new Predictor(server.snapshot(), 0);
    const snap = server.snapshot();
    snap.tops[1].pos.x += 0.2;
    client.reconcile(snap, 0, 0);
    const shown = client.renderPos(1);
    expect(shown.x).toBeCloseTo(client.sim.tops[1].pos.x - 0.2, 6);
    for (let i = 0; i < 60; i++) client.decay(1 / 60);
    expect(Math.abs(client.renderPos(1).x - client.sim.tops[1].pos.x)).toBeLessThan(0.01);
    const far = server.snapshot();
    far.tops[1].pos.x += 3;
    client.reconcile(far, 0, 0);
    expect(client.renderPos(1).x).toBeCloseTo(client.sim.tops[1].pos.x, 6);
  });

  test('預測產生的事件會被丟掉（特效只依伺服器事件觸發）', () => {
    const server = new BattleSim(TOP_SPECS.blaze, TOP_SPECS.turtle, { seed: 5, launch: [1, 1] });
    const client = new Predictor(server.snapshot(), 1);
    for (let i = 0; i < 240; i++) client.advance(STEP);
    expect(client.sim.drainEvents()).toEqual([]);
  });
});
