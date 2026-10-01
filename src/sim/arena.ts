import type { V2 } from './types';

/** 場地代號：練習場、標準戰鬥盤、雙層戰鬥盤、火山、冰川、積水 */
export type ArenaId = 'practice' | 'stadium' | 'double' | 'volcano' | 'glacier' | 'flooded';

/** 出場口的種類：Over 區（場外終結 2 分）、Xtreme 區（實體戰鬥盤中間的寬口，極限終結 3 分） */
export type PocketKind = 'over' | 'xtreme';

/** 出場口：中心角 at（弧度，sim 座標 atan2(z, x)）、半寬 half（弧度）與種類 */
export interface Pocket {
  at: number;
  half: number;
  kind: PocketKind;
}

/** 火山的熔岩噴口：平時灼燒（轉速衰減加快），週期性噴發把陀螺往外轟開 */
export interface LavaVent {
  x: number;
  z: number;
  /** 噴口半徑 */
  r: number;
  /** 噴發週期（秒）與相位（秒，錯開各噴口） */
  period: number;
  phase: number;
}

/** 冰川上的冰柱：固定的圓形障礙物，陀螺撞到會彈開 */
export interface Pillar {
  x: number;
  z: number;
  r: number;
}

/** 積水：中央低窪處的水池，水中阻力大、轉速流失快，並有繞圈的水流 */
export interface WaterPool {
  /** 水池半徑（從場地中心算起） */
  r: number;
  /** 水中的線性阻力（1/s） */
  drag: number;
  /** 水中轉速衰減倍率 */
  spinDrag: number;
  /** 水流的切線速度（正值 = 從上方看逆時針） */
  current: number;
}

/**
 * 極限軌道（實體戰鬥盤的齒軌，咬合後 X Dash）：陀螺在 from..to 的範圍內沿切線加速（機動力越高加速越多），並帶一點往內的分量。
 * lowered 為 true 的軌道（雙層戰鬥盤凹槽邊緣的內圈軌道）只在中央降下時作用。
 */
export interface Rail {
  /** 軌道範圍（半徑）：from < r <= to */
  from: number;
  to: number;
  /** 最大加速度 */
  accel: number;
  /** 切線與往內分量的比例 */
  tangent: number;
  inward: number;
  lowered: boolean;
}

/**
 * 龍捲脊（實體戰鬥盤內圈平台的邊緣）：半徑 r 處一圈高 h、寬 w 的隆起，地面額外加 h·exp(-((r'-r)/w)²)。
 * 和 outer（脊外的外圈坡度加陡）一起做出「兩層」：內圈平緩、外圈較陡。
 */
export interface Ridge {
  r: number;
  h: number;
  w: number;
}

/**
 * 雙層戰鬥盤（BX-37）的升降平台：中央半徑 r 的平台定時降下 depth，降下時中央變成凹槽
 * （r-edge..r 是凹槽壁），凹槽邊緣的內圈極限軌道開始作用。
 * 週期：升起 raised 秒 → 下降 move 秒 → 降下 lowered 秒 → 上升 move 秒；開場是升起的，下降前 warn 秒有預兆。
 */
export interface Lift {
  r: number;
  edge: number;
  depth: number;
  raised: number;
  lowered: number;
  move: number;
  warn: number;
}

/**
 * 場地規格。所有場地半徑都是 3.2（鏡頭、特效、場館尺寸共用），
 * 用碗形曲率、出場口、地面性質與機關做出差異。
 * frame 只影響外觀：實體戰鬥盤的方形外框是裝飾，模擬裡的牆仍是半徑 3.2 的圓。
 */
export interface ArenaSpec {
  id: ArenaId;
  nameJa: string;
  nameZh: string;
  /** 場地說明（選單顯示） */
  descZh: string;
  /** 場地半徑（牆的位置） */
  radius: number;
  /** 碗形曲率：地面高度 y = bowlK r² */
  bowlK: number;
  /** 中央隆起（火山錐）：高度 h、寬度 sigma；地面額外加 h·exp(-r²/σ²) */
  mound: { h: number; sigma: number } | null;
  /** 龍捲脊（實體戰鬥盤） */
  ridge: Ridge | null;
  /** 外圈加陡：r > from 時地面額外加 k (r - from)² */
  outer: { from: number; k: number } | null;
  /** 中央升降平台（雙層戰鬥盤） */
  lift: Lift | null;
  /** 外框外觀：圓形或方形（實體戰鬥盤） */
  frame: 'round' | 'square';
  /** 重力加速度 */
  gravity: number;
  /** 出場口 */
  pockets: Pocket[];
  /** 在出場口往外的徑向速度超過此值就出場 */
  overSpeed: number;
  /** 撞牆反彈係數 */
  wallRestitution: number;
  /** 地面摩擦倍率（冰面很低） */
  frictionMul: number;
  /** 軸心抓地倍率：影響驅動力與推移（冰面打滑） */
  gripMul: number;
  /** 轉速衰減倍率 */
  decayMul: number;
  rails: Rail[];
  vents: LavaVent[];
  pillars: Pillar[];
  water: WaterPool | null;
  /** 主題色（地板格線、霓虹、燈光） */
  theme: { floor: number; grid: number; neon: number; accent: number; wall: number };
}

const TAU = Math.PI * 2;
/** 三個等距出場口（練習場的配置） */
const THREE_POCKETS: Pocket[] = [0, 1, 2].map((i) => ({ at: Math.PI / 2 + (i * TAU) / 3, half: 0.26, kind: 'over' as const }));

/**
 * 實體戰鬥盤的出場口：三個都在 -z 那一側（畫面遠端；兩個發射位置在 ±x，離出場口一樣遠）。
 * 中間是較寬的 Xtreme 區，兩角是 Over 區（實體比例約 19 cm 對 12 cm）。
 */
const FAR = -Math.PI / 2;
const PHYSICAL_POCKETS: Pocket[] = [
  { at: FAR, half: 0.3, kind: 'xtreme' },
  { at: FAR - 0.8, half: 0.19, kind: 'over' },
  { at: FAR + 0.8, half: 0.19, kind: 'over' },
];
/** 實體戰鬥盤的兩層：內圈平台（龍捲脊直徑約為戰鬥區的 21/36.5）、脊外的外圈較陡 */
const PHYSICAL_RIDGE: Ridge = { r: 1.84, h: 0.035, w: 0.1 };
const PHYSICAL_OUTER = { from: 1.84, k: 0.06 };
/** 外圈極限軌道 */
const OUTER_RAIL: Rail = { from: 2.55, to: 99, accel: 5.5, tangent: 0.75, inward: 0.65, lowered: false };

/** 各場地共用的預設值（練習場就是原本的場地） */
const BASE = {
  radius: 3.2,
  bowlK: 0.065,
  mound: null,
  ridge: null,
  outer: null,
  lift: null,
  frame: 'round',
  gravity: 9.8,
  pockets: THREE_POCKETS,
  overSpeed: 2.0,
  wallRestitution: 0.45,
  frictionMul: 1,
  gripMul: 1,
  decayMul: 1,
  rails: [],
  vents: [],
  pillars: [],
  water: null,
} satisfies Omit<ArenaSpec, 'id' | 'nameJa' | 'nameZh' | 'descZh' | 'theme'>;

/** 在極座標 (r, φ) 的點 */
const at = (r: number, phi: number) => ({ x: r * Math.cos(phi), z: r * Math.sin(phi) });

/** 六個場地 */
export const ARENAS: Record<ArenaId, ArenaSpec> = {
  practice: {
    ...BASE,
    id: 'practice',
    nameJa: 'トレーニング',
    nameZh: '練習場',
    descZh: '標準碗形場，三個出場口，沒有機關。',
    theme: { floor: 0x0a1226, grid: 0x1a7fff, neon: 0x55f0ff, accent: 0xff3df0, wall: 0x1b2440 },
  },
  stadium: {
    ...BASE,
    id: 'stadium',
    nameJa: 'エクストリーム',
    nameZh: '標準戰鬥盤',
    descZh: '照正式比賽用的實體戰鬥盤：內圈平台＋外圈極限軌道（沿切線加速，機動力越高越快）；出場口集中在同一邊，撞進中間寬口是極限終結（3 分），兩角是場外終結（2 分）。',
    bowlK: 0.062,
    ridge: PHYSICAL_RIDGE,
    outer: PHYSICAL_OUTER,
    frame: 'square',
    pockets: PHYSICAL_POCKETS,
    overSpeed: 1.9,
    rails: [OUTER_RAIL],
    theme: { floor: 0x14100a, grid: 0xffb020, neon: 0xffd24a, accent: 0xff5a1a, wall: 0x2a2014 },
  },
  double: {
    ...BASE,
    id: 'double',
    nameJa: 'ダブルエクストリーム',
    nameZh: '雙層戰鬥盤',
    descZh: '照實體的雙層戰鬥盤：中央定時降下變成凹槽（降下前會發光預告），凹槽邊緣多一條內圈極限軌道；升起時和標準戰鬥盤一樣。出場口同標準戰鬥盤（中間寬口 3 分）。',
    bowlK: 0.062,
    ridge: PHYSICAL_RIDGE,
    outer: PHYSICAL_OUTER,
    lift: { r: 1.25, edge: 0.22, depth: 0.2, raised: 7, lowered: 5, move: 0.8, warn: 1.2 },
    frame: 'square',
    pockets: PHYSICAL_POCKETS,
    overSpeed: 1.9,
    rails: [OUTER_RAIL, { from: 1.03, to: 1.3, accel: 4.5, tangent: 0.85, inward: 0.2, lowered: true }],
    theme: { floor: 0x07090f, grid: 0x3a8cff, neon: 0x5ab8ff, accent: 0xff3a4a, wall: 0x141a26 },
  },
  volcano: {
    ...BASE,
    id: 'volcano',
    nameJa: 'ボルケーノ',
    nameZh: '火山',
    descZh: '中央火山錐把陀螺推向外圈溝槽；三個熔岩噴口會灼燒轉速，並定期噴發把陀螺轟開。',
    bowlK: 0.075,
    mound: { h: 0.38, sigma: 0.9 },
    vents: [0, 1, 2].map((i) => ({ ...at(2.05, Math.PI / 2 + TAU / 6 + (i * TAU) / 3), r: 0.5, period: 5.5, phase: i * 1.8 })),
    theme: { floor: 0x1a0805, grid: 0xff4a10, neon: 0xff7a2a, accent: 0xffc040, wall: 0x2a1410 },
  },
  glacier: {
    ...BASE,
    id: 'glacier',
    nameJa: 'グレイシャー',
    nameZh: '冰川',
    descZh: '冰面幾乎沒有摩擦，軸心打滑、推移吃力、容易滑出場；三根冰柱會把陀螺彈開。',
    frictionMul: 0.2,
    gripMul: 0.35,
    decayMul: 0.85,
    wallRestitution: 0.7,
    pillars: [0, 1, 2].map((i) => ({ ...at(1.65, Math.PI / 2 + TAU / 6 + (i * TAU) / 3), r: 0.26 })),
    theme: { floor: 0x0a1a2a, grid: 0x8fe8ff, neon: 0xbff4ff, accent: 0x5ab0ff, wall: 0x203848 },
  },
  flooded: {
    ...BASE,
    id: 'flooded',
    nameJa: 'アクア',
    nameZh: '積水',
    descZh: '中央積水：水中阻力大、轉速流失快，逆時針的水流會把陀螺帶著繞圈。',
    water: { r: 1.55, drag: 1.4, spinDrag: 1.9, current: 1.3 },
    theme: { floor: 0x061a22, grid: 0x20c8d0, neon: 0x40f0e0, accent: 0x2a7bff, wall: 0x143038 },
  },
};

export const ARENA_IDS: ArenaId[] = ['practice', 'stadium', 'double', 'volcano', 'glacier', 'flooded'];

/** 預設場地（練習場）；舊程式與測試沿用 ARENA 名稱 */
export const ARENA = ARENAS.practice;

/**
 * 升降平台在半徑 r 處下降的比例（0..1）：平台上為 1，凹槽壁上平滑降到 0，平台外為 0。
 * 回傳比例與它對 r 的導數（算坡度用）。
 */
function liftDip(r: number, lift: Lift): { dip: number; d: number } {
  const r0 = lift.r - lift.edge;
  if (r <= r0) return { dip: 1, d: 0 };
  if (r >= lift.r) return { dip: 0, d: 0 };
  const s = (r - r0) / lift.edge;
  return { dip: 1 - s * s * (3 - 2 * s), d: -(6 * s - 6 * s * s) / lift.edge };
}

/**
 * 半徑 r 處的地面高度。level 為雙層戰鬥盤中央降下的程度（0 = 升起、1 = 完全降下；其他場地不影響），
 * 不在對戰中的畫面（展示、預覽）用預設的 0。
 */
export function floorHeight(r: number, a: ArenaSpec = ARENA, level = 0): number {
  let y = a.bowlK * r * r;
  if (a.mound) y += a.mound.h * Math.exp(-(r * r) / (a.mound.sigma * a.mound.sigma));
  if (a.outer && r > a.outer.from) y += a.outer.k * (r - a.outer.from) ** 2;
  if (a.ridge) y += a.ridge.h * Math.exp(-(((r - a.ridge.r) / a.ridge.w) ** 2));
  if (a.lift && level > 0) y -= a.lift.depth * level * liftDip(r, a.lift).dip;
  return y;
}

/** 半徑 r 處的地面坡度 dy/dr（正值 = 往外變高）；level 同 floorHeight */
export function floorSlope(r: number, a: ArenaSpec = ARENA, level = 0): number {
  let s = 2 * a.bowlK * r;
  if (a.mound) {
    const s2 = a.mound.sigma * a.mound.sigma;
    s -= ((2 * a.mound.h * r) / s2) * Math.exp(-(r * r) / s2);
  }
  if (a.outer && r > a.outer.from) s += 2 * a.outer.k * (r - a.outer.from);
  if (a.ridge) {
    const u = (r - a.ridge.r) / a.ridge.w;
    s -= ((2 * a.ridge.h * u) / a.ridge.w) * Math.exp(-u * u);
  }
  if (a.lift && level > 0) s -= a.lift.depth * level * liftDip(r, a.lift).d;
  return s;
}

/**
 * 雙層戰鬥盤的升降狀態（純函式，依模擬時間）：level 為降下程度 0..1（升降時平滑過渡），
 * warn 為下降前的預兆進度 0..1（畫面讓平台邊緣發光）。
 */
export function liftPhase(lift: Lift, time: number): { level: number; warn: number } {
  const cycle = lift.raised + lift.lowered + 2 * lift.move;
  const t = ((time % cycle) + cycle) % cycle;
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (t < lift.raised) {
    const w0 = lift.raised - lift.warn;
    return { level: 0, warn: t >= w0 ? (t - w0) / lift.warn : 0 };
  }
  if (t < lift.raised + lift.move) return { level: ease((t - lift.raised) / lift.move), warn: 1 };
  if (t < lift.raised + lift.move + lift.lowered) return { level: 1, warn: 0 };
  return { level: 1 - ease((t - lift.raised - lift.move - lift.lowered) / lift.move), warn: 0 };
}

/** 半徑 r 處正在作用的極限軌道（level 同 floorHeight；內圈軌道要中央降下一半以上才作用），沒有則為 null */
export function activeRail(r: number, a: ArenaSpec, level = 0): Rail | null {
  for (const rail of a.rails) {
    if (r > rail.from && r <= rail.to && (!rail.lowered || level > 0.5)) return rail;
  }
  return null;
}

/** 角度 angle（弧度）落在哪一個出場口；是牆則為 null */
export function pocketAt(angle: number, a: ArenaSpec = ARENA): Pocket | null {
  for (const p of a.pockets) {
    let d = Math.abs(angle - p.at) % TAU;
    if (d > Math.PI) d = TAU - d;
    if (d <= p.half) return p;
  }
  return null;
}

/** 判斷角度 angle（弧度）是否落在任一出場口內 */
export function inPocket(angle: number, a: ArenaSpec = ARENA): boolean {
  return pocketAt(angle, a) !== null;
}

/**
 * 熔岩噴口在時間 time 的狀態：
 * 週期最後 0.9 秒為預兆（warn，畫面發光），接著 0.35 秒噴發（erupt），其他時間只灼燒。
 * 回傳噴發進度 0..1（未噴發為 -1）與預兆進度 0..1。
 */
export function ventPhase(v: LavaVent, time: number): { warn: number; erupt: number } {
  const t = (((time + v.phase) % v.period) + v.period) % v.period;
  const WARN = 0.9;
  const ERUPT = 0.35;
  const warnStart = v.period - WARN - ERUPT;
  if (t >= v.period - ERUPT) return { warn: 1, erupt: (t - (v.period - ERUPT)) / ERUPT };
  if (t >= warnStart) return { warn: (t - warnStart) / WARN, erupt: -1 };
  return { warn: 0, erupt: -1 };
}

/** 點 p 是否在圓 (cx, cz, r) 內 */
export function inCircle(p: V2, cx: number, cz: number, r: number): boolean {
  return Math.hypot(p.x - cx, p.z - cz) < r;
}
