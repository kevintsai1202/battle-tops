import { derivePhysics } from './stats';
import type { BaseStats, LayerShape, SpecialDef, TopId, TopSpec, TopType } from './types';

/** 定義一顆陀螺時要填的資料（物理能力值由基本屬性推導，不手填） */
interface TopDef {
  id: TopId;
  type: TopType;
  nameJa: string;
  nameZh: string;
  origin: string | null;
  spinDir: 1 | -1;
  emblem: string;
  shape: LayerShape;
  stats: BaseStats;
  special: SpecialDef;
  color: number;
  glow: number;
}

/** 基本屬性 + 推導出的物理能力值 → 完整規格 */
function defineTop(d: TopDef): TopSpec {
  return { ...d, ...derivePhysics(d.stats) };
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
    shape: { kind: 'saw', n: 3, depth: 0.3 },
    stats: { attack: 10, defense: 2, stamina: 3, weight: 44, burst: 5, dash: 10 },
    special: {
      nameJa: 'ドラゴン・インパクト',
      nameZh: '烈龍衝擊',
      descZh: '朝對手猛烈突進，1 秒內攻擊力 2.2 倍。',
      cue: 'close',
      steps: [
        { op: 'dash', speed: 7.5, keep: 0.3 },
        { op: 'buff', time: 1.0, mods: { atk: 2.2 } },
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
    shape: { kind: 'bumps', n: 6, depth: 0.1 },
    stats: { attack: 4, defense: 9, stamina: 6, weight: 64, burst: 5, dash: 2 },
    special: {
      nameJa: 'アイアン・フォートレス',
      nameZh: '鋼鐵要塞',
      descZh: '急停紮根：3 秒內質量 3 倍、防禦 2.5 倍、牢牢抓地。',
      cue: 'danger',
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
    shape: { kind: 'wings', n: 8, depth: 0.14 },
    stats: { attack: 1, defense: 4, stamina: 9, weight: 40, burst: 5, dash: 1 },
    special: {
      nameJa: 'エターナル・サイクロン',
      nameZh: '永恆旋風',
      descZh: '回復 22% 轉速、修復爆裂量，3 秒內轉速幾乎不流失。',
      cue: 'lowSpin',
      steps: [
        { op: 'spin', ratio: 0.22 },
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
    shape: { kind: 'fangs', n: 4, depth: 0.32 },
    stats: { attack: 4, defense: 4, stamina: 5, weight: 48, burst: 5, dash: 6 },
    special: {
      nameJa: 'ギャラクシー・ノヴァ',
      nameZh: '星河新星',
      descZh: '回復 15% 轉速並突進，1.5 秒內攻防 1.6 倍。',
      cue: 'close',
      steps: [
        { op: 'spin', ratio: 0.15 },
        { op: 'dash', speed: 5.5, keep: 0.4 },
        { op: 'buff', time: 1.5, mods: { atk: 1.6, def: 1.6 } },
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
    shape: { kind: 'saw', n: 4, depth: 0.3 },
    stats: { attack: 8, defense: 4, stamina: 5, weight: 40, burst: 5, dash: 8 },
    special: {
      nameJa: 'ストーム・アサルト',
      nameZh: '蒼嵐突襲',
      descZh: '捲起左旋風暴：2 秒內把附近的對手吸過來，巡航速度與攻擊力提升。',
      cue: 'far',
      steps: [{ op: 'buff', time: 2.0, mods: { aura: { k: 7, range: 2.6 }, cruise: 1.5, atk: 1.5 } }],
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
    shape: { kind: 'saw', n: 3, depth: 0.28 },
    stats: { attack: 9, defense: 3, stamina: 2, weight: 40, burst: 4, dash: 9 },
    special: {
      nameJa: 'テンペスト・ブリンガー',
      nameZh: '天馬急降',
      descZh: '從天而降的重擊：朝對手俯衝，0.8 秒內質量 2.5 倍、攻擊 1.8 倍，撞了不會被彈開。',
      cue: 'close',
      steps: [
        { op: 'dash', speed: 8, keep: 0.2 },
        { op: 'buff', time: 0.8, mods: { mass: 2.5, atk: 1.8 } },
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
    shape: { kind: 'fangs', n: 3, depth: 0.35 },
    stats: { attack: 9, defense: 3, stamina: 4, weight: 40, burst: 6, dash: 7 },
    special: {
      nameJa: '竜皇翔咬撃',
      nameZh: '龍皇翔咬擊',
      descZh: '突進咬住對手：2 秒內每次撞擊吸走對手轉速（對右旋加倍），攻擊 1.4 倍。',
      cue: 'close',
      steps: [
        { op: 'dash', speed: 6, keep: 0.3 },
        { op: 'buff', time: 2.0, mods: { spinSteal: 0.03, atk: 1.4 } },
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
    shape: { kind: 'saw', n: 3, depth: 0.36 },
    stats: { attack: 8, defense: 3, stamina: 3, weight: 40, burst: 6, dash: 10 },
    special: {
      nameJa: 'ラッシュ・ストライク',
      nameZh: '疾風連擊',
      descZh: '全速衝刺：2.5 秒內巡航速度 2.2 倍、攻擊 1.4 倍，在場上高速繞圈連撞。',
      cue: 'far',
      steps: [{ op: 'buff', time: 2.5, mods: { cruise: 2.2, atk: 1.4 } }],
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
    shape: { kind: 'bumps', n: 4, depth: 0.12 },
    stats: { attack: 3, defense: 9, stamina: 5, weight: 52, burst: 6, dash: 2 },
    special: {
      nameJa: 'メタルボール・ガード',
      nameZh: '金屬球壁',
      descZh: '金屬珠軸心鎖死：3 秒內質量 2.5 倍、防禦 2 倍，撞上來的對手承受 60% 反擊。',
      cue: 'danger',
      steps: [
        { op: 'brake', keep: 0.15 },
        { op: 'buff', time: 3.0, mods: { mass: 2.5, def: 2, fric: 3, reflect: 0.6 } },
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
    shape: { kind: 'bumps', n: 6, depth: 0.14 },
    stats: { attack: 3, defense: 8, stamina: 6, weight: 50, burst: 6, dash: 2 },
    special: {
      nameJa: '獅子暴風壁',
      nameZh: '獅子暴風壁',
      descZh: '颳起暴風牆：3 秒內把靠近的對手持續推開，防禦 1.6 倍。',
      cue: 'danger',
      steps: [{ op: 'buff', time: 3.0, mods: { aura: { k: -14, range: 1.8 }, def: 1.6 } }],
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
    shape: { kind: 'bumps', n: 3, depth: 0.1 },
    stats: { attack: 3, defense: 8, stamina: 5, weight: 46, burst: 5, dash: 4 },
    special: {
      nameJa: 'トリプル・ハウル',
      nameZh: '三首咆哮',
      descZh: '三顆頭同時咆哮：對手 3 秒內防禦降到 60%、攻擊降到 80%，自己修復爆裂量。',
      cue: 'close',
      steps: [
        { op: 'hex', time: 3.0, mods: { def: 0.6, atk: 0.8 } },
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
    shape: { kind: 'bumps', n: 6, depth: 0.08 },
    stats: { attack: 4, defense: 9, stamina: 6, weight: 48, burst: 3, dash: 3 },
    special: {
      nameJa: 'シールド・インパクト',
      nameZh: '聖盾衝擊',
      descZh: '舉盾反推：1.6 以內的對手被盾擊震開並累積爆裂量，2 秒內防禦 1.5 倍。',
      cue: 'close',
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
    shape: { kind: 'fangs', n: 6, depth: 0.3 },
    stats: { attack: 3, defense: 4, stamina: 9, weight: 40, burst: 5, dash: 3 },
    special: {
      nameJa: 'ノヴァ・ブリザード',
      nameZh: '極光冰封',
      descZh: '冰凍對手：2.5 秒內對手推不動、巡航速度減半、轉速流失 1.6 倍。',
      cue: 'close',
      steps: [{ op: 'hex', time: 2.5, mods: { ctrl: 0.3, cruise: 0.5, decay: 1.6, fric: 2 } }],
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
    shape: { kind: 'bumps', n: 4, depth: 0.06 },
    stats: { attack: 2, defense: 3, stamina: 10, weight: 50, burst: 5, dash: 2 },
    special: {
      nameJa: 'バーナード・ループ',
      nameZh: '巴納德環',
      descZh: '軸承空轉：回復 12% 轉速，4 秒內轉速流失只剩 15%。',
      cue: 'lowSpin',
      steps: [
        { op: 'spin', ratio: 0.12 },
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
    shape: { kind: 'bumps', n: 3, depth: 0.1 },
    stats: { attack: 1, defense: 6, stamina: 10, weight: 41, burst: 3, dash: 1 },
    special: {
      nameJa: 'ドレイン・スピン',
      nameZh: '吸轉魔旋',
      descZh: '隔空吸走對手 15% 轉速，3 秒內每次接觸再吸（對右旋加倍）。',
      cue: 'lowSpin',
      steps: [
        { op: 'drain', ratio: 0.15 },
        { op: 'buff', time: 3.0, mods: { spinSteal: 0.02 } },
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
    shape: { kind: 'wings', n: 2, depth: 0.2 },
    stats: { attack: 4, defense: 6, stamina: 9, weight: 41, burst: 3, dash: 3 },
    special: {
      nameJa: 'ミラージュ・パリィ',
      nameZh: '幻影招架',
      descZh: '化成幻影瞬移回場地中央，2 秒內防禦 1.8 倍、撞上來的對手承受 40% 反擊。',
      cue: 'danger',
      steps: [{ op: 'blink' }, { op: 'buff', time: 2.0, mods: { def: 1.8, reflect: 0.4, fric: 2 } }],
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
    shape: { kind: 'wings', n: 2, depth: 0.3 },
    stats: { attack: 6, defense: 5, stamina: 4, weight: 42, burst: 5, dash: 6 },
    special: {
      nameJa: 'ファイヤー・アロー',
      nameZh: '烈火飛箭',
      descZh: '化為火箭貫穿：回復 8% 轉速並突進，1.2 秒內造成的爆裂量 2.2 倍。',
      cue: 'close',
      steps: [
        { op: 'spin', ratio: 0.08 },
        { op: 'dash', speed: 6.5, keep: 0.3 },
        { op: 'buff', time: 1.2, mods: { burstDealt: 2.2 } },
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
    shape: { kind: 'fangs', n: 5, depth: 0.25 },
    stats: { attack: 6, defense: 5, stamina: 5, weight: 63, burst: 5, dash: 4 },
    special: {
      nameJa: '天地崩落',
      nameZh: '天地崩落',
      descZh: '把對手硬拉過來再壓碎：1.2 秒內質量 2.2 倍、攻擊 1.6 倍。',
      cue: 'far',
      steps: [
        { op: 'pull', speed: 5.5 },
        { op: 'buff', time: 1.2, mods: { mass: 2.2, atk: 1.6 } },
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
    shape: { kind: 'fangs', n: 2, depth: 0.3 },
    stats: { attack: 6, defense: 4, stamina: 5, weight: 46, burst: 5, dash: 5 },
    special: {
      nameJa: 'カウンター・ブレイク',
      nameZh: '逆轉破擊',
      descZh: '雙旋切換：反轉旋轉方向，2.5 秒內攻擊 1.3 倍、撞上來的對手承受 80% 反擊。',
      cue: 'danger',
      steps: [{ op: 'reverse' }, { op: 'buff', time: 2.5, mods: { atk: 1.3, reflect: 0.8 } }],
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
    shape: { kind: 'saw', n: 4, depth: 0.2 },
    stats: { attack: 6, defense: 5, stamina: 4, weight: 41, burst: 6, dash: 5 },
    special: {
      nameJa: 'クレセント・ジャッジ',
      nameZh: '新月審判',
      descZh: '瞬移到對手背後揮鐮：1 秒內造成的爆裂量 1.8 倍。',
      cue: 'far',
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

/** 類型的顯示名稱 */
export const TYPE_LABEL: Record<TopType, string> = { attack: '攻擊型', defense: '防禦型', stamina: '持久型', balance: '平衡型' };
