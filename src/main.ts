import './style.css';
import { Game } from './game/game';
import { initLang, tr } from './i18n';
import { ARENA_IDS, type ArenaId } from './sim/arena';
import { TOP_IDS } from './sim/tops';
import type { TopId } from './sim/types';

/**
 * 進入點。網址參數：
 * - demo=1：CPU 對 CPU 自動對打（展示與 e2e 用）
 * - seed=數字：亂數種子
 * - p=blaze,turtle、c=…：展示模式指定雙方隊伍的前幾顆（陀螺代號見 src/sim/tops.ts，其餘隨機補滿）
 * - arena=practice / stadium / volcano / glacier / flooded：展示模式的場地
 * - lang=ja / zh / en：介面語言（日文版／全中文版／英文版；不給時沿用上次在標題畫面選的，沒選過就看瀏覽器語言）
 */
const q = new URLSearchParams(location.search);
/** 解析逗號分隔的陀螺清單（例如 p=blaze,turtle），忽略不認得的 */
const pickTeam = (v: string | null): TopId[] | undefined => (v ? v.split(',').filter((t) => TOP_IDS.includes(t)) : undefined);
const arenaParam = q.get('arena');
// 先決定語言並換掉 index.html 的字，再建立遊戲（遊戲建立時就會用到目前語言）
initLang();

// WebGL 不可用時直接提示，而不是一片黑
const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
  const msg = document.createElement('p');
  msg.style.cssText = 'color:#fff;padding:24px;font-size:18px';
  msg.textContent = tr('webgl.none');
  document.body.replaceChildren(msg);
} else {
  const game = new Game(document.getElementById('stage')!, {
    demo: q.get('demo') === '1',
    seed: Number(q.get('seed') ?? Date.now() % 100000),
    player: pickTeam(q.get('p')),
    cpu: pickTeam(q.get('c')),
    arena: ARENA_IDS.includes(arenaParam as ArenaId) ? (arenaParam as ArenaId) : undefined,
  });
  // 除錯與 e2e 觀察用
  (window as unknown as { __game: Game }).__game = game;
}
