import { describe, expect, test } from 'vitest';
import { applyParts, clampStats, DISK_IDS, DRIVER_IDS, equip, PARTS, release, spareHolder, STOCK, type TeamLoadouts } from '../src/sim/parts';
import { buildSpec, TOP_IDS, TOP_SPECS } from '../src/sim/tops';
import type { BaseStats } from '../src/sim/types';

/** 六項屬性（不含重量）的名稱 */
const SCORE_KEYS = ['attack', 'defense', 'stamina', 'burst', 'dash'] as const;

describe('零件型錄', () => {
  test('盤與軸各自有好幾種，代號不重複，而且都登記在 PARTS', () => {
    expect(DISK_IDS.length).toBeGreaterThanOrEqual(5);
    expect(DRIVER_IDS.length).toBeGreaterThanOrEqual(6);
    const all = [...DISK_IDS, ...DRIVER_IDS];
    expect(new Set(all).size).toBe(all.length);
    for (const id of DISK_IDS) expect(PARTS[id].slot).toBe('disk');
    for (const id of DRIVER_IDS) expect(PARTS[id].slot).toBe('driver');
  });

  test('每個零件都是取捨：至少有一項加、一項減（標準盤除外）；實際強弱由 npm run balance:parts 把關', () => {
    for (const p of Object.values(PARTS)) {
      const vals = SCORE_KEYS.map((k) => p.mods[k] ?? 0);
      if (vals.some((v) => v !== 0) || p.mods.weight) {
        expect(vals.some((v) => v > 0) || (p.mods.weight ?? 0) > 0, `${p.id} 沒有好處`).toBe(true);
        expect(vals.some((v) => v < 0) || (p.mods.weight ?? 0) < 0, `${p.id} 沒有代價`).toBe(true);
      }
    }
  });

  test('每顆陀螺的原廠盤與原廠軸都在型錄裡、放在正確的欄位', () => {
    for (const id of TOP_IDS) {
      const s = TOP_SPECS[id].stock;
      expect(PARTS[s.disk]?.slot, `${id} 原廠盤`).toBe('disk');
      expect(PARTS[s.driver]?.slot, `${id} 原廠軸`).toBe('driver');
    }
  });
});

describe('組裝：攻擊環＋盤＋軸 → 屬性', () => {
  test('原廠組合的屬性與物理能力值和改版前完全相同（平衡基準不變）', () => {
    for (const id of TOP_IDS) {
      const stock = buildSpec(id, STOCK);
      expect(stock.stats, id).toEqual(TOP_SPECS[id].stats);
      expect(stock.attack).toBe(TOP_SPECS[id].attack);
      expect(stock.maxSpin).toBe(TOP_SPECS[id].maxSpin);
      expect(stock.parts).toEqual(TOP_SPECS[id].stock);
    }
  });

  test('換軸：屬性變化 = 新零件 − 原廠零件，物理能力值跟著重算', () => {
    const base = TOP_SPECS.pegasus;
    const to = 'bearing';
    expect(base.stock.driver).not.toBe(to);
    const s = buildSpec('pegasus', { disk: null, driver: to });
    const from = PARTS[base.stock.driver].mods;
    const now = PARTS[to].mods;
    const expected = clampStats({
      ...base.stats,
      stamina: base.stats.stamina - (from.stamina ?? 0) + (now.stamina ?? 0),
      dash: base.stats.dash - (from.dash ?? 0) + (now.dash ?? 0),
      defense: base.stats.defense - (from.defense ?? 0) + (now.defense ?? 0),
      attack: base.stats.attack - (from.attack ?? 0) + (now.attack ?? 0),
      burst: base.stats.burst - (from.burst ?? 0) + (now.burst ?? 0),
      weight: base.stats.weight - (from.weight ?? 0) + (now.weight ?? 0),
    });
    expect(s.stats).toEqual(expected);
    expect(s.stamina).toBeGreaterThan(base.stamina);
    expect(s.cruise).toBeLessThan(base.cruise);
    expect(s.parts).toEqual({ disk: base.stock.disk, driver: to });
    // 身分（名稱、必殺、外觀）跟著攻擊環走，不會變
    expect(s.id).toBe('pegasus');
    expect(s.special).toBe(base.special);
    expect(s.color).toBe(base.color);
  });

  test('屬性限制在 1～10、重量限制在 25～80 g（雷達圖與物理用同一個限制）', () => {
    const s: BaseStats = { attack: 12, defense: -2, stamina: 0, weight: 99, burst: 11, dash: 1 };
    expect(clampStats(s)).toEqual({ attack: 10, defense: 1, stamina: 1, weight: 80, burst: 10, dash: 1 });
    // 所有陀螺配上所有零件組合都落在範圍內
    for (const id of TOP_IDS) {
      for (const disk of DISK_IDS) {
        for (const driver of DRIVER_IDS) {
          const st = buildSpec(id, { disk, driver }).stats;
          for (const k of SCORE_KEYS) {
            expect(st[k]).toBeGreaterThanOrEqual(1);
            expect(st[k]).toBeLessThanOrEqual(10);
          }
        }
      }
    }
  });

  test('applyParts 是可逆的：裝上再換回原廠等於原本的屬性', () => {
    const sp = TOP_SPECS.orion;
    const swapped = applyParts(sp.ring, PARTS.light, PARTS.flat);
    expect(swapped).not.toEqual(sp.stats);
    expect(applyParts(sp.ring, PARTS[sp.stock.disk], PARTS[sp.stock.driver])).toEqual(sp.stats);
  });
});

describe('備用零件庫：每種只有一件', () => {
  const empty = (): TeamLoadouts => ({});
  /** 某顆陀螺的原廠零件 */
  const stk = (id: string) => TOP_SPECS[id].stock;

  test('一件備用零件只能裝在一顆陀螺上', () => {
    let team = equip(empty(), 'blaze', stk('blaze'), 'driver', 'bearing');
    expect(spareHolder(team, 'bearing')).toBe('blaze');
    expect(() => equip(team, 'gale', stk('gale'), 'driver', 'bearing')).toThrow();
    // 同一顆換成別的軸：原本那件歸還
    team = equip(team, 'blaze', stk('blaze'), 'driver', 'sharp');
    expect(spareHolder(team, 'bearing')).toBeNull();
    team = equip(team, 'gale', stk('gale'), 'driver', 'bearing');
    expect(spareHolder(team, 'bearing')).toBe('gale');
  });

  test('換回原廠（null）會把備用零件還回零件庫', () => {
    let team = equip(empty(), 'blaze', stk('blaze'), 'disk', 'heavy');
    team = equip(team, 'blaze', stk('blaze'), 'disk', null);
    expect(spareHolder(team, 'heavy')).toBeNull();
    expect(team.blaze?.disk ?? null).toBeNull();
  });

  test('陀螺離開隊伍（release）時，它身上的備用零件全部歸還', () => {
    let team = equip(empty(), 'blaze', stk('blaze'), 'disk', 'heavy');
    team = equip(team, 'blaze', stk('blaze'), 'driver', 'bearing');
    team = release(team, 'blaze');
    expect(spareHolder(team, 'heavy')).toBeNull();
    expect(spareHolder(team, 'bearing')).toBeNull();
    expect(team.blaze).toBeUndefined();
  });

  test('裝上和原廠同型的零件等於原廠，不佔用備用零件', () => {
    const stockDriver = TOP_SPECS.pegasus.stock.driver;
    const team = equip(empty(), 'pegasus', stk('pegasus'), 'driver', stockDriver);
    expect(team.pegasus?.driver ?? null).toBeNull();
    expect(spareHolder(team, stockDriver)).toBeNull();
  });

  test('盤不能裝到軸的欄位', () => {
    expect(() => equip(empty(), 'blaze', stk('blaze'), 'driver', DISK_IDS[0])).toThrow();
  });

  test('操作不會改到傳進來的物件（回傳新的狀態）', () => {
    const before = equip(empty(), 'blaze', stk('blaze'), 'disk', 'heavy');
    const snapshot = JSON.stringify(before);
    equip(before, 'gale', stk('gale'), 'driver', 'bearing');
    release(before, 'blaze');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
