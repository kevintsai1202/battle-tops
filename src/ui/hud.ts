import { spinRatio } from '../sim/physics';
import { currentPairing, type TeamMatch } from '../sim/team';
import { TOP_EMBLEM, TOP_TYPES } from '../sim/tops';
import type { FinishType, TopSpec, TopState, TopType } from '../sim/types';

/** 類型的顯示名稱 */
const TYPE_LABEL: Record<TopType, string> = { attack: '攻擊型', defense: '防禦型', stamina: '持久型', balance: '平衡型' };

/** 終結方式的英文名稱（結果畫面用） */
const FINISH_EN: Record<FinishType, string> = { spin: 'SPIN FINISH', over: 'OVER FINISH', burst: 'BURST FINISH' };

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

/** 數字色碼轉 CSS */
export function css(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

/** 陣容小圖示：圓形底 + 紋章字，顏色取陀螺發光色 */
function chip(sp: TopSpec): HTMLElement {
  const c = document.createElement('i');
  c.className = 'chip';
  c.style.setProperty('--c', css(sp.glow));
  c.title = sp.nameZh;
  c.textContent = TOP_EMBLEM[sp.type];
  return c;
}

/** 陀螺卡片（組隊與延長賽共用）：順序徽章、名稱、類型、能力條、必殺技名 */
function buildCard(sp: TopSpec): HTMLButtonElement {
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'card';
  c.style.setProperty('--c', css(sp.glow));
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
  const badge = document.createElement('span');
  badge.className = 'badge';
  const ja = document.createElement('div');
  ja.className = 'ja';
  ja.textContent = sp.nameJa;
  const zh = document.createElement('div');
  zh.className = 'zh';
  zh.textContent = sp.nameZh;
  const tag = document.createElement('span');
  tag.className = 'type';
  tag.textContent = TYPE_LABEL[sp.type];
  const spd = document.createElement('div');
  spd.className = 'sp';
  spd.textContent = `必殺：${sp.specialJa}`;
  c.append(badge, ja, zh, tag, stat('攻擊', sp.attack), stat('防禦', sp.defense), stat('持久', sp.stamina), stat('機動', sp.cruise / 3), spd);
  return c;
}

/**
 * DOM 覆蓋層：標題、組隊、延長賽選擇、對戰 HUD、中央大字、擬聲字、發射量表、必殺 cut-in、結果畫面。
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
   * 組隊畫面：四選三，點選的順序就是出場順序（卡片右上角顯示 1、2、3）。
   * 點卡片加入或取消；湊滿 3 顆後按「出陣！」。CPU 的三顆公開顯示，順序保密。
   * 鍵盤：← → 移動、Space 選取／取消、Enter 選取（滿 3 顆時出陣）、Backspace 退回上一顆。
   * onHover 在游標移動時呼叫（用來換 3D 預覽）。
   */
  showTeamSelect(specs: Record<TopType, TopSpec>, cpuTeam: TopType[], onHover: (t: TopType) => void, onConfirm: (team: TopType[]) => void): void {
    const root = $('#select');
    const cards = $('.cards', root);
    cards.replaceChildren();
    // CPU 陣容：依固定順序顯示，不洩漏出場順序
    $('.cpu-team .chips', root).replaceChildren(...TOP_TYPES.filter((t) => cpuTeam.includes(t)).map((t) => chip(specs[t])));
    const go = $<HTMLButtonElement>('.go', root);
    const slots = $('.slots', root);
    let idx = 0;
    const picks: TopType[] = [];
    const els: HTMLButtonElement[] = [];

    const refresh = () => {
      els.forEach((e, k) => {
        const n = picks.indexOf(TOP_TYPES[k]);
        e.classList.toggle('on', k === idx);
        e.classList.toggle('picked', n >= 0);
        $('.badge', e).textContent = n >= 0 ? String(n + 1) : '';
      });
      slots.replaceChildren(
        ...[0, 1, 2].map((i) => {
          const sl = document.createElement('span');
          sl.className = 'slot';
          sl.textContent = `${i + 1}`;
          if (picks[i]) sl.append(chip(specs[picks[i]]));
          return sl;
        }),
      );
      go.disabled = picks.length !== 3;
    };
    const setIdx = (i: number) => {
      idx = (i + TOP_TYPES.length) % TOP_TYPES.length;
      onHover(TOP_TYPES[idx]);
      refresh();
    };
    const toggle = (i: number) => {
      const t = TOP_TYPES[i];
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
      onConfirm([...picks]);
    };

    TOP_TYPES.forEach((type, i) => {
      const c = buildCard(specs[type]);
      c.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') setIdx(i);
      });
      c.addEventListener('click', () => toggle(i));
      els.push(c);
      cards.append(c);
    });
    go.onclick = confirm;
    this.selectKeys = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') setIdx(idx - 1);
      else if (e.key === 'ArrowRight' || e.key === 'd') setIdx(idx + 1);
      else if (e.key === ' ') toggle(idx);
      else if (e.key === 'Enter') {
        if (picks.length === 3) confirm();
        else toggle(idx);
      } else if (e.key === 'Backspace' && picks.length) {
        picks.pop();
        refresh();
      }
    };
    window.addEventListener('keydown', this.selectKeys);
    root.hidden = false;
    setIdx(0);
  }

  /** 延長賽：從自己的三顆挑一顆出戰（點一下即決定；鍵盤 ← → 移動、Enter 決定） */
  showOvertimePick(team: TopSpec[], onHover: (t: TopType) => void, onPick: (t: TopType) => void): void {
    const root = $('#overtime');
    const cards = $('.cards', root);
    cards.replaceChildren();
    let idx = 0;
    const setIdx = (i: number) => {
      idx = (i + team.length) % team.length;
      els.forEach((e, k) => e.classList.toggle('on', k === idx));
      onHover(team[idx].type);
    };
    const pick = () => {
      if (this.selectKeys) window.removeEventListener('keydown', this.selectKeys);
      this.selectKeys = null;
      root.hidden = true;
      onPick(team[idx].type);
    };
    const els = team.map((sp, i) => {
      const c = buildCard(sp);
      c.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse') setIdx(i);
      });
      c.addEventListener('click', () => {
        setIdx(i);
        pick();
      });
      cards.append(c);
      return c;
    });
    this.selectKeys = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') setIdx(idx - 1);
      else if (e.key === 'ArrowRight' || e.key === 'd') setIdx(idx + 1);
      else if (e.key === 'Enter' || e.key === ' ') pick();
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

  /** 對戰中的賽況：BATTLE n/3 或延長賽，以及雙方陣容小圖示（出戰中、已出戰與得分） */
  setMatchInfo(m: TeamMatch, specs: Record<TopType, TopSpec>): void {
    const pair = currentPairing(m);
    $('#hud .info').textContent = pair ? (pair.overtime ? '延長賽' : `BATTLE ${pair.battle}/3`) : 'FINAL';
    const side = (team: TopType[], who: 0 | 1) =>
      team.map((t) => {
        const c = chip(specs[t]);
        const rec = m.results.filter((r) => (who === 0 ? r.player : r.cpu) === t);
        if (rec.length) {
          c.classList.add('done');
          const pts = rec.reduce((a, r) => a + r.points[who], 0);
          const b = document.createElement('b');
          b.textContent = pts ? `+${pts}` : '0';
          c.append(b);
        }
        if (pair && (who === 0 ? pair.player : pair.cpu) === t) c.classList.add('cur');
        return c;
      });
    // CPU 陣容依固定順序排列，避免洩漏出場順序
    const cpuShown = TOP_TYPES.filter((t) => m.cpu.includes(t));
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

  /** 結果畫面：勝負、總分與每一戰的對陣和終結方式 */
  showResult(win: boolean, m: TeamMatch, specs: Record<TopType, TopSpec>, onRetry: () => void): void {
    const el = $('#result');
    $('.headline', el).textContent = win ? 'YOU WIN!!' : 'YOU LOSE…';
    $('.final', el).textContent = `${m.score[0]} - ${m.score[1]}`;
    $('.breakdown', el).replaceChildren(
      ...m.results.map((r) => {
        const li = document.createElement('li');
        li.className = r.winner === 0 ? 'w' : 'l';
        const label = r.overtime ? '延長賽' : `第 ${r.battle} 戰`;
        li.textContent = `${label}　${specs[r.player].nameZh} VS ${specs[r.cpu].nameZh}　${FINISH_EN[r.finish]}　${r.winner === 0 ? 'YOU' : 'CPU'} +${r.points[r.winner]}`;
        return li;
      }),
    );
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
