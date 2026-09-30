import type { BaseStats, TopId } from './types';

/**
 * 可替換零件：重心盤與軸心。攻擊環決定陀螺的身分（名稱、外觀、類型、必殺技），不能換；
 * 盤與軸可以換，換了之後屬性（雷達圖）與物理能力值立刻重算。
 *
 * 規則（2026-09-30 與使用者確認）：
 * - 每顆陀螺有自己的原廠盤與原廠軸（跟著陀螺，不會用完）。
 * - 另有一組備用零件：型錄上每種零件各一件，同一支隊伍的三顆不能同時用同一件（像只買了一組替換零件）。
 * - CPU 一律用原廠組合。
 */

/** 零件欄位：重心盤、軸心 */
export type PartSlot = 'disk' | 'driver';

/** 零件代號（PARTS 的鍵） */
export type PartId = string;

/** 零件定義 */
export interface PartDef {
  id: PartId;
  slot: PartSlot;
  /** 名稱（中文） */
  nameZh: string;
  /** 簡碼（小標籤用，例如 RF） */
  code: string;
  /** 特性說明 */
  descZh: string;
  /**
   * 對六項基本屬性的增減。除了重量（公克）以外都是 1～10 分的增減，加總為 0（有得有失）。
   * 陀螺的屬性 = 攻擊環 + 盤 + 軸，攻擊環的值由「原本的屬性 − 原廠盤 − 原廠軸」反推，
   * 所以原廠組合的屬性和加入零件系統之前完全相同。
   */
  mods: Partial<BaseStats>;
}

/** 一顆陀螺目前裝的零件：null 表示用原廠零件 */
export interface Loadout {
  disk: PartId | null;
  driver: PartId | null;
}

/** 一顆陀螺的原廠零件（固定，跟著陀螺） */
export interface StockParts {
  disk: PartId;
  driver: PartId;
}

/** 原廠組合（盤與軸都用原廠） */
export const STOCK: Loadout = { disk: null, driver: null };

/** 隊伍中每顆陀螺換上的備用零件（沒換過的陀螺不在表裡） */
export type TeamLoadouts = Partial<Record<TopId, Loadout>>;

/** 零件型錄 */
const DEFS: PartDef[] = [
  // ---------------- 重心盤 ----------------
  { id: 'standard', slot: 'disk', nameZh: '標準盤', code: 'STD', descZh: '沒有特別的長處或短處。', mods: {} },
  { id: 'light', slot: 'disk', nameZh: '輕量盤', code: 'LT', descZh: '減重 5 g：更靈活，但比較容易被撞開。', mods: { weight: -5, dash: 1 } },
  { id: 'heavy', slot: 'disk', nameZh: '重量盤', code: 'HV', descZh: '加重 8 g：撞不太動，但動作變慢。', mods: { weight: 8, dash: -1 } },
  { id: 'rim', slot: 'disk', nameZh: '外緣盤', code: 'RIM', descZh: '重量集中外圈：防禦與持久提升，攻擊與機動下降。', mods: { weight: 3, stamina: 1, defense: 1, attack: -1, dash: -1 } },
  { id: 'blade', slot: 'disk', nameZh: '刃盤', code: 'BLD', descZh: '外緣帶刃：攻擊大幅提升，防禦與持久下降。', mods: { weight: 2, attack: 2, defense: -1, stamina: -1 } },
  { id: 'guard', slot: 'disk', nameZh: '護鎖盤', code: 'GRD', descZh: '鎖緊攻擊環：不容易爆裂，機動下降。', mods: { weight: 2, burst: 2, dash: -1 } },

  // ---------------- 軸心 ----------------
  { id: 'flat', slot: 'driver', nameZh: '平頭軸', code: 'F', descZh: '平頭：跑得快，持久稍差。', mods: { dash: 2, stamina: -1 } },
  { id: 'rubber', slot: 'driver', nameZh: '橡膠平頭軸', code: 'RF', descZh: '橡膠平頭：抓地猛衝、攻擊提升，持久與防禦變差。', mods: { dash: 3, attack: 1, stamina: -1, defense: -1 } },
  { id: 'taper', slot: 'driver', nameZh: '錐頭軸', code: 'T', descZh: '錐頭：前期衝、後期穩，攻守均衡。', mods: { dash: 1, defense: 1, stamina: -1 } },
  { id: 'sharp', slot: 'driver', nameZh: '尖頭軸', code: 'S', descZh: '尖頭：原地站定、轉得久，幾乎不移動，撞人也不痛。', mods: { stamina: 2, dash: -2, attack: -1 } },
  { id: 'needle', slot: 'driver', nameZh: '針頭軸', code: 'N', descZh: '細針：站得穩、轉得久，機動最差。', mods: { defense: 1, stamina: 1, dash: -3 } },
  { id: 'ball', slot: 'driver', nameZh: '球頭軸', code: 'B', descZh: '球頭：被撞也能回正，防禦提升，移動變慢。', mods: { defense: 1, dash: -2 } },
  { id: 'wideBall', slot: 'driver', nameZh: '寬球軸', code: 'WB', descZh: '寬球：接觸面大，防禦最好，移動遲緩、磨耗轉速。', mods: { defense: 2, dash: -2, stamina: -1 } },
  { id: 'bearing', slot: 'driver', nameZh: '軸承軸', code: 'BD', descZh: '軸承空轉：持久最好，防禦與機動下降。', mods: { stamina: 3, dash: -2, defense: -2 } },
];

/** 零件代號 → 定義 */
export const PARTS: Record<PartId, PartDef> = Object.fromEntries(DEFS.map((d) => [d.id, d]));
/** 重心盤代號（選單順序） */
export const DISK_IDS: PartId[] = DEFS.filter((d) => d.slot === 'disk').map((d) => d.id);
/** 軸心代號（選單順序） */
export const DRIVER_IDS: PartId[] = DEFS.filter((d) => d.slot === 'driver').map((d) => d.id);

/** 限制在 [lo, hi] */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 屬性限制在合法範圍：1～10 分、重量 25～80 g。
 * 雷達圖與物理（derivePhysics）都用這個結果，兩邊不會不一致。
 */
export function clampStats(s: BaseStats): BaseStats {
  return {
    attack: clamp(s.attack, 1, 10),
    defense: clamp(s.defense, 1, 10),
    stamina: clamp(s.stamina, 1, 10),
    weight: clamp(s.weight, 25, 80),
    burst: clamp(s.burst, 1, 10),
    dash: clamp(s.dash, 1, 10),
  };
}

/** 屬性的六個鍵 */
const KEYS: (keyof BaseStats)[] = ['attack', 'defense', 'stamina', 'weight', 'burst', 'dash'];

/** 攻擊環屬性加上盤與軸的增減（sign = -1 時是扣掉，用來從原本的屬性反推攻擊環） */
function addMods(base: BaseStats, parts: PartDef[], sign: 1 | -1): BaseStats {
  const out = { ...base };
  for (const p of parts) for (const k of KEYS) out[k] += sign * (p.mods[k] ?? 0);
  return out;
}

/** 從原本（原廠組合）的屬性反推攻擊環的屬性（可能超出 1～10，只在內部使用） */
export function ringOf(stats: BaseStats, disk: PartDef, driver: PartDef): BaseStats {
  return addMods(stats, [disk, driver], -1);
}

/** 組裝：攻擊環 + 盤 + 軸 → 屬性（限制在合法範圍） */
export function applyParts(ring: BaseStats, disk: PartDef, driver: PartDef): BaseStats {
  return clampStats(addMods(ring, [disk, driver], 1));
}

/** 目前裝著某件備用零件的陀螺（沒人裝時為 null） */
export function spareHolder(team: TeamLoadouts, part: PartId): TopId | null {
  for (const [top, lo] of Object.entries(team)) {
    if (lo && (lo.disk === part || lo.driver === part)) return top;
  }
  return null;
}

/**
 * 換零件：把 top 的 slot 欄位換成備用零件 part（null = 換回原廠），回傳新的隊伍狀態（不改傳入的物件）。
 * - 零件已經裝在隊伍中另一顆陀螺上 → 丟出錯誤（備用零件每種只有一件）。
 * - 和原廠同型的零件等於原廠，不佔用備用零件。
 * stock 為這顆陀螺的原廠零件（TopSpec.stock；由呼叫端傳入，parts 模組不依賴陀螺名鑑）。
 */
export function equip(team: TeamLoadouts, top: TopId, stock: StockParts, slot: PartSlot, part: PartId | null): TeamLoadouts {
  if (part !== null) {
    const def = PARTS[part];
    if (!def) throw new Error(`沒有這個零件：${part}`);
    if (def.slot !== slot) throw new Error(`${def.nameZh}不能裝在${slot === 'disk' ? '盤' : '軸'}的位置`);
    if (stock[slot] === part) part = null;
  }
  if (part !== null) {
    const holder = spareHolder(team, part);
    if (holder !== null && holder !== top) throw new Error(`${PARTS[part].nameZh}已經裝在 ${holder} 上`);
  }
  const cur = team[top] ?? STOCK;
  const next: Loadout = { ...cur, [slot]: part };
  const out: TeamLoadouts = { ...team };
  if (next.disk === null && next.driver === null) delete out[top];
  else out[top] = next;
  return out;
}

/** 陀螺離開隊伍：它身上的備用零件全部歸還，回傳新的隊伍狀態 */
export function release(team: TeamLoadouts, top: TopId): TeamLoadouts {
  const out: TeamLoadouts = { ...team };
  delete out[top];
  return out;
}

