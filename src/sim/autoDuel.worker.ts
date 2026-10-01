import { runAutoDuelJob, type AutoDuelRequest } from './autoDuelJob';

/**
 * 電腦自動對打的 Web Worker：在背景執行緒跑 runAutoDuelJob，畫面不會卡，也不受畫面的影格速度影響。
 * 主執行緒用 new Worker(new URL('../sim/autoDuel.worker.ts', import.meta.url), { type: 'module' }) 建立，
 * 停止時直接 terminate()。
 * 用 globalThis 取 Worker 的全域物件：前端與伺服器的 tsconfig 都用 DOM 型別，不能再引用 webworker 型別。
 */
const ctx = globalThis as unknown as { onmessage: ((e: { data: AutoDuelRequest }) => void) | null; postMessage(m: unknown): void };

ctx.onmessage = (e) => runAutoDuelJob(e.data, (m) => ctx.postMessage(m));
