import { afterEach, describe, expect, test } from 'vitest';
import {
  browserLang,
  CLASH_WORDS,
  descOf,
  emblemOf,
  initialLang,
  lang,
  onLangChange,
  originOf,
  plainName,
  serverError,
  serverReason,
  setLang,
  specialName,
  TEXT,
  topName,
  tr,
  type TextKey,
} from '../src/i18n';
import { ARENAS } from '../src/sim/arena';
import { DIFFICULTIES } from '../src/sim/difficulty';
import { PARTS } from '../src/sim/parts';
import { TOP_SPECS } from '../src/sim/tops';
import indexHtml from '../index.html?raw';

/**
 * 語言切換：日文版（原本的日式熱血風格，夾帶中文說明）、全中文版與英文版。
 * 中文版的畫面文字不能有日文假名，也不能有英文字（按鍵名稱除外）；英文版不能有中日文字。
 */

/** 日文假名（平假名、片假名、長音符；中黑點「・」是中文介面也用的標點，不算） */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
/** 中日文字：漢字、假名、中黑點、全形標點與全形字（英文版一個都不能有） */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}・　-〿＀-￯]/u;
/**
 * 中文版允許出現的英文：鍵盤按鍵名稱、瀏覽器與技術名稱（WebGL、Chrome、Edge、3D），
 * 以及發射的口號「Go Shoot」（台灣與日本原作的習慣，使用者決定保留）
 */
const KEY_NAMES = /\b(SPACE|Space|Shift|WASD|W|A|S|D|Enter|Backspace|Esc|Ctrl|F5|Q|E|M|X|WebGL|Chrome|Edge|3D|GO SHOOT|Go Shoot)\b/g;
/** 英文版刻意不用的參數：日文版詳細資料附的中文必殺名（英文版不顯示中文） */
const EN_DROPS: Partial<Record<TextKey, string[]>> = { 'card.specialWithZh': ['zh'] };

afterEach(() => setLang('ja', false));

describe('起始語言', () => {
  test('沒有網址參數、沒記錄，也不知道瀏覽器語言時預設日文', () => {
    expect(initialLang('', null)).toBe('ja');
  });

  test('記住上次選的語言', () => {
    expect(initialLang('', 'zh')).toBe('zh');
    expect(initialLang('', 'en', ['zh-TW'])).toBe('en');
    expect(initialLang('?seed=3', 'ja', ['en-US'])).toBe('ja');
  });

  test('網址參數 lang 優先於記錄', () => {
    expect(initialLang('?lang=zh', 'ja')).toBe('zh');
    expect(initialLang('?seed=1&lang=ja', 'zh')).toBe('ja');
    expect(initialLang('?lang=en', 'zh')).toBe('en');
    expect(initialLang('?lang=en', null)).toBe('en');
  });

  test('不認得的值忽略', () => {
    expect(initialLang('?lang=fr', null)).toBe('ja');
    expect(initialLang('?lang=fr', 'zh')).toBe('zh');
    expect(initialLang('', 'fr')).toBe('ja');
  });

  test('沒選過時看瀏覽器語言（第一個偏好）：英文 → 英文版、中文 → 中文版、日文與其他 → 日文版', () => {
    expect(initialLang('', null, ['en-US', 'zh-TW'])).toBe('en');
    expect(initialLang('', null, ['en'])).toBe('en');
    expect(initialLang('', null, ['zh-TW', 'en'])).toBe('zh');
    expect(initialLang('', null, ['zh-CN'])).toBe('zh');
    expect(initialLang('', null, ['ja-JP'])).toBe('ja');
    expect(initialLang('', null, ['fr-FR', 'en'])).toBe('ja');
    expect(browserLang([])).toBe('ja');
    expect(browserLang(['EN-GB'])).toBe('en');
  });
});

describe('切換語言', () => {
  test('沒有 DOM 與 localStorage 的環境也能切換，並通知訂閱者', () => {
    const seen: string[] = [];
    const off = onLangChange((l: string) => seen.push(l));
    setLang('zh');
    expect(lang()).toBe('zh');
    setLang('zh');
    setLang('en');
    off();
    setLang('ja');
    expect(seen).toEqual(['zh', 'en']);
  });
});

describe('字串表', () => {
  const keys = Object.keys(TEXT) as TextKey[];

  test('每一句中文與英文都有內容；日文版另外寫的也不能是空的', () => {
    for (const k of keys) {
      const e: { zh: string; en: string; ja?: string } = TEXT[k];
      expect(e.zh, k).not.toBe('');
      expect(e.en, k).not.toBe('');
      if ('ja' in e) expect(e.ja, k).not.toBe('');
    }
  });

  test('中文版沒有日文假名，也沒有英文字（按鍵名稱除外）', () => {
    for (const k of keys) {
      const zh = TEXT[k].zh;
      expect(zh, k).not.toMatch(KANA);
      expect(zh.replace(KEY_NAMES, '').replace(/\{\w+\}/g, ''), k).not.toMatch(/[A-Za-z]/);
    }
  });

  test('英文版沒有中日文字（含全形標點）', () => {
    for (const k of keys) expect(TEXT[k].en, k).not.toMatch(CJK);
  });

  test('同一句的三種語言用同一組參數', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of keys) {
      const e: { zh: string; en: string; ja?: string } = TEXT[k];
      expect(params(e.en), k).toEqual(params(e.zh).filter((p) => !EN_DROPS[k]?.includes(p)));
      if (e.ja) expect(params(e.ja), k).toEqual(params(e.zh));
    }
  });

  test('依目前語言取字並代入參數；日文版沒另外寫的字用中文', () => {
    expect(tr('info.battle', { n: 2 })).toBe('BATTLE 2/3');
    expect(tr('select.next')).toBe('下一步 ▶');
    setLang('zh', false);
    expect(tr('info.battle', { n: 2 })).toBe('第 2／3 戰');
    expect(tr('banner.go')).toBe('GO SHOOT!!');
    setLang('en', false);
    expect(tr('info.battle', { n: 2 })).toBe('BATTLE 2/3');
    expect(tr('banner.go')).toBe('GO SHOOT!!');
    expect(tr('select.next')).toBe('Next ▶');
    expect(tr('opp.label', { name: 'Ken' })).toBe('Opponent: Ken');
  });

  test('擬聲字：中文版沒有假名、英文版沒有中日文字', () => {
    for (const w of [...CLASH_WORDS.zh.small, ...CLASH_WORDS.zh.big]) expect(w).not.toMatch(KANA);
    for (const w of [...CLASH_WORDS.en.small, ...CLASH_WORDS.en.big]) expect(w).not.toMatch(CJK);
    expect(CLASH_WORDS.ja.small.length).toBeGreaterThan(0);
    expect(CLASH_WORDS.en.big.length).toBeGreaterThan(0);
  });

  test('index.html 標了 data-i18n 的元素：鍵都在字串表裡，預設內容就是日文版的字', () => {
    const found = [...indexHtml.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)];
    expect(found.length).toBeGreaterThan(40);
    for (const [, key, text] of found) {
      expect(TEXT, key).toHaveProperty(key);
      const e: { zh: string; ja?: string } = TEXT[key as TextKey];
      expect(text.trim(), key).toBe((e.ja ?? e.zh).trim());
    }
    // aria-label 與 placeholder 的鍵也要在字串表裡
    for (const [, key] of indexHtml.matchAll(/data-i18n-(?:aria|ph)="([^"]+)"/g)) expect(TEXT, key).toHaveProperty(key);
  });

  test('index.html 的文字都標了語言鍵：沒標的中日文字只有語言按鈕（各語言自己的名稱）與日文版專用的中文小註解', () => {
    const body = indexHtml.replace(/<!--[\s\S]*?-->/g, '');
    const texts = [...body.matchAll(/<([a-z0-9]+)([^>]*)>([^<]*)</g)]
      .filter(([, , , t]) => CJK.test(t))
      .filter(([, , attrs]) => !/data-i18n="/.test(attrs) && !/data-lang=|class="ja-only"/.test(attrs));
    expect(texts.map((m) => m[0])).toEqual([]);
    // 屬性裡的中文（aria-label、placeholder）都有對應的語言鍵
    for (const m of body.matchAll(/<[^>]*\s(aria-label|placeholder)="[^"]*[一-鿿][^"]*"[^>]*>/g)) {
      expect(m[0], m[0]).toMatch(m[1] === 'aria-label' ? /data-i18n-aria=/ : /data-i18n-ph=/);
    }
  });
});

describe('名稱與說明', () => {
  test('日文版用日文名，中文版用中文名，英文版用英文名', () => {
    const sp = TOP_SPECS.blaze;
    expect(topName(sp)).toBe('ブレイズ・ドラゴン');
    expect(specialName(sp)).toBe('ドラゴン・インパクト');
    expect(plainName(sp)).toBe('烈焰龍');
    setLang('zh', false);
    expect(topName(sp)).toBe('烈焰龍');
    expect(specialName(sp)).toBe('烈龍衝擊');
    setLang('en', false);
    expect(topName(sp)).toBe('Blaze Dragon');
    expect(specialName(sp)).toBe('Dragon Impact');
    expect(plainName(sp)).toBe('Blaze Dragon');
    expect(plainName(ARENAS.stadium)).toBe('Xtreme');
    expect(originOf(TOP_SPECS.pegasus)).toBe('Storm Pegasus 105RF (BB-28)');
    expect(originOf(TOP_SPECS.blaze)).toBeNull();
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

  test('英文版的陀螺、必殺技、原型、場地、零件、難度都有英文，而且沒有中日文字', () => {
    setLang('en', false);
    for (const sp of Object.values(TOP_SPECS)) {
      for (const s of [topName(sp), specialName(sp), descOf(sp.special), originOf(sp) ?? 'x']) {
        expect(s, sp.id).not.toBe('');
        expect(s, sp.id).not.toMatch(CJK);
      }
      // 原型陀螺：中文版有原型就要有英文寫法
      expect(sp.originEn === null, sp.id).toBe(sp.origin === null);
    }
    for (const a of Object.values(ARENAS)) expect(plainName(a) + descOf(a), a.id).not.toMatch(CJK);
    for (const p of Object.values(PARTS)) expect(plainName(p) + descOf(p), p.id).not.toMatch(CJK);
    for (const d of Object.values(DIFFICULTIES)) expect(d.labelEn, d.id).not.toMatch(CJK);
    // 英文名不重複（名鑑、結果畫面靠名稱分辨）
    const names = Object.values(TOP_SPECS).map((sp) => sp.nameEn);
    expect(new Set(names).size).toBe(names.length);
  });

  test('紋章：中文版把日文字形換成繁體（亀→龜、戦→戰、氷→冰），日文版與英文版用日文字形', () => {
    expect(emblemOf(TOP_SPECS.turtle)).toBe('亀');
    setLang('zh', false);
    expect(emblemOf(TOP_SPECS.turtle)).toBe('龜');
    expect(emblemOf(TOP_SPECS.valkyrie)).toBe('戰');
    expect(emblemOf(TOP_SPECS.wolborg)).toBe('冰');
    expect(emblemOf(TOP_SPECS.blaze)).toBe('龍');
    setLang('en', false);
    expect(emblemOf(TOP_SPECS.turtle)).toBe('亀');
  });
});

describe('伺服器訊息', () => {
  test('日文版與中文版照用伺服器的中文訊息；英文版依錯誤碼換成英文，房號沿用', () => {
    expect(serverError('NOT_FOUND', '找不到房間 AB12')).toBe('找不到房間 AB12');
    setLang('zh', false);
    expect(serverReason('房主離開了房間')).toBe('房主離開了房間');
    setLang('en', false);
    expect(serverError('NOT_FOUND', '找不到房間 AB12')).toBe('Room AB12 not found');
    expect(serverError('ROOM_FULL', '房間 K9Z3 已經滿了')).toBe('Room K9Z3 is already full');
    expect(serverError('OUTDATED', '遊戲已更新…')).toMatch(/^The game has been updated/);
    expect(serverError('WHATEVER', '某個新錯誤')).toBe('Something went wrong (WHATEVER)');
    expect(serverReason('房主離開了房間')).toBe('The host left the room');
    expect(serverReason('別的原因')).toBe('The room was closed');
  });
});
