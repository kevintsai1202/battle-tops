import type { Conn } from '../../server/src/room';
import type { ServerMessage } from '../../src/net/protocol';

/** 假連線：記下收到的訊息 */
export class FakeConn implements Conn {
  msgs: ServerMessage[] = [];
  closed = false;
  send(m: ServerMessage): void {
    this.msgs.push(structuredClone(m));
  }
  close(): void {
    this.closed = true;
  }
  /** 某類型的所有訊息 */
  all<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.msgs.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  /** 某類型的最後一則訊息 */
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> {
    const a = this.all(t);
    if (!a.length) throw new Error(`沒有收到 ${t}`);
    return a[a.length - 1];
  }
}
