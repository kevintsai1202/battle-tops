/**
 * 競技場（碗形）參數。
 * 地面高度 y = bowlK * r²，越往外越高，重力沿坡面把陀螺拉回中心。
 */
export const ARENA = {
  /** 場地半徑（牆的位置） */
  radius: 3.2,
  /** 碗形曲率 */
  bowlK: 0.065,
  /** 重力加速度 */
  gravity: 9.8,
  /** 三個出場口的中心角（弧度） */
  pockets: [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3],
  /** 出場口半寬（弧度） */
  pocketHalfWidth: 0.26,
  /** 在出場口往外的徑向速度超過此值就出場 */
  overSpeed: 2.0,
  /** 撞牆反彈係數 */
  wallRestitution: 0.45,
} as const;

/** 半徑 r 處的地面高度 */
export function floorHeight(r: number): number {
  return ARENA.bowlK * r * r;
}

/** 判斷角度 angle（弧度）是否落在任一出場口內 */
export function inPocket(angle: number): boolean {
  for (const p of ARENA.pockets) {
    let d = Math.abs(angle - p) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d <= ARENA.pocketHalfWidth) return true;
  }
  return false;
}
