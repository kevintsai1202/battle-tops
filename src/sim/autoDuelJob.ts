import { AutoDuel, type DuelSummary, type TrialConfig } from './trial';

/**
 * 電腦自動對打的工作內容（純邏輯）：Web Worker（autoDuel.worker.ts）收到工作後呼叫它，
 * 單元測試也直接呼叫。每打 every 場回報一次進度，打完回報結果；id 讓主執行緒認出是哪一次的工作（舊的工作回報一律忽略）。
 */

/** 主執行緒送給 Worker 的工作 */
export interface AutoDuelRequest {
  id: number;
  cfg: TrialConfig;
  total: number;
  seed: number;
}

/** Worker 回報給主執行緒的訊息：進度（0..1）或最後的結果 */
export type AutoDuelMessage = { type: 'progress'; id: number; progress: number } | { type: 'done'; id: number; summary: DuelSummary };

/** 跑完一次自動對打，過程中用 post 回報 */
export function runAutoDuelJob(req: AutoDuelRequest, post: (m: AutoDuelMessage) => void, every = 10): void {
  const duel = new AutoDuel(req.cfg, req.total, req.seed);
  let n = 0;
  while (!duel.done) {
    duel.runNext();
    n++;
    if (n % every === 0 || duel.done) post({ type: 'progress', id: req.id, progress: duel.progress });
  }
  post({ type: 'done', id: req.id, summary: duel.summary });
}
