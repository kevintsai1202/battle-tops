/**
 * 介面語言切換。
 * - ja：日文版（原本的日式熱血風格：日文標題與日語語音，夾帶中文說明）
 * - zh：全中文版（畫面全中文、中文語音；按鍵名稱與發射口號「Go Shoot」維持英文）
 * 起始語言：網址參數 lang 優先，其次是上次選的（localStorage），都沒有就用日文。
 * 只有兩種模式顯示不同的字才放進字串表 TEXT；本來就是中文的字直接寫在程式裡。
 * 這個模組在 import 時不碰 window／document，單元測試（Node）可以直接載入。
 */

export type Lang = 'ja' | 'zh';
export const LANGS: readonly Lang[] = ['ja', 'zh'];

/** localStorage 的鍵（與難度、場地的鍵同一個前綴） */
const STORAGE_KEY = 'battle-tops.lang';
/** <html lang> 的值：影響漢字字形（日文字形／繁體字形）與螢幕報讀 */
const HTML_LANG: Record<Lang, string> = { ja: 'ja', zh: 'zh-Hant-TW' };

/** 目前的語言 */
let current: Lang = 'ja';
/** 語言改變時要通知的對象（例如語音換一套音檔） */
const listeners = new Set<(l: Lang) => void>();

/** 兩種語言顯示不同的字串；{name} 為要代入的參數 */
export const TEXT = {
  'doc.title': { ja: 'Battle Tops', zh: '戰鬥陀螺' },
  'title.logo': { ja: 'BATTLE TOPS', zh: '戰鬥陀螺' },
  'title.sub': { ja: '爆転バトル ・ 戰鬥陀螺', zh: '爆轉對戰' },
  'title.start': { ja: 'クリックしてスタート ／ 點擊開始（CPU 對戰）', zh: '點擊開始（電腦對戰）' },
  'title.online': { ja: 'オンライン対戦 ／ 線上對戰（找朋友）', zh: '線上對戰（找朋友）' },
  'title.tutorial': { ja: 'チュートリアル ／ 操作教學', zh: '操作教學' },
  'select.title': { ja: 'チームを組め！', zh: '組成隊伍！' },
  'select.cpuTeam': { ja: 'CPU チーム', zh: '電腦隊伍' },
  'diff.easy': { ja: 'かんたん', zh: '簡單' },
  'diff.normal': { ja: 'ふつう', zh: '普通' },
  'diff.hard': { ja: 'むずかしい', zh: '困難' },
  'arrange.title': { ja: '出場順と部品', zh: '出場順序與零件' },
  'overtime.title': { ja: '延長戦！', zh: '延長賽！' },
  'overtime.sudden': { ja: 'サドンデス', zh: '驟死戰' },
  'online.title': { ja: 'オンライン対戦', zh: '線上對戰' },
  'audio.hint': { ja: '🔊 クリックで音声ON／點擊畫面開啟聲音', zh: '🔊 點擊畫面開啟聲音' },
  'launch.hintKb': {
    ja: '滑鼠按住往下拖（拉條），在「ゴー」的瞬間放手！左右拖可瞄準・SPACE：簡易發射（最高 85%）',
    zh: '滑鼠按住往下拖（拉條），在「Go Shoot」的瞬間放手！左右拖可瞄準・SPACE：簡易發射（最高 85%）',
  },
  'launch.hintTc': { ja: '手指按住往下滑（拉條），在「ゴー」的瞬間放手！左右滑可瞄準', zh: '手指按住往下滑（拉條），在「Go Shoot」的瞬間放手！左右滑可瞄準' },
  'launch.power': { ja: 'POWER', zh: '力道' },
  'launch.powerAim': { ja: 'POWER {p}%　{aim}', zh: '力道 {p}%　{aim}' },
  'hud.rpm': { ja: 'RPM', zh: '轉/分' },
  'hud.burst': { ja: 'BURST', zh: '爆裂' },
  'hud.readyKey': { ja: '必殺 READY ▶', zh: '必殺就緒 ▶' },
  'hud.ready': { ja: '必殺 READY', zh: '必殺就緒' },
  'hud.you': { ja: 'YOU ｜ {name}', zh: '你 ｜ {name}' },
  'touch.ready': { ja: '必殺 READY！點右下角的按鈕（或三指觸控）', zh: '必殺就緒！點右下角的按鈕（或三指觸控）' },
  you: { ja: 'YOU', zh: '你' },
  cpu: { ja: 'CPU', zh: '電腦' },
  vs: { ja: 'VS', zh: '對' },
  'info.battle': { ja: 'BATTLE {n}/3', zh: '第 {n}／3 戰' },
  'info.final': { ja: 'FINAL', zh: '比賽結束' },
  'banner.battle': { ja: 'BATTLE {n}', zh: '第 {n} 戰' },
  'banner.final': { ja: 'FINAL BATTLE', zh: '最終決戰' },
  'banner.overtime': { ja: 'OVERTIME', zh: '延長賽' },
  'banner.replay': { ja: '（再戦）', zh: '（重賽）' },
  // 發射的口號：台灣與日本原作一樣喊英文「Go Shoot」（全中文版唯一保留的英文遊戲用語，使用者決定）
  'banner.go': { ja: 'ゴー・シュート!!', zh: 'GO SHOOT!!' },
  'banner.shoot': { ja: 'シュート！', zh: '發射！' },
  'banner.error': { ja: 'ERROR', zh: '錯誤' },
  'banner.draw': { ja: 'DRAW', zh: '平手' },
  'banner.drawSub': { ja: '引き分け！もう一度！', zh: '平手！再比一次！' },
  'banner.spin': { ja: 'SPIN FINISH!', zh: '旋轉終結！' },
  'banner.over': { ja: 'OVER FINISH!!', zh: '場外終結！！' },
  'banner.burst': { ja: 'BURST FINISH!!', zh: '爆裂終結！！' },
  'finish.spin': { ja: 'SPIN FINISH', zh: '旋轉終結' },
  'finish.over': { ja: 'OVER FINISH', zh: '場外終結' },
  'finish.burst': { ja: 'BURST FINISH', zh: '爆裂終結' },
  'rate.perfect': { ja: 'PERFECT!!', zh: '完美！！' },
  'rate.great': { ja: 'GREAT!', zh: '很好！' },
  'rate.good': { ja: 'GOOD', zh: '不錯' },
  'rate.weak': { ja: 'WEAK…', zh: '太弱了…' },
  'rate.power': { ja: '{p}% POWER', zh: '力道 {p}%' },
  'result.win': { ja: 'YOU WIN!!', zh: '你贏了！！' },
  'result.lose': { ja: 'YOU LOSE…', zh: '你輸了…' },
  'result.retry': { ja: 'もう一度！／再來一場', zh: '再來一場！' },
} as const satisfies Record<string, Record<Lang, string>>;

export type TextKey = keyof typeof TEXT;

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
};

/** 紋章字的日文字形 → 繁體字形（中文版用） */
const EMBLEM_ZH: Record<string, string> = { 亀: '龜', 戦: '戰', 氷: '冰' };

/** 判斷字串是不是支援的語言 */
const isLang = (v: string | null): v is Lang => v === 'ja' || v === 'zh';

/** 起始語言：網址參數 lang（ja／zh）優先，其次是記錄的語言，都沒有或不認得就用日文 */
export function initialLang(search: string, stored: string | null): Lang {
  const q = new URLSearchParams(search).get('lang');
  if (isLang(q)) return q;
  return isLang(stored) ? stored : 'ja';
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

/** 讀網址參數與記錄決定起始語言並套用（進入點呼叫一次） */
export function initLang(): Lang {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  setLang(initialLang(location.search, stored), false);
  return current;
}

/** 訂閱語言改變；回傳取消訂閱的函式 */
export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 依目前語言取字，並把 {name} 換成參數 */
export function tr(key: TextKey, vars: Record<string, string | number> = {}): string {
  return TEXT[key][current].replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** 把 index.html 裡標了 data-i18n 的元素換成目前語言的字（只標在沒有子元素的葉節點上） */
export function applyStaticText(root: ParentNode): void {
  for (const e of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = e.dataset.i18n as TextKey;
    if (key in TEXT) e.textContent = tr(key);
  }
}

/** 陀螺（或必殺技）的名稱：日文版用日文名，中文版用中文名 */
export function topName(sp: { nameJa: string; nameZh: string }): string {
  return current === 'zh' ? sp.nameZh : sp.nameJa;
}

/** 必殺技名稱 */
export function specialName(sp: { special: { nameJa: string; nameZh: string } }): string {
  return topName(sp.special);
}

/** 紋章字：中文版把日文字形換成繁體字形 */
export function emblemOf(sp: { emblem: string }): string {
  return current === 'zh' ? (EMBLEM_ZH[sp.emblem] ?? sp.emblem) : sp.emblem;
}
