import { describe, expect, test } from 'vitest';
import { derivePhysics } from '../src/sim/stats';
import { TOP_IDS, TOP_SPECS } from '../src/sim/tops';
import type { BaseStats } from '../src/sim/types';

/** 中等屬性的陀螺，用來單獨調一項屬性觀察變化 */
const mid: BaseStats = { attack: 5, defense: 5, stamina: 5, weight: 42, burst: 5, dash: 5 };

describe('基本屬性 → 物理能力值', () => {
  test('每一項屬性提高，對應的能力值跟著提高', () => {
    const base = derivePhysics(mid);
    const up = (k: keyof BaseStats, v: number) => derivePhysics({ ...mid, [k]: v });
    expect(up('attack', 9).attack).toBeGreaterThan(base.attack);
    expect(up('defense', 9).defense).toBeGreaterThan(base.defense);
    expect(up('defense', 9).friction).toBeGreaterThan(base.friction);
    expect(up('stamina', 9).stamina).toBeGreaterThan(base.stamina);
    expect(up('stamina', 9).maxSpin).toBeGreaterThan(base.maxSpin);
    expect(up('weight', 60).mass).toBeGreaterThan(base.mass);
    expect(up('burst', 9).burstRes).toBeGreaterThan(base.burstRes);
    expect(up('dash', 9).drive).toBeGreaterThan(base.drive);
    expect(up('dash', 9).cruise).toBeGreaterThan(base.cruise);
  });

  test('爆裂抵抗 5 分 = 1 倍（原本沒有此屬性的陀螺維持原手感）', () => {
    expect(derivePhysics(mid).burstRes).toBeCloseTo(1, 6);
  });

  test('以原創四顆校準：推導值與原本手調的數值差距在 25% 內', () => {
    // 原本手調的數值（改成屬性推導之前）。攻防持久的範圍為了 20 顆的平衡刻意收窄，所以極端值會偏離較多
    const legacy = {
      blaze: { attack: 1.7, defense: 0.8, stamina: 0.9, drive: 6.0, cruise: 5.0, friction: 0.3, maxSpin: 300, mass: 1.1 },
      turtle: { attack: 1.0, defense: 1.7, stamina: 1.15, drive: 1.6, cruise: 1.8, friction: 0.6, maxSpin: 280, mass: 1.6 },
      gale: { attack: 0.7, defense: 1.0, stamina: 1.35, drive: 1.0, cruise: 1.4, friction: 0.25, maxSpin: 320, mass: 1.0 },
      wolf: { attack: 1.05, defense: 1.05, stamina: 1.05, drive: 4.0, cruise: 4.0, friction: 0.35, maxSpin: 300, mass: 1.2 },
    };
    for (const [id, old] of Object.entries(legacy)) {
      const now = TOP_SPECS[id];
      for (const [k, v] of Object.entries(old)) {
        const got = now[k as keyof typeof old];
        expect(Math.abs(got - v) / v, `${id}.${k}：${got} vs ${v}`).toBeLessThanOrEqual(0.25);
      }
    }
  });

  test('屬性超出範圍會被夾住，不會算出負值', () => {
    const p = derivePhysics({ attack: -5, defense: 99, stamina: 0, weight: 500, burst: 0, dash: 0 });
    for (const v of Object.values(p)) expect(v).toBeGreaterThan(0);
  });
});

describe('陀螺名鑑', () => {
  test('至少 16 顆致敬陀螺，四種類型各至少 4 顆', () => {
    const homage = TOP_IDS.map((id) => TOP_SPECS[id]).filter((s) => s.origin);
    expect(homage.length).toBeGreaterThanOrEqual(16);
    for (const type of ['attack', 'defense', 'stamina', 'balance']) {
      expect(homage.filter((s) => s.type === type).length, type).toBeGreaterThanOrEqual(4);
    }
  });

  test('有左旋陀螺；代號、名稱、紋章、必殺技名都不重複', () => {
    const all = TOP_IDS.map((id) => TOP_SPECS[id]);
    expect(all.some((s) => s.spinDir === -1)).toBe(true);
    for (const key of ['id', 'nameJa', 'nameZh', 'emblem'] as const) {
      expect(new Set(all.map((s) => s[key])).size, key).toBe(all.length);
    }
    expect(new Set(all.map((s) => s.special.nameJa)).size).toBe(all.length);
  });
});
