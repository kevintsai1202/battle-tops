import { describe, expect, test } from 'vitest';
import enLines from '../src/audio/tutorial-lines.en.json';
import lines from '../src/audio/tutorial-lines.json';
import { TEXT } from '../src/i18n';
import { caption, emptyCtx, GUIDE_KINDS, RECOMMENDED, shouldOfferTutorial, STEPS, targetOf, TutorialFlow, type TutorialCtx } from '../src/tutorial/flow';

/**
 * 操作教學的步驟流程（純邏輯）：一步一步檢查玩家是否真的做到，做到才進下一步。
 * 遊戲每幀把目前狀態（TutorialCtx）餵給 TutorialFlow，流程決定目前在哪一步。
 */

/** 日文假名 */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
/** 中日文字（漢字、假名、全形標點）：英文版的字幕與標題不能有 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

/** 從空白狀態套上變化 */
const ctx = (patch: Partial<TutorialCtx> = {}): TutorialCtx => ({ ...emptyCtx(), ...patch });

describe('教學步驟', () => {
  test('四章十二步，依序是組隊、發射、操控、計分', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['pick', 'next', 'order', 'parts', 'ready', 'launch', 'push', 'dash', 'special', 'finish', 'points', 'match']);
    expect([...new Set(STEPS.map((s) => s.chapter))]).toEqual(['team', 'launch', 'control', 'score']);
  });

  test('每一步的電腦版與手機版都有解說語音，字幕就是語音的台詞（去掉語氣標記）：日文版與中文版全中文，英文版全英文', () => {
    for (const s of STEPS) {
      for (const input of ['kb', 'tc'] as const) {
        const id = s.voice[input];
        expect(lines.lines, `${s.id} ${input}`).toHaveProperty(id);
        expect(enLines.lines, `${s.id} ${input}`).toHaveProperty(id);
        const text = lines.lines[id as keyof typeof lines.lines].text.replace(/\[[^\]]*\]/g, '').trim();
        const en = enLines.lines[id as keyof typeof enLines.lines].text.replace(/\[[^\]]*\]/g, '').trim();
        expect(caption(s, input, 'zh')).toBe(text);
        expect(caption(s, input, 'ja')).toBe(text);
        expect(caption(s, input, 'zh')).not.toMatch(KANA);
        expect(caption(s, input, 'en')).toBe(en);
        expect(caption(s, input, 'en')).not.toMatch(CJK);
      }
      expect(TEXT[s.title].zh).not.toMatch(KANA);
      expect(TEXT[s.title].en).not.toMatch(CJK);
    }
  });

  test('每一步都有大畫面上的指引（電腦與手機），面板裡只有計分那一步留著三種終結的說明圖', () => {
    for (const s of STEPS) {
      for (const input of ['kb', 'tc'] as const) expect(GUIDE_KINDS, `${s.id} ${input}`).toContain(s.guide[input]);
    }
    expect(STEPS.filter((s) => s.illustration).map((s) => s.id)).toEqual(['points']);
    // 要點選的步驟都有聚光圈目標
    for (const id of ['pick', 'next', 'order', 'parts', 'ready', 'special']) expect(STEPS.find((s) => s.id === id)!.target, id).toBeDefined();
  });

  test('只有說明型的步驟要按按鈕才前進', () => {
    expect(STEPS.filter((s) => s.info).map((s) => s.id)).toEqual(['points', 'match']);
  });
});

describe('教學流程', () => {
  test('做到了才進下一步，一路走到完成', () => {
    const f = new TutorialFlow();
    const seq: [Partial<TutorialCtx>, string][] = [
      [{ state: 'select', picked: ['blaze', 'wolf'] }, 'pick'],
      [{ state: 'select', picked: ['blaze', 'wolf', 'gale'] }, 'next'],
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

describe('大畫面指引的目標', () => {
  const pick = STEPS.find((s) => s.id === 'pick')!;

  test('選陀螺：依序指推薦的三顆裡還沒選的第一顆', () => {
    expect(RECOMMENDED).toEqual(['blaze', 'turtle', 'gale']);
    expect(targetOf(pick, ctx())).toBe('#select .card[data-id="blaze"]');
    expect(targetOf(pick, ctx({ picked: ['blaze'] }))).toBe('#select .card[data-id="turtle"]');
    // 選了別顆也算：只指還沒選的推薦陀螺
    expect(targetOf(pick, ctx({ picked: ['wolf', 'blaze'] }))).toBe('#select .card[data-id="turtle"]');
    expect(targetOf(pick, ctx({ picked: ['turtle'] }))).toBe('#select .card[data-id="blaze"]');
    expect(targetOf(pick, ctx({ picked: ['blaze', 'turtle', 'gale'] }))).toBeUndefined();
  });

  test('其他步驟的目標是固定的元素', () => {
    const at = (id: string) => targetOf(STEPS.find((s) => s.id === id)!, ctx());
    expect(at('next')).toBe('#select .go');
    expect(at('order')).toBe('#arrange .ar-slot:nth-child(2) .ar-up');
    expect(at('parts')).toBe('#arrange .ar-slot.on .part-btn[data-slot="driver"]');
    // 零件清單打開後改指清單裡第一件還沒裝上的零件
    expect(targetOf(STEPS.find((s) => s.id === 'parts')!, ctx({ partMenu: true }))).toBe('#part-menu .pm-opt:not(.current):not(:disabled)');
    expect(at('ready')).toBe('#arrange .ar-ready');
    expect(at('launch')).toBeUndefined();
  });

  test('必殺：電腦框住必殺量表，手機指著集滿時出現的必殺按鈕', () => {
    const special = STEPS.find((s) => s.id === 'special')!;
    expect(targetOf(special, ctx({ input: 'kb' }))).toBe('#hud .panel[data-side="0"] .special');
    expect(targetOf(special, ctx({ input: 'tc' }))).toBe('#special-btn');
    expect(special.guide).toEqual({ kb: 'keySpace', tc: 'tap' });
  });
});

describe('第一次玩的提示', () => {
  test('沒看過也沒拒絕過才提示', () => {
    expect(shouldOfferTutorial(null)).toBe(true);
    expect(shouldOfferTutorial('done')).toBe(false);
    expect(shouldOfferTutorial('dismissed')).toBe(false);
  });
});
