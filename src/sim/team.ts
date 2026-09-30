import type { Rng } from './rng';
import { FINISH_POINTS } from './rules';
import { TOP_IDS } from './tops';
import type { FinishType, RoundResult, TopId } from './types';

/** 對戰階段：一般三戰、延長賽、結束 */
export type MatchPhase = 'regular' | 'overtime' | 'done';

/** 一戰（有分出勝負）的紀錄 */
export interface BattleRecord {
  /** 第幾戰（1..3，延長賽為 4） */
  battle: number;
  overtime: boolean;
  player: TopId;
  cpu: TopId;
  winner: 0 | 1;
  finish: FinishType;
  /** 這一戰雙方各得幾分 */
  points: [number, number];
}

/** 3 對 3 對戰的狀態 */
export interface TeamMatch {
  /** 玩家的三顆，順序即出場順序 */
  player: TopId[];
  /** CPU 的三顆，順序即出場順序（對玩家保密） */
  cpu: TopId[];
  /** 已分出勝負的每一戰（平手重打的不記） */
  results: BattleRecord[];
  /** 總分 [玩家, CPU] */
  score: [number, number];
  phase: MatchPhase;
  /** 延長賽雙方挑的陀螺（挑好之前為 null） */
  overtimePick: { player: TopId; cpu: TopId } | null;
  /** 勝者（結束時才有） */
  winner: 0 | 1 | null;
}

/** 下一戰的對陣 */
export interface Pairing {
  battle: number;
  overtime: boolean;
  player: TopId;
  cpu: TopId;
}

/** 檢查隊伍：剛好 3 顆且不重複 */
function assertTeam(team: TopId[], who: string): void {
  if (team.length !== 3 || new Set(team).size !== 3) throw new Error(`${who}隊伍必須是 3 顆不重複的陀螺`);
}

/** 建立 3 對 3 對戰 */
export function createMatch(player: TopId[], cpu: TopId[]): TeamMatch {
  assertTeam(player, '玩家');
  assertTeam(cpu, 'CPU');
  return { player: [...player], cpu: [...cpu], results: [], score: [0, 0], phase: 'regular', overtimePick: null, winner: null };
}

/** 目前要打的對陣；延長賽還沒挑、或已結束時為 null */
export function currentPairing(m: TeamMatch): Pairing | null {
  if (m.phase === 'regular') {
    const i = m.results.length;
    return { battle: i + 1, overtime: false, player: m.player[i], cpu: m.cpu[i] };
  }
  if (m.phase === 'overtime' && m.overtimePick) {
    return { battle: 4, overtime: true, ...m.overtimePick };
  }
  return null;
}

/**
 * 記錄一戰的結果。平手（winner 為 null）不計分、不前進，同一組重打。
 * 三戰打完：總分高者勝；平手進入延長賽。延長賽分出勝負即結束，分數也加進總分。
 */
export function recordResult(m: TeamMatch, res: RoundResult): void {
  const pair = currentPairing(m);
  if (!pair || res.winner === null) return;
  const winner = res.winner as 0 | 1;
  const points: [number, number] = [0, 0];
  points[winner] = FINISH_POINTS[res.finish];
  m.score = [m.score[0] + points[0], m.score[1] + points[1]];
  m.results.push({ ...pair, winner, finish: res.finish, points });

  if (pair.overtime) {
    m.phase = 'done';
    m.winner = winner;
  } else if (m.results.length === 3) {
    if (m.score[0] === m.score[1]) {
      m.phase = 'overtime';
    } else {
      m.phase = 'done';
      m.winner = m.score[0] > m.score[1] ? 0 : 1;
    }
  }
}

/** 設定延長賽雙方挑的陀螺（只能從自己隊伍裡挑） */
export function setOvertime(m: TeamMatch, player: TopId, cpu: TopId): void {
  if (m.phase !== 'overtime') throw new Error('目前不是延長賽');
  if (!m.player.includes(player)) throw new Error('玩家只能從自己的隊伍挑');
  if (!m.cpu.includes(cpu)) throw new Error('CPU 只能從自己的隊伍挑');
  m.overtimePick = { player, cpu };
}

/** CPU 隨機組隊：從全部陀螺挑三顆不重複，順序隨機 */
export function cpuPickTeam(rng: Rng): TopId[] {
  const pool = [...TOP_IDS];
  const team: TopId[] = [];
  while (team.length < 3) team.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return team;
}
