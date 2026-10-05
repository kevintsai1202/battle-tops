import { descOf, lang, originOf, plainName, specialName, topName, tr } from '../i18n';
import { PARTS, type PartSlot } from '../sim/parts';
import { TOP_SPECS } from '../sim/tops';
import type { TopId, TopSpec } from '../sim/types';
import { chargeLabel, css, el, joinDot, radar, radarPoints, spinLabel, STAT_AXES, statLabel, typeLabel } from './common';
import { slotLabel } from './partMenu';

/**
 * 組隊畫面右側的詳細資料，分上下兩段：
 * - 上方固定（不捲動）：名稱一行（日文版是日文名＋中文名，中文版只有中文名，英文版只有英文名）、雷達圖（換零件時疊上原廠的淡色輪廓）與六項數值（標出增減）。
 *   最重要的比較資料一定看得到，切換陀螺時位置也不變。
 * - 下方捲動區：外觀・絕招示範的舞台窗（render/showcase.ts 畫在這個畫布上）、類型與原型、
 *   目前的盤與軸（opts.parts 為 false 時不顯示，例如組隊第 1 步；換零件用各畫面的「盤」「軸」按鈕，見 ui/partMenu.ts）、
 *   必殺技名稱、集氣速度與說明。
 * 面板高度由 CSS 固定，切換陀螺不會跳動；捲動位置保留（正在比較兩顆的必殺說明時不會跳回頂端）。
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
    this.stage.append(this.canvas, el('span', 'd-cap', tr('detail.stage')), this.stageMove);
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
    const name = el('div', 'd-name');
    name.append(this.ja, this.zh);
    const fixed = el('div', 'd-fixed');
    fixed.append(name, this.radar, this.stats);
    const scroll = el('div', 'd-scroll');
    scroll.append(this.stage, this.meta, this.parts, this.sp, this.charge, this.desc);
    root.replaceChildren(fixed, scroll);
  }

  /** 顯示一顆陀螺（spec 為套用目前零件後的規格） */
  show(spec: TopSpec): void {
    const stock = TOP_SPECS[spec.id];
    this.root.style.setProperty('--c', css(spec.glow));
    this.root.dataset.id = spec.id;
    this.ja.textContent = topName(spec);
    // 日文版才在日文名旁附中文名（其他語言連隱藏的字都不放，英文版的 DOM 裡沒有中文）
    this.zh.textContent = lang() === 'ja' ? spec.nameZh : '';
    this.zh.hidden = lang() !== 'ja';
    const origin = originOf(spec);
    this.meta.textContent = joinDot(joinDot(typeLabel(spec.type), spinLabel(spec)), origin ? tr('detail.origin', { name: origin }) : tr('detail.original'));
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
        const li = el('li', '', statLabel(ax.key));
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
        const s = el('span', changed ? 'changed' : '', tr('detail.part', { slot: slotLabel(slot), name: plainName(PARTS[id]), code: PARTS[id].code }) + (changed ? '' : tr('detail.stock')));
        s.title = descOf(PARTS[id]);
        return s;
      }),
    );

    // 日文版：日文必殺名後面附中文名；中文版、英文版只有該語言的必殺名
    this.sp.textContent =
      lang() === 'ja' ? tr('card.specialWithZh', { name: specialName(spec), zh: spec.special.nameZh }) : tr('card.special', { name: specialName(spec) });
    this.charge.textContent = chargeLabel(spec);
    this.desc.textContent = descOf(spec.special);
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
