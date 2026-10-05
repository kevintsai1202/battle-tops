import { TEXT, type TextEntry, type TextKey } from './text';

/**
 * 介面語言切換。
 * - ja：日文版（原本的日式熱血風格：日文標題與日語語音，夾帶中文說明）
 * - zh：全中文版（畫面全中文、中文語音；按鍵名稱與發射口號「Go Shoot」維持英文）
 * - en：英文版（畫面全英文、英文語音與英文操作教學；紋章字維持日文漢字當裝飾）
 * 起始語言：網址參數 lang 優先，其次是上次選的（localStorage），都沒有就看瀏覽器語言（英文→英文版、中文→中文版、其他→日文版）。
 * 畫面文字都在字串表 src/text.ts；日文版和中文版相同的說明文字只寫中文（日文版顯示中文）。
 * 這個模組在 import 時不碰 window／document，單元測試（Node）可以直接載入。
 */

export { TEXT, type TextKey } from './text';

export type Lang = 'ja' | 'zh' | 'en';
export const LANGS: readonly Lang[] = ['ja', 'zh', 'en'];

/** localStorage 的鍵（與難度、場地的鍵同一個前綴） */
const STORAGE_KEY = 'battle-tops.lang';
/** <html lang> 的值：影響漢字字形（日文字形／繁體字形）、斷字與螢幕報讀 */
const HTML_LANG: Record<Lang, string> = { ja: 'ja', zh: 'zh-Hant-TW', en: 'en' };

/** 目前的語言 */
let current: Lang = 'ja';
/** 語言改變時要通知的對象（例如語音換一套音檔） */
const listeners = new Set<(l: Lang) => void>();

/** 撞擊時跳出的擬聲字：一般撞擊與大力撞擊 */
export const CLASH_WORDS: Record<Lang, { small: string[]; big: string[] }> = {
  ja: {
    small: ['ガキィン！', 'ドガッ！', 'バキィッ！', 'ガガッ！', 'ズガッ！'],
    big: ['ドゴォォン！！', 'ズガァァン！！', 'ドガガガッ！！', 'バゴォォン！！'],
  },
  zh: {
    small: ['鏘！', '砰！', '喀啦！', '鏗！', '碰！'],
    big: ['轟隆——！！', '碰——！！', '轟轟轟！！', '砰隆！！'],
  },
  en: {
    small: ['CLANG!', 'BAM!', 'CRACK!', 'CLASH!', 'WHAM!'],
    big: ['KA-BOOM!!', 'CRAAASH!!', 'BOOM-BOOM!!', 'KA-POW!!'],
  },
};

/** 紋章字的日文字形 → 繁體字形（中文版用） */
const EMBLEM_ZH: Record<string, string> = { 亀: '龜', 戦: '戰', 氷: '冰' };

/** 判斷字串是不是支援的語言 */
const isLang = (v: string | null): v is Lang => v === 'ja' || v === 'zh' || v === 'en';

/**
 * 瀏覽器偏好的語言（navigator.languages 的第一個）對應的版本：英文 → 英文版、中文 → 中文版、日文與其他 → 日文版。
 * 沒有資料時用日文版。
 */
export function browserLang(prefs: readonly string[]): Lang {
  const first = (prefs[0] ?? '').toLowerCase();
  if (first.startsWith('en')) return 'en';
  if (first.startsWith('zh')) return 'zh';
  return 'ja';
}

/** 起始語言：網址參數 lang（ja／zh／en）優先，其次是記錄的語言，都沒有或不認得就依瀏覽器語言 */
export function initialLang(search: string, stored: string | null, browser: readonly string[] = []): Lang {
  const q = new URLSearchParams(search).get('lang');
  if (isLang(q)) return q;
  return isLang(stored) ? stored : browserLang(browser);
}

/** 目前的語言 */
export function lang(): Lang {
  return current;
}

/**
 * 切換語言：更新 <html lang>、頁面標題與 index.html 裡標了 data-i18n 的字，並通知訂閱者。
 * persist 為 true 時記住選擇（下次打開沿用）；網址參數指定的語言不記錄。
 * 沒有 DOM 或 localStorage（單元測試、隱私模式）時略過那些步驟。
 */
export function setLang(l: Lang, persist = true): void {
  const changed = l !== current;
  current = l;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // 沒有 localStorage（Node、封鎖網站資料）：只在這次有效
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = HTML_LANG[l];
    document.title = tr('doc.title');
    applyStaticText(document);
  }
  if (changed) for (const fn of listeners) fn(l);
}

/** 讀網址參數、記錄與瀏覽器語言決定起始語言並套用（進入點呼叫一次） */
export function initLang(): Lang {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language ?? ''];
  setLang(initialLang(location.search, stored, prefs), false);
  return current;
}

/** 訂閱語言改變；回傳取消訂閱的函式 */
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 依目前語言取字（日文版沒有另外寫的用中文），並把 {name} 換成參數 */
export function tr(key: TextKey, vars: Record<string, string | number> = {}): string {
  const e: TextEntry = TEXT[key];
  const s = e[current] ?? e.zh;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * 把 index.html 裡標了語言鍵的元素換成目前語言的字（只標在沒有子元素的葉節點上）：
 * data-i18n 換文字、data-i18n-aria 換 aria-label、data-i18n-ph 換 placeholder。
 */
export function applyStaticText(root: ParentNode): void {
  const set = (attr: string, apply: (e: HTMLElement, s: string) => void) => {
    for (const e of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const key = e.getAttribute(attr) as TextKey;
      if (key in TEXT) apply(e, tr(key));
    }
  };
  set('data-i18n', (e, s) => (e.textContent = s));
  set('data-i18n-aria', (e, s) => e.setAttribute('aria-label', s));
  set('data-i18n-ph', (e, s) => e.setAttribute('placeholder', s));
}

/** 英文版用 en，日文版與中文版用 zh（日文版的說明文字本來就是中文） */
export function zhOrEn<T>(zh: T, en: T): T {
  return current === 'en' ? en : zh;
}

/** 陀螺（或必殺技）的名稱：日文版用日文名，中文版用中文名，英文版用英文名 */
export function topName(sp: { nameJa: string; nameZh: string; nameEn: string }): string {
  return current === 'zh' ? sp.nameZh : current === 'en' ? sp.nameEn : sp.nameJa;
}

/** 必殺技名稱 */
export function specialName(sp: { special: { nameJa: string; nameZh: string; nameEn: string } }): string {
  return topName(sp.special);
}

/**
 * 說明文字裡的名稱（陀螺、場地、零件）：英文版用英文名，日文版與中文版用中文名
 * （日文版的名鑑、場地按鈕、零件清單本來就是中文）。
 */
export function plainName(x: { nameZh: string; nameEn: string }): string {
  return zhOrEn(x.nameZh, x.nameEn);
}

/** 說明（必殺技、場地、零件）：英文版用英文，日文版與中文版用中文 */
export function descOf(x: { descZh: string; descEn: string }): string {
  return zhOrEn(x.descZh, x.descEn);
}

/** 難度名稱（結果畫面等說明文字）：英文版用英文，日文版與中文版用中文 */
export function diffLabel(d: { labelZh: string; labelEn: string }): string {
  return zhOrEn(d.labelZh, d.labelEn);
}

/** 原型陀螺的寫法：英文版不帶中文暱稱 */
export function originOf(sp: { origin: string | null; originEn: string | null }): string | null {
  return zhOrEn(sp.origin, sp.originEn);
}

/** 紋章字：中文版把日文字形換成繁體字形；日文版與英文版用日文字形 */
export function emblemOf(sp: { emblem: string }): string {
  return current === 'zh' ? (EMBLEM_ZH[sp.emblem] ?? sp.emblem) : sp.emblem;
}

/**
 * 伺服器送來的錯誤訊息：英文版依錯誤碼換成英文（伺服器只送中文），其他語言照用伺服器的字。
 * 訊息裡的房號（4 碼英數）沿用到英文句子裡。
 */
export function serverError(code: string, message: string): string {
  if (current !== 'en') return message;
  const key = `srv.${code}` as TextKey;
  if (!(key in TEXT)) return tr('srv.unknown', { code });
  return tr(key, { code: /[A-Z0-9]{4}/.exec(message)?.[0] ?? '' });
}

/** 伺服器關閉房間的原因：英文版把已知的原因換成英文 */
export function serverReason(reason: string): string {
  if (current !== 'en') return reason;
  return reason === TEXT['srv.hostLeft'].zh ? tr('srv.hostLeft') : tr('srv.closed');
}
