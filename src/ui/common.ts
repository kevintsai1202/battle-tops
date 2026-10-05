import { emblemOf, plainName, tr, type TextKey } from '../i18n';
import type { BaseStats, TopSpec, TopType } from '../sim/types';

/** 雷達圖與數值列的六項屬性（重量換算成 1～10 分顯示：30 g = 1、66 g = 10） */
export const STAT_AXES: { key: keyof BaseStats }[] = [
  { key: 'attack' },
  { key: 'defense' },
  { key: 'stamina' },
  { key: 'weight' },
  { key: 'burst' },
  { key: 'dash' },
];

/** 屬性名稱：full 完整（數值列）、short 短名（雷達圖與卡片，中文兩個字）、tiny 最短（零件清單的小膠囊，中文一個字） */
export function statLabel(key: keyof BaseStats, form: 'full' | 'short' | 'tiny' = 'full'): string {
  return tr((form === 'full' ? `stat.${key}` : `stat.${key}.${form === 'short' ? 's' : 't'}`) as TextKey);
}

/** 類型名稱（攻擊型…）；short 為名鑑小格角落的一個字 */
export function typeLabel(type: TopType, short = false): string {
  return tr((short ? `type.${type}.s` : `type.${type}`) as TextKey);
}

/** 兩段說明用中黑點連起來（英文版用 ·） */
export const joinDot = (a: string, b: string) => tr('info.join', { a, b });

/** 屬性換成 0..10 的顯示分數（屬性本身已由 sim/parts.ts 的 clampStats 限制在合法範圍） */
export function statScore(s: BaseStats, key: keyof BaseStats): number {
  if (key === 'weight') return Math.max(1, Math.min(10, 1 + ((s.weight - 30) / 36) * 9));
  return s[key];
}

/** 轉速換成畫面上顯示的 RPM（HUD 與試驗模式的數據共用） */
export const rpmOf = (t: { spin: number }) => Math.round(t.spin * 9.55 * 2.4);

/** 取第一個符合選擇器的元素 */
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

/** 數字色碼轉 CSS */
export function css(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

/** 建立帶 class 與文字的元素 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** 陣容小圖示：圓形底 + 紋章字，顏色取陀螺發光色 */
export function chip(sp: TopSpec): HTMLElement {
  const c = el('i', 'chip', emblemOf(sp));
  c.style.setProperty('--c', css(sp.glow));
  c.title = plainName(sp);
  return c;
}

/** 旋轉方向的標示 */
export const spinLabel = (sp: TopSpec) =>
  tr(sp.spinDir === 1 ? 'spin.right' : 'spin.left') + (sp.special.steps.some((s) => s.op === 'reverse') ? tr('spin.switch') : '');

/** 集氣速度的文字（依集氣時間分三級） */
export function chargeLabel(sp: TopSpec): string {
  const c = sp.special.charge;
  const tier = tr(c <= 6 ? 'charge.fast' : c <= 7.5 ? 'charge.mid' : 'charge.slow');
  return tr('charge.label', { tier, c });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 雷達圖上第 i 軸、值 v 的座標 */
function radarPt(i: number, v: number): [number, number] {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / STAT_AXES.length;
  return [Math.cos(a) * v * 4.4, Math.sin(a) * v * 4.4];
}

/** 屬性 → 雷達圖多邊形的 points 字串 */
export function radarPoints(s: BaseStats): string {
  return STAT_AXES.map((ax, i) => radarPt(i, statScore(s, ax.key)).join(',')).join(' ');
}

/**
 * 六角雷達圖（SVG）：外圈為 10 分。回傳的元素裡 .val 是目前屬性、.ghost 是原廠屬性（換零件時用來比較，預設隱藏）。
 */
export function radar(s: BaseStats): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-70 -62 140 124');
  svg.setAttribute('class', 'radar');
  for (const lv of [10, 5]) {
    const g = document.createElementNS(SVG_NS, 'polygon');
    g.setAttribute('points', STAT_AXES.map((_, i) => radarPt(i, lv).join(',')).join(' '));
    g.setAttribute('class', 'grid');
    svg.append(g);
  }
  const ghost = document.createElementNS(SVG_NS, 'polygon');
  ghost.setAttribute('class', 'ghost');
  ghost.setAttribute('points', radarPoints(s));
  ghost.style.display = 'none';
  const shape = document.createElementNS(SVG_NS, 'polygon');
  shape.setAttribute('points', radarPoints(s));
  shape.setAttribute('class', 'val');
  svg.append(ghost, shape);
  STAT_AXES.forEach((ax, i) => {
    const [x, y] = radarPt(i, 12.2);
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y + 3));
    t.setAttribute('text-anchor', 'middle');
    t.textContent = statLabel(ax.key, 'short');
    svg.append(t);
  });
  return svg;
}
