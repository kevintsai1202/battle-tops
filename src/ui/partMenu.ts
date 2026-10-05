import { descOf, plainName, tr } from '../i18n';
import { DISK_IDS, DRIVER_IDS, PARTS, spareHolder, STOCK, type PartDef, type PartId, type PartSlot, type TeamLoadouts } from '../sim/parts';
import { buildSpec, TOP_SPECS } from '../sim/tops';
import type { BaseStats, TopId } from '../sim/types';
import { el, statLabel } from './common';

/** 欄位名稱（盤／軸；英文版 Disk／Driver） */
export const slotLabel = (slot: PartSlot) => tr(slot === 'disk' ? 'slot.disk' : 'slot.driver');

/** 會列出增減的六項屬性（零件清單裡的小膠囊，依這個順序） */
const STAT_KEYS: (keyof BaseStats)[] = ['attack', 'defense', 'stamina', 'weight', 'burst', 'dash'];

/** 零件清單的一個選項 */
export interface PartOption {
  /** 要裝上的備用零件；null 表示換回原廠 */
  part: PartId | null;
  /** 這個選項實際裝上的零件（原廠選項就是原廠零件） */
  def: PartDef;
  stock: boolean;
  /** 和「這一欄用原廠零件」相比的屬性增減（只列有變的；另一欄維持目前的零件） */
  delta: Partial<Record<keyof BaseStats, number>>;
  /** 被隊友裝走時是哪一顆（自己裝的、或沒人裝為 null） */
  takenBy: TopId | null;
  /** 目前裝的就是這一件 */
  current: boolean;
}

/**
 * 某顆陀螺某一欄（盤或軸）可以換的零件（純邏輯，畫面與測試共用）：
 * 原廠零件放第一個，接著是同一欄的其他備用零件；備用零件每種一件，被隊友裝走的標出是哪一顆。
 * loadouts 為整隊的零件狀態（試驗模式每邊只有一顆，就只放那一顆）。
 */
export function partOptions(top: TopId, slot: PartSlot, loadouts: TeamLoadouts): PartOption[] {
  const stockId = TOP_SPECS[top].stock[slot];
  const lo = loadouts[top] ?? STOCK;
  const base = buildSpec(top, { ...lo, [slot]: null }).stats;
  const ids = (slot === 'disk' ? DISK_IDS : DRIVER_IDS).filter((id) => id !== stockId);
  const option = (part: PartId | null): PartOption => {
    const stats = buildSpec(top, { ...lo, [slot]: part }).stats;
    const delta: PartOption['delta'] = {};
    for (const k of STAT_KEYS) if (stats[k] !== base[k]) delta[k] = stats[k] - base[k];
    const holder = part ? spareHolder(loadouts, part) : null;
    return { part, def: PARTS[part ?? stockId], stock: part === null, delta, takenBy: holder !== top ? holder : null, current: lo[slot] === part };
  };
  return [option(null), ...ids.map(option)];
}

/** 零件按鈕上的文字：零件名（目前語言）、簡碼與是不是原廠 */
export function partButtonText(top: TopId, slot: PartSlot, loadouts: TeamLoadouts): { name: string; code: string; stock: boolean } {
  const id = loadouts[top]?.[slot] ?? null;
  const def = PARTS[id ?? TOP_SPECS[top].stock[slot]];
  return { name: plainName(def), code: def.code, stock: id === null };
}

/** 零件清單的開啟參數 */
export interface PartMenuRequest {
  /** 按下的零件按鈕（清單貼著它出現） */
  anchor: HTMLElement;
  top: TopId;
  slot: PartSlot;
  loadouts: TeamLoadouts;
  /** 選了一件（null = 換回原廠）；被隊友裝走的選不了 */
  onPick: (part: PartId | null) => void;
}

/**
 * 「盤」「軸」按鈕展開的零件清單（整個畫面共用一個）：貼著按鈕出現（下方放不下就放上方），
 * 每一件列出名稱、數值增減與特性說明；點外面、按 Esc 或選好一件就收起。上下鍵在選項間移動。
 */
class PartMenu {
  private root: HTMLElement | null = null;
  private req: PartMenuRequest | null = null;
  /** 點清單外面就收起（在捕獲階段處理，按到的按鈕照常作用） */
  private readonly outside = (e: PointerEvent) => {
    if (this.root && !this.root.contains(e.target as Node) && e.target !== this.req?.anchor) this.close();
  };
  private readonly keys = (e: KeyboardEvent) => {
    if (!this.root) return;
    const opts = [...this.root.querySelectorAll<HTMLButtonElement>('.pm-opt:not(:disabled)')];
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const anchor = this.req?.anchor;
      this.close();
      anchor?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = opts.length;
      opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      // 交給選項按鈕本身（click）；不要讓外層畫面的 Enter（出陣）也觸發
      e.stopPropagation();
    }
  };

  /** 清單是否開著 */
  get isOpen(): boolean {
    return this.root !== null;
  }

  /** 開啟（同一個按鈕再按一次就收起） */
  open(req: PartMenuRequest): void {
    if (this.req?.anchor === req.anchor) {
      this.close();
      return;
    }
    this.close();
    this.req = req;
    const root = el('div', 'part-menu');
    root.id = 'part-menu';
    root.setAttribute('role', 'listbox');
    root.append(el('div', 'pm-head', tr('part.menuHead', { slot: slotLabel(req.slot), name: plainName(TOP_SPECS[req.top]) })));
    for (const o of partOptions(req.top, req.slot, req.loadouts)) {
      const b = el('button', `pm-opt${o.current ? ' current' : ''}`);
      b.type = 'button';
      b.dataset.part = o.part ?? '';
      b.disabled = o.takenBy !== null;
      const name = el('span', 'pm-name', tr('part.option', { name: plainName(o.def), code: o.def.code }));
      if (o.stock) name.append(el('small', 'pm-tag', tr('part.stock')));
      if (o.current) name.append(el('small', 'pm-tag on', tr('part.current')));
      const deltas = el('span', 'pm-delta');
      for (const [k, v] of Object.entries(o.delta) as [keyof BaseStats, number][]) {
        deltas.append(el('i', v > 0 ? 'up' : 'down', `${statLabel(k, 'tiny')}${v > 0 ? '+' : ''}${v}${k === 'weight' ? 'g' : ''}`));
      }
      const desc = el('span', 'pm-desc', o.takenBy ? tr('part.takenBy', { name: plainName(TOP_SPECS[o.takenBy]) }) : descOf(o.def));
      b.append(name, deltas, desc);
      b.onclick = () => {
        const r = this.req;
        this.close();
        r?.onPick(o.part);
        r?.anchor.focus();
      };
      root.append(b);
    }
    document.getElementById('overlay')!.append(root);
    this.root = root;
    this.place();
    window.addEventListener('pointerdown', this.outside, true);
    window.addEventListener('keydown', this.keys, true);
    (root.querySelector<HTMLButtonElement>('.pm-opt.current') ?? root.querySelector<HTMLButtonElement>('.pm-opt'))?.focus({ preventScroll: true });
  }

  /** 收起 */
  close(): void {
    window.removeEventListener('pointerdown', this.outside, true);
    window.removeEventListener('keydown', this.keys, true);
    this.root?.remove();
    this.root = null;
    this.req = null;
  }

  /** 貼著按鈕放：下方空間夠就放下方，否則放上方；左右不超出畫面，高度超過可用空間時清單內捲動 */
  private place(): void {
    const root = this.root!;
    const a = this.req!.anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(340, vw - 16);
    root.style.width = `${width}px`;
    root.style.left = `${Math.max(8, Math.min(vw - width - 8, a.left))}px`;
    const below = vh - a.bottom - 8;
    const above = a.top - 8;
    const h = root.scrollHeight;
    if (below >= Math.min(h, 260) || below >= above) {
      root.style.top = `${a.bottom + 4}px`;
      root.style.maxHeight = `${below - 4}px`;
    } else {
      const mh = above - 4;
      root.style.maxHeight = `${mh}px`;
      root.style.top = `${a.top - 4 - Math.min(h, mh)}px`;
    }
  }
}

/** 畫面共用的零件清單 */
export const partMenu = new PartMenu();

/**
 * 建一顆「盤」或「軸」按鈕：顯示欄位名與目前的零件（換過的發光、原廠的標小字），按下展開零件清單。
 * onOpen 在展開前呼叫（例如先選取那一欄）；之後換零件由 PartMenuRequest.onPick 處理。
 */
export function partButton(top: TopId, slot: PartSlot, loadouts: TeamLoadouts, onOpen: (b: HTMLButtonElement) => void, disabled = false): HTMLButtonElement {
  const b = el('button', 'part-btn');
  b.type = 'button';
  b.dataset.slot = slot;
  const t = partButtonText(top, slot, loadouts);
  b.classList.toggle('changed', !t.stock);
  const name = el('span', 'pb-name', t.name);
  name.append(el('small', 'pb-code', t.code));
  b.append(el('b', 'pb-slot', slotLabel(slot)), name);
  if (t.stock) b.append(el('small', 'pb-tag', tr('part.stock')));
  b.append(el('span', 'pb-caret', '▾'));
  b.setAttribute('aria-label', tr('part.aria', { slot: slotLabel(slot), name: t.name, code: t.code, stock: t.stock ? tr('part.ariaStock') : '' }));
  b.disabled = disabled;
  b.onclick = (e) => {
    e.stopPropagation();
    onOpen(b);
  };
  return b;
}
