import { describe, expect, test } from 'vitest';

/**
 * 畫面文字都要放在字串表（src/text.ts），不能寫死在介面程式裡：寫死的中文在英文版會原樣出現。
 * 掃描會顯示文字的程式（介面、遊戲流程、教學、繪圖、進入點、語音），註解以外出現中日文字就失敗。
 * 例外：例外訊息（new Error）與 console 只給開發者看；示範用假人陀螺的中文名與紋章是資料。
 */

/** 要掃描的原始碼（檔名 → 內容） */
const SOURCES = import.meta.glob(
  ['../src/ui/*.ts', '../src/game/*.ts', '../src/tutorial/*.ts', '../src/render/*.ts', '../src/director/*.ts', '../src/audio/*.ts', '../src/main.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** 中日文字：漢字、假名、中黑點、全形標點與全形字 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}・　-〿＀-￯]/u;

/** 允許的行：開發者訊息、示範假人陀螺的資料 */
const ALLOWED = [/new Error\(/, /console\.\w+\(/, /^\s*(nameZh|emblem): '/];

/** 去掉註解（區塊註解與行尾註解；字串裡的「://」不算註解），保留行數 */
function stripComments(src: string): string[] {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
  return noBlocks.split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/.*$/, ''));
}

describe('介面程式沒有寫死的中日文字', () => {
  test('有掃到檔案', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(15);
  });

  for (const [file, src] of Object.entries(SOURCES)) {
    test(file.replace('../', ''), () => {
      const bad = stripComments(src)
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => CJK.test(line) && !ALLOWED.some((re) => re.test(line)))
        .map(({ line, n }) => `${n}: ${line.trim()}`);
      expect(bad, '畫面文字請放進 src/text.ts 再用 tr() 取').toEqual([]);
    });
  }
});

/**
 * 直接讀中文欄位（nameZh、descZh、labelZh）的話，英文版會顯示中文：名稱與說明要用 src/i18n.ts 的 topName、plainName、descOf、diffLabel。
 * 例外：日文版專用的中文小註解（ja-only、詳細資料的中文名、日文必殺名後面附的中文名）。
 */
const ZH_FIELD = /\.(nameZh|descZh|labelZh)\b/;
const ZH_FIELD_ALLOWED = [/ja-only/, /this\.zh\.textContent/, /card\.specialWithZh/];

describe('介面程式不直接讀中文欄位', () => {
  for (const [file, src] of Object.entries(SOURCES)) {
    test(file.replace('../', ''), () => {
      const bad = stripComments(src)
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => ZH_FIELD.test(line) && !ZH_FIELD_ALLOWED.some((re) => re.test(line)))
        .map(({ line, n }) => `${n}: ${line.trim()}`);
      expect(bad, '名稱與說明請用 topName／plainName／descOf／diffLabel').toEqual([]);
    });
  }
});
