import { ClockSync } from './clock';
import type { ClientMessage, ServerMessage } from './protocol';

/** 連線狀態 */
export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** 重連的等待時間（毫秒）：依序使用，最後一個重複 */
const BACKOFF = [500, 1000, 2000, 4000, 8000];
/** 開頭快速量幾次延遲、之後每隔多久量一次（毫秒） */
const QUICK_PINGS = 5;
const PING_EVERY = 2000;

/**
 * 瀏覽器端的對戰伺服器連線：
 * - 收到的訊息轉給訂閱者（on）。
 * - 開頭連續 ping 幾次、之後每 2 秒一次，交給 ClockSync 估算時差與往返時間。
 * - 不是自己關閉的斷線會自動重連；進過房間（setResume）的話重連後送 resume 回到原本的房間。
 */
export class NetClient {
  readonly clock = new ClockSync();
  status: NetStatus = 'idle';
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly handlers = new Set<(m: ServerMessage) => void>();
  private readonly statusHandlers = new Set<(s: NetStatus) => void>();
  private resumeInfo: { code: string; token: string } | null = null;
  private attempt = 0;
  private pingTimer = 0;
  private closedByUser = false;

  constructor(url: string) {
    this.url = url;
  }

  /** 伺服器網址 */
  get address(): string {
    return this.url;
  }

  /** 連線；連上時 resolve，第一次就失敗時 reject */
  connect(): Promise<void> {
    this.closedByUser = false;
    return new Promise((ok, fail) => {
      this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
      let opened = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        opened = true;
        this.attempt = 0;
        this.setStatus('open');
        if (this.resumeInfo) this.send({ t: 'resume', ...this.resumeInfo });
        this.startPings();
        ok();
      };
      ws.onmessage = (ev) => {
        let m: ServerMessage;
        try {
          m = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          return;
        }
        if (m.t === 'pong') this.clock.add(m.c, m.s, Date.now());
        for (const h of this.handlers) h(m);
      };
      ws.onclose = () => {
        window.clearInterval(this.pingTimer);
        if (this.ws !== ws) return;
        this.ws = null;
        if (!opened && this.attempt === 0 && !this.resumeInfo) {
          this.setStatus('closed');
          fail(new Error(`無法連上伺服器（${this.url}）`));
          return;
        }
        if (this.closedByUser) {
          this.setStatus('closed');
          return;
        }
        this.scheduleReconnect();
      };
    });
  }

  /** 送訊息（沒連上時丟掉） */
  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** 訂閱伺服器訊息；回傳取消訂閱的函式 */
  on(handler: (m: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** 訂閱連線狀態 */
  onStatus(handler: (s: NetStatus) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /** 進房後記下房號與 token：斷線重連時自動回到房間 */
  setResume(code: string, token: string): void {
    this.resumeInfo = { code, token };
  }

  /** 主動關閉（離開線上對戰） */
  close(): void {
    this.closedByUser = true;
    this.resumeInfo = null;
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }

  /** 開始量延遲：先連續幾次，之後定時 */
  private startPings(): void {
    window.clearInterval(this.pingTimer);
    for (let i = 0; i < QUICK_PINGS; i++) window.setTimeout(() => this.send({ t: 'ping', c: Date.now() }), i * 120);
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: Date.now() }), PING_EVERY);
  }

  /** 排定重連 */
  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const wait = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt++;
    window.setTimeout(() => {
      if (this.closedByUser) return;
      this.connect().catch(() => undefined);
    }, wait);
  }

  private setStatus(s: NetStatus): void {
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }
}

/**
 * 伺服器網址：網址參數 ?server= 優先（e2e 用），否則用建置時的 VITE_GAME_SERVER，都沒有就用正式伺服器。
 */
export function gameServerUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_GAME_SERVER;
  return env || 'wss://battle-tops.zeabur.app/ws';
}
