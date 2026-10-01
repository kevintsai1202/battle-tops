import { describe, expect, test } from 'vitest';
import { STOCK } from '../src/sim/parts';
import {
  addTrialResult,
  emptyTrialRecord,
  parseTrialStore,
  pruneTrialStore,
  TRIAL_DATA_VERSION,
  trialKey,
  type TrialConfig,
  type TrialStore,
} from '../src/sim/trial';
import { runAutoDuelJob } from '../src/sim/autoDuelJob';
import { AutoDuel } from '../src/sim/trial';

/** 試驗模式的紀錄存在瀏覽器裡（localStorage）：解析要擋掉壞掉或過期的資料，數量有上限 */
const CFG: TrialConfig = { player: { top: 'blaze', loadout: { disk: 'heavy', driver: null } }, cpu: { top: 'turtle', loadout: STOCK }, arena: 'stadium', difficulty: 'normal' };
const KEY = trialKey(CFG);
const AUTO = { games: 10, wins: 6, losses: 3, draws: 1, finishes: { spin: [3, 2], over: [1, 0], burst: [1, 1], xtreme: [1, 0] }, avgTime: 12.5, seats: [5, 5] } as TrialStore['entries'][string]['auto'];

/** 一份正常的紀錄 */
function store(): TrialStore {
  const record = addTrialResult(emptyTrialRecord(), { finish: 'over', loser: 1, winner: 0 });
  return { v: TRIAL_DATA_VERSION, cfg: CFG, entries: { [KEY]: { cfg: CFG, record, auto: AUTO, at: 100 } } };
}

describe('試驗紀錄的解析', () => {
  test('存進去再讀出來一模一樣', () => {
    expect(parseTrialStore(JSON.stringify(store()))).toEqual(store());
  });

  test('沒有資料、不是 JSON、版本不同（平衡數值改過）都當成沒有紀錄', () => {
    const empty = { v: TRIAL_DATA_VERSION, cfg: null, entries: {} };
    expect(parseTrialStore(null)).toEqual(empty);
    expect(parseTrialStore('{壞掉')).toEqual(empty);
    expect(parseTrialStore(JSON.stringify({ ...store(), v: TRIAL_DATA_VERSION + 1 }))).toEqual(empty);
    expect(parseTrialStore('"字串"')).toEqual(empty);
  });

  test('設定不合法的項目個別丟掉（不認得的陀螺、零件不存在或欄位不對、場地或難度不存在），其他保留', () => {
    const bad = (patch: Partial<TrialConfig>): TrialConfig => ({ ...CFG, ...patch });
    const configs = [
      bad({ player: { top: 'nope', loadout: STOCK } }),
      bad({ cpu: { top: 'turtle', loadout: { disk: 'no-such-part', driver: null } } }),
      bad({ cpu: { top: 'turtle', loadout: { disk: 'needle', driver: null } } }), // 軸裝在盤的欄位
      bad({ arena: 'moon' as TrialConfig['arena'] }),
      bad({ difficulty: 'insane' as TrialConfig['difficulty'] }),
    ];
    const s = store();
    configs.forEach((c, i) => (s.entries[`bad${i}`] = { cfg: c, record: emptyTrialRecord(), at: 1 }));
    s.cfg = configs[0];
    const parsed = parseTrialStore(JSON.stringify(s));
    expect(Object.keys(parsed.entries)).toEqual([KEY]);
    // 上次的設定不合法：當成沒有
    expect(parsed.cfg).toBeNull();
  });

  test('戰績的數字不合法（負數、不是數字）的項目丟掉；key 和設定對不上的也丟掉', () => {
    const s = store();
    s.entries.x = { cfg: CFG, record: { ...emptyTrialRecord(), wins: -1 }, at: 1 };
    s.entries[trialKey({ ...CFG, arena: 'practice' })] = { cfg: { ...CFG, arena: 'practice' }, record: { ...emptyTrialRecord(), games: 'a' as unknown as number }, at: 1 };
    expect(Object.keys(parseTrialStore(JSON.stringify(s)).entries)).toEqual([KEY]);
  });

  test('最多保留最近的 N 組設定（依最後更新時間）', () => {
    const s: TrialStore = { v: TRIAL_DATA_VERSION, cfg: CFG, entries: {} };
    for (let i = 0; i < 60; i++) {
      const c = { ...CFG, player: { top: 'blaze', loadout: STOCK }, difficulty: (['easy', 'normal', 'hard'] as const)[i % 3] };
      s.entries[`k${i}`] = { cfg: c, record: emptyTrialRecord(), at: i };
    }
    const kept = pruneTrialStore(s, 50);
    expect(Object.keys(kept.entries)).toHaveLength(50);
    expect(kept.entries.k0).toBeUndefined();
    expect(kept.entries.k59).toBeDefined();
  });
});

describe('背景執行的自動對打（Web Worker 的工作內容）', () => {
  test('每 N 場回報一次進度（遞增），最後回報結果，和直接跑 AutoDuel 一樣', () => {
    const msgs: { type: string; progress?: number; summary?: unknown }[] = [];
    runAutoDuelJob({ id: 7, cfg: CFG, total: 12, seed: 5 }, (m) => msgs.push(m), 4);
    const progress = msgs.filter((m) => m.type === 'progress').map((m) => m.progress!);
    expect(progress).toEqual([4 / 12, 8 / 12, 12 / 12]);
    const done = msgs.at(-1)!;
    expect(done).toMatchObject({ type: 'done', id: 7 });
    const direct = new AutoDuel(CFG, 12, 5);
    while (!direct.done) direct.runNext();
    expect(done.summary).toEqual(direct.summary);
  });
});
