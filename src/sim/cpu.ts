import type { BattleSim } from './battle';
import { spinRatio } from './physics';
import type { Rng } from './rng';
import type { V2 } from './types';

/** CPU 每一步的決策 */
export interface CpuDecision {
  control: V2;
  special: boolean;
}

/** 正規化並乘上強度 */
function toward(dx: number, dz: number, strength: number): V2 {
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x: 0, z: 0 };
  return { x: (dx / d) * strength, z: (dz / d) * strength };
}

/**
 * CPU 操控：依陀螺類型決定走位與必殺時機。
 * 攻擊型追擊（預判對手位置）；防禦型守中並正面迎擊；持久型守中並閃避；平衡型看轉速優劣決定攻守。
 * 太靠近邊緣時一律往中心修正，避免自己滑出場。
 * specialRate：條件成立時每一步放必殺的機率（難度用來調整 CPU 的反應）。
 */
export function cpuThink(sim: BattleSim, id: number, rng: Rng, specialRate = 0.05): CpuDecision {
  const me = sim.tops[id];
  const opp = sim.tops[id === 0 ? 1 : 0];
  if (!me.alive) return { control: { x: 0, z: 0 }, special: false };

  const r = Math.hypot(me.pos.x, me.pos.z);
  const dx = opp.pos.x - me.pos.x;
  const dz = opp.pos.z - me.pos.z;
  const dist = Math.hypot(dx, dz);
  const myRatio = spinRatio(me);
  const oppRatio = spinRatio(opp);

  let c: V2 = { x: 0, z: 0 };
  switch (me.spec.type) {
    case 'attack': {
      const px = opp.pos.x + opp.vel.x * 0.25 - me.pos.x;
      const pz = opp.pos.z + opp.vel.z * 0.25 - me.pos.z;
      c = toward(px, pz, 1);
      break;
    }
    case 'defense':
      c = r > 1.0 ? toward(-me.pos.x, -me.pos.z, 0.8) : toward(dx, dz, 0.3);
      break;
    case 'stamina':
      if (r > 0.6) c = toward(-me.pos.x, -me.pos.z, 0.9);
      // 只閃避高速衝來的對手；對手慢的時候就守在中心硬碰硬
      else if (dist < 1.2 && Math.hypot(opp.vel.x, opp.vel.z) > 2.5) c = toward(-dx, -dz, 0.6);
      break;
    case 'balance':
      c = myRatio > oppRatio ? toward(dx, dz, 0.7) : toward(-me.pos.x, -me.pos.z, 0.7);
      break;
  }

  // 靠近邊緣：往中心修正
  if (r > 2.5) {
    const back = toward(-me.pos.x, -me.pos.z, 1);
    c = { x: c.x * 0.3 + back.x, z: c.z * 0.3 + back.z };
  }
  // 小幅隨機擾動，讓每場走位不同
  c = { x: c.x + (rng() - 0.5) * 0.2, z: c.z + (rng() - 0.5) * 0.2 };

  let special = false;
  if (me.special >= 1 && opp.alive && rng() < specialRate) {
    const closing = -((opp.vel.x - me.vel.x) * dx + (opp.vel.z - me.vel.z) * dz) / (dist || 1);
    switch (me.spec.type) {
      case 'attack':
        special = dist < 2.2;
        break;
      case 'defense':
        special = closing > 2 || me.burst > 0.6;
        break;
      case 'stamina':
        special = myRatio < 0.5 || me.burst > 0.5;
        break;
      case 'balance':
        special = dist < 2 || myRatio < 0.45;
        break;
    }
  }
  return { control: c, special };
}
