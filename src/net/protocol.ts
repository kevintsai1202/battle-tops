import { ARENA_IDS, type ArenaId } from '../sim/arena';
import type { SimSnapshot } from '../sim/battle';
import { MAX_AIM, type PullMetrics } from '../sim/launcher';
import { DISK_IDS, DRIVER_IDS, equip, type PartId, type PartSlot, type StockParts, type TeamLoadouts } from '../sim/parts';
import type { Rng } from '../sim/rng';
import { TOP_SPECS } from '../sim/tops';
import type { FinishType, SimEvent, TopId, V2 } from '../sim/types';

/**
 * 線上對戰的訊息協定（前端與伺服器共用，純邏輯）。設計見 docs/online-design.md。
 * - 客戶端 → 伺服器的訊息一律經過 parseClientMessage 檢查：格式不對整則丟掉，數值夾在合法範圍。
 * - 伺服器 → 客戶端的訊息以收件人的觀點組成（mine／theirs、me／them），客戶端不必自己換算；
 *   只有模擬相關的陣列依座位（0 號在左）排序，並附上收件人這一戰的座位。
 */

/** 場地選擇：五個場地加上「隨機」（開打時抽） */
export type ArenaChoice = ArenaId | 'random';

/** 一顆陀螺的規格參照：代號與目前裝的零件（接收端用 buildSpec 重建） */
export interface SpecRef {
  id: TopId;
  parts: StockParts;
}

/** 單則訊息大小上限（字元數） */
export const MAX_MESSAGE = 2048;

/**
 * 協定版本：進房類訊息（create／join／quick／resume）都要帶，伺服器只接受相同版本。
 * 2：組隊分成「選三顆」與「順序與零件（限時）」兩步（picks／arrange／ready）。舊版網頁沒帶版本，伺服器回「請重新整理」。
 */
export const PROTOCOL_VERSION = 2;

/** 房號使用的字元：去掉容易混淆的 I、O、0、1 */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 房號長度 */
const CODE_LENGTH = 4;
/** 玩家名稱最多幾個字 */
const NAME_MAX = 12;

// ---------------------------------------------------------------- 客戶端 → 伺服器

/** 客戶端送出的訊息 */
export type ClientMessage =
  /** 建立房間（自己是房主）；public 為是否列在房間列表（不公開時只能用房號或連結加入）；v 為協定版本 */
  | { t: 'create'; name: string; public: boolean; v: number }
  /** 用房號加入 */
  | { t: 'join'; code: string; name: string; v: number }
  /** 快速加入：加入等最久的公開房間，沒有就建一間公開房間 */
  | { t: 'quick'; name: string; v: number }
  /** 查詢房間列表 */
  | { t: 'list' }
  /** 斷線後用 token 重連 */
  | { t: 'resume'; code: string; token: string; v: number }
  /** 房主選場地 */
  | { t: 'arena'; arena: ArenaChoice }
  /** 第 1 步：選好的三顆（點選順序是第 2 步的預設出場順序） */
  | { t: 'picks'; picks: TopId[] }
  /** 第 2 步調整中：目前的出場順序與換上的備用零件（時間到時伺服器用最後收到的這一份） */
  | { t: 'arrange'; order: TopId[]; loadouts: TeamLoadouts }
  /** 第 2 步準備完成：最後的出場順序與零件（送出後鎖定） */
  | { t: 'ready'; order: TopId[]; loadouts: TeamLoadouts }
  /** 發射：時機誤差（秒，提早為負）、世界座標的瞄準角度（相對座位的基準方向）、拉條量測（按 Space 時為 null） */
  | { t: 'launch'; error: number; aim: number; pull: PullMetrics | null }
  /** 推移方向（世界座標，長度 ≤ 1）；seq 遞增，伺服器在快照裡回報處理到第幾號 */
  | { t: 'input'; seq: number; x: number; z: number }
  /** 發動必殺 */
  | { t: 'special'; seq: number }
  /** 衝刺（世界座標方向，已正規化） */
  | { t: 'dash'; seq: number; x: number; z: number }
  /** 延長賽挑的陀螺 */
  | { t: 'overtime'; top: TopId }
  /** 再來一場 */
  | { t: 'rematch' }
  /** 離開房間 */
  | { t: 'leave' }
  /** 時鐘同步與量延遲：c 為客戶端送出時間（毫秒） */
  | { t: 'ping'; c: number };

// ---------------------------------------------------------------- 伺服器 → 客戶端

/** 房間階段：大廳（等人、選場地）、組隊第 1 步（選三顆）、第 2 步（順序與零件，限時）、比賽中、延長賽挑選、結果 */
export type RoomPhase = 'lobby' | 'picking' | 'arranging' | 'match' | 'overtimePick' | 'result';

/** 房間列表的一列：等人中（可加入）或對戰中（灰色、不能加入）；waited 為等人中已經等了幾秒（對戰中為 0） */
export interface RoomSummary {
  code: string;
  host: string;
  guest: string | null;
  arena: ArenaChoice;
  status: 'waiting' | 'playing';
  waited: number;
}

/** 一位玩家在房間裡的狀態（ready：第 1 步＝已選好三顆、第 2 步＝準備完成、結果畫面＝要再來一場） */
export interface PlayerInfo {
  name: string;
  connected: boolean;
  ready: boolean;
}

/** 以收件人觀點記錄的一戰結果（points 為 [自己, 對手]） */
export interface ResultRow {
  battle: number;
  overtime: boolean;
  mine: TopId;
  theirs: TopId;
  winner: 'me' | 'them';
  finish: FinishType;
  points: [number, number];
}

/** 伺服器導演的切換事件（客戶端照著切鏡頭與慢動作） */
export type DirectorEvent =
  | { kind: 'closeup'; pos: V2; normal: V2; intensity: number }
  | { kind: 'finish'; pos: V2 }
  | { kind: 'special' };

/** 伺服器送出的訊息 */
export type ServerMessage =
  /** 進入房間：房號、重連用 token、自己是不是房主、房間是否公開在列表上 */
  | { t: 'room'; code: string; token: string; host: boolean; public: boolean }
  /** 房間列表（回應 list）：等人中的在前（等最久的最前面），接著是對戰中的 */
  | { t: 'rooms'; rooms: RoomSummary[] }
  /** 房間狀態（大廳、組隊、結果畫面的雙方狀態與場地） */
  | { t: 'lobby'; phase: RoomPhase; arena: ArenaChoice; host: boolean; me: PlayerInfo; opponent: PlayerInfo | null }
  /**
   * 第 2 步開始（雙方都選好三顆）：自己選的三顆、對手的三顆（依名鑑順序，出場順序保密）、截止的伺服器時間（毫秒），
   * 以及目前的順序、零件與是否已準備完成（重連時還原畫面用；剛開始時順序就是選的順序）
   */
  | { t: 'reveal'; mine: TopId[]; theirs: TopId[]; deadline: number; order: TopId[]; loadouts: TeamLoadouts; ready: boolean }
  /** 開打前雙方隊伍確定：自己的依出場順序、對手的依名鑑順序（出場順序保密）；arena 為實際場地（隨機已抽出） */
  | { t: 'teams'; mine: TopId[]; theirs: TopId[]; loadouts: TeamLoadouts; arena: ArenaId }
  /** 新的一戰：對陣、自己的座位、雙方規格（依座位）、「ゴー」的伺服器時間（毫秒）、目前總分與戰績 */
  | {
      t: 'battle';
      battle: number;
      overtime: boolean;
      replay: boolean;
      seat: 0 | 1;
      specs: [SpecRef, SpecRef];
      goAt: number;
      score: [number, number];
      results: ResultRow[];
    }
  /** 發射結果：開打時的完整模擬狀態、雙方力道與瞄準（依座位） */
  | { t: 'launched'; snap: SimSnapshot; launch: [number, number]; aim: [number, number] }
  /** 對戰快照：模擬步數、時間流速、伺服器處理到的自己操作序號、完整狀態、這段期間的事件與導演切換 */
  | { t: 'snap'; tick: number; ts: number; ack: number; snap: SimSnapshot; events: SimEvent[]; director: DirectorEvent[] }
  /** 這一戰結束：勝方（平手為 null）、終結方式、總分、接下來 */
  | { t: 'round'; winner: 'me' | 'them' | null; finish: FinishType; score: [number, number]; next: 'battle' | 'overtime' | 'result' }
  /** 延長賽：從自己的隊伍挑一顆 */
  | { t: 'overtime' }
  /** 整場結束 */
  | { t: 'result'; winner: 'me' | 'them'; score: [number, number]; results: ResultRow[]; forfeit: boolean }
  /** 對手斷線：比賽暫停，until 為判負的伺服器時間（毫秒） */
  | { t: 'paused'; until: number }
  /** 對手回來了：繼續（發射階段會另外送新的 battle 訊息） */
  | { t: 'resumed' }
  /** 房間關閉（對手離開、閒置逾時等） */
  | { t: 'closed'; reason: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong'; c: number; s: number };

// ---------------------------------------------------------------- 工具

/** 產生房號 */
export function makeRoomCode(rng: Rng): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}

/** 是否為合法房號（大寫） */
export function isRoomCode(s: unknown): s is string {
  return typeof s === 'string' && s.length === CODE_LENGTH && [...s].every((ch) => CODE_CHARS.includes(ch));
}

/** 清理玩家名稱：去控制字元與前後空白、最多 NAME_MAX 個字，空的用 Player */
export function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  const chars = Array.from(s).slice(0, NAME_MAX).join('');
  return chars || 'Player';
}

/**
 * 檢查隊伍：三顆不重複的合法陀螺；零件只能裝在隊伍裡的陀螺上、欄位要對、備用零件同隊不能重複。
 * 合法回傳 null，否則回傳原因。
 */
export function validateTeam(picks: unknown, loadouts: unknown): string | null {
  return checkTeam(picks, loadouts).error;
}

/** 檢查並清理隊伍（回傳清理後的零件狀態：和原廠同型的零件會被當成原廠） */
function checkTeam(picks: unknown, loadouts: unknown): { error: string | null; loadouts: TeamLoadouts } {
  const fail = (error: string) => ({ error, loadouts: {} });
  if (!Array.isArray(picks) || picks.length !== 3) return fail('隊伍必須是 3 顆');
  if (!picks.every((p) => typeof p === 'string' && p in TOP_SPECS)) return fail('有不存在的陀螺');
  if (new Set(picks).size !== 3) return fail('隊伍不能重複');
  if (typeof loadouts !== 'object' || loadouts === null || Array.isArray(loadouts)) return fail('零件格式不對');
  let team: TeamLoadouts = {};
  for (const [top, lo] of Object.entries(loadouts as Record<string, unknown>)) {
    if (!picks.includes(top)) return fail(`${top} 不在隊伍裡`);
    if (typeof lo !== 'object' || lo === null) return fail('零件格式不對');
    for (const slot of ['disk', 'driver'] as PartSlot[]) {
      const part = (lo as Record<string, unknown>)[slot];
      if (part === null || part === undefined) continue;
      if (typeof part !== 'string' || ![...DISK_IDS, ...DRIVER_IDS].includes(part as PartId)) return fail('有不存在的零件');
      try {
        team = equip(team, top, TOP_SPECS[top].stock, slot, part);
      } catch (e) {
        return fail(e instanceof Error ? e.message : '零件不合法');
      }
    }
  }
  return { error: null, loadouts: team };
}

/** 有限數字 */
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** 非負整數序號 */
const seqOk = (v: unknown): v is number => num(v) && Number.isInteger(v) && v >= 0;
/** 夾在 [lo, hi] */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 解析並檢查客戶端訊息：不是 JSON、太大、未知類型、欄位不合法 → null（整則丟掉）。
 * 數值夾在合法範圍、方向向量正規化、房號轉大寫、名稱清理。
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE) return null;
  let m: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    m = v as Record<string, unknown>;
  } catch {
    return null;
  }
  // 協定版本：沒帶或不是數字（舊版網頁）為 0，由伺服器回「請重新整理」
  const v = num(m.v) ? m.v : 0;
  switch (m.t) {
    case 'create':
      // 沒帶 public（舊版網頁）或不是 false 都視為公開
      return { t: 'create', name: sanitizeName(m.name), public: m.public !== false, v };
    case 'quick':
      return { t: 'quick', name: sanitizeName(m.name), v };
    case 'list':
      return { t: 'list' };
    case 'join': {
      const code = typeof m.code === 'string' ? m.code.toUpperCase() : '';
      return isRoomCode(code) ? { t: 'join', code, name: sanitizeName(m.name), v } : null;
    }
    case 'resume': {
      const code = typeof m.code === 'string' ? m.code.toUpperCase() : '';
      const token = m.token;
      if (!isRoomCode(code) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
      return { t: 'resume', code, token, v };
    }
    case 'arena':
      return m.arena === 'random' || (typeof m.arena === 'string' && ARENA_IDS.includes(m.arena as ArenaId))
        ? { t: 'arena', arena: m.arena as ArenaChoice }
        : null;
    case 'picks':
      return checkTeam(m.picks, {}).error ? null : { t: 'picks', picks: [...(m.picks as TopId[])] };
    case 'arrange':
    case 'ready': {
      const r = checkTeam(m.order, m.loadouts ?? {});
      return r.error ? null : { t: m.t, order: [...(m.order as TopId[])], loadouts: r.loadouts };
    }
    case 'launch': {
      if (!num(m.error) || !num(m.aim)) return null;
      let pull: PullMetrics | null = null;
      if (m.pull !== null && m.pull !== undefined) {
        const p = m.pull as Record<string, unknown>;
        if (typeof p !== 'object' || !num(p.length) || !num(p.speed) || !num(p.aim)) return null;
        pull = { length: clamp(p.length, 0, 1), speed: clamp(p.speed, 0, 1), aim: clamp(p.aim, -MAX_AIM, MAX_AIM) };
      }
      return { t: 'launch', error: clamp(m.error, -2, 2), aim: clamp(m.aim, -MAX_AIM, MAX_AIM), pull };
    }
    case 'input': {
      if (!seqOk(m.seq) || !num(m.x) || !num(m.z)) return null;
      const len = Math.hypot(m.x, m.z);
      const k = len > 1 ? 1 / len : 1;
      return { t: 'input', seq: m.seq, x: m.x * k, z: m.z * k };
    }
    case 'special':
      return seqOk(m.seq) ? { t: 'special', seq: m.seq } : null;
    case 'dash': {
      if (!seqOk(m.seq) || !num(m.x) || !num(m.z)) return null;
      const len = Math.hypot(m.x, m.z);
      return len > 1e-6 ? { t: 'dash', seq: m.seq, x: m.x / len, z: m.z / len } : null;
    }
    case 'overtime':
      return typeof m.top === 'string' && m.top in TOP_SPECS ? { t: 'overtime', top: m.top } : null;
    case 'rematch':
      return { t: 'rematch' };
    case 'leave':
      return { t: 'leave' };
    case 'ping':
      return num(m.c) ? { t: 'ping', c: m.c } : null;
    default:
      return null;
  }
}
