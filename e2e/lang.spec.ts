import { devices, expect, test, type Page } from '@playwright/test';
import { expectInViewport, expectNoHorizontalScroll } from './mobile.helpers';
import { confirmArrange, pickTeam, pickTops } from './team.helpers';

/**
 * 語言切換（日文版／全中文版）：
 * 1. 桌機：標題畫面切到中文（不會開始遊戲），重新整理後仍是中文；組隊兩步、發射、延長賽、對戰、終結、結果畫面全中文：
 *    整段過程畫面上出現過的文字（含一閃即逝的橫幅、擬聲字、必殺 cut-in）都沒有日文假名，對戰相關的字也沒有英文（按鍵名稱除外）；
 *    語音只載入 voice/zh/ 的 48 句中文音檔，播出的是中文語音。
 * 2. 桌機：語音已經開始用之後（進過線上房間）在標題畫面切換，語音跟著換語言；切回日文後畫面還原成日文版並記住。
 * 3. 手機橫向、直向：切換鈕在畫面內、觸控切換；組隊兩步全中文且不超出畫面。
 */

/** 日文假名（平假名、片假名、長音符；中黑點「・」是中文介面也用的標點，不算） */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
/** 中文版允許出現的英文：鍵盤按鍵名稱 */
const KEY_NAMES = /\b(SPACE|Space|Shift|WASD|Enter|Backspace|Esc|Q|E|M|GO SHOOT|Go Shoot)\b/g;
/** 檢查英文字的區塊：對戰中的大字、HUD、擬聲字、必殺 cut-in、發射台、延長賽、結果畫面 */
const BATTLE_AREAS = ['banner', 'hud', 'fx-layer', 'cutin', 'launch', 'overtime', 'result'];
/** 線上對戰預設連本機伺服器；對線上網址跑時用環境變數 GAME_SERVER 指定（與 online.spec 相同） */
const SERVER = process.env.GAME_SERVER ?? 'ws://localhost:8787/ws';

type Dbg = {
  state: string;
  lang: string;
  voice: { mode: string; lang: string; loaded: number; played: number; last: string | null };
};
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): Dbg } }).__game.debug());

/** 手機裝置設定（去掉 defaultBrowserType 才能在 describe 裡用 test.use） */
const phone = (name: string) => {
  const { defaultBrowserType: _, ...rest } = devices[name];
  return rest;
};

/**
 * 記錄頁面上出現過的每一段文字與它所在的區塊（最近的有 id 的祖先），含一閃即逝的元素。
 * 頁面一載入就開始記；clearTexts 之後重新累計。
 */
async function recordTexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __texts: Set<string> };
    w.__texts = new Set();
    const grab = (n: Node) => {
      const t = n.textContent?.trim();
      if (!t) return;
      const host = (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest('[id]');
      w.__texts.add(`${host?.id ?? ''}\t${t}`);
    };
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === 'characterData') grab(m.target);
        else m.addedNodes.forEach(grab);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

const clearTexts = (page: Page) => page.evaluate(() => (window as unknown as { __texts: Set<string> }).__texts.clear());

/** 讀出記錄的文字：[區塊 id, 文字] */
async function recordedTexts(page: Page): Promise<[string, string][]> {
  const rows = await page.evaluate(() => [...(window as unknown as { __texts: Set<string> }).__texts]);
  return rows.map((r) => r.split('\t', 2) as [string, string]);
}

/** 目前畫面上看得到的文字沒有假名 */
async function expectNoKanaVisible(page: Page, where: string): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const bad = text.split('\n').filter((l) => KANA.test(l));
  expect(bad, `${where}：畫面上還有日文`).toEqual([]);
}

/**
 * 標題畫面的語言切換鈕：整個在畫面內、不蓋到大標題的字，而且兩個按鈕的中心點真的點得到
 * （大標題換行時元素框橫跨整個畫面，又有 transform，切換鈕沒有疊在上層時點擊會被標題吃掉）。
 * 標題的字用 Range.getClientRects 量每一行文字的範圍，不用元素框。
 */
async function expectSwitchClickable(page: Page): Promise<void> {
  await expectInViewport(page, '#title .lang-switch');
  const sw = (await page.locator('#title .lang-switch').boundingBox())!;
  const lines = await page.locator('#title h1').evaluate((h) => {
    const r = document.createRange();
    r.selectNodeContents(h);
    return [...r.getClientRects()].map((c) => ({ x: c.x, y: c.y, width: c.width, height: c.height }));
  });
  for (const t of lines) {
    const apart = sw.x + sw.width <= t.x || t.x + t.width <= sw.x || sw.y + sw.height <= t.y || t.y + t.height <= sw.y;
    expect(apart, `切換鈕 ${JSON.stringify(sw)} 蓋到標題的字 ${JSON.stringify(t)}`).toBe(true);
  }
  for (const l of ['ja', 'zh']) {
    const hit = await page.locator(`#title .lang-switch [data-lang="${l}"]`).evaluate((b) => {
      const r = b.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b;
    });
    expect(hit, `${l} 按鈕被其他元素蓋住`).toBe(true);
  }
}

/** 收集頁面錯誤，測試最後斷言為空 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

test('桌機：切到中文並記住；組隊、發射、延長賽、對戰到結果畫面全中文，播的是中文語音', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = watchErrors(page);
  /** 下載過的語音檔路徑 */
  const voiceFiles: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.endsWith('.mp3')) voiceFiles.push(p);
  });
  await recordTexts(page);

  // 預設日文
  await page.goto('./?seed=51');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#title h1')).toHaveText('BATTLE TOPS');
  await expect(page.locator('#title .lang-switch [data-lang="ja"]')).toHaveAttribute('aria-pressed', 'true');
  await expectSwitchClickable(page);

  // 切到中文：標題換字，但不會開始遊戲
  await page.locator('#title .lang-switch [data-lang="zh"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant-TW');
  await expect(page.locator('#title h1')).toHaveText('戰鬥陀螺');
  await expect(page.locator('#title .blink')).toHaveText('點擊開始（電腦對戰）');
  await expect(page.locator('#title .to-online')).toHaveText('線上對戰（找朋友）');
  await expect(page).toHaveTitle('戰鬥陀螺');
  await expect(page.locator('#title')).toBeVisible();
  await expect(page.locator('#select')).toBeHidden();
  await page.screenshot({ path: 'e2e/screenshots/90-lang-title-zh.png' });

  // 重新整理後仍是中文
  await page.reload();
  await expect(page.locator('#title h1')).toHaveText('戰鬥陀螺');
  await expect(page.locator('#title .lang-switch [data-lang="zh"]')).toHaveAttribute('aria-pressed', 'true');
  await expectNoKanaVisible(page, '標題畫面');
  await clearTexts(page);

  // 組隊第 1 步
  await page.locator('#title .blink').click();
  await expect(page.locator('#select')).toBeVisible();
  await expect(page.locator('#select h2 > span')).toHaveText('組成隊伍！');
  await expect(page.locator('#select .difficulty button[data-id="easy"]')).toHaveText('簡單', { useInnerText: true });
  await expect(page.locator('#select .cpu-team .ct-label')).toHaveText('電腦隊伍');
  await page.locator('#select .card[data-id="blaze"]').hover();
  await expect(page.locator('#select .detail .d-ja')).toHaveText('烈焰龍');
  await expect(page.locator('#select .detail .d-zh')).toBeHidden();
  await expect(page.locator('#select .detail .d-sp')).toHaveText('必殺：烈龍衝擊');
  await expect(page.locator('#select .card.tile[data-id="turtle"] .emb')).toHaveText('龜');
  await expectNoKanaVisible(page, '組隊第 1 步');
  await page.screenshot({ path: 'e2e/screenshots/91-lang-select-zh.png' });

  // 組隊第 2 步
  await pickTops(page, ['blaze', 'turtle', 'gale']);
  await expect(page.locator('#arrange h2 > span')).toHaveText('出場順序與零件');
  await expect(page.locator('#arrange .ar-opp-label')).toHaveText('電腦隊伍');
  await expectNoKanaVisible(page, '組隊第 2 步');
  await page.screenshot({ path: 'e2e/screenshots/92-lang-arrange-zh.png' });
  await confirmArrange(page);

  // 對戰 HUD（開場介紹中）
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#hud .info')).toHaveText('第 1／3 戰・練習場');
  await expect(page.locator('#hud .panel[data-side="0"] .name')).toHaveText('你 ｜ 烈焰龍');
  await expect(page.locator('#hud .panel[data-side="1"] .name')).toHaveText(/ ｜ 電腦$/);
  await expect(page.locator('#hud .panel[data-side="0"] .label').first()).toHaveText('爆裂');
  await expect(page.locator('#hud .panel[data-side="0"] .rpm')).toHaveText(/轉\/分$/);
  await expect(page.locator('#hud .lineup em')).toHaveText('對');
  await expect(page.locator('#banner .bn')).toHaveText('第 1 戰');
  await page.waitForFunction(() => (window as any).__game.debug().state === 'launch');

  // 延長賽（用除錯鉤子直接進入三戰平手）：一顆定勝負，打完就到結果畫面
  await page.evaluate(() => (window as any).__game.debugForceOvertime());
  await expect(page.locator('#overtime')).toBeVisible();
  await expect(page.locator('#overtime h2 > span')).toHaveText('延長賽！');
  await expect(page.locator('#overtime h2 small')).toContainText('驟死戰');
  await expect(page.locator('#overtime .card').first().locator('.ja')).toHaveText('烈焰龍');
  await expect(page.locator('#overtime .card').first().locator('.zh')).toBeHidden();
  await expect(page.locator('#overtime .card').first().locator('.sp')).toHaveText('必殺：烈龍衝擊');
  await expectNoKanaVisible(page, '延長賽選擇');
  await page.screenshot({ path: 'e2e/screenshots/93-lang-overtime-zh.png' });
  await page.locator('#overtime .card').first().click();

  // 倒數到「GO SHOOT!!」時按 Space（中文版照台灣與日本原作的習慣喊英文）
  await page.locator('#banner .bn', { hasText: 'GO SHOOT' }).waitFor({ timeout: 45_000 });
  await expect(page.locator('#launch .hint .kb')).toContainText('在「Go Shoot」的瞬間放手');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window as any).__game.debug().state === 'battle', null, { timeout: 10_000 });
  await expect(page.locator('#banner .bn-sub')).toContainText('力道');
  await page.screenshot({ path: 'e2e/screenshots/94-lang-battle-zh.png' });

  // 打到結果畫面（headless 軟體渲染一回合要 2～3 分鐘；平手會重賽）
  await page.waitForFunction(() => (window as any).__game.debug().state === 'result', null, { timeout: 480_000, polling: 500 });
  await expect(page.locator('#result .headline')).toHaveText(/^(你贏了！！|你輸了…)$/);
  await expect(page.locator('#result .breakdown li')).toHaveCount(4);
  for (const li of await page.locator('#result .breakdown li').allTextContents()) {
    expect(li).toMatch(/^(第 \d 戰|延長賽)　\S+ 對 \S+　(旋轉|場外|爆裂)終結　(你|電腦) \+\d$/);
  }
  await expect(page.locator('#result .retry')).toHaveText('再來一場！');
  await expectNoKanaVisible(page, '結果畫面');
  await page.screenshot({ path: 'e2e/screenshots/95-lang-result-zh.png' });

  // 整段過程出現過的文字：沒有假名；對戰相關的區塊沒有英文（按鍵名稱除外）
  const texts = await recordedTexts(page);
  expect(texts.length).toBeGreaterThan(50);
  expect(texts.filter(([, t]) => KANA.test(t))).toEqual([]);
  expect(texts.filter(([id, t]) => BATTLE_AREAS.includes(id) && /[A-Za-z]/.test(t.replace(KEY_NAMES, '')))).toEqual([]);
  // 終結的大字是中文
  expect(texts.some(([id, t]) => id === 'banner' && /^(旋轉|場外|爆裂)終結！/.test(t))).toBe(true);

  // 語音：只載入中文的 48 句，播出開場、倒數、發射、終結與勝負宣告
  await expect.poll(async () => (await dbg(page)).voice.played, { timeout: 10_000 }).toBeGreaterThanOrEqual(7);
  const d = await dbg(page);
  expect(d.voice).toMatchObject({ lang: 'zh', mode: 'fish-files', loaded: 48 });
  expect(voiceFiles.filter((p) => p.includes('/voice/zh/')).length).toBe(48);
  expect(voiceFiles.filter((p) => !p.includes('/voice/zh/'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('桌機：語音開始用之後在標題切換，語音跟著換；切回日文後畫面還原並記住', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto(`./?seed=56&server=${encodeURIComponent(SERVER)}`);

  // 先進線上房間再回標題：音訊與日語語音已經載入
  await page.locator('#title .to-online').click();
  await expect(page.locator('#online')).toBeVisible();
  await expect(page.locator('#online h2 > span')).toHaveText('オンライン対戦');
  await expect.poll(async () => (await dbg(page)).voice, { timeout: 30_000 }).toMatchObject({ lang: 'ja', mode: 'fish-files', loaded: 48 });
  await page.locator('#online .ol-back').click();
  await expect(page.locator('#title')).toBeVisible();

  // 切到中文：語音換成中文並在背景載入
  await page.locator('#title .lang-switch [data-lang="zh"]').click();
  await expect.poll(async () => (await dbg(page)).voice, { timeout: 30_000 }).toMatchObject({ lang: 'zh', mode: 'fish-files', loaded: 48 });
  await page.locator('#title .to-online').click();
  await expect(page.locator('#online h2 > span')).toHaveText('線上對戰');
  await page.locator('#online .ol-back').click();

  // 切回日文：語音換回日文（已經載過，立刻可用），畫面恢復日文版
  await page.locator('#title .lang-switch [data-lang="ja"]').click();
  expect((await dbg(page)).voice).toMatchObject({ lang: 'ja', mode: 'fish-files', loaded: 48 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('#title h1')).toHaveText('BATTLE TOPS');
  await expect(page.locator('#title .blink')).toHaveText('クリックしてスタート ／ 點擊開始（CPU 對戰）');

  // 重新整理後仍是日文；組隊畫面是原本的日文版（難度下方附中文）
  await page.reload();
  await expect(page.locator('#title h1')).toHaveText('BATTLE TOPS');
  await page.locator('#title .blink').click();
  await expect(page.locator('#select h2 > span')).toHaveText('チームを組め！');
  await expect(page.locator('#select .difficulty button[data-id="easy"]')).toHaveText('かんたん簡單', { useInnerText: false });
  await expect(page.locator('#select .difficulty button[data-id="easy"] small')).toBeVisible();
  await expect(page.locator('#select .cpu-team .ct-label')).toHaveText('CPU チーム');
  await page.locator('#select .card[data-id="blaze"]').hover();
  await expect(page.locator('#select .detail .d-ja')).toHaveText('ブレイズ・ドラゴン');
  await expect(page.locator('#select .detail .d-zh')).toHaveText('烈焰龍');
  await expect(page.locator('#select .card.tile[data-id="turtle"] .emb')).toHaveText('亀');
  await pickTeam(page, ['blaze', 'turtle', 'gale']);
  await expect(page.locator('#hud .panel[data-side="0"] .name')).toHaveText('YOU ｜ ブレイズ・ドラゴン');
  await expect(page.locator('#hud .info')).toHaveText('BATTLE 1/3・練習場');
  expect(errors).toEqual([]);
});

test.describe('手機橫向', () => {
  test.use(phone('Pixel 7 landscape'));
  test('切換鈕在畫面內、觸控切到中文；組隊兩步全中文且不超出畫面', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    await page.goto('./?seed=57');
    await page.screenshot({ path: 'e2e/screenshots/96a-lang-mobile-title-ja.png' });
    await expectSwitchClickable(page);
    await page.locator('#title .lang-switch [data-lang="zh"]').tap();
    await expect(page.locator('#title h1')).toHaveText('戰鬥陀螺');
    await expect(page.locator('#select')).toBeHidden();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: 'e2e/screenshots/96-lang-mobile-title.png' });

    await page.locator('#title .blink').tap();
    await expect(page.locator('#select')).toBeVisible();
    await expectNoKanaVisible(page, '手機組隊第 1 步');
    await expectInViewport(page, '#select .go');
    await pickTops(page, ['orion', 'blaze', 'turtle'], true);
    await expect(page.locator('#arrange')).toBeVisible();
    for (const sel of ['#arrange .ar-slots', '#arrange .ar-ready', '#arrange .ar-opp']) await expectInViewport(page, sel);
    await expectNoHorizontalScroll(page);
    await expectNoKanaVisible(page, '手機組隊第 2 步');
    await page.screenshot({ path: 'e2e/screenshots/97-lang-mobile-arrange.png' });
    await confirmArrange(page, true);

    await expect(page.locator('#hud .panel[data-side="0"] .name')).toHaveText('你 ｜ 幻星獵戶');
    await expect(page.locator('#launch .hint .tc')).toHaveText('手指按住往下滑（拉條），在「Go Shoot」的瞬間放手！左右滑可瞄準');
    await expectNoKanaVisible(page, '手機對戰畫面');
    await page.screenshot({ path: 'e2e/screenshots/98-lang-mobile-hud.png' });
    expect(errors).toEqual([]);
  });
});

test.describe('手機直向', () => {
  test.use(phone('Pixel 7'));
  test('切換鈕在畫面內、不蓋到標題', async ({ page }) => {
    await page.goto('./?seed=58');
    await page.locator('#title .lang-switch [data-lang="zh"]').tap();
    await expect(page.locator('#title h1')).toHaveText('戰鬥陀螺');
    await expectSwitchClickable(page);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: 'e2e/screenshots/99-lang-portrait-title.png' });
  });
});
