import { clampStats } from './parts';
import type { BaseStats } from './types';

/** 由基本屬性推導出的物理能力值 */
export interface PhysicsParams {
  radius: number;
  mass: number;
  attack: number;
  defense: number;
  stamina: number;
  burstRes: number;
  drive: number;
  cruise: number;
  friction: number;
  maxSpin: number;
}

/**
 * 基本屬性 → 物理能力值。這是「屬性決定能力」的唯一公式，調平衡時只改這裡。
 * 係數以最早的四顆原創陀螺校準：代入它們的屬性，會得到接近原本手調的數值（誤差 25% 內，見 tests/stats.test.ts）。
 * 攻防持久的範圍比原本窄：20 顆一起跑平衡報表時，範圍太寬會讓防禦 10、持久 10 的陀螺一面倒。
 *
 * - 攻擊 1～10 → 攻擊力 0.85～1.7
 * - 防禦 1～10 → 防禦力 0.87～1.5；防禦高的軸心也比較抓地（摩擦大）
 * - 持久 1～10 → 持久力 0.85～1.3、最高轉速 275～320；持久型尖軸摩擦小
 * - 重量（公克）→ 質量 = 0.5 + 重量 / 80（輕重差距縮小，避免重量一項決定勝負）、半徑隨重量略增
 * - 爆裂抵抗 1～10 → 爆裂量累積除以 0.64～1.45（5 分 = 1）
 * - 機動 1～10 → 驅動力 1.0～6.0、巡航速度 1.4～5.0
 */
export function derivePhysics(s: BaseStats): PhysicsParams {
  // 與雷達圖共用同一個範圍限制（sim/parts.ts 的 clampStats）
  const c = clampStats(s);
  const atk = c.attack;
  const def = c.defense;
  const sta = c.stamina;
  const bur = c.burst;
  const dash = c.dash;
  const weight = c.weight;
  return {
    radius: 0.28 + 0.0015 * weight,
    mass: 0.5 + weight / 80,
    attack: 0.75 + 0.095 * atk,
    defense: 0.8 + 0.07 * def,
    stamina: 0.8 + 0.05 * sta,
    burstRes: 0.55 + 0.09 * bur,
    drive: 0.45 + 0.555 * dash,
    cruise: 1.0 + 0.4 * dash,
    friction: 0.15 + 0.05 * def + 0.01 * dash - 0.01 * sta,
    maxSpin: 270 + 5 * sta,
  };
}
