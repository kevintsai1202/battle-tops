import { spinRatio } from '../sim/physics';
import { TOP_TYPES } from '../sim/tops';
import type { TopSpec, TopState, TopType } from '../sim/types';

/** 類型的顯示名稱 */
const TYPE_LABEL: Record<TopType, string> = { attack: '攻擊型', defense: '防禦型', stamina: '持久型', balance: '平衡型' };

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

/** 數字色碼轉 CSS */
export function css(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

/**
 * DOM 覆蓋層：標題、選角、對戰 HUD、中央大字、擬聲字、發射量表、必殺 cut-in、結果畫面。
 * 只負責畫面，遊戲邏輯在 Game。
 */
export class Hud {
  private bannerTimer = 0;
  private selectKeys: ((e: KeyboardEvent) => void) | null = null;

  /** 顯示標題畫面，點擊後呼叫 onStart */
  showTitle(onStart: () => void): void {
    const el = $('#title');
    el.hidden = false;
    const go = () => {
      el.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      el.hidden = true;
      onStart();
    };
    el.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }

  /**
   * 選角畫面：四張卡片，←→ 或滑鼠選擇，Enter／點擊決定。
   * onHover 在選擇變動時呼叫（用來換 3D 預覽）。
   */
  showSelect(specs: Record<TopType, TopSpec>, initial: TopType, onHover: (t: TopType) => void, onPick: (t: TopType) => void): void {
    const root = $('#select');
    const cards = $('.cards', root);
    cards.replaceChildren();
    let idx = TOP_TYPES.indexOf(initial);
    const els: HTMLButtonElement[] = [];
    const stat = (label: string, v: number) => {
      const row = document.createElement('div');
      row.className = 'stat';
      const s = document.createElement('span');
      s.textContent = label;
      const b = document.createElement('b');
      b.style.width = `${Math.min(100, (v / 1.8) * 100)}%`;
      row.append(s, b);
      return row;
    };
    TOP_TYPES.forEach((type, i) => {
      const sp = specs[type];
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'card';
      c.style.setProperty('--c', css(sp.glow));
      const ja = document.createElement('div');
      ja.className = 'ja';
      ja.textContent = sp.nameJa;
      const zh = document.createElement('div');
      zh.className = 'zh';
      zh.textContent = sp.nameZh;
      const tag = document.createElement('span');
      tag.className = 'type';
      tag.textContent = TYPE_LABEL[type];
      const spd = document.createElement('div');
      spd.className = 'sp';
      spd.textContent = `必殺：${sp.specialJa}`;
      c.append(ja, zh, tag, stat('攻擊', sp.attack), stat('防禦', sp.defense), stat('持久', sp.stamina), stat('機動', sp.cruise / 3), spd);
      c.addEventListener('pointerenter', () => setIdx(i));
      c.addEventListener('click', () => pick());
      els.push(c);
      cards.append(c);
    });
    const setIdx = (i: number) => {
      idx = (i + TOP_TYPES.length) % TOP_TYPES.length;
      els.forEach((e, k) => e.classList.toggle('on', k === idx));
      onHover(TOP_TYPES[idx]);
    };
    const pick = () => {
      if (this.selectKeys) window.removeEventListener('keydown', this.selectKeys);
      this.selectKeys = null;
      root.hidden = true;
      onPick(TOP_TYPES[idx]);
    };
    this.selectKeys = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') setIdx(idx - 1);
      else if (e.key === 'ArrowRight' || e.key === 'd') setIdx(idx + 1);
      else if (e.key === 'Enter' || e.key === ' ') pick();
    };
    window.addEventListener('keydown', this.selectKeys);
    root.hidden = false;
    setIdx(idx);
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
    const b = document.createElement('div');
    b.className = 'bn' + (opts.small ? ' small' : '') + (opts.blue ? ' blue' : '');
    b.textContent = text;
    const nodes: HTMLElement[] = [b];
    if (sub) {
      const s = document.createElement('div');
      s.className = 'bn-sub';
      s.textContent = sub;
      nodes.push(s);
    }
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
    const el = document.createElement('div');
    el.className = 'ono';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.fontSize = `${size}px`;
    el.style.setProperty('--c', color);
    el.style.setProperty('--r', `${(Math.random() - 0.5) * 24}deg`);
    $('#fx-layer').append(el);
    window.setTimeout(() => el.remove(), 950);
  }

  /** 發射量表：progress 為 0..1（1 = 外圈剛好對上內圈，也就是「ゴー」的瞬間） */
  launchMeter(show: boolean, progress = 0): void {
    const el = $('#launch');
    el.hidden = !show;
    if (!show) return;
    const scale = 1 + Math.max(0, 1 - progress) * 2.4;
    const c = $('.closing', el);
    c.style.transform = `scale(${scale})`;
    c.style.opacity = progress > 1.25 ? '0' : '1';
  }

  /** 必殺技 cut-in 橫幅（何時收起由遊戲時鐘決定，見 hideCutin） */
  cutin(spec: TopSpec, isPlayer: boolean): void {
    const el = $('#cutin');
    const band = $('.band', el);
    band.style.setProperty('--c', css(spec.glow));
    $('.who', el).textContent = isPlayer ? `YOU ｜ ${spec.nameJa}` : `CPU ｜ ${spec.nameJa}`;
    $('.move', el).textContent = `必殺！${spec.specialJa}`;
    el.hidden = false;
    // 重新觸發動畫
    band.style.animation = 'none';
    void band.offsetWidth;
    band.style.animation = '';
  }

  hideCutin(): void {
    $('#cutin').hidden = true;
  }

  /** 結果畫面 */
  showResult(win: boolean, score: [number, number], onRetry: () => void): void {
    const el = $('#result');
    $('.headline', el).textContent = win ? 'YOU WIN!!' : 'YOU LOSE…';
    $('.final', el).textContent = `${score[0]} - ${score[1]}`;
    const btn = $<HTMLButtonElement>('.retry', el);
    btn.onclick = () => {
      el.hidden = true;
      onRetry();
    };
    el.hidden = false;
  }

  hideResult(): void {
    $('#result').hidden = true;
  }
}
