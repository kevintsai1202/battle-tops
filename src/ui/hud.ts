import { ARENA_IDS, ARENAS, type ArenaId } from '../sim/arena';
import { DIFFICULTY_IDS, type DifficultyId } from '../sim/difficulty';
import { spinRatio } from '../sim/physics';
import { currentPairing, type TeamMatch } from '../sim/team';
import { TOP_IDS, TYPE_LABEL } from '../sim/tops';
import type { BaseStats, FinishType, TopId, TopSpec, TopState } from '../sim/types';

/** 終結方式的英文名稱（結果畫面用） */
const FINISH_EN: Record<FinishType, string> = { spin: 'SPIN FINISH', over: 'OVER FINISH', burst: 'BURST FINISH' };

/** 雷達圖與數值列的六項屬性（重量換算成 1～10 分顯示：30 g = 1、66 g = 10） */
const STAT_AXES: { key: keyof BaseStats; label: string }[] = [
  { key: 'attack', label: '攻擊' },
  { key: 'defense', label: '防禦' },
  { key: 'stamina', label: '持久' },
  { key: 'weight', label: '重量' },
  { key: 'burst', label: '爆裂抵抗' },
  { key: 'dash', label: '機動' },
];

/** 場地選擇：五個場地加上「隨機」 */
export type ArenaChoice = ArenaId | 'random';

/** 屬性換成 0..10 的顯示分數 */
function statScore(s: BaseStats, key: keyof BaseStats): number {
  if (key === 'weight') return Math.max(1, Math.min(10, 1 + ((s.weight - 30) / 36) * 9));
  return s[key];
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

/** 數字色碼轉 CSS */
export function css(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

/** 建立帶 class 與文字的元素 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** 陣容小圖示：圓形底 + 紋章字，顏色取陀螺發光色 */
function chip(sp: TopSpec): HTMLElement {
  const c = el('i', 'chip', sp.emblem);
  c.style.setProperty('--c', css(sp.glow));
  c.title = sp.nameZh;
  return c;
}

/** 旋轉方向的標示 */
const spinLabel = (sp: TopSpec) => (sp.spinDir === 1 ? '右旋' : '左旋') + (sp.special.steps.some((s) => s.op === 'reverse') ? '（可切換）' : '');

/**
 * 六角雷達圖（SVG）：六項基本屬性，外圈為 10 分。
 */
function radar(sp: TopSpec): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-70 -62 140 124');
  svg.setAttribute('class', 'radar');
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / STAT_AXES.length;
    return [Math.cos(a) * v * 4.4, Math.sin(a) * v * 4.4];
  };
  for (const lv of [10, 5]) {
    const g = document.createElementNS(NS, 'polygon');
    g.setAttribute('points', STAT_AXES.map((_, i) => pt(i, lv).join(',')).join(' '));
    g.setAttribute('class', 'grid');
    svg.append(g);
  }
  const shape = document.createElementNS(NS, 'polygon');
  shape.setAttribute('points', STAT_AXES.map((ax, i) => pt(i, statScore(sp.stats, ax.key)).join(',')).join(' '));
  shape.setAttribute('class', 'val');
  svg.append(shape);
  STAT_AXES.forEach((ax, i) => {
    const [x, y] = pt(i, 12.2);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', String(x));
    t.setAttribute('y', String(y + 3));
    t.setAttribute('text-anchor', 'middle');
    t.textContent = ax.label.slice(0, 2);
    svg.append(t);
  });
  return svg;
}

/** 陀螺卡片（延長賽三選一用）：順序徽章、名稱、類型、六項屬性條、必殺技名 */
function buildCard(sp: TopSpec): HTMLButtonElement {
  const c = el('button', 'card');
  c.type = 'button';
  c.dataset.id = sp.id;
  c.style.setProperty('--c', css(sp.glow));
  const stat = (label: string, v: number) => {
    const row = el('div', 'stat');
    const b = document.createElement('b');
    b.style.width = `${v * 10}%`;
    row.append(el('span', '', label.slice(0, 2)), b);
    return row;
  };
  c.append(
    el('span', 'badge'),
    el('div', 'ja', sp.nameJa),
    el('div', 'zh', sp.nameZh),
    el('span', 'type', `${TYPE_LABEL[sp.type]}・${spinLabel(sp)}`),
    ...STAT_AXES.map((ax) => stat(ax.label, statScore(sp.stats, ax.key))),
    el('div', 'sp', `必殺：${sp.special.nameJa}`),
  );
  return c;
}

/** 組隊畫面的陀螺小格：紋章、中文名、類型色條，左旋另外標示 */
function buildTile(sp: TopSpec): HTMLButtonElement {
  const c = el('button', 'card tile');
  c.type = 'button';
  c.dataset.id = sp.id;
  c.dataset.type = sp.type;
  c.style.setProperty('--c', css(sp.glow));
  c.title = `${sp.nameZh}（${TYPE_LABEL[sp.type]}）`;
  c.append(el('span', 'badge'), el('i', 'emb', sp.emblem), el('span', 'nm', sp.nameZh), el('span', 'ty', TYPE_LABEL[sp.type].slice(0, 1)));
  if (sp.spinDir === -1) c.append(el('span', 'left', '左'));
  return c;
}

/** 組隊畫面右側的詳細資料：名稱、原型、雷達圖、數值、必殺技說明 */
function fillDetail(root: HTMLElement, sp: TopSpec): void {
  root.style.setProperty('--c', css(sp.glow));
  const stats = el('ul', 'd-stats');
  for (const ax of STAT_AXES) {
    const li = el('li', '', ax.label);
    li.append(el('b', '', ax.key === 'weight' ? `${sp.stats.weight} g` : String(sp.stats[ax.key])));
    stats.append(li);
  }
  root.replaceChildren(
    el('div', 'd-ja', sp.nameJa),
    el('div', 'd-zh', sp.nameZh),
    el('div', 'd-meta', `${TYPE_LABEL[sp.type]}・${spinLabel(sp)}${sp.origin ? `・原型：${sp.origin}` : '・原創'}`),
    radar(sp),
    stats,
    el('div', 'd-sp', `必殺：${sp.special.nameJa}（${sp.special.nameZh}）`),
    el('div', 'd-desc', sp.special.descZh),
  );
}

/** 組隊畫面的參數 */
export interface TeamSelectOptions {
  specs: Record<TopId, TopSpec>;
  cpuTeam: TopId[];
  difficulty: DifficultyId;
  arena: ArenaChoice;
  onDifficulty: (d: DifficultyId) => void;
  onArena: (a: ArenaChoice) => void;
  /** 游標移動時呼叫（用來換 3D 預覽） */
  onHover: (t: TopId) => void;
  onConfirm: (team: TopId[]) => void;
}

/** 拉條畫面狀態（game 每幀傳進來） */
export interface CordView {
  /** 按下的起點與目前指標位置（螢幕 px） */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 目前的拉條品質 0..1 與瞄準角度（弧度） */
  power: number;
  aim: number;
}

/**
 * DOM 覆蓋層：標題、組隊、延長賽選擇、對戰 HUD、中央大字、擬聲字、發射台（拉條）、必殺 cut-in、結果畫面。
 * 只負責畫面，遊戲邏輯在 Game。
 */
export class Hud {
  private bannerTimer = 0;
  private selectKeys: ((e: KeyboardEvent) => void) | null = null;

  /**
   * 顯示標題畫面，點擊後呼叫 onStart。
   * 用 click 而不是 pointerdown：觸控時瀏覽器在 pointerdown 之後才補送 click，
   * 若在 pointerdown 就切到組隊畫面，這個 click 會落在剛出現的陀螺小格上，誤選一顆。
   */
  showTitle(onStart: () => void): void {
    const title = $('#title');
    title.hidden = false;
    const go = () => {
      title.removeEventListener('click', go);
      window.removeEventListener('keydown', go);
      title.hidden = true;
      onStart();
    };
    title.addEventListener('click', go);
    window.addEventListener('keydown', go);
  }

  /**
   * 組隊畫面：從全部陀螺挑三顆，點選的順序就是出場順序（小格右上角顯示 1、2、3）。
   * 點小格加入或取消；湊滿 3 顆後按「出陣！」。CPU 的三顆公開顯示，順序保密。
   * 右側顯示游標所在陀螺的屬性雷達圖與必殺技說明。上方可切換難度與場地。
   * 鍵盤：方向鍵移動、Space 選取／取消、Enter 選取（滿 3 顆時出陣）、Backspace 退回上一顆、
   * 1／2／3 切換難度、Q／E 切換場地。
   */
  showTeamSelect(o: TeamSelectOptions): void {
    const root = $('#select');
    // 難度切換
    const diffBtns = [...root.querySelectorAll<HTMLButtonElement>('.difficulty button')];
    const setDiff = (d: DifficultyId) => {
      diffBtns.forEach((b) => b.classList.toggle('on', b.dataset.id === d));
      o.onDifficulty(d);
    };
    diffBtns.forEach((b) => {
      b.onclick = () => {
        setDiff(b.dataset.id as DifficultyId);
        b.blur();
      };
    });
    diffBtns.forEach((b) => b.classList.toggle('on', b.dataset.id === o.difficulty));

    // 場地切換（含隨機）
    const arenaRow = $('.arena', root);
    const arenaChoices: ArenaChoice[] = [...ARENA_IDS, 'random'];
    let arena = o.arena;
    const arenaBtns = arenaChoices.map((id) => {
      const b = el('button', '', id === 'random' ? '隨機' : ARENAS[id].nameZh);
      b.type = 'button';
      b.dataset.id = id;
      b.onclick = () => {
        setArena(id);
        b.blur();
      };
      return b;
    });
    arenaRow.replaceChildren(...arenaBtns);
    const setArena = (id: ArenaChoice) => {
      arena = id;
      arenaBtns.forEach((b) => b.classList.toggle('on', b.dataset.id === id));
      $('.arena-desc', root).textContent = id === 'random' ? '開打時從五個場地隨機抽一個。' : ARENAS[id].descZh;
      o.onArena(id);
    };
    setArena(arena);

    const cards = $('.cards', root);
    const detail = $('.detail', root);
    // CPU 陣容：依名鑑順序顯示，不洩漏出場順序
    $('.cpu-team .chips', root).replaceChildren(...TOP_IDS.filter((t) => o.cpuTeam.includes(t)).map((t) => chip(o.specs[t])));
    const go = $<HTMLButtonElement>('.go', root);
    const slots = $('.slots', root);
    let idx = 0;
    const picks: TopId[] = [];
    const els: HTMLButtonElement[] = [];

    const refresh = () => {
      els.forEach((e, k) => {
        const n = picks.indexOf(TOP_IDS[k]);
        e.classList.toggle('on', k === idx);
        e.classList.toggle('picked', n >= 0);
        $('.badge', e).textContent = n >= 0 ? String(n + 1) : '';
      });
      slots.replaceChildren(
        ...[0, 1, 2].map((i) => {
          const sl = el('span', 'slot', `${i + 1}`);
          if (picks[i]) sl.append(chip(o.specs[picks[i]]));
          return sl;
        }),
      );
      go.disabled = picks.length !== 3;
    };
    const setIdx = (i: number) => {
      idx = (i + TOP_IDS.length) % TOP_IDS.length;
      o.onHover(TOP_IDS[idx]);
      fillDetail(detail, o.specs[TOP_IDS[idx]]);
      refresh();
      els[idx]?.scrollIntoView({ block: 'nearest' });
    };
    const toggle = (i: number) => {
      const t = TOP_IDS[i];
      const n = picks.indexOf(t);
      if (n >= 0) picks.splice(n, 1);
      else if (picks.length < 3) picks.push(t);
      setIdx(i);
    };
    const confirm = () => {
      if (picks.length !== 3) return;
      if (this.selectKeys) window.removeEventListener('keydown', this.selectKeys);
      this.selectKeys = null;
      root.hidden = true;
      o.onConfirm([...picks]);
    };
    /** 目前一列有幾格（依實際排版計算，給上下鍵用） */
    const columns = () => {
      const top = els[0]?.offsetTop ?? 0;
      const n = els.findIndex((e) => e.offsetTop !== top);
      return n > 0 ? n : els.length;
    };

    cards.replaceChildren();
    TOP_IDS.forEach((id, i) => {
      const c = buildTile(o.specs[id]);
      c.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') setIdx(i);
      });
      // 點完就移開焦點：否則之後按 Enter／Space 會同時觸發按鈕與鍵盤處理，選取與取消互相抵消
      c.addEventListener('click', () => {
        toggle(i);
        c.blur();
      });
      els.push(c);
      cards.append(c);
    });
    go.onclick = () => {
      go.blur();
      confirm();
    };
    this.selectKeys = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a') setIdx(idx - 1);
      else if (k === 'ArrowRight' || k === 'd') setIdx(idx + 1);
      else if (k === 'ArrowUp' || k === 'w') {
        e.preventDefault();
        setIdx(idx - columns());
      } else if (k === 'ArrowDown' || k === 's') {
        e.preventDefault();
        setIdx(idx + columns());
      } else if (k === ' ') {
        e.preventDefault();
        toggle(idx);
      } else if (k === 'Enter') {
        e.preventDefault();
        if (picks.length === 3) confirm();
        else toggle(idx);
      } else if (k === 'Backspace' && picks.length) {
        picks.pop();
        refresh();
      } else if (k === '1' || k === '2' || k === '3') {
        setDiff(DIFFICULTY_IDS[Number(k) - 1]);
      } else if (k === 'q' || k === 'e') {
        const i = arenaChoices.indexOf(arena) + (k === 'e' ? 1 : -1);
        setArena(arenaChoices[(i + arenaChoices.length) % arenaChoices.length]);
      }
    };
    window.addEventListener('keydown', this.selectKeys);
    root.hidden = false;
    setIdx(0);
  }

  /** 延長賽：從自己的三顆挑一顆出戰（點一下即決定；鍵盤 ← → 移動、Enter 決定） */
  showOvertimePick(team: TopSpec[], onHover: (t: TopId) => void, onPick: (t: TopId) => void): void {
    const root = $('#overtime');
    const cards = $('.cards', root);
    cards.replaceChildren();
    let idx = 0;
    const setIdx = (i: number) => {
      idx = (i + team.length) % team.length;
      els.forEach((e, k) => e.classList.toggle('on', k === idx));
      onHover(team[idx].id);
    };
    const pick = () => {
      if (this.selectKeys) window.removeEventListener('keydown', this.selectKeys);
      this.selectKeys = null;
      root.hidden = true;
      onPick(team[idx].id);
    };
    const els = team.map((sp, i) => {
      const c = buildCard(sp);
      c.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') setIdx(i);
      });
      c.addEventListener('click', () => {
        c.blur();
        setIdx(i);
        pick();
      });
      cards.append(c);
      return c;
    });
    this.selectKeys = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') setIdx(idx - 1);
      else if (e.key === 'ArrowRight' || e.key === 'd') setIdx(idx + 1);
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    };
    window.addEventListener('keydown', this.selectKeys);
    root.hidden = false;
    setIdx(0);
  }

  /** 收起延長賽選擇畫面（展示模式自動挑選時用） */
  hideOvertimePick(): void {
    $('#overtime').hidden = true;
    if (this.selectKeys) window.removeEventListener('keydown', this.selectKeys);
    this.selectKeys = null;
  }

  /** 對戰中的賽況：BATTLE n/3 或延長賽、場地名，以及雙方陣容小圖示（出戰中、已出戰與得分） */
  setMatchInfo(m: TeamMatch, specs: Record<TopId, TopSpec>, arenaName: string): void {
    const pair = currentPairing(m);
    $('#hud .info').textContent = `${pair ? (pair.overtime ? '延長賽' : `BATTLE ${pair.battle}/3`) : 'FINAL'}・${arenaName}`;
    const side = (team: TopId[], who: 0 | 1) =>
      team.map((t) => {
        const c = chip(specs[t]);
        const rec = m.results.filter((r) => (who === 0 ? r.player : r.cpu) === t);
        if (rec.length) {
          c.classList.add('done');
          const pts = rec.reduce((a, r) => a + r.points[who], 0);
          c.append(el('b', '', pts ? `+${pts}` : '0'));
        }
        if (pair && (who === 0 ? pair.player : pair.cpu) === t) c.classList.add('cur');
        return c;
      });
    // CPU 陣容依名鑑順序排列，避免洩漏出場順序
    const cpuShown = TOP_IDS.filter((t) => m.cpu.includes(t));
    $('#hud .lineup .t0').replaceChildren(...side(m.player, 0));
    $('#hud .lineup .t1').replaceChildren(...side(cpuShown, 1));
  }

  /** 顯示對戰 HUD 並填入名稱 */
  showHud(a: TopSpec, b: TopSpec): void {
    const hud = $('#hud');
    hud.hidden = false;
    hud.style.setProperty('--p0', css(a.glow));
    hud.style.setProperty('--p1', css(b.glow));
    $('.panel[data-side="0"] .name', hud).textContent = `YOU ｜ ${a.nameJa}`;
    $('.panel[data-side="1"] .name', hud).textContent = `${b.nameJa} ｜ CPU`;
  }

  hideHud(): void {
    $('#hud').hidden = true;
  }

  /** 每幀更新轉速、爆裂量、必殺量與比分 */
  updateHud(tops: TopState[], score: [number, number]): void {
    const hud = $('#hud');
    tops.forEach((t, i) => {
      const p = $(`.panel[data-side="${i}"]`, hud);
      const r = t.alive ? spinRatio(t) : 0;
      $('.val', p).textContent = String(Math.round(t.spin * 9.55 * 2.4));
      $('.spin i', p).style.width = `${r * 100}%`;
      $('.burst i', p).style.width = `${Math.min(1, t.burst) * 100}%`;
      $('.burst', p).classList.toggle('danger', t.burst > 0.7 && t.alive);
      $('.special i', p).style.width = `${(t.specialUsed ? 0 : t.special) * 100}%`;
      p.classList.toggle('can', t.alive && !t.specialUsed && t.special >= 1);
    });
    $('.s0', hud).textContent = String(score[0]);
    $('.s1', hud).textContent = String(score[1]);
  }

  /** 中央大字；seconds 後淡出（0 = 一直顯示） */
  banner(text: string, sub = '', opts: { small?: boolean; blue?: boolean; seconds?: number } = {}): void {
    const root = $('#banner');
    window.clearTimeout(this.bannerTimer);
    const b = el('div', 'bn' + (opts.small ? ' small' : '') + (opts.blue ? ' blue' : ''), text);
    const nodes: HTMLElement[] = [b];
    if (sub) nodes.push(el('div', 'bn-sub', sub));
    root.replaceChildren(...nodes);
    const sec = opts.seconds ?? 1.2;
    if (sec > 0) {
      this.bannerTimer = window.setTimeout(() => {
        nodes.forEach((n) => n.classList.add('out'));
      }, sec * 1000);
    }
  }

  clearBanner(): void {
    window.clearTimeout(this.bannerTimer);
    $('#banner').replaceChildren();
  }

  /** 擬聲字：在螢幕座標 (x, y) 跳出一個大字 */
  onomatopoeia(x: number, y: number, text: string, size: number, color: string): void {
    const e = el('div', 'ono', text);
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    e.style.fontSize = `${size}px`;
    e.style.setProperty('--c', color);
    e.style.setProperty('--r', `${(Math.random() - 0.5) * 24}deg`);
    $('#fx-layer').append(e);
    window.setTimeout(() => e.remove(), 950);
  }

  /**
   * 發射台：時機環（外圈收縮，對上內圈 = 「ゴー」）與拉條。
   * progress 為 0..1（1 = 外圈剛好對上內圈）；cord 為拉條中的狀態（沒在拉時為 null）。
   */
  launchMeter(show: boolean, progress = 0, cord: CordView | null = null): void {
    const root = $('#launch');
    root.hidden = !show;
    if (!show) return;
    const scale = 1 + Math.max(0, 1 - progress) * 2.4;
    const c = $('.closing', root);
    c.style.transform = `scale(${scale})`;
    c.style.opacity = progress > 1.25 ? '0' : '1';
    root.classList.toggle('pulling', cord !== null);
    const line = root.querySelector('.cord line') as SVGLineElement;
    const knob = root.querySelector('.cord circle') as SVGCircleElement;
    if (cord) {
      line.setAttribute('x1', String(cord.from.x));
      line.setAttribute('y1', String(cord.from.y));
      line.setAttribute('x2', String(cord.to.x));
      line.setAttribute('y2', String(cord.to.y));
      knob.setAttribute('cx', String(cord.to.x));
      knob.setAttribute('cy', String(cord.to.y));
      $('.power i', root).style.width = `${Math.round(cord.power * 100)}%`;
      $('.power span', root).textContent = `POWER ${Math.round(cord.power * 100)}%　${aimText(cord.aim)}`;
    } else {
      $('.power i', root).style.width = '0%';
      $('.power span', root).textContent = 'POWER';
    }
  }

  /** 必殺技 cut-in 橫幅（何時收起由遊戲時鐘決定，見 hideCutin） */
  cutin(spec: TopSpec, isPlayer: boolean): void {
    const root = $('#cutin');
    const band = $('.band', root);
    band.style.setProperty('--c', css(spec.glow));
    $('.who', root).textContent = isPlayer ? `YOU ｜ ${spec.nameJa}` : `CPU ｜ ${spec.nameJa}`;
    $('.move', root).textContent = `必殺！${spec.special.nameJa}`;
    root.hidden = false;
    // 重新觸發動畫
    band.style.animation = 'none';
    void band.offsetWidth;
    band.style.animation = '';
  }

  hideCutin(): void {
    $('#cutin').hidden = true;
  }

  /** 結果畫面：勝負、總分與每一戰的對陣和終結方式 */
  showResult(win: boolean, m: TeamMatch, specs: Record<TopId, TopSpec>, footnote: string, onRetry: () => void): void {
    const root = $('#result');
    $('.headline', root).textContent = win ? 'YOU WIN!!' : 'YOU LOSE…';
    $('.final', root).textContent = `${m.score[0]} - ${m.score[1]}`;
    $('.diff', root).textContent = footnote;
    $('.breakdown', root).replaceChildren(
      ...m.results.map((r) => {
        const label = r.overtime ? '延長賽' : `第 ${r.battle} 戰`;
        return el(
          'li',
          r.winner === 0 ? 'w' : 'l',
          `${label}　${specs[r.player].nameZh} VS ${specs[r.cpu].nameZh}　${FINISH_EN[r.finish]}　${r.winner === 0 ? 'YOU' : 'CPU'} +${r.points[r.winner]}`,
        );
      }),
    );
    const btn = $<HTMLButtonElement>('.retry', root);
    btn.onclick = () => {
      root.hidden = true;
      onRetry();
    };
    root.hidden = false;
  }

  hideResult(): void {
    $('#result').hidden = true;
  }
}

/** 瞄準角度的文字（例如「→ 12°」） */
function aimText(aim: number): string {
  const deg = Math.round((aim * 180) / Math.PI);
  if (Math.abs(deg) < 3) return '正面';
  return `${deg > 0 ? '右' : '左'} ${Math.abs(deg)}°`;
}
