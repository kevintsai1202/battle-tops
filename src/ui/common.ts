import { emblemOf } from '../i18n';
import type { BaseStats, TopSpec } from '../sim/types';

/** 雷達圖與數值列的六項屬性（重量換算成 1～10 分顯示：30 g = 1、66 g = 10） */
export const STAT_AXES: { key: keyof BaseStats; label: string }[] = [
  { key: 'attack', label: '攻擊' },
  { key: 'defense', label: '防禦' },
  { key: 'stamina', label: '持久' },
  { key: 'weight', label: '重量' },
  { key: 'burst', label: '爆裂抵抗' },
  { key: 'dash', label: '機動' },
];

/** 屬性換成 0..10 的顯示分數（屬性本身已由 sim/parts.ts 的 clampStats 限制在合法範圍） */
export function statScore(s: BaseStats, key: keyof BaseStats): number {
  if (key === 'weight') return Math.max(1, Math.min(10, 1 + ((s.weight - 30) / 36) * 9));
  return s[key];
}

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
  c.title = sp.nameZh;
  return c;
}

/** 旋轉方向的標示 */
export const spinLabel = (sp: TopSpec) => (sp.spinDir === 1 ? '右旋' : '左旋') + (sp.special.steps.some((s) => s.op === 'reverse') ? '（可切換）' : '');

/** 集氣速度的文字（依集氣時間分三級） */
export function chargeLabel(sp: TopSpec): string {
  const c = sp.special.charge;
  const tier = c <= 6 ? '快' : c <= 7.5 ? '中' : '慢';
  return `集氣 ${tier}（約 ${c} 秒）`;
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
    t.textContent = ax.label.slice(0, 2);
    svg.append(t);
  });
  return svg;
}
