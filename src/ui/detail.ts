import { lang, specialName, topName } from '../i18n';
import { PARTS, type PartSlot } from '../sim/parts';
import { TOP_SPECS, TYPE_LABEL } from '../sim/tops';
import type { TopId, TopSpec } from '../sim/types';
import { chargeLabel, css, el, radar, radarPoints, spinLabel, STAT_AXES } from './common';
import { SLOT_LABEL } from './partMenu';

/**
 * 組隊畫面右側的詳細資料：
 * - 上方是透明的「舞台」窗，主場景的鏡頭會對準這裡播放外觀與絕招示範（見 game.ts 的 showcase）。
 * - 名稱（日文版是日文名＋中文名，中文版只有中文名）、類型、原型；雷達圖（換零件時疊上原廠的淡色輪廓）與六項數值（標出增減）。
 * - 目前的盤與軸（opts.parts 為 false 時不顯示，例如組隊第 1 步）；換零件用各畫面的「盤」「軸」按鈕（ui/partMenu.ts）。
 * - 必殺技名稱、說明與集氣速度。
 * 每一段的高度固定（名稱一行、原型說明兩行、必殺說明固定行數且內部捲動），切換陀螺時面板與裡面的版面都不會跳動。
 * 元素只建立一次，之後就地更新。
 */
export class DetailView {
  readonly root: HTMLElement;
  /** 絕招示範的舞台窗與畫布（由 render/showcase.ts 繪製） */
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private readonly stageMove: HTMLElement;
  private readonly ja: HTMLElement;
  private readonly zh: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly radar: SVGSVGElement;
  private readonly stats: HTMLUListElement;
  private readonly parts: HTMLElement;
  private readonly sp: HTMLElement;
  private readonly charge: HTMLElement;
  private readonly desc: HTMLElement;
  private flashTimer = 0;

  /** opts.parts 為 false 時不顯示目前的零件（組隊第 1 步只看原廠介紹） */
  constructor(root: HTMLElement, opts: { parts?: boolean } = {}) {
    this.root = root;
    this.stage = el('div', 'd-stage');
    this.canvas = el('canvas', 'd-canvas');
    this.stageMove = el('div', 'd-move');
    this.stage.append(this.canvas, el('span', 'd-cap', '外觀・絕招示範'), this.stageMove);
    this.ja = el('div', 'd-ja');
    this.zh = el('div', 'd-zh');
    this.meta = el('div', 'd-meta');
    this.radar = radar(TOP_SPECS.blaze.stats);
    this.stats = el('ul', 'd-stats');
    this.parts = el('div', 'd-parts');
    this.parts.hidden = opts.parts === false;
    this.sp = el('div', 'd-sp');
    this.charge = el('div', 'd-charge');
    this.desc = el('div', 'd-desc');
    root.replaceChildren(this.stage, this.ja, this.zh, this.meta, this.radar, this.stats, this.parts, this.sp, this.charge, this.desc);
  }

  /** 顯示一顆陀螺（spec 為套用目前零件後的規格） */
  show(spec: TopSpec): void {
    const stock = TOP_SPECS[spec.id];
    this.root.style.setProperty('--c', css(spec.glow));
    this.root.dataset.id = spec.id;
    this.ja.textContent = topName(spec);
    this.zh.textContent = spec.nameZh;
    this.zh.hidden = lang() === 'zh';
    this.meta.textContent = `${TYPE_LABEL[spec.type]}・${spinLabel(spec)}${spec.origin ? `・原型：${spec.origin}` : '・原創'}`;
    this.meta.title = this.meta.textContent;

    // 雷達圖：目前屬性；換過零件時疊上原廠輪廓
    const modified = spec !== stock;
    this.radar.querySelector('.val')!.setAttribute('points', radarPoints(spec.stats));
    const ghost = this.radar.querySelector('.ghost') as SVGPolygonElement;
    ghost.setAttribute('points', radarPoints(stock.stats));
    ghost.style.display = modified ? '' : 'none';

    // 數值列：與原廠相比的增減
    this.stats.replaceChildren(
      ...STAT_AXES.map((ax) => {
        const li = el('li', '', ax.label);
        const v = spec.stats[ax.key];
        const d = v - stock.stats[ax.key];
        const b = el('b', '', ax.key === 'weight' ? `${v} g` : String(v));
        li.append(b);
        if (d !== 0) li.append(el('small', d > 0 ? 'up' : 'down', d > 0 ? `+${d}` : String(d)));
        return li;
      }),
    );

    // 目前的盤與軸（換過的標成發光色）
    this.parts.replaceChildren(
      ...(['disk', 'driver'] as PartSlot[]).map((slot) => {
        const id = spec.parts[slot];
        const changed = id !== stock.stock[slot];
        const s = el('span', changed ? 'changed' : '', `${SLOT_LABEL[slot]}：${PARTS[id].nameZh}（${PARTS[id].code}）${changed ? '' : '・原廠'}`);
        s.title = PARTS[id].descZh;
        return s;
      }),
    );

    this.sp.textContent = lang() === 'zh' ? `必殺：${spec.special.nameZh}` : `必殺：${specialName(spec)}（${spec.special.nameZh}）`;
    this.charge.textContent = chargeLabel(spec);
    this.desc.textContent = spec.special.descZh;
    this.desc.scrollTop = 0;
  }

  /** 舞台上閃出招式名（絕招示範放招時） */
  flash(text: string): void {
    window.clearTimeout(this.flashTimer);
    this.stageMove.textContent = text;
    this.stageMove.classList.remove('on');
    void this.stageMove.offsetWidth;
    this.stageMove.classList.add('on');
    this.flashTimer = window.setTimeout(() => this.stageMove.classList.remove('on'), 1400);
  }

  /** 目前顯示的陀螺代號 */
  get current(): TopId | undefined {
    return this.root.dataset.id;
  }
}
