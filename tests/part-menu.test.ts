import { describe, expect, test } from 'vitest';
import { DISK_IDS, DRIVER_IDS, PARTS } from '../src/sim/parts';
import { buildSpec, TOP_SPECS } from '../src/sim/tops';
import { partOptions } from '../src/ui/partMenu';

/** 零件清單（組隊第 2 步與試驗模式的「盤」「軸」按鈕展開的選項）的純邏輯 */
describe('零件清單的選項', () => {
  test('第一個是原廠零件，接著是同一欄的其他備用零件（不重複列原廠那一件）', () => {
    const opts = partOptions('blaze', 'disk', {});
    expect(opts[0]).toMatchObject({ part: null, stock: true, current: true });
    expect(opts[0].def.id).toBe(TOP_SPECS.blaze.stock.disk);
    expect(opts).toHaveLength(DISK_IDS.length);
    expect(new Set(opts.map((o) => o.def.id)).size).toBe(opts.length);
    expect(partOptions('blaze', 'driver', {})).toHaveLength(DRIVER_IDS.length);
  });

  test('數值增減是「換上這件」和「用原廠這一欄」相比（另一欄維持目前的零件）', () => {
    const lo = { blaze: { disk: null, driver: 'needle' } };
    const heavy = partOptions('blaze', 'disk', lo).find((o) => o.part === 'heavy')!;
    const withPart = buildSpec('blaze', { disk: 'heavy', driver: 'needle' }).stats;
    const without = buildSpec('blaze', { disk: null, driver: 'needle' }).stats;
    expect(heavy.delta.weight).toBe(withPart.weight - without.weight);
    // 只列有變的屬性
    for (const v of Object.values(heavy.delta)) expect(v).not.toBe(0);
    // 原廠選項沒有增減
    expect(partOptions('blaze', 'disk', lo)[0].delta).toEqual({});
    expect(PARTS.heavy.slot).toBe('disk');
  });

  test('標出目前裝的零件；被隊友用掉的零件標出是哪一顆（自己裝的不算）', () => {
    const team = { blaze: { disk: 'heavy', driver: null }, turtle: { disk: null, driver: 'needle' } };
    const mine = partOptions('blaze', 'disk', team);
    expect(mine.find((o) => o.current)?.part).toBe('heavy');
    expect(mine.find((o) => o.part === 'heavy')?.takenBy).toBeNull();
    const other = partOptions('gale', 'disk', team);
    expect(other.find((o) => o.part === 'heavy')?.takenBy).toBe('blaze');
    expect(partOptions('gale', 'driver', team).find((o) => o.part === 'needle')?.takenBy).toBe('turtle');
  });
});
