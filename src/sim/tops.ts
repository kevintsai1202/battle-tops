import { applyParts, PARTS, ringOf, type Loadout, type StockParts } from './parts';
import { derivePhysics } from './stats';
import type { BaseStats, SpecialDef, TopId, TopLook, TopSpec, TopType } from './types';

/** 定義一顆陀螺時要填的資料（物理能力值由基本屬性推導，不手填） */
interface TopDef {
  id: TopId;
  type: TopType;
  nameJa: string;
  nameZh: string;
  origin: string | null;
  spinDir: 1 | -1;
  emblem: string;
  look: TopLook;
  stats: BaseStats;
  /** 原廠盤與原廠軸（原型的零件型態，見 sim/parts.ts） */
  stock: StockParts;
  special: SpecialDef;
  color: number;
  glow: number;
}

/** 基本屬性 + 推導出的物理能力值 → 完整規格（原廠組合）；攻擊環屬性由原本的屬性扣掉原廠零件反推 */
function defineTop(d: TopDef): TopSpec {
  const ring = ringOf(d.stats, PARTS[d.stock.disk], PARTS[d.stock.driver]);
  return { ...d, ring, parts: { ...d.stock }, ...derivePhysics(d.stats) };
}

/**
 * 全部陀螺。前四顆是原創；其餘 16 顆致敬歷代有名的戰鬥陀螺（名稱改寫，類型、旋轉方向、屬性、外形、招式風格參考原型）。
 * 屬性來源：Beyblade Wiki 的官方零件能力值加總後換算成 1～10 分；初代沒有官方值，為估計值。
 * 對照表與換算方式見 docs/design.md「陀螺名鑑」。
 * 數值平衡由 tests/battle.test.ts 的 CPU 對打耐久測試把關。
 */
const DEFS: TopDef[] = [
  // ---------------- 原創 ----------------
  {
    id: 'blaze',
    type: 'attack',
    nameJa: 'ブレイズ・ドラゴン',
    nameZh: '烈焰龍',
    origin: null,
    spinDir: 1,
    emblem: '龍',
    look: {
      primary: 0xff3b1f,
      secondary: 0xffb020,
      metal: 0xb8c0d0,
      tip: 0x2a2a2a,
      ring: [{ n: 3, phase: 0, width: 70, height: 0.28, skew: 0.6 }],
      inner: [{ n: 3, phase: 60, width: 40, height: 0.1, skew: 0.3 }],
    },
    stats: { attack: 10, defense: 2, stamina: 3, weight: 44, burst: 5, dash: 10 },
    stock: { disk: 'standard', driver: 'rubber' },
    special: {
      nameJa: 'ドラゴン・インパクト',
      nameZh: '烈龍衝擊',
      descZh: '朝對手猛烈突進，1 秒內攻擊力 1.3 倍。',
      cue: 'close',
      charge: 8,
      steps: [
        { op: 'dash', speed: 6.5, keep: 0.3 },
        { op: 'buff', time: 1.0, mods: { atk: 1.3 } },
      ],
    },
    color: 0xff3b1f,
    glow: 0xff7a1a,
  },
  {
    id: 'turtle',
    type: 'defense',
    nameJa: 'アイアン・タートル',
    nameZh: '鐵壁龜',
    origin: null,
    spinDir: 1,
    emblem: '亀',
    look: {
      primary: 0x2fd35b,
      secondary: 0x1a5a2a,
      metal: 0x9aa2b0,
      tip: 0x3a3d42,
      ring: [{ n: 6, phase: 0, width: 50, height: 0.1 }],
      inner: [{ n: 6, phase: 30, width: 30, height: 0.05 }],
    },
    stats: { attack: 4, defense: 9, stamina: 6, weight: 64, burst: 5, dash: 2 },
    stock: { disk: 'heavy', driver: 'wideBall' },
    special: {
      nameJa: 'アイアン・フォートレス',
      nameZh: '鋼鐵要塞',
      descZh: '急停紮根：3 秒內質量 3 倍、防禦 2.5 倍、牢牢抓地。',
      cue: 'danger',
      charge: 7,
      steps: [
        { op: 'brake', keep: 0.3 },
        { op: 'buff', time: 3.0, mods: { mass: 3, def: 2.5, fric: 4, ctrl: 0.25, decay: 0.7 } },
      ],
    },
    color: 0x2fd35b,
    glow: 0x7dff9a,
  },
  {
    id: 'gale',
    type: 'stamina',
    nameJa: 'ゲイル・フェニックス',
    nameZh: '疾風鳳',
    origin: null,
    spinDir: 1,
    emblem: '鳳',
    look: {
      primary: 0x2aa8ff,
      secondary: 0xe8f6ff,
      metal: 0xc8d0dc,
      tip: 0xdddddd,
      ring: [{ n: 8, phase: 0, width: 30, height: 0.12, skew: 0.2 }],
      inner: [{ n: 2, phase: 0, width: 120, height: 0.06 }],
    },
    stats: { attack: 1, defense: 4, stamina: 9, weight: 40, burst: 5, dash: 1 },
    stock: { disk: 'rim', driver: 'sharp' },
    special: {
      nameJa: 'エターナル・サイクロン',
      nameZh: '永恆旋風',
      descZh: '回復 16% 轉速、修復爆裂量，3 秒內轉速幾乎不流失。',
      cue: 'lowSpin',
      charge: 8,
      steps: [
        { op: 'spin', ratio: 0.16 },
        { op: 'repair', amount: 0.25 },
        { op: 'buff', time: 3.0, mods: { decay: 0.3 } },
      ],
    },
    color: 0x2aa8ff,
    glow: 0x7fe0ff,
  },
  {
    id: 'wolf',
    type: 'balance',
    nameJa: 'ギャラクシー・ウルフ',
    nameZh: '星河狼',
    origin: null,
    spinDir: 1,
    emblem: '狼',
    look: {
      primary: 0xb04dff,
      secondary: 0x2a1a4a,
      metal: 0xb8c0d0,
      tip: 0x2a2a2a,
      ring: [{ n: 4, phase: 0, width: 30, height: 0.3, skew: 0.3 }],
      inner: [{ n: 4, phase: 45, width: 40, height: 0.08 }],
    },
    stats: { attack: 4, defense: 4, stamina: 5, weight: 48, burst: 5, dash: 6 },
    stock: { disk: 'standard', driver: 'taper' },
    special: {
      nameJa: 'ギャラクシー・ノヴァ',
      nameZh: '星河新星',
      descZh: '回復 10% 轉速並突進，1.5 秒內攻防 1.4 倍。',
      cue: 'close',
      charge: 6,
      steps: [
        { op: 'spin', ratio: 0.1 },
        { op: 'dash', speed: 5.5, keep: 0.4 },
        { op: 'buff', time: 1.5, mods: { atk: 1.4, def: 1.4 } },
      ],
    },
    color: 0xb04dff,
    glow: 0xe0a0ff,
  },

  // ---------------- 攻擊型（致敬） ----------------
  {
    id: 'azure',
    type: 'attack',
    nameJa: 'アズール・ドラグナー',
    nameZh: '蒼嵐青龍',
    origin: 'Dragoon S（初代・青龍）',
    spinDir: -1,
    emblem: '蒼',
    look: {
      primary: 0xf2f2ee,
      secondary: 0xd0202a,
      metal: 0xb5b9bf,
      tip: 0x1c1c1c,
      ring: [{ n: 4, phase: 0, width: 40, height: 0.18, skew: 0.35 }],
      inner: [{ n: 4, phase: 45, width: 30, height: 0.06 }],
    },
    stats: { attack: 8, defense: 4, stamina: 5, weight: 40, burst: 5, dash: 8 },
    stock: { disk: 'standard', driver: 'rubber' },
    special: {
      nameJa: 'ストーム・アサルト',
      nameZh: '蒼嵐突襲',
      descZh: '捲起左旋風暴突進：2 秒內把附近的對手吸過來，攻擊 1.8 倍。',
      cue: 'far',
      charge: 5.5,
      steps: [
        { op: 'dash', speed: 6, keep: 0.3 },
        { op: 'buff', time: 2.0, mods: { aura: { k: 9, range: 2.6 }, atk: 1.8 } },
      ],
    },
    color: 0xe8f0ff,
    glow: 0x4aa0ff,
  },
  {
    id: 'pegasus',
    type: 'attack',
    nameJa: 'テンペスト・ペガス',
    nameZh: '暴嵐天駒',
    origin: 'Storm Pegasus 105RF（BB-28・天馬）',
    spinDir: 1,
    emblem: '馬',
    look: {
      primary: 0x1b3fa6,
      secondary: 0xffffff,
      metal: 0xc3c7cc,
      tip: 0x202020,
      ring: [{ n: 3, phase: 0, width: 85, height: 0.16, skew: 0.2 }, { n: 9, phase: 30, width: 8, height: 0.03, skew: 0.5 }],
      inner: [{ n: 3, phase: 0, width: 60, height: 0.08 }],
    },
    stats: { attack: 9, defense: 3, stamina: 2, weight: 40, burst: 4, dash: 9 },
    stock: { disk: 'standard', driver: 'rubber' },
    special: {
      nameJa: 'テンペスト・ブリンガー',
      nameZh: '天馬急降',
      descZh: '從天而降的重擊：朝對手俯衝，0.8 秒內質量 1.6 倍、攻擊 1.4 倍，撞了不容易被彈開。',
      cue: 'close',
      charge: 7.5,
      steps: [
        { op: 'dash', speed: 7, keep: 0.2 },
        { op: 'buff', time: 0.8, mods: { mass: 1.6, atk: 1.4 } },
      ],
    },
    color: 0x1a4dff,
    glow: 0x5ad8ff,
  },
  {
    id: 'ldrago',
    type: 'attack',
    nameJa: 'ライトニング・エルドラ',
    nameZh: '雷皇龍',
    origin: 'Lightning L-Drago 100HF（BB-43・左旋龍）',
    spinDir: -1,
    emblem: '雷',
    look: {
      primary: 0xd8d4ec,
      secondary: 0x7b3fbf,
      metal: 0xc0c4ca,
      tip: 0xdfe3ea,
      ring: [{ n: 3, phase: 0, width: 50, height: 0.2, skew: 0.45 }, { n: 3, phase: 60, width: 40, height: 0.12, skew: 0.2 }],
      inner: [{ n: 3, phase: 60, width: 35, height: 0.08 }],
    },
    stats: { attack: 9, defense: 3, stamina: 4, weight: 40, burst: 6, dash: 7 },
    stock: { disk: 'standard', driver: 'flat' },
    special: {
      nameJa: '竜皇翔咬撃',
      nameZh: '龍皇翔咬擊',
      descZh: '突進咬住對手：2 秒內每次撞擊吸走對手轉速（對右旋加倍），攻擊 1.25 倍。',
      cue: 'close',
      charge: 6,
      steps: [
        { op: 'dash', speed: 6, keep: 0.3 },
        { op: 'buff', time: 2.0, mods: { spinSteal: 0.012, atk: 1.25 } },
      ],
    },
    color: 0x7a1aff,
    glow: 0xff4ad0,
  },
  {
    id: 'valkyrie',
    type: 'attack',
    nameJa: 'ヴィクトル・ヴァルキュリア',
    nameZh: '凱旋武神',
    origin: 'Victory Valkyrie Boost Variable（B-34・女武神）',
    spinDir: 1,
    emblem: '戦',
    look: {
      primary: 0x1f5fe0,
      secondary: 0xffd21a,
      metal: 0xbfc3c8,
      tip: 0x8fd3ff,
      ring: [{ n: 3, phase: 0, width: 55, height: 0.25, skew: 0.4 }, { n: 1, phase: 0, width: 20, height: 0.3, skew: 0.4 }],
      inner: [{ n: 3, phase: 30, width: 30, height: 0.08 }],
    },
    stats: { attack: 8, defense: 3, stamina: 3, weight: 40, burst: 6, dash: 10 },
    stock: { disk: 'light', driver: 'rubber' },
    special: {
      nameJa: 'ラッシュ・ストライク',
      nameZh: '疾風連擊',
      descZh: '全速衝刺：朝對手突進，2 秒內巡航速度 1.3 倍、攻擊 1.4 倍，高速連撞。',
      cue: 'far',
      charge: 6,
      steps: [
        { op: 'dash', speed: 5.5, keep: 0.3 },
        { op: 'buff', time: 2.0, mods: { cruise: 1.3, atk: 1.4 } },
      ],
    },
    color: 0x1a6aff,
    glow: 0xffd21a,
  },

  // ---------------- 防禦型（致敬） ----------------
  {
    id: 'draciel',
    type: 'defense',
    nameJa: 'ブラック・トータス',
    nameZh: '玄武甲',
    origin: 'Draciel S（初代・玄武）',
    spinDir: 1,
    emblem: '玄',
    look: {
      primary: 0x2f9e44,
      secondary: 0x3a3f44,
      metal: 0xb8bcc2,
      tip: 0xc8ccd0,
      ring: [{ n: 4, phase: 45, width: 90, height: 0.06 }, { n: 4, phase: 45, width: 30, height: 0.14 }, { n: 12, phase: 0, width: 8, height: 0.03 }],
      inner: [{ n: 4, phase: 0, width: 50, height: 0.05 }],
    },
    stats: { attack: 3, defense: 9, stamina: 5, weight: 52, burst: 6, dash: 2 },
    stock: { disk: 'heavy', driver: 'ball' },
    special: {
      nameJa: 'メタルボール・ガード',
      nameZh: '金屬球壁',
      descZh: '金屬珠軸心鎖死：4 秒內質量 2.5 倍、防禦 2.2 倍，撞上來的對手承受 1.2 倍反擊。',
      cue: 'danger',
      charge: 5.5,
      steps: [
        { op: 'brake', keep: 0.15 },
        { op: 'buff', time: 4.0, mods: { mass: 2.5, def: 2.2, fric: 3, reflect: 1.2 } },
      ],
    },
    color: 0x2a8a8a,
    glow: 0x6affd8,
  },
  {
    id: 'leone',
    type: 'defense',
    nameJa: 'ガイア・レオーネ',
    nameZh: '岩獅王',
    origin: 'Rock Leone 145WB（BB-30・獅子）',
    spinDir: 1,
    emblem: '獅',
    look: {
      primary: 0x1fb5a6,
      secondary: 0x5a7d3a,
      metal: 0xbfc3c8,
      tip: 0xededed,
      ring: [{ n: 6, phase: 0, width: 52, height: 0.06 }],
      inner: [{ n: 3, phase: 0, width: 60, height: 0.06 }],
    },
    stats: { attack: 3, defense: 8, stamina: 6, weight: 50, burst: 6, dash: 2 },
    stock: { disk: 'standard', driver: 'wideBall' },
    special: {
      nameJa: '獅子暴風壁',
      nameZh: '獅子暴風壁',
      descZh: '颳起暴風牆：4 秒內把靠近的對手持續推開，防禦 1.8 倍。',
      cue: 'danger',
      charge: 5.5,
      steps: [{ op: 'buff', time: 4.0, mods: { aura: { k: -18, range: 1.8 }, def: 1.8 } }],
    },
    color: 0x2fae3a,
    glow: 0xb0ff60,
  },
  {
    id: 'kerbeus',
    type: 'defense',
    nameJa: 'ケルベロス・ガード',
    nameZh: '冥府犬',
    origin: 'Kerbeus Central Defense（B-04・三頭犬）',
    spinDir: 1,
    emblem: '犬',
    look: {
      primary: 0x3fae49,
      secondary: 0xdcecf5,
      metal: 0xbfc3c8,
      tip: 0x4a4f55,
      ring: [{ n: 8, phase: 0, width: 18, height: 0.07 }, { n: 8, phase: 22.5, width: 12, height: 0.035 }],
      inner: [{ n: 3, phase: 0, width: 50, height: 0.06 }],
    },
    stats: { attack: 3, defense: 8, stamina: 5, weight: 46, burst: 5, dash: 4 },
    stock: { disk: 'guard', driver: 'wideBall' },
    special: {
      nameJa: 'トリプル・ハウル',
      nameZh: '三首咆哮',
      descZh: '三顆頭同時咆哮：對手 3.5 秒內防禦降到 50%、攻擊降到 70%，自己修復爆裂量。',
      cue: 'close',
      charge: 5.5,
      steps: [
        { op: 'hex', time: 3.5, mods: { def: 0.5, atk: 0.7 } },
        { op: 'repair', amount: 0.2 },
      ],
    },
    color: 0x8a2a14,
    glow: 0xff8a3a,
  },
  {
    id: 'knight',
    type: 'defense',
    nameJa: 'パラディン・シールド',
    nameZh: '聖騎盾',
    origin: 'KnightShield 3-80N（BX-04・騎士）',
    spinDir: 1,
    emblem: '騎',
    look: {
      primary: 0x2e9d57,
      secondary: 0xd9dde2,
      metal: 0xc2c6cc,
      tip: 0x3a3d42,
      ring: [{ n: 6, phase: 0, width: 32, height: 0.07, skew: 0.1 }],
      inner: [{ n: 2, phase: 0, width: 80, height: 0.05 }],
    },
    stats: { attack: 4, defense: 9, stamina: 6, weight: 48, burst: 3, dash: 3 },
    stock: { disk: 'standard', driver: 'needle' },
    special: {
      nameJa: 'シールド・インパクト',
      nameZh: '聖盾衝擊',
      descZh: '舉盾反推：1.6 以內的對手被盾擊震開並累積爆裂量，2 秒內防禦 1.5 倍。',
      cue: 'close',
      charge: 6,
      steps: [
        { op: 'brake', keep: 0.2 },
        { op: 'shove', speed: 7, range: 1.6, burst: 0.12 },
        { op: 'buff', time: 2.0, mods: { def: 1.5 } },
      ],
    },
    color: 0xa0a8b8,
    glow: 0xe0e8ff,
  },

  // ---------------- 持久型（致敬） ----------------
  {
    id: 'wolborg',
    type: 'stamina',
    nameJa: 'ブリザード・ウルグ',
    nameZh: '冰原狼',
    origin: 'Wolborg 4（初代・銀狼）',
    spinDir: 1,
    emblem: '氷',
    look: {
      primary: 0xc9ced6,
      secondary: 0x3a6fd8,
      metal: 0xb8bcc2,
      tip: 0xe4e8ee,
      ring: [{ n: 3, phase: 0, width: 28, height: 0.32, skew: 0.15 }, { n: 3, phase: 60, width: 26, height: 0.18 }],
      inner: [{ n: 3, phase: 0, width: 40, height: 0.06 }],
    },
    stats: { attack: 3, defense: 4, stamina: 9, weight: 40, burst: 5, dash: 3 },
    stock: { disk: 'rim', driver: 'sharp' },
    special: {
      nameJa: 'ノヴァ・ブリザード',
      nameZh: '極光冰封',
      descZh: '冰凍對手：3.5 秒內對手幾乎推不動、巡航速度剩 40%、轉速流失 2.6 倍、防禦下降。',
      cue: 'close',
      charge: 6,
      steps: [{ op: 'hex', time: 3.5, mods: { ctrl: 0.2, cruise: 0.4, decay: 2.6, fric: 2.5, def: 0.75 } }],
    },
    color: 0xc8e8ff,
    glow: 0x80ffff,
  },
  {
    id: 'orion',
    type: 'stamina',
    nameJa: 'ミラージュ・オリオン',
    nameZh: '幻星獵戶',
    origin: 'Phantom Orion B:D（BB-118・獵戶座）',
    spinDir: 1,
    emblem: '星',
    look: {
      primary: 0x7a1f35,
      secondary: 0x2f5bd8,
      metal: 0xc0c4ca,
      tip: 0xf2d34a,
      ring: [{ n: 2, phase: 0, width: 40, height: 0.05 }, { n: 2, phase: 90, width: 80, height: 0.03 }],
      inner: [{ n: 4, phase: 0, width: 40, height: 0.04 }],
    },
    stats: { attack: 2, defense: 3, stamina: 10, weight: 50, burst: 5, dash: 2 },
    stock: { disk: 'rim', driver: 'bearing' },
    special: {
      nameJa: 'バーナード・ループ',
      nameZh: '巴納德環',
      descZh: '軸承空轉：回復 10% 轉速，4 秒內轉速流失只剩 15%。',
      cue: 'lowSpin',
      charge: 7.5,
      steps: [
        { op: 'spin', ratio: 0.1 },
        { op: 'buff', time: 4.0, mods: { decay: 0.15 } },
      ],
    },
    color: 0x1a2a6a,
    glow: 0x4a8aff,
  },
  {
    id: 'fafnir',
    type: 'stamina',
    nameJa: 'グリード・ファフナー',
    nameZh: '吸魂魔龍',
    origin: 'Drain Fafnir 8 Nothing（B-79・左旋法夫納）',
    spinDir: -1,
    emblem: '魔',
    look: {
      primary: 0xd4a62a,
      secondary: 0x1c2e6b,
      metal: 0xbfc3c8,
      tip: 0xff8a2a,
      ring: [{ n: 3, phase: 0, width: 45, height: 0.07, skew: 0.1 }, { n: 2, phase: 60, width: 10, height: 0.03 }],
      inner: [{ n: 3, phase: 0, width: 35, height: 0.06 }],
    },
    stats: { attack: 1, defense: 6, stamina: 10, weight: 41, burst: 3, dash: 1 },
    stock: { disk: 'heavy', driver: 'bearing' },
    special: {
      nameJa: 'ドレイン・スピン',
      nameZh: '吸轉魔旋',
      descZh: '隔空吸走對手 4% 轉速，3 秒內每次撞擊再吸（對右旋加倍）。',
      cue: 'lowSpin',
      charge: 8,
      steps: [
        { op: 'drain', ratio: 0.04 },
        { op: 'buff', time: 3.0, mods: { spinSteal: 0.008 } },
      ],
    },
    color: 0xd0a020,
    glow: 0x40ffc0,
  },
  {
    id: 'wizard',
    type: 'stamina',
    nameJa: 'メイジ・アロー',
    nameZh: '魔導弓',
    origin: 'WizardArrow 4-80B（BX-03・巫師）',
    spinDir: 1,
    emblem: '弓',
    look: {
      primary: 0xf5c518,
      secondary: 0x6b4bb8,
      metal: 0xc2c6cc,
      tip: 0x3a3d42,
      ring: [{ n: 2, phase: 0, width: 75, height: 0.09, skew: 0.15 }],
      inner: [{ n: 2, phase: 90, width: 40, height: 0.05 }],
    },
    stats: { attack: 4, defense: 6, stamina: 9, weight: 41, burst: 3, dash: 3 },
    stock: { disk: 'standard', driver: 'ball' },
    special: {
      nameJa: 'ミラージュ・パリィ',
      nameZh: '幻影招架',
      descZh: '化成幻影瞬移回場地中央，2.5 秒內防禦 1.9 倍、撞上來的對手承受 80% 反擊。',
      cue: 'danger',
      charge: 6,
      steps: [{ op: 'blink' }, { op: 'buff', time: 2.5, mods: { def: 1.9, reflect: 0.8, fric: 2 } }],
    },
    color: 0x6a3ad0,
    glow: 0xc0a0ff,
  },

  // ---------------- 平衡型（致敬） ----------------
  {
    id: 'dranzer',
    type: 'balance',
    nameJa: 'クリムゾン・スザク',
    nameZh: '紅蓮朱雀',
    origin: 'Dranzer S（初代・朱雀）',
    spinDir: 1,
    emblem: '朱',
    look: {
      primary: 0xd42a2a,
      secondary: 0x2a4fb5,
      metal: 0xb8bcc2,
      tip: 0xc8ccd0,
      ring: [{ n: 2, phase: 0, width: 20, height: 0.12, skew: -0.4 }, { n: 2, phase: 30, width: 35, height: 0.25, skew: -0.4 }],
      inner: [{ n: 2, phase: 90, width: 40, height: 0.06 }],
    },
    stats: { attack: 6, defense: 5, stamina: 4, weight: 42, burst: 5, dash: 6 },
    stock: { disk: 'standard', driver: 'taper' },
    special: {
      nameJa: 'ファイヤー・アロー',
      nameZh: '烈火飛箭',
      descZh: '化為火箭貫穿：回復 8% 轉速並突進，1.2 秒內造成的爆裂量 1.4 倍。',
      cue: 'close',
      charge: 7,
      steps: [
        { op: 'spin', ratio: 0.08 },
        { op: 'dash', speed: 6.5, keep: 0.3 },
        { op: 'buff', time: 1.2, mods: { burstDealt: 1.4 } },
      ],
    },
    color: 0xd8102a,
    glow: 0xff4060,
  },
  {
    id: 'nemesis',
    type: 'balance',
    nameJa: 'ディアボロ・ネメア',
    nameZh: '滅世魔神',
    origin: 'Diablo Nemesis X:D（BB-122・破壞神）',
    spinDir: 1,
    emblem: '神',
    look: {
      primary: 0x6b3fa0,
      secondary: 0x1d1d22,
      metal: 0xc0c4ca,
      tip: 0x1d1d22,
      ring: [{ n: 1, phase: 0, width: 70, height: 0.12 }, { n: 1, phase: 120, width: 55, height: 0.09 }, { n: 1, phase: 240, width: 40, height: 0.06 }],
      inner: [{ n: 3, phase: 60, width: 30, height: 0.05 }],
    },
    stats: { attack: 6, defense: 5, stamina: 5, weight: 63, burst: 5, dash: 4 },
    stock: { disk: 'heavy', driver: 'rubber' },
    special: {
      nameJa: '天地崩落',
      nameZh: '天地崩落',
      descZh: '把對手硬拉過來再壓碎：2 秒內質量 2.2 倍、攻擊 1.8 倍、防禦 1.5 倍。',
      cue: 'far',
      charge: 5.5,
      steps: [
        { op: 'pull', speed: 5.5 },
        { op: 'buff', time: 2.0, mods: { mass: 2.2, atk: 1.8, def: 1.5 } },
      ],
    },
    color: 0x301830,
    glow: 0xff2aa0,
  },
  {
    id: 'requiem',
    type: 'balance',
    nameJa: 'ギガント・レクイエム',
    nameZh: '鎮魂巨人',
    origin: 'Spriggan Requiem 0 Zeta（B-100・雙旋巨神）',
    spinDir: 1,
    emblem: '巨',
    look: {
      primary: 0xc8202f,
      secondary: 0xd9a936,
      metal: 0xbfc3c8,
      tip: 0x3a3d42,
      ring: [{ n: 2, phase: 0, width: 50, height: 0.07 }, { n: 10, phase: 18, width: 6, height: -0.02 }],
      inner: [{ n: 2, phase: 90, width: 45, height: 0.06 }],
    },
    stats: { attack: 6, defense: 4, stamina: 5, weight: 46, burst: 5, dash: 5 },
    stock: { disk: 'standard', driver: 'taper' },
    special: {
      nameJa: 'カウンター・ブレイク',
      nameZh: '逆轉破擊',
      descZh: '雙旋切換：反轉旋轉方向，3 秒內攻擊 1.8 倍、撞上來的對手承受同等反擊。',
      cue: 'danger',
      charge: 5.5,
      steps: [{ op: 'reverse' }, { op: 'buff', time: 3.0, mods: { atk: 1.8, reflect: 1 } }],
    },
    color: 0xc01a1a,
    glow: 0xffcc40,
  },
  {
    id: 'scythe',
    type: 'balance',
    nameJa: 'ヘル・リーパー',
    nameZh: '冥鐮死神',
    origin: 'HellsScythe 4-60T（BX-02・死神）',
    spinDir: 1,
    emblem: '鎌',
    look: {
      primary: 0xd3232a,
      secondary: 0x1f1f24,
      metal: 0xc2c6cc,
      tip: 0x3a3d42,
      ring: [{ n: 4, phase: 0, width: 60, height: 0.09, skew: 0.35 }],
      inner: [{ n: 4, phase: 45, width: 25, height: 0.05 }],
    },
    stats: { attack: 6, defense: 5, stamina: 4, weight: 41, burst: 6, dash: 5 },
    stock: { disk: 'standard', driver: 'taper' },
    special: {
      nameJa: 'クレセント・ジャッジ',
      nameZh: '新月審判',
      descZh: '瞬移到對手背後揮鐮：1 秒內造成的爆裂量 1.8 倍。',
      cue: 'far',
      charge: 7,
      steps: [
        { op: 'warp', dist: 0.95, speed: 6.5 },
        { op: 'buff', time: 1.0, mods: { burstDealt: 1.8 } },
      ],
    },
    color: 0xa01010,
    glow: 0xff5020,
  },
];

/** 陀螺代號 → 規格 */
export const TOP_SPECS: Record<TopId, TopSpec> = Object.fromEntries(DEFS.map((d) => [d.id, defineTop(d)]));

/** 全部陀螺代號（選單順序：原創四顆在前，其後依類型排列） */
export const TOP_IDS: TopId[] = DEFS.map((d) => d.id);

/**
 * 依零件組合建立陀螺規格：攻擊環（身分、外觀、必殺）不變，屬性與物理能力值依盤與軸重算。
 * 原廠組合直接回傳 TOP_SPECS 的物件。
 */
export function buildSpec(id: TopId, lo: Loadout): TopSpec {
  const base = TOP_SPECS[id];
  const parts: StockParts = { disk: lo.disk ?? base.stock.disk, driver: lo.driver ?? base.stock.driver };
  if (parts.disk === base.stock.disk && parts.driver === base.stock.driver) return base;
  const stats = applyParts(base.ring, PARTS[parts.disk], PARTS[parts.driver]);
  return { ...base, stats, parts, ...derivePhysics(stats) };
}

/** 類型的顯示名稱 */
export const TYPE_LABEL: Record<TopType, string> = { attack: '攻擊型', defense: '防禦型', stamina: '持久型', balance: '平衡型' };
