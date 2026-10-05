import { describe, expect, test } from 'vitest';
import jaManifest from '../public/voice/manifest.json';
import zhManifest from '../public/voice/zh/manifest.json';
import enManifest from '../public/voice/en/manifest.json';
import tutorialManifest from '../public/voice/tutorial/manifest.json';
import tutorialEnManifest from '../public/voice/tutorial/en/manifest.json';
import tutorialEn from '../src/audio/tutorial-lines.en.json';
import tutorial from '../src/audio/tutorial-lines.json';
import en from '../src/audio/voice-lines.en.json';
import ja from '../src/audio/voice-lines.json';
import zh from '../src/audio/voice-lines.zh.json';
import { specialVoice, type VoiceId } from '../src/audio/voice';
import { TOP_SPECS } from '../src/sim/tops';

/**
 * 中文與英文語音：台詞表與日文版一一對應（同一組 id、同一個角色），音檔已生成且沒有過期，
 * 每句的播放長度（manifest 的 seconds，gen-voice 用與遊戲相同的頭尾靜音裁切量出）不超過節拍。
 */

type Manifest = Record<string, { file: string; text: string; speaker: string; voiceId: string; seconds?: number }>;
type Lines = { speakers: Record<string, { voiceId: string }>; lines: Record<string, { speaker: string; text: string }> };

const SETS: { lang: string; lines: Lines; manifest: Manifest }[] = [
  { lang: 'ja', lines: ja, manifest: jaManifest },
  { lang: 'zh', lines: zh, manifest: zhManifest },
  { lang: 'en', lines: en, manifest: enManifest },
];
/** 中文、英文音檔（只列檔名，不載入） */
const ZH_FILES = Object.keys(import.meta.glob('../public/voice/zh/*.mp3')).map((p) => p.split('/').pop());
const EN_FILES = Object.keys(import.meta.glob('../public/voice/en/*.mp3')).map((p) => p.split('/').pop());
/** 教學解說音檔：中文、英文（只列檔名，不載入） */
const TUTORIAL_FILES = Object.keys(import.meta.glob('../public/voice/tutorial/*.mp3')).map((p) => p.split('/').pop());
const TUTORIAL_EN_FILES = Object.keys(import.meta.glob('../public/voice/tutorial/en/*.mp3')).map((p) => p.split('/').pop());

/** 日文假名（平假名、片假名、長音符；中黑點「・」是中文介面也用的標點，不算） */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
/** 中日文字（漢字、假名、全形標點）：英文台詞不能有 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}・　-〿＀-￯]/u;

/** 台詞已生成而且沒有過期：manifest 記的文字與聲音和台詞表一致，音檔存在 */
function expectGenerated(lines: Lines, manifest: Manifest, files: (string | undefined)[]): void {
  for (const [id, line] of Object.entries(lines.lines)) {
    const m = manifest[id];
    expect(m, id).toBeDefined();
    expect(m.text, id).toBe(line.text);
    expect(m.voiceId, id).toBe(lines.speakers[line.speaker].voiceId);
    expect(files, id).toContain(m.file);
  }
}

/** 倒數每拍的長度（秒，game.ts 的 BEAT）：倒數的數字要在下一拍之前講完 */
const BEAT = 0.9;
/**
 * 開場介紹的上限（秒）：線上對戰的介紹時間由伺服器固定（server/src/room.ts 的 INTRO_LEAD_MS = 2.6 秒），
 * 扣掉網路延遲的餘裕後取 2.2 秒，超過會被倒數蓋掉。
 */
const INTRO_MAX = 2.2;
/** 勝負宣告後 2.7 秒、5.6 秒接著播勝利與落敗的台詞（game.ts 的 setTimeout），前一句要先講完 */
const WINNER_MAX = 2.7;
const WIN_LINE_MAX = 5.6 - 2.7;

const ids = (l: Lines) => Object.keys(l.lines).sort();

describe('中文台詞表', () => {
  test('與日文版同一組台詞 id、同一個角色', () => {
    expect(ids(zh)).toEqual(ids(ja));
    for (const id of ids(ja)) expect(zh.lines[id as VoiceId].speaker, id).toBe(ja.lines[id as VoiceId].speaker);
    expect(Object.keys(zh.speakers).sort()).toEqual(Object.keys(ja.speakers).sort());
  });

  test('全是中文：沒有假名；語氣標記用方括號（圓括號會被唸出來）', () => {
    for (const [id, line] of Object.entries(zh.lines)) {
      expect(line.text, id).not.toMatch(KANA);
      expect(line.text, id).not.toMatch(/\([a-z ]+\)/i);
      expect(line.text.replace(/\[[^\]]*\]/g, '').trim(), id).not.toBe('');
    }
  });

  test('每顆陀螺的必殺台詞喊的是畫面上的中文必殺名', () => {
    for (const sp of Object.values(TOP_SPECS)) {
      expect(zh.lines[specialVoice(sp)].text, sp.id).toContain(`必殺！${sp.special.nameZh}！`);
    }
  });
});

describe('中文音檔', () => {
  test('每句都已生成，而且是用目前的台詞與聲音生成的（改了台詞要重跑 npm run voice -- --lang zh）', () => {
    expectGenerated(zh, zhManifest, ZH_FILES);
  });
});

describe('英文台詞表', () => {
  test('與日文版同一組台詞 id、同一個角色', () => {
    expect(ids(en)).toEqual(ids(ja));
    for (const id of ids(ja)) expect(en.lines[id as VoiceId].speaker, id).toBe(ja.lines[id as VoiceId].speaker);
    expect(Object.keys(en.speakers).sort()).toEqual(Object.keys(ja.speakers).sort());
  });

  test('全是英文：沒有中日文字；語氣標記用方括號（圓括號會被唸出來）', () => {
    for (const [id, line] of Object.entries(en.lines)) {
      expect(line.text, id).not.toMatch(CJK);
      expect(line.text, id).not.toMatch(/\([a-z ]+\)/i);
      expect(line.text.replace(/\[[^\]]*\]/g, '').trim(), id).not.toBe('');
    }
  });

  test('倒數與發射和其他語言一樣喊 Three! Two! One! Go Shoot!', () => {
    expect(en.lines.countdown_3.text).toContain('Three!');
    expect(en.lines.go_shoot.text).toContain('Go Shoot!');
  });

  test('每顆陀螺的必殺台詞喊的是畫面上的英文必殺名', () => {
    for (const sp of Object.values(TOP_SPECS)) {
      expect(en.lines[specialVoice(sp)].text, sp.id).toContain(`Special move! ${sp.special.nameEn}!`);
    }
  });
});

describe('英文音檔', () => {
  test('每句都已生成，而且是用目前的台詞與聲音生成的（改了台詞要重跑 npm run voice -- --lang en）', () => {
    expectGenerated(en, enManifest, EN_FILES);
  });
});

describe('播放長度不超過節拍', () => {
  for (const { lang, manifest } of SETS) {
    const sec = (id: string) => {
      const s = manifest[id]?.seconds;
      expect(s, `${lang} ${id} 沒有記錄播放長度（跑 npm run voice${lang === 'ja' ? '' : ` -- --lang ${lang}`} 補上）`).toBeTypeOf('number');
      return s!;
    };

    test(`${lang}：倒數的數字一拍內講完`, () => {
      for (const id of ['countdown_3', 'countdown_2', 'countdown_1']) expect(sec(id), id).toBeLessThanOrEqual(BEAT);
    });

    test(`${lang}：開場介紹在倒數開始前講完`, () => {
      for (const id of ['battle_1', 'battle_2', 'battle_final', 'overtime', 'round_ready']) expect(sec(id), id).toBeLessThanOrEqual(INTRO_MAX);
    });
  }

  // 日文版的 winner_rival 量起來 2.77 秒（最後 0.07 秒是尾音留白），沿用原本的音檔，只檢查中文版與英文版
  for (const [lang, m] of [['zh', zhManifest], ['en', enManifest]] as [string, Manifest][]) {
    test(`${lang}：勝負宣告與勝利台詞在下一句之前講完`, () => {
      for (const id of ['winner_player', 'winner_rival']) expect(m[id].seconds, id).toBeLessThanOrEqual(WINNER_MAX);
      for (const id of ['p_win', 'r_win']) expect(m[id].seconds, id).toBeLessThanOrEqual(WIN_LINE_MAX);
    });
  }
});

describe('操作教學的解說語音', () => {
  test('全中文、語氣標記用方括號，每句都已生成而且沒有過期（改了台詞要重跑 npm run voice -- --lang tutorial）', () => {
    const m = tutorialManifest as Manifest;
    for (const [id, line] of Object.entries(tutorial.lines)) {
      expect(line.text, id).not.toMatch(KANA);
      expect(line.text, id).not.toMatch(/\([a-z ]+\)/i);
      expect(m[id], id).toBeDefined();
      expect(m[id].text, id).toBe(line.text);
      expect(m[id].voiceId, id).toBe(tutorial.speakers[line.speaker as keyof typeof tutorial.speakers].voiceId);
      expect(TUTORIAL_FILES, id).toContain(m[id].file);
    }
  });

  test('英文版：與中文版同一組台詞 id、全英文、語氣標記用方括號，每句都已生成而且沒有過期（改了台詞要重跑 npm run voice -- --lang tutorial-en）', () => {
    expect(Object.keys(tutorialEn.lines).sort()).toEqual(Object.keys(tutorial.lines).sort());
    for (const [id, line] of Object.entries(tutorialEn.lines)) {
      expect(line.text, id).not.toMatch(CJK);
      expect(line.text, id).not.toMatch(/\([a-z ]+\)/i);
    }
    expectGenerated(tutorialEn, tutorialEnManifest, TUTORIAL_EN_FILES);
  });
});
