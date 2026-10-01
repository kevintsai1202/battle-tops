/** 保留最近幾筆樣本 */
const KEEP = 12;

/**
 * 客戶端與伺服器的時鐘同步（純邏輯）。每次 ping／pong 得到一筆樣本：
 * 往返時間 rtt = 收到 − 送出；時差 offset = 伺服器時間 + rtt/2 − 收到時間。
 * 時差取往返最短的那筆（主執行緒忙、封包排隊的樣本往返特別久，也最不準）；
 * 往返時間取中位數，給預測決定要往前推多少。
 */
export class ClockSync {
  private samples: { rtt: number; offset: number }[] = [];

  /** 加一筆樣本：送出時間、伺服器回報的時間、收到時間（毫秒） */
  add(clientSend: number, server: number, clientRecv: number): void {
    const rtt = Math.max(0, clientRecv - clientSend);
    this.samples.push({ rtt, offset: server + rtt / 2 - clientRecv });
    if (this.samples.length > KEEP) this.samples.shift();
  }

  /** 是否已經有樣本 */
  get ready(): boolean {
    return this.samples.length > 0;
  }

  /** 伺服器時間 − 本機時間（毫秒） */
  get offset(): number {
    if (!this.samples.length) return 0;
    return this.samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
  }

  /** 往返時間（毫秒，最近樣本的中位數） */
  get rtt(): number {
    if (!this.samples.length) return 0;
    const sorted = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  /** 本機時間 → 伺服器時間 */
  serverNow(localNow: number): number {
    return localNow + this.offset;
  }

  /** 伺服器時間 → 本機時間 */
  toLocal(serverTime: number): number {
    return serverTime - this.offset;
  }
}
