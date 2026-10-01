import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MESSAGE, parseClientMessage, type ServerMessage } from '../../src/net/protocol';
import { RoomManager } from './manager';
import type { Conn, Room, Side } from './room';

/** 伺服器設定 */
export interface ServerOptions {
  /** 監聽的連接埠（0 = 讓系統挑，測試用） */
  port: number;
  /** 允許連線的來源（瀏覽器的 Origin）；沒帶 Origin 的連線（機器人、測試）放行 */
  allowedOrigins: string[];
  /** 時間倍率（只給整合測試加速用；正式環境為 1） */
  speed?: number;
  /** 紀錄輸出（預設 console.log） */
  log?: (msg: string) => void;
}

/** 啟動中的伺服器 */
export interface RunningServer {
  port: number;
  manager: RoomManager;
  close(): Promise<void>;
}

/** 主迴圈每秒幾次 */
const LOOP_HZ = 60;
/** 每條連線每秒最多幾則訊息（推移最多 30 次，加上其他訊息的餘裕） */
const MAX_MSGS_PER_SEC = 120;

/**
 * 啟動對戰伺服器：HTTP（/health）與 WebSocket（/ws）共用一個連接埠。
 * 主迴圈用會自我修正漂移的 setTimeout（不用 setInterval），每次把實際經過的時間交給 RoomManager；
 * 房間的模擬若落後實際時間會記錄下來（共用主機忙時看得到）。
 */
export function startServer(opts: ServerOptions): Promise<RunningServer> {
  const speed = opts.speed ?? 1;
  const log = opts.log ?? ((m: string) => console.log(`${new Date().toISOString()} ${m}`));
  const t0 = Date.now();
  /** 伺服器時間（毫秒）：測試加速時按倍率前進 */
  const now = () => (speed === 1 ? Date.now() : t0 + (Date.now() - t0) * speed);
  const manager = new RoomManager({ now, rng: Math.random, makeToken: () => randomBytes(18).toString('base64url'), log });
  const startedAt = Date.now();
  let connections = 0;

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, uptime: Math.round((Date.now() - startedAt) / 1000), connections, rooms: manager.size }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: MAX_MESSAGE * 2,
    verifyClient: ({ origin }: { origin?: string }) => !origin || opts.allowedOrigins.includes(origin),
  });

  wss.on('connection', (ws: WebSocket) => {
    connections++;
    ws.binaryType = 'nodebuffer';
    /** 這條連線目前所在的房間與陣營 */
    let session: { room: Room; side: Side } | null = null;
    const conn: Conn = {
      send: (m: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      },
      close: () => ws.close(),
    };
    // 簡單的流量限制：每秒訊息數超過上限就斷線
    let windowStart = Date.now();
    let count = 0;

    /** 處理一則訊息：流量限制 → 格式檢查 → 進房類訊息交給 RoomManager，其他交給所在的房間 */
    const onMessage = (text: string) => {
      const t = Date.now();
      if (t - windowStart >= 1000) {
        windowStart = t;
        count = 0;
      }
      if (++count > MAX_MSGS_PER_SEC) {
        log('連線訊息過多，斷線');
        ws.close(1008, 'rate limit');
        return;
      }
      const msg = parseClientMessage(text);
      if (!msg) return;
      switch (msg.t) {
        case 'ping':
          conn.send({ t: 'pong', c: msg.c, s: now() });
          return;
        case 'list':
          conn.send({ t: 'rooms', rooms: manager.list() });
          return;
        case 'create':
        case 'join':
        case 'quick':
        case 'resume': {
          // 換房間前先離開原本的房間
          if (session) session.room.handle(session.side, { t: 'leave' });
          session = null;
          const r =
            msg.t === 'create'
              ? manager.create(conn, msg.name, msg.public)
              : msg.t === 'join'
                ? manager.join(msg.code, conn, msg.name)
                : msg.t === 'quick'
                  ? manager.quick(conn, msg.name)
                  : manager.resume(msg.code, msg.token, conn);
          if ('error' in r) conn.send({ t: 'error', code: r.error, message: r.message });
          else session = r;
          return;
        }
        default:
          if (!session) return;
          session.room.handle(session.side, msg);
          if (msg.t === 'leave') session = null;
      }
    };

    // 監聽器丟出的例外在 Node 會變成未捕捉例外、整個行程結束（所有房間一起斷線），所以在這裡攔下並記錄
    ws.on('message', (data) => {
      try {
        onMessage(String(data));
      } catch (e) {
        log(`訊息處理錯誤：${e instanceof Error ? e.stack : String(e)}`);
      }
    });

    ws.on('close', () => {
      connections--;
      try {
        if (session) session.room.disconnect(session.side);
      } catch (e) {
        log(`斷線處理錯誤：${e instanceof Error ? e.stack : String(e)}`);
      }
      session = null;
    });
  });

  // 主迴圈：自我修正漂移的 setTimeout
  let running = true;
  let last = performance.now();
  let timer: NodeJS.Timeout | null = null;
  const loop = () => {
    if (!running) return;
    const start = performance.now();
    const dt = (start - last) * speed;
    last = start;
    try {
      manager.advance(dt);
    } catch (e) {
      log(`主迴圈錯誤：${e instanceof Error ? e.stack : String(e)}`);
    }
    const spent = performance.now() - start;
    timer = setTimeout(loop, Math.max(0, 1000 / LOOP_HZ - spent));
  };
  timer = setTimeout(loop, 1000 / LOOP_HZ);

  return new Promise((resolve) => {
    http.listen(opts.port, () => {
      const port = (http.address() as AddressInfo).port;
      log(`battle-tops server listening on :${port}（允許來源：${opts.allowedOrigins.join(', ')}）`);
      resolve({
        port,
        manager,
        close: () =>
          new Promise<void>((done) => {
            running = false;
            if (timer) clearTimeout(timer);
            for (const c of wss.clients) c.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}
