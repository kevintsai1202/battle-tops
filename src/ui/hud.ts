import { ARENA_IDS, ARENAS, type ArenaId } from '../sim/arena';
import { DIFFICULTY_IDS, type DifficultyId } from '../sim/difficulty';
import { equip, STOCK, type TeamLoadouts } from '../sim/parts';
import { spinRatio } from '../sim/physics';
import { currentPairing, type Pairing, type TeamMatch } from '../sim/team';
import { buildSpec, TOP_IDS, TYPE_LABEL } from '../sim/tops';
import type { FinishType, TopId, TopSpec, TopState } from '../sim/types';
import { $, chip, css, el, spinLabel, STAT_AXES, statScore } from './common';
import { DetailView } from './detail';

export { css } from './common';

/** 終結方式的英文名稱（結果畫面用） */
const FINISH_EN: Record<FinishType, string> = { spin: 'SPIN FINISH', over: 'OVER FINISH', burst: 'BURST FINISH' };

/** 場地選擇：五個場地加上「隨機」 */
export type ArenaChoice = ArenaId | 'random';

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

/** 組隊畫面的陀螺小格：3D 縮圖（還沒產生時顯示紋章，見 setTileThumb）、中文名、類型色條，左旋另外標示 */
function buildTile(sp: TopSpec): HTMLButtonElement {
  const c = el('button', 'card tile');
  c.type = 'button';
  c.dataset.id = sp.id;
  c.dataset.type = sp.type;
  c.style.setProperty('--c', css(sp.glow));
  c.title = `${sp.nameZh}（${TYPE_LABEL[sp.type]}）`;
  const img = el('img', 'thumb');
  img.alt = '';
  img.hidden = true;
  const emb = el('i', 'emb', sp.emblem);
  c.append(el('span', 'badge'), img, emb, el('span', 'nm', sp.nameZh), el('span', 'ty', TYPE_LABEL[sp.type].slice(0, 1)));
  if (sp.spinDir === -1) c.append(el('span', 'left', '左'));
  return c;
}

/** 小格換上 3D 縮圖（隱藏紋章字） */
function setTileThumb(tile: HTMLElement, url: string): void {
  const img = tile.querySelector('img') as HTMLImageElement;
  img.src = url;
  img.hidden = false;
  (tile.querySelector('.emb') as HTMLElement).hidden = true;
}

/** 組隊畫面的參數 */
export interface TeamSelectOptions {
  specs: Record<TopId, TopSpec>;
  cpuTeam: TopId[];
  difficulty: DifficultyId;
  arena: ArenaChoice;
  onDifficulty: (d: DifficultyId) => void;
  onArena: (a: ArenaChoice) => void;
  /** 游標移動或換零件時呼叫（spec 已套用零件；用來換 3D 預覽與絕招示範） */
  onHover: (spec: TopSpec) => void;
  /** 要一張 3D 縮圖（dataURL）：有快取時立刻回呼，否則產生後回呼 */
  thumb: (spec: TopSpec, cb: (url: string) => void) => void;
  /** 預先選好的三顆（從第 2 步回上一步時帶入；順序即點選順序） */
  picks?: TopId[];
  /** 下一步：選好的三顆（點選順序是第 2 步的預設出場順序） */
  onNext: (picks: TopId[]) => void;
  /**
   * 線上對戰：隱藏難度；CPU 陣容的位置改成顯示對手狀態；只有房主能選場地（客人只看得到房主的選擇）。
   * 之後的對手狀態與場地變化用 updateSelectOnline 更新。
   */
  online?: { host: boolean; opponent: string };
}

/** 組隊第 2 步（出場順序與零件）的參數 */
export interface ArrangeOptions {
  specs: Record<TopId, TopSpec>;
  /** 一開始的出場順序與零件（第 1 步選的順序；線上重連時是伺服器記得的設定） */
  order: TopId[];
  loadouts: TeamLoadouts;
  /** 對手：標題（CPU チーム／對手：名稱）、三顆（依名鑑順序，出場順序保密）與狀態文字 */
  opponent: { label: string; team: TopId[]; note: string };
  /** 場地名稱 */
  arena: string;
  /** 截止的本機時間（毫秒）；null 為不計時（CPU 模式） */
  deadline: number | null;
  /** 確定按鈕的文字（CPU：出陣！；線上：準備完成） */
  readyLabel: string;
  /** 回上一步（CPU 模式才有；帶回目前的順序與零件） */
  onBack?: (order: TopId[], loadouts: TeamLoadouts) => void;
  /** 順序或零件改變時（線上：同步給伺服器，時間到時用最後一份） */
  onChange?: (order: TopId[], loadouts: TeamLoadouts) => void;
  /** 確定（出陣／準備完成） */
  onReady: (order: TopId[], loadouts: TeamLoadouts) => void;
  /** 選到的陀螺（spec 已套用零件；換 3D 示範用） */
  onHover: (spec: TopSpec) => void;
  /** 要一張 3D 縮圖（dataURL） */
  thumb: (spec: TopSpec, cb: (url: string) => void) => void;
}

/** 線上房間畫面的參數 */
export interface OnlineLobbyOptions {
  /** 預設名稱與房號（從分享連結進來時帶入） */
  name: string;
  code: string;
  /** 建立房間（isPublic：是否列在房間列表） */
  onCreate: (name: string, isPublic: boolean) => void;
  /** 用房號加入（輸入房號或點房間列表） */
  onJoin: (code: string, name: string) => void;
  /** 快速加入 */
  onQuick: (name: string) => void;
  onBack: () => void;
}

/** 房間列表的一列（與 src/net/protocol.ts 的 RoomSummary 相同） */
export interface RoomRow {
  code: string;
  host: string;
  guest: string | null;
  arena: ArenaId | 'random';
  status: 'waiting' | 'playing';
  waited: number;
}

/** 結果畫面的額外選項（線上對戰用） */
export interface ResultOptions {
  /** 對手的稱呼（預設 CPU） */
  opponent?: string;
  /** 再來一場的按鈕文字 */
  retryLabel?: string;
  /** 按了再來一場後不關閉結果畫面（線上要等對手也按） */
  keepOpen?: boolean;
  /** 顯示「離開」按鈕 */
  onLeave?: () => void;
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
  /** 組隊畫面的詳細資料（含絕招示範舞台） */
  private detail: DetailView | null = null;
  /** 線上組隊時更新場地與對手狀態用（組隊畫面開著時才有） */
  private selectOnline: { setArena: (a: ArenaChoice) => void } | null = null;
  /** 線上房間畫面正在連線（按鈕停用中） */
  private onlineBusy = false;
  /** 第 2 步：倒數的定時器、鍵盤操作、鎖定（準備完成或時間到）的函式（畫面開著時才有） */
  private arrangeTimer = 0;
  private arrangeKeys: ((e: KeyboardEvent) => void) | null = null;
  private arrangeLock: ((status: string) => void) | null = null;
  /** 目前畫在房間列表上的內容（沒變就不重畫） */
  private roomsKey = '';

  /**
   * 顯示標題畫面，點擊後呼叫 onStart。
   * 用 click 而不是 pointerdown：觸控時瀏覽器在 pointerdown 之後才補送 click，
   * 若在 pointerdown 就切到組隊畫面，這個 click 會落在剛出現的陀螺小格上，誤選一顆。
   */
  showTitle(onStart: () => void, onOnline?: () => void): void {
    const title = $('#title');
    const online = $<HTMLButtonElement>('.to-online', title);
    title.hidden = false;
    online.hidden = !onOnline;
    const stop = () => {
      title.removeEventListener('click', go);
      window.removeEventListener('keydown', go);
      online.onclick = null;
      title.hidden = true;
    };
    const go = () => {
      stop();
      onStart();
    };
    // 線上對戰按鈕：攔住事件，不要讓標題的「點任意處開始 CPU 對戰」也觸發
    online.onclick = (e) => {
      e.stopPropagation();
      stop();
      onOnline?.();
    };
    title.addEventListener('click', go);
    window.addEventListener('keydown', go);
  }

  /** 線上房間畫面：輸入名稱，建立房間或用房號加入 */
  showOnlineLobby(o: OnlineLobbyOptions): void {
    const root = $('#online');
    const name = $<HTMLInputElement>('.ol-name input', root);
    const code = $<HTMLInputElement>('.ol-code', root);
    name.value = o.name;
    code.value = o.code;
    $('.ol-room', root).hidden = true;
    $('.ol-form', root).hidden = false;
    this.setOnlineMessage('');
    this.setOnlineBusy(false);
    const priv = $<HTMLInputElement>('.ol-private input', root);
    priv.checked = false;
    $<HTMLButtonElement>('.ol-create', root).onclick = () => o.onCreate(name.value, !priv.checked);
    $<HTMLButtonElement>('.ol-quick', root).onclick = () => o.onQuick(name.value);
    // 房間列表：點等人中的房間就加入（列表會定時重畫，所以用事件委派）
    $('.ol-rooms', root).onclick = (e) => {
      const row = (e.target as HTMLElement).closest<HTMLButtonElement>('button.ol-room-row');
      if (row && !row.disabled && row.dataset.code) o.onJoin(row.dataset.code, name.value);
    };
    this.roomsKey = '';
    this.setRoomList([], '連線中…');
    const join = () => {
      const c = code.value.trim().toUpperCase();
      if (c.length !== 4) return this.setOnlineMessage('房號是 4 個字（英文與數字）', true);
      o.onJoin(c, name.value);
    };
    $<HTMLButtonElement>('.ol-join-btn', root).onclick = join;
    code.onkeydown = (e) => {
      if (e.key === 'Enter') join();
    };
    $<HTMLButtonElement>('.ol-back', root).onclick = () => o.onBack();
    $<HTMLButtonElement>('.ol-copy', root).onclick = () => {
      const link = $<HTMLInputElement>('.ol-link', root).value;
      void navigator.clipboard?.writeText(link).then(
        () => this.setOnlineMessage('已複製連結，傳給朋友開啟就能加入'),
        () => this.setOnlineMessage('無法自動複製，請手動複製連結'),
      );
    };
    root.hidden = false;
    document.body.classList.add('selecting');
  }

  /** 線上房間畫面：進房後顯示房號、分享連結與狀態（code 為 null 時回到輸入畫面） */
  setOnlineRoom(code: string | null, link = '', status = ''): void {
    const root = $('#online');
    $('.ol-room', root).hidden = code === null;
    $('.ol-form', root).hidden = code !== null;
    if (code === null) return;
    $('.ol-code-big', root).textContent = code;
    $<HTMLInputElement>('.ol-link', root).value = link;
    $('.ol-status', root).textContent = status;
  }

  /** 線上房間畫面的提示文字（error 時標紅） */
  setOnlineMessage(text: string, error = false): void {
    const m = $('#online .ol-msg');
    m.textContent = text;
    m.classList.toggle('err', error);
  }

  /** 連線中時停用按鈕（含房間列表的列） */
  setOnlineBusy(busy: boolean): void {
    this.onlineBusy = busy;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#online .ol-form button')) b.disabled = busy;
  }

  /**
   * 房間列表：等人中的列是按鈕（點一下加入），對戰中的列灰色、不能點；note 為列表標題旁的狀態文字。
   * 名稱是別的玩家取的，一律用 textContent 放進畫面（不當成 HTML）；內容沒變就不重畫（避免手指按下時列被換掉）。
   */
  setRoomList(rooms: RoomRow[], note: string): void {
    const root = $('#online');
    $('.ol-list-note', root).textContent = note;
    const key = JSON.stringify(rooms);
    if (key === this.roomsKey) return;
    this.roomsKey = key;
    const list = $('.ol-rooms', root);
    list.replaceChildren();
    if (!rooms.some((r) => r.status === 'waiting')) {
      const empty = el('p', 'ol-empty');
      empty.textContent = '目前沒有等人的房間：按「快速加入」會幫你開一間公開房間等人';
      list.append(empty);
    }
    for (const r of rooms) {
      const waiting = r.status === 'waiting';
      const row = waiting ? el('button', 'ol-room-row') : el('div', 'ol-room-row playing');
      row.dataset.code = r.code;
      if (row instanceof HTMLButtonElement) {
        row.type = 'button';
        row.disabled = this.onlineBusy;
      } else row.setAttribute('aria-disabled', 'true');
      const who = el('span', 'rr-host');
      who.textContent = waiting ? r.host : `${r.host} vs ${r.guest ?? ''}`;
      const meta = el('span', 'rr-meta');
      const arena = r.arena === 'random' ? '隨機場地' : ARENAS[r.arena].nameZh;
      meta.textContent = `${arena}・${waiting ? waitedLabel(r.waited) : '對戰中'}`;
      const go = el('span', 'rr-go');
      go.textContent = waiting ? '加入 ▶' : '—';
      row.append(who, meta, go);
      list.append(row);
    }
  }

  hideOnlineLobby(): void {
    $('#online').hidden = true;
  }

  /** 連線與等待的覆蓋層（對手斷線、重新連線中、等待對手組隊等） */
  showNetOverlay(text: string, sub = ''): void {
    const root = $('#net-overlay');
    $('.no-text', root).textContent = text;
    $('.no-sub', root).textContent = sub;
    root.hidden = false;
  }

  hideNetOverlay(): void {
    $('#net-overlay').hidden = true;
  }

  /**
   * 組隊畫面：從全部陀螺挑三顆，點選的順序就是出場順序（小格右上角顯示 1、2、3）。
   * 點小格加入或取消；湊滿 3 顆後按「出陣！」。CPU 的三顆公開顯示，順序保密。
   * 右側顯示游標所在陀螺的外觀與絕招示範、屬性雷達圖、零件選單與必殺技說明；隊伍中的陀螺可以換盤與軸，
   * 雷達圖與數值立刻更新。備用零件每種一件，陀螺離開隊伍時它身上的備用零件自動歸還。上方可切換難度與場地。
   * 鍵盤：方向鍵移動、Space 選取／取消、Enter 選取（滿 3 顆時出陣）、Backspace 退回上一顆、
   * 1／2／3 切換難度、Q／E 切換場地。
   */
  showTeamSelect(o: TeamSelectOptions): void {
    const root = $('#select');
    const online = o.online ?? null;
    // 線上：沒有難度；客人不能選場地
    $('.difficulty', root).hidden = !!online;
    root.classList.toggle('online', !!online);
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
      b.disabled = !!online && !online.host;
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
    // 線上：伺服器通知場地變化時只更新畫面（不再回報）
    this.selectOnline = online
      ? {
          setArena: (id: ArenaChoice) => {
            arena = id;
            arenaBtns.forEach((b) => b.classList.toggle('on', b.dataset.id === id));
            $('.arena-desc', root).textContent = id === 'random' ? '開打時從五個場地隨機抽一個。' : ARENAS[id].descZh;
          },
        }
      : null;

    const cards = $('.cards', root);
    /** 第 1 步只看原廠規格的介紹與絕招示範；換零件在第 2 步 */
    const specOf = (t: TopId) => o.specs[t];
    const detail = new DetailView($('.detail', root), undefined, { parts: false });
    this.detail = detail;
    // CPU 陣容：依名鑑順序顯示，不洩漏出場順序；線上時改成對手狀態
    $('.cpu-team .chips', root).replaceChildren(...TOP_IDS.filter((t) => o.cpuTeam.includes(t)).map((t) => chip(o.specs[t])));
    $('.cpu-team .ct-label', root).textContent = online ? `對手：${online.opponent}` : 'CPU チーム';
    $('.cpu-team small', root).textContent = online ? '選擇中…' : '出場順序保密';
    const go = $<HTMLButtonElement>('.go', root);
    const slots = $('.slots', root);
    let idx = 0;
    const picks: TopId[] = [...(o.picks ?? [])];
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
      const t = TOP_IDS[idx];
      const sp = specOf(t);
      o.onHover(sp);
      detail.show(sp, picks.includes(t), {});
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
      this.detail = null;
      this.selectOnline = null;
      document.body.classList.remove('selecting');
      o.onNext([...picks]);
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
      o.thumb(o.specs[id], (url) => setTileThumb(c, url));
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
      // 零件選單有焦點時，方向鍵與 Enter 交給選單本身
      if ((e.target as HTMLElement | null)?.tagName === 'SELECT') return;
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
        setIdx(idx);
      } else if ((k === '1' || k === '2' || k === '3') && !online) {
        setDiff(DIFFICULTY_IDS[Number(k) - 1]);
      } else if ((k === 'q' || k === 'e') && (!online || online.host)) {
        const i = arenaChoices.indexOf(arena) + (k === 'e' ? 1 : -1);
        setArena(arenaChoices[(i + arenaChoices.length) % arenaChoices.length]);
      }
    };
    window.addEventListener('keydown', this.selectKeys);
    root.hidden = false;
    // 組隊中隱藏對戰操作說明（手機上會蓋住出陣按鈕）
    document.body.classList.add('selecting');
    setIdx(0);
  }

  /**
   * 組隊第 2 步：三個出場欄位（▲▼ 或 Shift＋↑↓ 調換順序，點一顆就在右側換盤與軸）、對手公開的三顆、場地與倒數。
   * 零件規則同第 1 步以前：備用零件每種一件、同隊不能重複（equip 用整隊的零件狀態檢查）。
   * 線上：每次調整都呼叫 onChange（同步給伺服器）；倒數歸零或 lockArrange 後鎖定，不能再改。
   */
  showArrange(o: ArrangeOptions): void {
    this.hideArrange();
    const root = $('#arrange');
    /** 目前的出場順序、零件、選到第幾個欄位、是否鎖定 */
    const order = [...o.order];
    let loadouts: TeamLoadouts = structuredClone(o.loadouts);
    let sel = 0;
    let locked = false;
    const specOf = (t: TopId) => buildSpec(t, loadouts[t] ?? STOCK);

    $('.ar-opp-label', root).textContent = o.opponent.label;
    $('.ar-opp .chips', root).replaceChildren(...o.opponent.team.map((t) => chip(o.specs[t])));
    $('.ar-opp-note', root).textContent = o.opponent.note;
    $('.ar-arena', root).textContent = `場地：${o.arena}`;
    $('.ar-status', root).textContent = '';
    const back = $<HTMLButtonElement>('.ar-back', root);
    back.hidden = !o.onBack;
    back.disabled = false;
    const ready = $<HTMLButtonElement>('.ar-ready', root);
    ready.textContent = o.readyLabel;
    ready.disabled = false;

    const detail = new DetailView($('.ar-detail', root), (slot, part) => {
      if (locked) return;
      const t = order[sel];
      try {
        loadouts = equip(loadouts, t, o.specs[t].stock, slot, part);
      } catch {
        // 零件已被隊友使用（選單已停用該選項，正常不會發生）：維持原狀
      }
      changed();
    });
    this.detail = detail;

    const slots = $('.ar-slots', root);
    /** 重畫三個出場欄位與右側的詳細資料 */
    const render = () => {
      slots.replaceChildren(
        ...order.map((t, i) => {
          const sp = specOf(t);
          const li = el('li', 'ar-slot');
          li.dataset.id = t;
          li.classList.toggle('on', i === sel);
          const thumb = el('span', 'ar-thumb');
          o.thumb(sp, (url) => (thumb.style.backgroundImage = `url(${url})`));
          const name = el('span', 'ar-name', sp.nameZh);
          name.append(el('small', '', `${TYPE_LABEL[sp.type]}${loadouts[t] ? '・換了零件' : ''}`));
          const mv = el('span', 'ar-move');
          const up = el('button', 'ar-up', '▲');
          const down = el('button', 'ar-down', '▼');
          up.type = 'button';
          down.type = 'button';
          up.setAttribute('aria-label', '往前一戰');
          down.setAttribute('aria-label', '往後一戰');
          up.disabled = locked || i === 0;
          down.disabled = locked || i === order.length - 1;
          up.onclick = (e) => {
            e.stopPropagation();
            move(i, -1);
          };
          down.onclick = (e) => {
            e.stopPropagation();
            move(i, 1);
          };
          mv.append(up, down);
          li.append(el('span', 'ar-n', `第 ${i + 1} 戰`), thumb, name, mv);
          li.onclick = () => select(i);
          return li;
        }),
      );
      const sp = specOf(order[sel]);
      detail.show(sp, !locked, loadouts);
      o.onHover(sp);
    };
    const select = (i: number) => {
      sel = (i + order.length) % order.length;
      render();
    };
    /** 把第 i 個欄位的陀螺往前（d = -1）或往後（d = 1）調換一戰 */
    const move = (i: number, d: number) => {
      const j = i + d;
      if (locked || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      sel = j;
      changed();
    };
    const changed = () => {
      render();
      o.onChange?.([...order], structuredClone(loadouts));
    };
    /** 鎖定：準備完成或時間到之後不能再改 */
    const lock = (status: string) => {
      locked = true;
      ready.disabled = true;
      back.disabled = true;
      $('.ar-status', root).textContent = status;
      render();
    };
    this.arrangeLock = lock;
    const confirm = () => {
      if (!locked) o.onReady([...order], structuredClone(loadouts));
    };
    ready.onclick = () => {
      ready.blur();
      confirm();
    };
    back.onclick = () => {
      back.blur();
      if (locked || !o.onBack) return;
      this.hideArrange();
      o.onBack([...order], structuredClone(loadouts));
    };

    // 倒數（線上）：最後 10 秒變紅；歸零時鎖定，等伺服器用目前的設定開打
    const timer = $('.ar-timer', root);
    timer.hidden = o.deadline === null;
    if (o.deadline !== null) {
      const deadline = o.deadline;
      const tick = () => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        timer.textContent = left > 0 ? `剩 ${left} 秒` : '時間到';
        timer.classList.toggle('warn', left <= 10);
        if (left <= 0 && !locked) lock('時間到，用目前的順序與零件開戰…');
      };
      tick();
      this.arrangeTimer = window.setInterval(tick, 250);
    }

    this.arrangeKeys = (e: KeyboardEvent) => {
      // 零件選單有焦點時，方向鍵與 Enter 交給選單本身
      if ((e.target as HTMLElement | null)?.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') {
        e.preventDefault();
        if (e.shiftKey) move(sel, -1);
        else select(sel - 1);
      } else if (k === 'arrowdown' || k === 's') {
        e.preventDefault();
        if (e.shiftKey) move(sel, 1);
        else select(sel + 1);
      } else if (k === 'enter') {
        e.preventDefault();
        confirm();
      } else if ((k === 'backspace' || k === 'escape') && o.onBack) {
        e.preventDefault();
        back.click();
      }
    };
    window.addEventListener('keydown', this.arrangeKeys);
    root.hidden = false;
    document.body.classList.add('selecting');
    render();
  }

  /** 第 2 步鎖定（線上按了準備完成、或從伺服器得知已準備完成）：顯示狀態文字 */
  lockArrange(status: string): void {
    this.arrangeLock?.(status);
  }

  /** 第 2 步的對手狀態文字（調整中／準備完成／連線中斷） */
  updateArrangeOpponent(text: string): void {
    $('#arrange .ar-opp-note').textContent = text;
  }

  /** 收起第 2 步：停止倒數、拿掉鍵盤操作 */
  hideArrange(): void {
    window.clearInterval(this.arrangeTimer);
    this.arrangeTimer = 0;
    if (this.arrangeKeys) window.removeEventListener('keydown', this.arrangeKeys);
    this.arrangeKeys = null;
    this.arrangeLock = null;
    const root = $('#arrange');
    if (!root.hidden) {
      root.hidden = true;
      this.detail = null;
      document.body.classList.remove('selecting');
    }
  }

  /**
   * 收起組隊畫面（沒有出陣就離開時：線上房間關閉、對手離開、回到標題）：
   * 拿掉鍵盤操作、放掉詳細資料與線上狀態。正常出陣由組隊畫面自己收起。
   */
  hideTeamSelect(): void {
    if (this.selectKeys) window.removeEventListener('keydown', this.selectKeys);
    this.selectKeys = null;
    $('#select').hidden = true;
    this.detail = null;
    this.selectOnline = null;
  }

  /** 線上組隊：更新場地（房主的選擇）與對手狀態 */
  updateSelectOnline(arena: ArenaChoice, opponent: string, status: string): void {
    this.selectOnline?.setArena(arena);
    const root = $('#select');
    $('.cpu-team .ct-label', root).textContent = `對手：${opponent}`;
    $('.cpu-team small', root).textContent = status;
  }

  /** 組隊畫面絕招示範的畫布（組隊畫面沒開時為 null） */
  stageCanvas(): HTMLCanvasElement | null {
    return this.detail?.canvas ?? null;
  }

  /** 絕招示範放招時，在舞台上閃出招式名 */
  stageFlash(text: string): void {
    this.detail?.flash(text);
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
  setMatchInfo(m: TeamMatch, specs: Record<TopId, TopSpec>, arenaName: string, current?: Pairing | null): void {
    const pair = current === undefined ? currentPairing(m) : current;
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
  showHud(a: TopSpec, b: TopSpec, opponent = 'CPU'): void {
    const hud = $('#hud');
    hud.hidden = false;
    hud.style.setProperty('--p0', css(a.glow));
    hud.style.setProperty('--p1', css(b.glow));
    $('.panel[data-side="0"] .name', hud).textContent = `YOU ｜ ${a.nameJa}`;
    $('.panel[data-side="1"] .name', hud).textContent = `${b.nameJa} ｜ ${opponent}`;
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
  showResult(win: boolean, m: TeamMatch, specs: Record<TopId, TopSpec>, footnote: string, onRetry: () => void, opts: ResultOptions = {}): void {
    const root = $('#result');
    const opp = opts.opponent ?? 'CPU';
    $('.headline', root).textContent = win ? 'YOU WIN!!' : 'YOU LOSE…';
    $('.final', root).textContent = `${m.score[0]} - ${m.score[1]}`;
    $('.diff', root).textContent = footnote;
    $('.breakdown', root).replaceChildren(
      ...m.results.map((r) => {
        const label = r.overtime ? '延長賽' : `第 ${r.battle} 戰`;
        return el(
          'li',
          r.winner === 0 ? 'w' : 'l',
          `${label}　${specs[r.player].nameZh} VS ${specs[r.cpu].nameZh}　${FINISH_EN[r.finish]}　${r.winner === 0 ? 'YOU' : opp} +${r.points[r.winner]}`,
        );
      }),
    );
    const btn = $<HTMLButtonElement>('.retry', root);
    btn.textContent = opts.retryLabel ?? 'もう一度！／再來一場';
    btn.disabled = false;
    btn.onclick = () => {
      if (!opts.keepOpen) root.hidden = true;
      else btn.disabled = true;
      onRetry();
    };
    const leave = $<HTMLButtonElement>('.leave', root);
    leave.hidden = !opts.onLeave;
    leave.onclick = () => {
      root.hidden = true;
      opts.onLeave?.();
    };
    this.setResultStatus('');
    root.hidden = false;
  }

  /** 結果畫面的狀態文字（線上再來一場的等待狀態） */
  setResultStatus(text: string): void {
    $('#result .rm-status').textContent = text;
  }

  hideResult(): void {
    $('#result').hidden = true;
  }
}

/** 瞄準角度的文字（例如「→ 12°」） */
/** 房間列表的等待時間文字：一分鐘內用秒、之後用分鐘 */
function waitedLabel(sec: number): string {
  return sec < 60 ? `等了 ${sec} 秒` : `等了 ${Math.floor(sec / 60)} 分鐘`;
}

function aimText(aim: number): string {
  const deg = Math.round((aim * 180) / Math.PI);
  if (Math.abs(deg) < 3) return '正面';
  return `${deg > 0 ? '右' : '左'} ${Math.abs(deg)}°`;
}
