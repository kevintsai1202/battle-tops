import { expect, test, type Page } from '@playwright/test';

/**
 * 需要使用者手勢才能出聲的瀏覽器（Chrome 桌面預設）：
 * 展示模式不能卡在等待 AudioContext.resume()，要照常開打並提示點擊開啟聲音。
 */

type Dbg = { state: string; audioState: string };
const dbg = (page: Page) => page.evaluate(() => (window as unknown as { __game: { debug(): Dbg } }).__game.debug());

/**
 * 模擬 Chrome 桌面的自動播放政策（headless 不會套用 --autoplay-policy 旗標）：
 * AudioContext 建立後維持暫停；使用者點擊或按鍵之前，resume() 永遠不會完成。
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let gesture = false;
    const mark = () => (gesture = true);
    window.addEventListener('pointerdown', mark, true);
    window.addEventListener('keydown', mark, true);
    const Orig = window.AudioContext;
    class GatedAudioContext extends Orig {
      constructor(opts?: AudioContextOptions) {
        super(opts);
        void super.suspend();
      }
      resume(): Promise<void> {
        return gesture ? super.resume() : new Promise<void>(() => undefined);
      }
    }
    window.AudioContext = GatedAudioContext;
  });
});

test('展示模式照常開打，點擊後聲音恢復', async ({ page }) => {
  await page.goto('./?demo=1&seed=3');
  // 沒有手勢也要能進入對戰
  await page.waitForFunction(() => (window as any).__game?.debug().state === 'battle', null, { timeout: 40_000 });
  const before = await dbg(page);
  console.log(`點擊前 AudioContext：${before.audioState}`);
  expect(before.audioState).toBe('suspended');
  await expect(page.locator('#audio-hint')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/20-demo-audio-hint.png' });

  await page.mouse.click(640, 400);
  await page.waitForFunction(() => (window as any).__game.debug().audioState === 'running', null, { timeout: 10_000 });
  await expect(page.locator('#audio-hint')).toBeHidden();
});
