import { describe, expect, test } from 'vitest';
import { CHEER_COOLDOWN, CHEER_LEVEL, CheerGate, cheerLength } from '../src/audio/cheer';

/**
 * 觀眾歡呼（真實錄音，只在關鍵時刻播）：終結最大聲、必殺中等、重擊最小聲；
 * 同一段時間內只播一聲：冷卻中更小或一樣大的丟掉，更大的取代正在播的那一聲。
 */

describe('歡呼的強度', () => {
  test('終結 > 必殺 > 重擊', () => {
    expect(CHEER_LEVEL.finish).toBe(1);
    expect(CHEER_LEVEL.special).toBeLessThan(CHEER_LEVEL.finish);
    expect(CHEER_LEVEL.bigClash).toBeLessThan(CHEER_LEVEL.special);
  });

  test('越小聲播得越短，最大聲播完整段', () => {
    expect(cheerLength(1, 4)).toBe(4);
    expect(cheerLength(CHEER_LEVEL.special, 4)).toBeLessThan(4);
    expect(cheerLength(CHEER_LEVEL.bigClash, 4)).toBeLessThan(cheerLength(CHEER_LEVEL.special, 4));
    expect(cheerLength(CHEER_LEVEL.bigClash, 4)).toBeGreaterThanOrEqual(1.2);
    // 錄音比預期短時不會超過錄音長度
    expect(cheerLength(1, 2)).toBe(2);
  });
});

describe('歡呼的閘門', () => {
  test('第一聲照播', () => {
    expect(new CheerGate().request(10, CHEER_LEVEL.bigClash)).toBe('play');
  });

  test('冷卻中更小或一樣大的丟掉', () => {
    const g = new CheerGate();
    g.request(10, CHEER_LEVEL.special);
    expect(g.request(11, CHEER_LEVEL.bigClash)).toBeNull();
    expect(g.request(11.5, CHEER_LEVEL.special)).toBeNull();
  });

  test('冷卻中更大聲的取代正在播的那一聲（重擊 → 必殺 → 終結）', () => {
    const g = new CheerGate();
    expect(g.request(10, CHEER_LEVEL.bigClash)).toBe('play');
    expect(g.request(10.8, CHEER_LEVEL.special)).toBe('replace');
    expect(g.request(11.5, CHEER_LEVEL.finish)).toBe('replace');
    // 取代之後重新計算冷卻：終結之後馬上的必殺丟掉
    expect(g.request(12, CHEER_LEVEL.special)).toBeNull();
  });

  test('冷卻過後，小聲的也照播', () => {
    const g = new CheerGate();
    g.request(10, CHEER_LEVEL.finish);
    expect(g.request(10 + CHEER_COOLDOWN + 0.01, CHEER_LEVEL.bigClash)).toBe('play');
  });
});
