import { describe, expect, test } from 'vitest';
import { activeRail, ARENAS, ARENA_IDS, floorHeight, floorSlope, inPocket, liftPhase, pocketAt, ventPhase, type ArenaId } from '../src/sim/arena';
import { BattleSim } from '../src/sim/battle';
import { createTop, integrateTop, resolvePillars } from '../src/sim/physics';
import { TOP_SPECS } from '../src/sim/tops';

const STEP = 1 / 120;

describe('場地規格', () => {
  test('六個場地，半徑一致（鏡頭與特效共用尺寸）', () => {
    expect(ARENA_IDS).toHaveLength(6);
    expect(ARENA_IDS).toContain('double');
    for (const id of ARENA_IDS) expect(ARENAS[id].radius).toBe(3.2);
  });

  test('出場口判定依各場地的出場口位置', () => {
    for (const id of ARENA_IDS) {
      const a = ARENAS[id];
      for (const p of a.pockets) expect(inPocket(p.at, a)).toBe(true);
    }
    // 標準戰鬥盤的出場口在不同角度：練習場的第二個出場口在這裡是牆
    expect(inPocket(ARENAS.practice.pockets[1].at, ARENAS.stadium)).toBe(false);
  });

  test('坡度等於高度的數值微分（含火山錐、龍捲脊、外圈加陡、雙層盤升降的凹槽）', () => {
    for (const id of ARENA_IDS) {
      const a = ARENAS[id];
      for (const level of [0, 0.5, 1]) {
        for (const r of [0.3, 1, 1.15, 1.8, 1.9, 2, 2.6, 3]) {
          const h = 1e-4;
          const num = (floorHeight(r + h, a, level) - floorHeight(r - h, a, level)) / (2 * h);
          expect(floorSlope(r, a, level), `${id} r=${r} level=${level}`).toBeCloseTo(num, 4);
        }
      }
    }
  });
});

describe('場地會改變陀螺走向', () => {
  /** 同一顆、同樣的初速，在不同場地推進 3 秒後的狀態 */
  function run(arenaId: ArenaId) {
    const t = createTop(0, TOP_SPECS.wolf, { x: -1.2, z: 0.4 }, { x: 2, z: 0.5 }, 0.9);
    for (let i = 0; i < 360; i++) integrateTop(t, STEP, ARENAS[arenaId]);
    return t;
  }

  test('每個特殊場地的軌跡都和練習場不同', () => {
    const base = run('practice');
    for (const id of ['stadium', 'double', 'volcano', 'glacier', 'flooded'] as const) {
      const t = run(id);
      expect(Math.hypot(t.pos.x - base.pos.x, t.pos.z - base.pos.z), id).toBeGreaterThan(0.1);
    }
  });

  test('火山：中央火山錐把靜止的陀螺往外推', () => {
    const t = createTop(0, TOP_SPECS.wolf, { x: 0.4, z: 0 }, { x: 0, z: 0 }, 0);
    integrateTop(t, 0.05, ARENAS.volcano);
    expect(t.vel.x).toBeGreaterThan(0);
  });

  test('冰川：同樣的初速滑得更遠（摩擦小）', () => {
    const mk = () => createTop(0, TOP_SPECS.wolf, { x: 0, z: 0 }, { x: 3, z: 0 }, 0);
    const [ice, ground] = [mk(), mk()];
    for (let i = 0; i < 30; i++) {
      integrateTop(ice, STEP, ARENAS.glacier);
      integrateTop(ground, STEP, ARENAS.practice);
    }
    expect(Math.hypot(ice.vel.x, ice.vel.z)).toBeGreaterThan(Math.hypot(ground.vel.x, ground.vel.z));
  });

  test('積水：水中的陀螺轉速流失比岸上快，而且被水流帶著繞圈', () => {
    const wet = createTop(0, TOP_SPECS.wolf, { x: 0.8, z: 0 }, { x: 0, z: 0 }, 0.9);
    const dry = createTop(0, TOP_SPECS.wolf, { x: 0.8, z: 0 }, { x: 0, z: 0 }, 0.9);
    for (let i = 0; i < 60; i++) {
      integrateTop(wet, STEP, ARENAS.flooded);
      integrateTop(dry, STEP, ARENAS.practice);
    }
    expect(wet.terrain).toBe('water');
    expect(wet.spin).toBeLessThan(dry.spin);
    // 水流逆時針：在 +x 處往 +z 推
    expect(wet.vel.z).toBeGreaterThan(dry.vel.z);
  });

  test('標準戰鬥盤：極限軌道沿切線加速，機動高的加速更多', () => {
    const mk = (id: string) => createTop(0, TOP_SPECS[id], { x: 2.8, z: 0 }, { x: 0, z: 0 }, 1);
    const [fast, slow] = [mk('valkyrie'), mk('gale')];
    integrateTop(fast, STEP, ARENAS.stadium);
    integrateTop(slow, STEP, ARENAS.stadium);
    expect(fast.terrain).toBe('rail');
    expect(Math.abs(fast.vel.z)).toBeGreaterThan(Math.abs(slow.vel.z));
  });

  test('冰川：撞到冰柱會被彈開', () => {
    const p = ARENAS.glacier.pillars[0];
    const t = createTop(0, TOP_SPECS.wolf, { x: p.x - p.r - 0.3, z: p.z }, { x: 3, z: 0 }, 0.9);
    const hit = resolvePillars(t, ARENAS.glacier);
    expect(hit).not.toBeNull();
    expect(t.vel.x).toBeLessThan(0);
  });

  test('火山：噴口週期性噴發，把噴口內的陀螺轟開並發出事件', () => {
    const v = ARENAS.volcano.vents[0];
    const sim = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.wolf, { seed: 1, launch: [1, 1], arena: ARENAS.volcano });
    let erupted = false;
    let pushed = 0;
    for (let i = 0; i < 120 * (v.period + 1) && !erupted; i++) {
      // 把玩家的陀螺固定在噴口裡、另一顆放到對面
      const t = sim.tops[0];
      t.pos = { x: v.x * 1.05, z: v.z * 1.05 };
      t.vel = { x: 0, z: 0 };
      sim.tops[1].pos = { x: -v.x, z: -v.z };
      sim.step(STEP);
      const ev = sim.drainEvents().find((e) => e.type === 'hazard' && e.kind === 'erupt' && e.pos.x === v.x);
      if (ev) {
        erupted = true;
        pushed = Math.hypot(t.vel.x, t.vel.z);
      }
    }
    expect(erupted).toBe(true);
    expect(pushed).toBeGreaterThan(3);
  });

  test('熔岩噴口：噴發前有預兆（warn），平常站在上面轉速流失較快', () => {
    const v = ARENAS.volcano.vents[0];
    const before = v.period - v.phase - 0.4 - 0.35;
    expect(ventPhase(v, before).warn).toBeGreaterThan(0);
    expect(ventPhase(v, before).erupt).toBe(-1);
    const onLava = createTop(0, TOP_SPECS.wolf, { x: v.x, z: v.z }, { x: 0, z: 0 }, 0.9);
    const off = createTop(0, TOP_SPECS.wolf, { x: -v.x, z: -v.z }, { x: 0, z: 0 }, 0.9);
    integrateTop(onLava, STEP, ARENAS.volcano);
    integrateTop(off, STEP, ARENAS.volcano);
    expect(onLava.terrain).toBe('lava');
    expect(onLava.spin).toBeLessThan(off.spin);
  });
});

describe('實體戰鬥盤：標準戰鬥盤（BX-10）與雙層戰鬥盤（BX-37）', () => {
  const PHYSICAL = ['stadium', 'double'] as const;

  test('出場口集中在同一邊：中間寬口是 Xtreme 區（極限終結），兩角是 Over 區（場外終結）', () => {
    for (const id of PHYSICAL) {
      const a = ARENAS[id];
      expect(a.frame, id).toBe('square');
      // 全部出場口都在 -z 那一側（兩個發射位置在 ±x，離出場口一樣遠）
      for (const p of a.pockets) expect(Math.sin(p.at), id).toBeLessThan(-0.3);
      const xtreme = a.pockets.filter((p) => p.kind === 'xtreme');
      const over = a.pockets.filter((p) => p.kind === 'over');
      expect(xtreme, id).toHaveLength(1);
      expect(over, id).toHaveLength(2);
      // 中間寬口比兩角的出場口寬，且在兩角的中間
      for (const o of over) expect(xtreme[0].half).toBeGreaterThan(o.half);
      expect(Math.sin(xtreme[0].at)).toBeCloseTo(-1, 6);
      expect(pocketAt(xtreme[0].at, a)?.kind).toBe('xtreme');
      expect(pocketAt(over[0].at, a)?.kind).toBe('over');
      // 對面（+z）整片是牆
      expect(pocketAt(Math.PI / 2, a)).toBeNull();
    }
    // 其他場地沒有 Xtreme 區
    for (const id of ['practice', 'volcano', 'glacier', 'flooded'] as const) {
      expect(ARENAS[id].pockets.every((p) => p.kind === 'over'), id).toBe(true);
    }
  });

  test('兩層：內圈平台比外圈平緩，中間隔著一圈龍捲脊（脊上坡度比兩側陡）', () => {
    for (const id of PHYSICAL) {
      const a = ARENAS[id];
      const ridge = a.ridge!;
      expect(ridge, id).not.toBeNull();
      expect(floorSlope(1, a), id).toBeLessThan(floorSlope(2.6, a));
      expect(floorSlope(ridge.r - ridge.w * 0.7, a), id).toBeGreaterThan(floorSlope(ridge.r - ridge.w * 3, a));
    }
  });

  test('外圈極限軌道照舊：標準戰鬥盤與雙層戰鬥盤的外圈都會加速', () => {
    for (const id of PHYSICAL) {
      const t = createTop(0, TOP_SPECS.valkyrie, { x: 2.8, z: 0 }, { x: 0, z: 0 }, 1);
      integrateTop(t, STEP, ARENAS[id]);
      expect(t.terrain, id).toBe('rail');
      expect(Math.abs(t.vel.z), id).toBeGreaterThan(0.01);
    }
  });

  test('雙層戰鬥盤：開場是升起的，之後中央定時降下（降下前有預兆），再升回來，週期重複', () => {
    const lift = ARENAS.double.lift!;
    expect(ARENAS.stadium.lift).toBeNull();
    expect(liftPhase(lift, 0).level).toBe(0);
    // 下降前的預兆
    const warnAt = lift.raised - lift.warn / 2;
    expect(liftPhase(lift, warnAt).level).toBe(0);
    expect(liftPhase(lift, warnAt).warn).toBeGreaterThan(0);
    // 降下中途、完全降下、升回
    expect(liftPhase(lift, lift.raised + lift.move / 2).level).toBeGreaterThan(0);
    expect(liftPhase(lift, lift.raised + lift.move / 2).level).toBeLessThan(1);
    const down = lift.raised + lift.move + lift.lowered / 2;
    expect(liftPhase(lift, down).level).toBe(1);
    const cycle = lift.raised + lift.lowered + 2 * lift.move;
    expect(liftPhase(lift, cycle + 0.1).level).toBe(0);
    expect(liftPhase(lift, cycle + down).level).toBe(1);
  });

  test('雙層戰鬥盤：降下時中央變成凹槽（升起時和標準戰鬥盤一樣平），凹槽壁把陀螺往內推', () => {
    const a = ARENAS.double;
    const lift = a.lift!;
    expect(floorHeight(0.5, a, 1)).toBeCloseTo(floorHeight(0.5, a, 0) - lift.depth, 6);
    expect(floorHeight(lift.r + 0.01, a, 1)).toBeCloseTo(floorHeight(lift.r + 0.01, a, 0), 6);
    // 凹槽壁上靜止的陀螺：降下時往中心加速得比升起時多
    const wall = lift.r - lift.edge / 2;
    const mk = () => createTop(0, TOP_SPECS.wolf, { x: wall, z: 0 }, { x: 0, z: 0 }, 0);
    const [lowered, raised] = [mk(), mk()];
    integrateTop(lowered, 0.05, a, 1);
    integrateTop(raised, 0.05, a, 0);
    expect(lowered.vel.x).toBeLessThan(raised.vel.x - 0.05);
  });

  test('雙層戰鬥盤：凹槽邊緣的內圈極限軌道只在降下時作用', () => {
    const a = ARENAS.double;
    const inner = a.rails.find((r) => r.lowered)!;
    expect(inner).toBeDefined();
    const r = (inner.from + inner.to) / 2;
    expect(activeRail(r, a, 1)).toBe(inner);
    expect(activeRail(r, a, 0)).toBeNull();
    const mk = () => createTop(0, TOP_SPECS.valkyrie, { x: r, z: 0 }, { x: 0, z: 0 }, 1);
    const [down, up] = [mk(), mk()];
    integrateTop(down, STEP, a, 1);
    integrateTop(up, STEP, a, 0);
    expect(down.terrain).toBe('rail');
    expect(up.terrain).toBe('ground');
    expect(Math.abs(down.vel.z)).toBeGreaterThan(Math.abs(up.vel.z));
  });

  test('雙層戰鬥盤：模擬依時間推進升降（level），快照還原後一致', () => {
    const sim = new BattleSim(TOP_SPECS.wolf, TOP_SPECS.turtle, { seed: 3, launch: [1, 1], arena: ARENAS.double });
    expect(sim.level).toBe(0);
    const lift = ARENAS.double.lift!;
    const steps = Math.ceil((lift.raised + lift.move + 0.5) / STEP);
    for (let i = 0; i < steps && !sim.result; i++) sim.step(STEP);
    if (!sim.result) expect(sim.level).toBe(1);
    const copy = BattleSim.fromSnapshot(sim.snapshot());
    expect(copy.level).toBe(sim.level);
  });
});
