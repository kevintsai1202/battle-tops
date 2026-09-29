import { STRICT_WINDOW, type LaunchWindow } from './rules';

/** 難度代號 */
export type DifficultyId = 'easy' | 'normal' | 'hard';

/** 一檔難度調整的項目：只影響發射判定、CPU 發射力道與 CPU 使用必殺的頻率 */
export interface Difficulty {
  id: DifficultyId;
  /** 顯示名稱（日文／中文） */
  labelJa: string;
  labelZh: string;
  /** 玩家的發射判定視窗 */
  launch: LaunchWindow;
  /** CPU 發射力道範圍（轉速比例） */
  cpuLaunch: [number, number];
  /** CPU 條件成立時每一步放必殺的機率（原本 0.05） */
  cpuSpecialRate: number;
}

/**
 * 三檔難度。數值依 CPU 對打模擬校準（見 docs/design.md「難度」）：
 * 反應晚 0.1～0.3 秒的一般玩家，回合勝率約為簡單 84%、普通 76%、困難 42%。
 */
export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: {
    id: 'easy',
    labelJa: 'かんたん',
    labelZh: '簡單',
    launch: { perfect: 0.15, worst: 0.6, min: 0.8 },
    cpuLaunch: [0.6, 0.8],
    cpuSpecialRate: 0.015,
  },
  normal: {
    id: 'normal',
    labelJa: 'ふつう',
    labelZh: '普通',
    launch: { perfect: 0.1, worst: 0.5, min: 0.65 },
    cpuLaunch: [0.72, 0.95],
    cpuSpecialRate: 0.05,
  },
  hard: {
    id: 'hard',
    labelJa: 'むずかしい',
    labelZh: '困難',
    launch: STRICT_WINDOW,
    cpuLaunch: [0.85, 1.0],
    cpuSpecialRate: 0.05,
  },
};

export const DIFFICULTY_IDS: DifficultyId[] = ['easy', 'normal', 'hard'];
