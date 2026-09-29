import type { TopSpec, TopType } from './types';

/**
 * 四種陀螺的規格。數值平衡由 tests/battle.test.ts 的 CPU 對打耐久測試把關：
 * 每個組合都要能在時限內分出勝負，且三種終結方式都會出現。
 */
export const TOP_SPECS: Record<TopType, TopSpec> = {
  attack: {
    type: 'attack',
    nameJa: 'ブレイズ・ドラゴン',
    nameZh: '烈焰龍',
    specialJa: 'ドラゴン・インパクト',
    radius: 0.36,
    mass: 1.1,
    attack: 1.7,
    defense: 0.8,
    stamina: 0.9,
    drive: 6.0,
    cruise: 5.0,
    friction: 0.3,
    maxSpin: 300,
    color: 0xff3b1f,
    glow: 0xff7a1a,
  },
  defense: {
    type: 'defense',
    nameJa: 'アイアン・タートル',
    nameZh: '鐵壁龜',
    specialJa: 'アイアン・フォートレス',
    radius: 0.38,
    mass: 1.6,
    attack: 1.0,
    defense: 1.7,
    stamina: 1.15,
    drive: 1.6,
    cruise: 1.8,
    friction: 0.6,
    maxSpin: 280,
    color: 0x2fd35b,
    glow: 0x7dff9a,
  },
  stamina: {
    type: 'stamina',
    nameJa: 'ゲイル・フェニックス',
    nameZh: '疾風鳳',
    specialJa: 'エターナル・サイクロン',
    radius: 0.34,
    mass: 1.0,
    attack: 0.7,
    defense: 1.0,
    stamina: 1.35,
    drive: 1.0,
    cruise: 1.4,
    friction: 0.25,
    maxSpin: 320,
    color: 0x2aa8ff,
    glow: 0x7fe0ff,
  },
  balance: {
    type: 'balance',
    nameJa: 'ギャラクシー・ウルフ',
    nameZh: '星河狼',
    specialJa: 'ギャラクシー・ノヴァ',
    radius: 0.36,
    mass: 1.2,
    attack: 1.05,
    defense: 1.05,
    stamina: 1.05,
    drive: 4.0,
    cruise: 4.0,
    friction: 0.35,
    maxSpin: 300,
    color: 0xb04dff,
    glow: 0xe0a0ff,
  },
};

export const TOP_TYPES: TopType[] = ['attack', 'defense', 'stamina', 'balance'];

/** 各類型陀螺頂部晶片與陣容小圖示上的字 */
export const TOP_EMBLEM: Record<TopType, string> = { attack: '龍', defense: '亀', stamina: '鳳', balance: '狼' };
