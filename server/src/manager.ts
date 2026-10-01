import { makeRoomCode } from '../../src/net/protocol';
import { RECONNECT_MS, Room, type Conn, type RoomDeps, type Side } from './room';

/** 房間數上限（主機記憶體吃緊，每個房間約數十 KB，保守設定） */
const MAX_ROOMS = 200;
/** 沒有任何人連著的房間，多久後移除 */
const EMPTY_TTL_MS = RECONNECT_MS + 30_000;
/** 只有房主、沒人加入的房間，多久後關閉 */
const LOBBY_TTL_MS = 10 * 60_000;
/** 結果畫面停留多久後關閉 */
const RESULT_TTL_MS = 5 * 60_000;

/** 進入房間的結果 */
export type EnterResult = { room: Room; side: Side } | { error: string; message: string };

/**
 * 管理所有房間：建立（產生不重複的房號）、加入、重連、定期推進與清理閒置房間。
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly deps: RoomDeps;
  /** 各房間進入目前階段的時間（清理用） */
  private readonly phaseSince = new Map<Room, { phase: string; since: number }>();

  constructor(deps: RoomDeps) {
    this.deps = deps;
  }

  /** 目前的房間數 */
  get size(): number {
    return this.rooms.size;
  }

  /** 建立房間並以房主身分進入 */
  create(conn: Conn, name: string): EnterResult {
    if (this.rooms.size >= MAX_ROOMS) return { error: 'FULL', message: '伺服器房間已滿，請稍後再試' };
    let code = makeRoomCode(this.deps.rng);
    for (let i = 0; this.rooms.has(code) && i < 20; i++) code = makeRoomCode(this.deps.rng);
    if (this.rooms.has(code)) return { error: 'FULL', message: '暫時無法建立房間，請再試一次' };
    const room = new Room(code, this.deps);
    this.rooms.set(code, room);
    const side = room.addPlayer(conn, name)!;
    this.deps.log?.(`[${code}] 建立房間（共 ${this.rooms.size} 間）`);
    return { room, side };
  }

  /** 用房號加入 */
  join(code: string, conn: Conn, name: string): EnterResult {
    const room = this.rooms.get(code);
    if (!room || room.closed) {
      this.deps.log?.(`[${code}] 加入失敗：找不到房間`);
      return { error: 'NOT_FOUND', message: `找不到房間 ${code}` };
    }
    const side = room.addPlayer(conn, name);
    if (side === null) {
      this.deps.log?.(`[${code}] 加入失敗：房間已滿`);
      return { error: 'ROOM_FULL', message: `房間 ${code} 已經滿了` };
    }
    this.deps.log?.(`[${code}] 加入（陣營 ${side}）`);
    return { room, side };
  }

  /** 斷線後重連 */
  resume(code: string, token: string, conn: Conn): EnterResult {
    const room = this.rooms.get(code);
    const side = room && !room.closed ? room.resume(conn, token) : null;
    if (!room || side === null) {
      this.deps.log?.(`[${code}] 重連失敗`);
      return { error: 'RESUME_FAILED', message: '無法重新連線（房間已關閉或已過期）' };
    }
    this.deps.log?.(`[${code}] 重連（陣營 ${side}）`);
    return { room, side };
  }

  /** 伺服器迴圈每次呼叫：推進所有房間，移除已關閉或閒置的房間 */
  advance(dtMs: number): void {
    const now = this.deps.now();
    for (const [code, room] of this.rooms) {
      room.advance(dtMs);
      const ps = this.phaseSince.get(room);
      if (!ps || ps.phase !== room.phase) this.phaseSince.set(room, { phase: room.phase, since: now });
      const since = this.phaseSince.get(room)!.since;
      const idle =
        (room.connected === 0 && now - room.lastActive > EMPTY_TTL_MS) ||
        (room.phase === 'lobby' && now - since > LOBBY_TTL_MS) ||
        (room.phase === 'result' && now - since > RESULT_TTL_MS);
      if (room.closed || idle) {
        if (!room.closed) room.shutdown('房間閒置太久，已自動關閉');
        this.rooms.delete(code);
        this.phaseSince.delete(room);
        this.deps.log?.(`[${code}] 移除房間（剩 ${this.rooms.size} 間）`);
      }
    }
  }
}
