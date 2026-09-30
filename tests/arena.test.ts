import { describe, expect, test } from 'vitest';
import { ARENAS, ARENA_IDS, floorHeight, floorSlope, inPocket, ventPhase, type ArenaId } from '../src/sim/arena';
import { BattleSim } from '../src/sim/battle';
import { createTop, integrateTop, resolvePillars } from '../src/sim/physics';
import { TOP_SPECS } from '../src/sim/tops';

const STEP = 1 / 120;

describe('場地規格', () => {
  test('五個場地，半徑一致（鏡頭與特效共用尺寸）', () => {
    expect(ARENA_IDS).toHaveLength(5);
    for (const id of ARENA_IDS) expect(ARENAS[id].radius).toBe(3.2);
  });

  test('出場口判定依各場地的出場口位置', () => {
    for (const id of ARENA_IDS) {
      const a = ARENAS[id];
      for (const p of a.pockets) expect(inPocket(p, a)).toBe(true);
    }
    // 標準戰鬥盤的出場口在不同角度：練習場的第二個出場口在這裡是牆
    expect(inPocket(ARENAS.practice.pockets[1], ARENAS.stadium)).toBe(false);
  });

  test('坡度等於高度的數值微分（含火山錐）', () => {
    for (const id of ARENA_IDS) {
      const a = ARENAS[id];
      for (const r of [0.3, 1, 2, 3]) {
        const h = 1e-4;
        const num = (floorHeight(r + h, a) - floorHeight(r - h, a)) / (2 * h);
        expect(floorSlope(r, a)).toBeCloseTo(num, 4);
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
    for (const id of ['stadium', 'volcano', 'glacier', 'flooded'] as const) {
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
