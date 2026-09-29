/** 可指定種子的亂數函式，回傳 [0, 1) */
export type Rng = () => number;

/**
 * 建立 mulberry32 亂數產生器。
 * 模擬與 CPU 只透過它取亂數，同一個種子就能重現同一場對戰（測試與 e2e 需要）。
 */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 在 [min, max) 取亂數 */
export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}
