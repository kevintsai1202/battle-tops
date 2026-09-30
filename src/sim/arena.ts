import type { V2 } from './types';

/** 場地代號：練習場、標準戰鬥盤、火山、冰川、積水 */
export type ArenaId = 'practice' | 'stadium' | 'volcano' | 'glacier' | 'flooded';

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

/** 標準戰鬥盤外圈的極限軌道：陀螺進入後沿切線加速（機動力越高加速越多） */
export interface Rail {
  /** 軌道內緣半徑（到牆為止都算軌道） */
  from: number;
  /** 最大切線加速度 */
  accel: number;
}

/**
 * 場地規格。所有場地半徑都是 3.2（鏡頭、特效、場館尺寸共用），
 * 用碗形曲率、出場口、地面性質與機關做出差異。
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
  /** 重力加速度 */
  gravity: number;
  /** 出場口的中心角（弧度） */
  pockets: number[];
  /** 出場口半寬（弧度） */
  pocketHalfWidth: number;
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
  rail: Rail | null;
  vents: LavaVent[];
  pillars: Pillar[];
  water: WaterPool | null;
  /** 主題色（地板格線、霓虹、燈光） */
  theme: { floor: number; grid: number; neon: number; accent: number; wall: number };
}

const TAU = Math.PI * 2;
/** 三個等距出場口（練習場的配置） */
const THREE_POCKETS = [Math.PI / 2, Math.PI / 2 + TAU / 3, Math.PI / 2 + (2 * TAU) / 3];

/** 各場地共用的預設值（練習場就是原本的場地） */
const BASE = {
  radius: 3.2,
  bowlK: 0.065,
  mound: null,
  gravity: 9.8,
  pockets: THREE_POCKETS,
  pocketHalfWidth: 0.26,
  overSpeed: 2.0,
  wallRestitution: 0.45,
  frictionMul: 1,
  gripMul: 1,
  decayMul: 1,
  rail: null,
  vents: [],
  pillars: [],
  water: null,
} satisfies Omit<ArenaSpec, 'id' | 'nameJa' | 'nameZh' | 'descZh' | 'theme'>;

/** 在極座標 (r, φ) 的點 */
const at = (r: number, phi: number) => ({ x: r * Math.cos(phi), z: r * Math.sin(phi) });

/** 五個場地 */
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
    descZh: '正式比賽用盤：外圈極限軌道會沿切線加速（機動力越高越快），兩個出場口加一個寬口。',
    bowlK: 0.072,
    pockets: [Math.PI / 2, Math.PI / 2 + (2 * TAU) / 5, Math.PI / 2 - (2 * TAU) / 5],
    pocketHalfWidth: 0.22,
    overSpeed: 1.9,
    rail: { from: 2.55, accel: 5.5 },
    theme: { floor: 0x14100a, grid: 0xffb020, neon: 0xffd24a, accent: 0xff5a1a, wall: 0x2a2014 },
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

export const ARENA_IDS: ArenaId[] = ['practice', 'stadium', 'volcano', 'glacier', 'flooded'];

/** 預設場地（練習場）；舊程式與測試沿用 ARENA 名稱 */
export const ARENA = ARENAS.practice;

/** 半徑 r 處的地面高度 */
export function floorHeight(r: number, a: ArenaSpec = ARENA): number {
  let y = a.bowlK * r * r;
  if (a.mound) y += a.mound.h * Math.exp(-(r * r) / (a.mound.sigma * a.mound.sigma));
  return y;
}

/** 半徑 r 處的地面坡度 dy/dr（正值 = 往外變高） */
export function floorSlope(r: number, a: ArenaSpec = ARENA): number {
  let s = 2 * a.bowlK * r;
  if (a.mound) {
    const s2 = a.mound.sigma * a.mound.sigma;
    s -= ((2 * a.mound.h * r) / s2) * Math.exp(-(r * r) / s2);
  }
  return s;
}

/** 判斷角度 angle（弧度）是否落在任一出場口內 */
export function inPocket(angle: number, a: ArenaSpec = ARENA): boolean {
  for (const p of a.pockets) {
    let d = Math.abs(angle - p) % TAU;
    if (d > Math.PI) d = TAU - d;
    if (d <= a.pocketHalfWidth) return true;
  }
  return false;
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
