import { describe, expect, test } from 'vitest';
import lines from '../src/audio/tutorial-lines.json';
import { emptyCtx, shouldOfferTutorial, STEPS, TutorialFlow, type TutorialCtx } from '../src/tutorial/flow';

/**
 * 操作教學的步驟流程（純邏輯）：一步一步檢查玩家是否真的做到，做到才進下一步。
 * 遊戲每幀把目前狀態（TutorialCtx）餵給 TutorialFlow，流程決定目前在哪一步。
 */

/** 日文假名 */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;

/** 從空白狀態套上變化 */
const ctx = (patch: Partial<TutorialCtx> = {}): TutorialCtx => ({ ...emptyCtx(), ...patch });

describe('教學步驟', () => {
  test('四章十二步，依序是組隊、發射、操控、計分', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['pick', 'next', 'order', 'parts', 'ready', 'launch', 'push', 'dash', 'special', 'finish', 'points', 'match']);
    expect([...new Set(STEPS.map((s) => s.chapter))]).toEqual(['team', 'launch', 'control', 'score']);
  });

  test('每一步的電腦版與手機版都有解說語音，字幕就是語音的台詞（去掉語氣標記），全中文', () => {
    for (const s of STEPS) {
      for (const input of ['kb', 'tc'] as const) {
        const id = s.voice[input];
        expect(lines.lines, `${s.id} ${input}`).toHaveProperty(id);
        const text = lines.lines[id as keyof typeof lines.lines].text.replace(/\[[^\]]*\]/g, '').trim();
        expect(s.text[input]).toBe(text);
        expect(s.text[input]).not.toMatch(KANA);
      }
      expect(s.title).not.toMatch(KANA);
    }
  });

  test('只有說明型的步驟要按按鈕才前進', () => {
    expect(STEPS.filter((s) => s.info).map((s) => s.id)).toEqual(['points', 'match']);
  });
});

describe('教學流程', () => {
  test('做到了才進下一步，一路走到完成', () => {
    const f = new TutorialFlow();
    const seq: [Partial<TutorialCtx>, string][] = [
      [{ state: 'select', picks: 2 }, 'pick'],
      [{ state: 'select', picks: 3 }, 'next'],
      [{ state: 'arrange' }, 'order'],
      [{ state: 'arrange', orderChanged: true }, 'parts'],
      [{ state: 'arrange', orderChanged: true, partChanged: true }, 'ready'],
      [{ state: 'launch' }, 'launch'],
      [{ state: 'battle', pulled: true }, 'push'],
      [{ state: 'battle', pulled: true, pushTime: 0.5 }, 'push'],
      [{ state: 'battle', pulled: true, pushTime: 1.3 }, 'dash'],
      [{ state: 'battle', pulled: true, pushTime: 2, dashes: 1 }, 'special'],
      [{ state: 'battle', pulled: true, pushTime: 2, dashes: 1, specials: 1 }, 'finish'],
      [{ state: 'roundEnd', finished: true }, 'points'],
      [{ state: 'roundEnd', finished: true, next: true }, 'match'],
    ];
    for (const [patch, want] of seq) {
      f.update(ctx(patch));
      expect(f.step.id, JSON.stringify(patch)).toBe(want);
    }
    expect(f.done).toBe(false);
    f.update(ctx({ state: 'roundEnd', next: true }));
    expect(f.done).toBe(true);
  });

  test('衝刺與必殺只算進入這一步之後的次數', () => {
    const f = new TutorialFlow(STEPS.findIndex((s) => s.id === 'dash'));
    // 進入這一步時已經衝刺過 3 次（之前自己試的），要再衝一次才算
    f.update(ctx({ state: 'battle', dashes: 3 }));
    expect(f.step.id).toBe('dash');
    f.update(ctx({ state: 'battle', dashes: 4, specials: 2 }));
    expect(f.step.id).toBe('special');
    f.update(ctx({ state: 'battle', dashes: 4, specials: 2 }));
    expect(f.step.id).toBe('special');
    f.update(ctx({ state: 'battle', dashes: 4, specials: 3 }));
    expect(f.step.id).toBe('finish');
  });

  test('發射沒有拉條（點一下或按 Space）：要求重來一次，不前進', () => {
    const f = new TutorialFlow(STEPS.findIndex((s) => s.id === 'launch'));
    expect(f.update(ctx({ state: 'launch' }))).toBeNull();
    expect(f.update(ctx({ state: 'battle', pulled: false }))).toBe('retry');
    // 同一次發射只要求一次
    expect(f.update(ctx({ state: 'battle', pulled: false }))).toBeNull();
    expect(f.step.id).toBe('launch');
    // 重來：回到發射階段，這次有拉條
    f.update(ctx({ state: 'launch' }));
    expect(f.update(ctx({ state: 'battle', pulled: true }))).toBe('advanced');
    expect(f.step.id).toBe('push');
  });

  test('說明型步驟要按「下一步」，按鈕的訊號只用一次', () => {
    const f = new TutorialFlow(STEPS.findIndex((s) => s.id === 'points'));
    f.update(ctx({ state: 'roundEnd' }));
    expect(f.step.id).toBe('points');
    f.update(ctx({ state: 'roundEnd', next: true }));
    expect(f.step.id).toBe('match');
  });

  test('跳過這一步：直接進下一步；最後一步跳過就完成', () => {
    const f = new TutorialFlow();
    f.skip();
    expect(f.step.id).toBe('next');
    const g = new TutorialFlow(STEPS.length - 1);
    g.skip();
    expect(g.done).toBe(true);
  });

  test('保護與被動對手：發射到必殺的步驟對手不攻擊、雙方不會被終結；計分章節解除保護', () => {
    const at = (id: string) => new TutorialFlow(STEPS.findIndex((s) => s.id === id));
    for (const id of ['launch', 'push', 'dash', 'special']) expect(at(id).guard, id).toBe(true);
    for (const id of ['pick', 'ready', 'finish', 'points', 'match']) expect(at(id).guard, id).toBe(false);
    for (const id of ['launch', 'push', 'dash', 'special', 'finish', 'points']) expect(at(id).cpuPassive, id).toBe(true);
  });
});

describe('第一次玩的提示', () => {
  test('沒看過也沒拒絕過才提示', () => {
    expect(shouldOfferTutorial(null)).toBe(true);
    expect(shouldOfferTutorial('done')).toBe(false);
    expect(shouldOfferTutorial('dismissed')).toBe(false);
  });
});
