import { afterEach, describe, expect, test } from 'vitest';
import { CLASH_WORDS, emblemOf, initialLang, lang, onLangChange, setLang, specialName, TEXT, topName, tr, type TextKey } from '../src/i18n';
import { ARENAS } from '../src/sim/arena';
import { DIFFICULTIES } from '../src/sim/difficulty';
import { TOP_SPECS } from '../src/sim/tops';
import indexHtml from '../index.html?raw';

/**
 * 語言切換：日文版（原本的日式熱血風格，夾帶中文說明）與全中文版。
 * 中文版的畫面文字不能有日文假名，也不能有英文字（按鍵名稱除外）。
 */

/** 日文假名（平假名、片假名、長音符；中黑點「・」是中文介面也用的標點，不算） */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
/** 中文版允許出現的英文：鍵盤按鍵名稱 */
const KEY_NAMES = /\b(SPACE|Space|Shift|WASD|Enter|Backspace|Esc|Q|E|M)\b/g;

afterEach(() => setLang('ja', false));

describe('起始語言', () => {
  test('沒有網址參數也沒記錄時預設日文', () => {
    expect(initialLang('', null)).toBe('ja');
  });

  test('記住上次選的語言', () => {
    expect(initialLang('', 'zh')).toBe('zh');
    expect(initialLang('?seed=3', 'ja')).toBe('ja');
  });

  test('網址參數 lang 優先於記錄', () => {
    expect(initialLang('?lang=zh', 'ja')).toBe('zh');
    expect(initialLang('?seed=1&lang=ja', 'zh')).toBe('ja');
  });

  test('不認得的值忽略', () => {
    expect(initialLang('?lang=en', null)).toBe('ja');
    expect(initialLang('?lang=en', 'zh')).toBe('zh');
    expect(initialLang('', 'fr')).toBe('ja');
  });
});

describe('切換語言', () => {
  test('沒有 DOM 與 localStorage 的環境也能切換，並通知訂閱者', () => {
    const seen: string[] = [];
    const off = onLangChange((l: string) => seen.push(l));
    setLang('zh');
    expect(lang()).toBe('zh');
    setLang('zh');
    off();
    setLang('ja');
    expect(seen).toEqual(['zh']);
  });
});

describe('字串表', () => {
  const keys = Object.keys(TEXT) as TextKey[];

  test('每一句兩種語言都有內容', () => {
    for (const k of keys) {
      expect(TEXT[k].ja, k).not.toBe('');
      expect(TEXT[k].zh, k).not.toBe('');
    }
  });

  test('中文版沒有日文假名，也沒有英文字（按鍵名稱除外）', () => {
    for (const k of keys) {
      const zh = TEXT[k].zh;
      expect(zh, k).not.toMatch(KANA);
      expect(zh.replace(KEY_NAMES, '').replace(/\{\w+\}/g, ''), k).not.toMatch(/[A-Za-z]/);
    }
  });

  test('依目前語言取字並代入參數', () => {
    expect(tr('info.battle', { n: 2 })).toBe('BATTLE 2/3');
    setLang('zh', false);
    expect(tr('info.battle', { n: 2 })).toBe('第 2／3 戰');
    expect(tr('banner.go')).toBe('發射！！');
  });

  test('擬聲字：中文版沒有假名', () => {
    for (const w of [...CLASH_WORDS.zh.small, ...CLASH_WORDS.zh.big]) expect(w).not.toMatch(KANA);
    expect(CLASH_WORDS.ja.small.length).toBeGreaterThan(0);
  });

  test('index.html 標了 data-i18n 的元素：鍵都在字串表裡，預設內容就是日文版的字', () => {
    const found = [...indexHtml.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)];
    expect(found.length).toBeGreaterThan(10);
    for (const [, key, text] of found) {
      expect(TEXT, key).toHaveProperty(key);
      expect(text.trim(), key).toBe(TEXT[key as TextKey].ja);
    }
  });
});

describe('名稱', () => {
  test('日文版用日文名，中文版用中文名', () => {
    const sp = TOP_SPECS.blaze;
    expect(topName(sp)).toBe('ブレイズ・ドラゴン');
    expect(specialName(sp)).toBe('ドラゴン・インパクト');
    setLang('zh', false);
    expect(topName(sp)).toBe('烈焰龍');
    expect(specialName(sp)).toBe('烈龍衝擊');
  });

  test('中文版的陀螺、必殺技、場地、難度名稱都沒有假名', () => {
    setLang('zh', false);
    for (const sp of Object.values(TOP_SPECS)) {
      expect(topName(sp)).not.toMatch(KANA);
      expect(specialName(sp)).not.toMatch(KANA);
      expect(sp.special.descZh).not.toMatch(KANA);
    }
    for (const a of Object.values(ARENAS)) expect(a.nameZh + a.descZh).not.toMatch(KANA);
    for (const d of Object.values(DIFFICULTIES)) expect(d.labelZh).not.toMatch(KANA);
  });

  test('紋章：中文版把日文字形換成繁體（亀→龜、戦→戰、氷→冰），其他不變', () => {
    expect(emblemOf(TOP_SPECS.turtle)).toBe('亀');
    setLang('zh', false);
    expect(emblemOf(TOP_SPECS.turtle)).toBe('龜');
    expect(emblemOf(TOP_SPECS.valkyrie)).toBe('戰');
    expect(emblemOf(TOP_SPECS.wolborg)).toBe('冰');
    expect(emblemOf(TOP_SPECS.blaze)).toBe('龍');
  });
});
