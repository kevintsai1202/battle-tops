import { DISK_IDS, DRIVER_IDS, PARTS, spareHolder, type PartId, type PartSlot, type TeamLoadouts } from '../sim/parts';
import { TOP_SPECS, TYPE_LABEL } from '../sim/tops';
import type { TopId, TopSpec } from '../sim/types';
import { chargeLabel, css, el, radar, radarPoints, spinLabel, STAT_AXES } from './common';

/** 欄位的中文名 */
const SLOT_LABEL: Record<PartSlot, string> = { disk: '盤', driver: '軸' };

/** 零件的顯示名稱（名稱＋簡碼） */
const partName = (id: PartId) => `${PARTS[id].nameZh}（${PARTS[id].code}）`;

/**
 * 組隊畫面右側的詳細資料：
 * - 上方是透明的「舞台」窗，主場景的鏡頭會對準這裡播放外觀與絕招示範（見 game.ts 的 showcase）。
 * - 名稱、類型、原型；雷達圖（換零件時疊上原廠的淡色輪廓）與六項數值（標出增減）。
 * - 盤與軸的選單：隊伍中的陀螺才能換；備用零件每種一件，被隊友用掉的會標出來且不能選。
 * - 必殺技名稱、說明與集氣速度。
 * 元素只建立一次，之後就地更新：換零件時不會把正在操作的選單整個重建。
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
  private readonly selects: Record<PartSlot, HTMLSelectElement>;
  private readonly partNote: HTMLElement;
  private readonly sp: HTMLElement;
  private readonly charge: HTMLElement;
  private readonly desc: HTMLElement;
  private flashTimer = 0;

  /** onChange：玩家在選單換零件（part 為 null 表示換回原廠） */
  constructor(root: HTMLElement, onChange: (slot: PartSlot, part: PartId | null) => void) {
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
    const parts = el('div', 'd-parts');
    const mk = (slot: PartSlot) => {
      const row = el('label', 'd-part');
      const s = el('select', '');
      s.dataset.slot = slot;
      s.addEventListener('change', () => {
        onChange(slot, s.value === '' ? null : s.value);
        s.blur();
      });
      row.append(el('span', 'd-slot', SLOT_LABEL[slot]), s);
      parts.append(row);
      return s;
    };
    this.selects = { disk: mk('disk'), driver: mk('driver') };
    this.partNote = el('div', 'd-note');
    parts.append(this.partNote);
    this.sp = el('div', 'd-sp');
    this.charge = el('div', 'd-charge');
    this.desc = el('div', 'd-desc');
    root.replaceChildren(this.stage, this.ja, this.zh, this.meta, this.radar, this.stats, parts, this.sp, this.charge, this.desc);
  }

  /**
   * 顯示一顆陀螺（spec 為套用目前零件後的規格）。
   * picked：是否在隊伍中（才能換零件）；loadouts：隊伍的備用零件狀態（判斷哪些零件被隊友用掉）。
   */
  show(spec: TopSpec, picked: boolean, loadouts: TeamLoadouts): void {
    const stock = TOP_SPECS[spec.id];
    this.root.style.setProperty('--c', css(spec.glow));
    this.root.dataset.id = spec.id;
    this.ja.textContent = spec.nameJa;
    this.zh.textContent = spec.nameZh;
    this.meta.textContent = `${TYPE_LABEL[spec.type]}・${spinLabel(spec)}${spec.origin ? `・原型：${spec.origin}` : '・原創'}`;

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

    // 零件選單
    for (const slot of ['disk', 'driver'] as PartSlot[]) {
      const s = this.selects[slot];
      const ids = slot === 'disk' ? DISK_IDS : DRIVER_IDS;
      const opts = [new Option(`原廠 ${partName(stock.stock[slot])}`, '')];
      for (const id of ids) {
        if (id === stock.stock[slot]) continue;
        const holder = spareHolder(loadouts, id);
        const taken = holder !== null && holder !== spec.id;
        const o = new Option(taken ? `${partName(id)}・裝在${TOP_SPECS[holder!].nameZh}` : partName(id), id);
        o.disabled = taken;
        opts.push(o);
      }
      s.replaceChildren(...opts);
      s.value = loadouts[spec.id]?.[slot] ?? '';
      s.disabled = !picked;
      s.title = PARTS[spec.parts[slot]].descZh;
    }
    this.partNote.textContent = picked
      ? `${PARTS[spec.parts.disk].descZh} ${PARTS[spec.parts.driver].descZh}`
      : '加入隊伍後可以換盤和軸（備用零件每種只有一件，同隊不能重複）。';

    this.sp.textContent = `必殺：${spec.special.nameJa}（${spec.special.nameZh}）`;
    this.charge.textContent = chargeLabel(spec);
    this.desc.textContent = spec.special.descZh;
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
