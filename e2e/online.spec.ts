import { expect as baseExpect, devices, test, type Browser, type BrowserContextOptions, type BrowserType, type LaunchOptions, type Page } from '@playwright/test';
import { Bot } from '../server/tests/bot';
import { expectInViewport } from './mobile.helpers';

/** 兩個瀏覽器同時軟體算圖時每個只有約 5 fps，跨客戶端的畫面更新要等比較久：預設等 30 秒 */
const expect = baseExpect.configure({ timeout: 30_000 });

/**
 * 線上對戰（兩個瀏覽器對本機伺服器 ws://localhost:8787，playwright.config.ts 會一起啟動；設 GAME_SERVER 可改連線上伺服器）：
 * 建房 → 分享連結加入 → 雙方組隊（客人不能改場地）→ 開打後推移、Shift 衝刺、必殺都經伺服器傳到對方 →
 * 斷線自動重連 → 第 2 戰座位交換 → 打到結果（雙方勝負相反）→ 再來一場回到組隊 → 離開。
 * headless 軟體算圖很慢、CDP 事件間隔大，發射一律讓它自動發射（不驗發射力道）；
 * 衝刺與必殺要在對戰階段才能驗，這一戰先結束的話下一戰再試，最後一定要驗到。
 * 第二個測試：房間列表（不公開的不列、對戰中灰色不能點、點一下加入、快速加入），B 用手機橫向。
 */

const SERVER = process.env.GAME_SERVER ?? 'ws://localhost:8787/ws';

type OnlineDbg = {
  state: string;
  me: 0 | 1;
  match: { battle: number | null } | null;
  counters: { specials: number; rounds: number; dashes: number };
  tops: { control: { x: number; z: number }; special: number; specialUsed: boolean; alive: boolean }[];
  online: {
    code: string | null;
    host: boolean;
    status: string;
    predictor: boolean;
    paused: boolean;
    phase: string | null;
    opponent: string | null;
    public: boolean;
    browsing: boolean;
    roomsSeen: number;
    rooms: { code: string; host: string; status: 'waiting' | 'playing' }[];
  } | null;
};
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): OnlineDbg } }).__game.debug());

/** 這個測試開的瀏覽器、兩位玩家的頁面（失敗時印狀態）與機器人；每個測試結束就關掉 */
const browsers: Browser[] = [];
const players: { label: string; page: Page }[] = [];
const bots: Bot[] = [];

/** 手機裝置設定（去掉 defaultBrowserType，才能套在自己開的 context 上） */
function phone(name: string): BrowserContextOptions {
  const { defaultBrowserType: _, ...rest } = devices[name];
  return rest;
}

/**
 * 開一個玩家：各自啟動一個瀏覽器（像兩台電腦）。
 * 不用同一個瀏覽器的兩個 context：它們共用軟體 WebGL 的 GPU 行程，一邊在算圖時，另一邊初始化 WebGL 的同步呼叫要排隊，
 * 實測後開的頁面主執行緒卡住超過 30 秒（連 #title 都查不到）。
 */
async function newPlayer(
  label: string,
  browserType: BrowserType,
  launchOptions: LaunchOptions,
  baseURL: string | undefined,
  device: BrowserContextOptions = { viewport: { width: 1280, height: 720 } },
): Promise<Page> {
  const browser = await browserType.launch(launchOptions);
  browsers.push(browser);
  // 裝置像素比 0.5 讓畫布只算四分之一的像素（版面不變）：實測兩個瀏覽器同時開時各約 1.3 fps → 5 fps
  // （scripts/net-eval/two-browsers-perf.spec.ts）；截圖也會縮小
  const ctx = await browser.newContext({ ...device, baseURL, deviceScaleFactor: 0.5 });
  const page = await ctx.newPage();
  players.push({ label, page });
  // 頁面的警告與錯誤印到測試輸出（標上是哪一位玩家）
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${label} ${m.type()}] ${m.text()}`);
  });
  // 單一步驟最多等 30 秒（對戰本身較久的等待另外指定），失敗時不會空等到整個測試逾時；
  // 開頁面要等語音、貼圖都載完，機器忙時比較久，所以導覽放寬到 2 分鐘
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  (page as unknown as { errors: string[] }).errors = errors;
  return page;
}

/** 印出目前進度與經過秒數（失敗時看得出卡在哪一步、每步花多久） */
const t0 = Date.now();
function step(label: string): void {
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);
}

/** 失敗時印出兩位玩家的畫面狀態（在哪個畫面、連線狀態、房間畫面的提示、覆蓋層文字）；之後關掉這個測試的瀏覽器與機器人 */
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) await dumpPlayers();
  for (const bot of bots.splice(0)) bot.close();
  for (const b of browsers.splice(0)) await b.close().catch(() => undefined);
  players.splice(0);
});

/** 印出每位玩家的畫面狀態 */
async function dumpPlayers(): Promise<void> {
  for (const { label, page } of players) {
    const st = await page
      .evaluate(() => {
        const g = (window as unknown as { __game: { debug(): OnlineDbg } }).__game;
        const text = (sel: string) => document.querySelector(sel)?.textContent ?? null;
        const d = g.debug();
        return {
          state: d.state,
          online: d.online,
          olMsg: text('#online .ol-msg'),
          olStatus: text('#online .ol-status'),
          overlay: (document.querySelector('#net-overlay') as HTMLElement).hidden ? null : text('#net-overlay .no-text'),
        };
      })
      .catch((e: unknown) => `讀不到狀態：${String(e)}`);
    console.log(`[${label} 失敗時狀態] ${JSON.stringify(st)}`);
  }
}

/** 組隊並出陣 */
async function pickTeam(page: Page, ids: string[]): Promise<void> {
  await expect(page.locator('#select')).toBeVisible({ timeout: 30_000 });
  for (const id of ids) await page.locator(`#select .card[data-id="${id}"]`).click();
  await page.locator('#select .go').click();
}

test('線上對戰：兩個分頁建房、加入、組隊、對戰、斷線重連、結果與再來一場', async ({ playwright, browserName, launchOptions, baseURL }) => {
  const browserType = playwright[browserName];
  test.setTimeout(900_000);
  const a = await newPlayer('A', browserType, launchOptions, baseURL);
  const b = await newPlayer('B', browserType, launchOptions, baseURL);
  step('兩個瀏覽器已開');

  // A 建房
  await a.goto(`./?seed=1&server=${encodeURIComponent(SERVER)}`);
  await a.locator('#title .to-online').click();
  await expect(a.locator('#online')).toBeVisible();
  await a.locator('#online .ol-name input').fill('Alice');
  await a.locator('#online .ol-create').click();
  await expect(a.locator('#online .ol-code-big')).toHaveText(/^[A-Z2-9]{4}$/, { timeout: 30_000 });
  const code = (await a.locator('#online .ol-code-big').textContent())!;
  const link = await a.locator('#online .ol-link').inputValue();
  expect(link).toContain(`room=${code}`);
  await a.screenshot({ path: 'e2e/screenshots/80-online-room.png' });
  step(`A 建房 ${code}`);

  // B 開分享連結加入（點標題任意處就進線上、房號已帶入）
  await b.goto(link);
  step('B 開好分享連結');
  await b.locator('#title').click();
  await expect(b.locator('#online .ol-code')).toHaveValue(code);
  await b.locator('#online .ol-name input').fill('Bob');
  await b.locator('#online .ol-join-btn').click();
  step('B 按加入');

  // 雙方進入組隊：A 看到對手 Bob，B 的場地按鈕不能按（只顯示房主的選擇）
  await expect(a.locator('#select')).toBeVisible({ timeout: 60_000 });
  await expect(a.locator('#select .cpu-team .ct-label')).toHaveText('對手：Bob');
  await expect(b.locator('#select .cpu-team .ct-label')).toHaveText('對手：Alice');
  await expect(b.locator('#select .difficulty')).toBeHidden();
  await expect(b.locator('#select .arena button').first()).toBeDisabled();
  await a.locator('#select .arena button[data-id="stadium"]').click();
  await expect(b.locator('#select .arena button.on')).toHaveAttribute('data-id', 'stadium');
  await pickTeam(a, ['blaze', 'turtle', 'gale']);
  await expect(b.locator('#select .cpu-team small')).toHaveText('已完成組隊');
  await expect(a.locator('#net-overlay')).toBeVisible();
  await b.screenshot({ path: 'e2e/screenshots/81-online-select.png' });
  await pickTeam(b, ['wolf', 'orion', 'pegasus']);
  step('雙方出陣');

  // 第 1 戰：雙方都進入倒數，座位相反（房主 0 號）
  await expect.poll(async () => (await dbg(a)).state, { timeout: 30_000 }).toMatch(/launch|battle/);
  const a1 = await dbg(a);
  const b1 = await dbg(b);
  expect(a1.me).toBe(0);
  expect(b1.me).toBe(1);
  expect(a1.online?.opponent).toBe('Bob');
  step('第 1 戰倒數');

  // 自動發射後開打（雙方都有預測）
  await expect.poll(async () => (await dbg(a)).state, { timeout: 60_000 }).toBe('battle');
  await expect.poll(async () => (await dbg(b)).online?.predictor, { timeout: 30_000 }).toBe(true);
  step('開打');

  /** 等 A 進入第 n 戰（或之後）的對戰階段 */
  const waitBattle = async (n: number) => {
    await expect
      .poll(async () => {
        const d = await dbg(a);
        return (d.match?.battle ?? 0) >= n && d.state === 'battle';
      }, { timeout: 240_000 })
      .toBe(true);
  };
  /** 試著衝刺一次（按住 W 再按 Shift）：B 收到伺服器轉來的衝刺事件就算成功；這一戰先結束回傳 false */
  const tryDash = async () => {
    const before = (await dbg(b)).counters.dashes;
    await a.keyboard.down('w');
    if ((await dbg(a)).state === 'battle') await a.keyboard.press('Shift');
    await expect.poll(async () => (await dbg(b)).counters.dashes > before || (await dbg(a)).state !== 'battle').toBe(true);
    await a.keyboard.up('w');
    return (await dbg(b)).counters.dashes > before;
  };
  /** 試著放必殺：等 A 的量表集滿（被動集氣約 5～8 秒）後按 Space，雙方都收到伺服器的必殺事件才算成功；這一戰先結束回傳 false */
  const trySpecial = async () => {
    const aBefore = (await dbg(a)).counters.specials;
    const bBefore = (await dbg(b)).counters.specials;
    await expect
      .poll(async () => {
        const d = await dbg(a);
        const t = d.tops[d.me];
        return d.state !== 'battle' || (t && t.alive && !t.specialUsed && t.special >= 1);
      }, { timeout: 60_000 })
      .toBe(true);
    if ((await dbg(a)).state !== 'battle') return false;
    await a.keyboard.press('Space');
    // 按下的瞬間這一戰剛好結束的話不算，下一戰再試
    await expect.poll(async () => (await dbg(b)).counters.specials > bBefore || (await dbg(a)).state !== 'battle').toBe(true);
    if ((await dbg(b)).counters.specials <= bBefore) return false;
    await expect.poll(async () => (await dbg(a)).counters.specials).toBeGreaterThan(aBefore);
    return true;
  };

  // A 按住前進：B 從伺服器快照看到 A（0 號）的推移
  await a.keyboard.down('w');
  await expect.poll(async () => Math.hypot((await dbg(b)).tops[0]?.control.x ?? 0, (await dbg(b)).tops[0]?.control.z ?? 0), { timeout: 30_000 }).toBeGreaterThan(0.5);
  step('B 看到 A 的推移');
  // Shift 衝刺與必殺：B 都要收到伺服器轉來的事件。這一戰先結束的話，第 2、3 戰開打再試
  let dashOk = await tryDash();
  let specialOk = await trySpecial();
  step(`第 1 戰：衝刺 ${dashOk ? '已驗證' : '未及'}、必殺 ${specialOk ? '已驗證' : '未及'}`);
  await a.screenshot({ path: 'e2e/screenshots/82-online-battle.png' });

  // B 的連線中途斷掉：A 看到暫停；B 自動重連回房間後繼續
  await b.evaluate(() => (window as unknown as { __game: { online: { net: { ws: WebSocket } } } }).__game.online.net.ws.close());
  await expect(a.locator('#net-overlay')).toBeVisible();
  await expect(a.locator('#net-overlay .no-text')).toContainText('連線中斷');
  await expect.poll(async () => (await dbg(b)).online?.status).toBe('open');
  await expect(a.locator('#net-overlay')).toBeHidden();
  step('B 重連完成');

  // 第 2 戰：座位交換（房主坐 1 號）
  await expect.poll(async () => (await dbg(a)).match?.battle, { timeout: 240_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await dbg(a)).me).toBe(1);
  expect((await dbg(b)).me).toBe(0);
  step('第 2 戰座位交換');
  for (const n of [2, 3]) {
    if (dashOk && specialOk) break;
    await waitBattle(n);
    if (!dashOk) dashOk = await tryDash();
    if (!specialOk) specialOk = await trySpecial();
    step(`第 ${n} 戰：衝刺 ${dashOk ? '已驗證' : '未及'}、必殺 ${specialOk ? '已驗證' : '未及'}`);
  }
  expect(dashOk).toBe(true);
  expect(specialOk).toBe(true);

  // 打到結果：雙方勝負相反
  await expect(a.locator('#result')).toBeVisible({ timeout: 600_000 });
  await expect(b.locator('#result')).toBeVisible({ timeout: 30_000 });
  const ha = await a.locator('#result .headline').textContent();
  const hb = await b.locator('#result .headline').textContent();
  expect([ha, hb].sort()).toEqual(['YOU LOSE…', 'YOU WIN!!']);
  expect(await a.locator('#result .final').textContent()).toBe((await b.locator('#result .final').textContent())!.split(' - ').reverse().join(' - '));
  await a.screenshot({ path: 'e2e/screenshots/83-online-result.png' });
  step(`結果 ${ha} / ${hb}`);

  // 再來一場：A 按了 B 看到提示，B 也按後雙方回到組隊
  await a.locator('#result .retry').click();
  await expect(b.locator('#result .rm-status')).toContainText('Alice 想再來一場');
  await b.locator('#result .retry').click();
  await expect(a.locator('#select')).toBeVisible({ timeout: 30_000 });
  await expect(b.locator('#select')).toBeVisible({ timeout: 30_000 });
  step('再來一場回到組隊');

  // 離開：B 離開後 A 回到房間畫面等人
  await b.locator('#select .go').isVisible();
  await b.evaluate(() => (window as unknown as { __game: { leaveOnline(): void } }).__game.leaveOnline());
  await expect(a.locator('#online .ol-status')).toContainText('等待對手加入', { timeout: 30_000 });

  expect((a as unknown as { errors: string[] }).errors).toEqual([]);
  expect((b as unknown as { errors: string[] }).errors).toEqual([]);
});

test('房間列表：不公開的不列、對戰中灰色不能點、點一下就加入、快速加入互相配對（B 用手機橫向）', async ({ playwright, browserName, launchOptions, baseURL }) => {
  const browserType = playwright[browserName];
  test.setTimeout(600_000);
  /** 這次執行的代號：名稱帶上它，對線上伺服器跑時分得出哪些房間是自己開的 */
  const tag = Math.random().toString(36).slice(2, 5);
  const alice = `Alice-${tag}`;
  const bob = `Bob-${tag}`;
  const a = await newPlayer('A', browserType, launchOptions, baseURL);
  const b = await newPlayer('B', browserType, launchOptions, baseURL, phone('Pixel 7 landscape'));
  step('兩個瀏覽器已開（B 為手機橫向）');

  // B 先進線上畫面：連上後列表標題顯示自動更新；手機版面的名稱、快速加入、建立房間、列表標題都在畫面內
  await b.goto(`./?seed=2&server=${encodeURIComponent(SERVER)}`);
  await b.locator('#title .to-online').tap();
  await expect(b.locator('#online')).toBeVisible();
  await b.locator('#online .ol-name input').fill(bob);
  await expect(b.locator('#online .ol-list-note')).toHaveText('每 3 秒自動更新');
  for (const sel of ['#online .ol-name', '#online .ol-quick', '#online .ol-create', '#online .ol-list-head']) await expectInViewport(b, sel);
  await b.screenshot({ path: 'e2e/screenshots/84-online-rooms-mobile.png' });

  // A 建不公開的房間：B 的列表之後再更新兩次也看不到
  await a.goto(`./?seed=1&server=${encodeURIComponent(SERVER)}`);
  await a.locator('#title .to-online').click();
  await a.locator('#online .ol-name input').fill(alice);
  await a.locator('#online .ol-private input').check();
  await a.locator('#online .ol-create').click();
  await expect(a.locator('#online .ol-code-big')).toHaveText(/^[A-Z2-9]{4}$/);
  await expect(a.locator('#online .ol-status')).toContainText('不公開');
  const privCode = (await a.locator('#online .ol-code-big').textContent())!;
  const seen = (await dbg(b)).online!.roomsSeen;
  await expect.poll(async () => (await dbg(b)).online!.roomsSeen).toBeGreaterThanOrEqual(seen + 2);
  await expect(b.locator(`#online .ol-room-row[data-code="${privCode}"]`)).toHaveCount(0);
  step(`A 的不公開房間 ${privCode} 沒有出現在 B 的列表`);

  // 房主在等人畫面斷線：自動重連後「連線中斷」的覆蓋層要收起，回到原本的房間
  await a.evaluate(() => {
    const ov = document.querySelector('#net-overlay') as HTMLElement;
    const w = window as unknown as { __overlaySeen: boolean; __game: { online: { net: { ws: WebSocket } } } };
    w.__overlaySeen = false;
    new MutationObserver(() => {
      if (!ov.hidden) w.__overlaySeen = true;
    }).observe(ov, { attributes: true, attributeFilter: ['hidden'] });
    w.__game.online.net.ws.close();
  });
  await expect.poll(() => a.evaluate(() => (window as unknown as { __overlaySeen: boolean }).__overlaySeen)).toBe(true);
  await expect.poll(async () => (await dbg(a)).online?.status).toBe('open');
  await expect(a.locator('#net-overlay')).toBeHidden();
  await expect(a.locator('#online .ol-code-big')).toHaveText(privCode);
  step('A 等人時斷線重連，覆蓋層已收起');

  // 兩個機器人開一場：B 的列表出現灰色的對戰中房間，而且不是按鈕（不能點）
  const bot1 = new Bot(SERVER, 31);
  const bot2 = new Bot(SERVER, 32);
  bots.push(bot1, bot2);
  await Promise.all([bot1.open(), bot2.open()]);
  bot1.send({ t: 'create', name: `Bot1-${tag}`, public: true });
  const br = await bot1.waitFor('room');
  bot2.send({ t: 'join', code: br.code, name: `Bot2-${tag}` });
  await bot2.waitFor('room');
  const grey = b.locator(`#online .ol-room-row.playing[data-code="${br.code}"]`);
  await expect(grey).toContainText(`Bot1-${tag} vs Bot2-${tag}`);
  await expect(grey).toContainText('對戰中');
  expect(await grey.evaluate((e) => e.tagName)).toBe('DIV');
  step('B 看到機器人對戰中的房間（灰色、不能點）');

  // A 回到列表改開公開房間：B 從列表點一下就加入，雙方進到組隊
  await a.locator('#online .ol-back').click();
  await a.locator('#title .to-online').click();
  await expect(a.locator('#online .ol-private input')).not.toBeChecked();
  await a.locator('#online .ol-create').click();
  await expect(a.locator('#online .ol-code-big')).toHaveText(/^[A-Z2-9]{4}$/);
  await expect(a.locator('#online .ol-status')).toContainText('房間列表');
  const code = (await a.locator('#online .ol-code-big').textContent())!;
  const row = b.locator(`#online button.ol-room-row[data-code="${code}"]`);
  await expect(row).toContainText(alice);
  await expect(row).toContainText('等了');
  await b.screenshot({ path: 'e2e/screenshots/85-online-rooms-list.png' });
  await row.tap();
  await expect(a.locator('#select')).toBeVisible({ timeout: 60_000 });
  await expect(b.locator('#select')).toBeVisible({ timeout: 60_000 });
  await expect(a.locator('#select .cpu-team .ct-label')).toHaveText(`對手：${bob}`);
  await expect(b.locator('#select .cpu-team .ct-label')).toHaveText(`對手：${alice}`);
  step(`B 從列表點一下加入 A 的房間 ${code}`);

  // 房主離開：B 收到房間關閉，組隊畫面收起、回到房間列表
  await a.evaluate(() => (window as unknown as { __game: { leaveOnline(): void } }).__game.leaveOnline());
  await expect(b.locator('#online .ol-msg')).toContainText('房間已關閉');
  await expect(b.locator('#select')).toBeHidden();
  await expect(b.locator('#online .ol-list-note')).toHaveText('每 3 秒自動更新');
  step('房主離開，B 回到房間列表');

  // 快速加入：雙方各按一次，配進同一間（誰先到誰當房主）。對線上伺服器跑時，列表上有別人在等就略過（會配到別人）
  const strangers = (await dbg(b)).online!.rooms.filter((r) => r.status === 'waiting' && !r.host.endsWith(tag));
  if (strangers.length) step(`列表上有 ${strangers.length} 間別人的房間在等，略過快速加入`);
  else {
    await a.locator('#title .to-online').click();
    await a.locator('#online .ol-quick').click();
    await b.locator('#online .ol-quick').tap();
    await expect(a.locator('#select')).toBeVisible({ timeout: 60_000 });
    await expect(b.locator('#select')).toBeVisible({ timeout: 60_000 });
    await expect(a.locator('#select .cpu-team .ct-label')).toHaveText(`對手：${bob}`);
    await expect(b.locator('#select .cpu-team .ct-label')).toHaveText(`對手：${alice}`);
    step('快速加入配對成功');
  }

  expect((a as unknown as { errors: string[] }).errors).toEqual([]);
  expect((b as unknown as { errors: string[] }).errors).toEqual([]);
});
