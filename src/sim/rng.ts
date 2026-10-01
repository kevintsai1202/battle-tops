/** 可指定種子的亂數函式，回傳 [0, 1) */
export type Rng = () => number;

/** 可以讀出與設定內部狀態的亂數函式（模擬快照與線上對戰的預測校正需要） */
export interface SeededRng extends Rng {
  /** 目前的內部狀態（32 位元整數） */
  state(): number;
  /** 設定內部狀態；之後取出的數列與當初讀出這個狀態時完全相同 */
  setState(s: number): void;
}

/**
 * 建立 mulberry32 亂數產生器。
 * 模擬與 CPU 只透過它取亂數，同一個種子就能重現同一場對戰（測試與 e2e 需要）。
 * 內部狀態只有一個 32 位元整數，可以讀出與設定（見 SeededRng）。
 */
export function createRng(seed: number): SeededRng {
  let s = seed >>> 0;
  const next = (() => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SeededRng;
  next.state = () => s;
  next.setState = (v: number) => {
    s = v >>> 0;
  };
  return next;
}

/** 在 [min, max) 取亂數 */
export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}
