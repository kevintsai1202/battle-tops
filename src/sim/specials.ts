import type { ArenaSpec } from './arena';
import type { SpecialStep, TopState, V2 } from './types';

/** 單位向量（長度為 0 時回傳 fallback） */
function unit(dx: number, dz: number, fallback: V2 = { x: 1, z: 0 }): V2 {
  const d = Math.hypot(dx, dz);
  return d > 1e-6 ? { x: dx / d, z: dz / d } : fallback;
}

/**
 * 依序執行必殺技的每個動作（資料定義在 sim/tops.ts 的 special.steps）。
 * 每顆陀螺的必殺技都是這些基本動作的不同組合與參數，所以效果各不相同，但邏輯只有這一份。
 */
export function runSpecial(me: TopState, opp: TopState, arena: ArenaSpec): void {
  for (const s of me.spec.special.steps) runStep(s, me, opp, arena);
}

/** 執行單一動作 */
function runStep(s: SpecialStep, me: TopState, opp: TopState, arena: ArenaSpec): void {
  const toOpp = unit(opp.pos.x - me.pos.x, opp.pos.z - me.pos.z);
  const max = me.spec.maxSpin;
  switch (s.op) {
    case 'dash':
      me.vel = { x: me.vel.x * s.keep + toOpp.x * s.speed, z: me.vel.z * s.keep + toOpp.z * s.speed };
      break;
    case 'brake':
      me.vel = { x: me.vel.x * s.keep, z: me.vel.z * s.keep };
      break;
    case 'spin':
      me.spin = Math.min(max, me.spin + max * s.ratio);
      break;
    case 'repair':
      me.burst = Math.max(0, me.burst - s.amount);
      break;
    case 'drain': {
      if (!opp.alive) break;
      const got = Math.min(opp.spin, opp.spec.maxSpin * s.ratio);
      opp.spin -= got;
      me.spin = Math.min(max, me.spin + got * 0.5);
      break;
    }
    case 'shove': {
      const d = Math.hypot(opp.pos.x - me.pos.x, opp.pos.z - me.pos.z);
      if (!opp.alive || d > s.range) break;
      // 越近推得越猛
      const k = s.speed * (0.5 + 0.5 * (1 - d / s.range));
      opp.vel = { x: opp.vel.x + toOpp.x * k, z: opp.vel.z + toOpp.z * k };
      opp.burst += s.burst / opp.spec.burstRes;
      break;
    }
    case 'pull':
      if (opp.alive) opp.vel = { x: opp.vel.x - toOpp.x * s.speed, z: opp.vel.z - toOpp.z * s.speed };
      break;
    case 'reverse':
      me.spinDir = me.spinDir === 1 ? -1 : 1;
      break;
    case 'warp': {
      // 瞬移到對手背後（以場地中心→對手的方向為「背後」），限制在場內
      const back = unit(opp.pos.x, opp.pos.z, toOpp);
      let x = opp.pos.x + back.x * s.dist;
      let z = opp.pos.z + back.z * s.dist;
      const lim = arena.radius - me.spec.radius - 0.2;
      const r = Math.hypot(x, z);
      if (r > lim) {
        // 背後貼牆時改到對手靠中心的一側
        x = opp.pos.x - back.x * s.dist;
        z = opp.pos.z - back.z * s.dist;
      }
      me.pos = { x, z };
      const dir = unit(opp.pos.x - x, opp.pos.z - z);
      me.vel = { x: dir.x * s.speed, z: dir.z * s.speed };
      break;
    }
    case 'blink':
      // 瞬間回到場地中央並停下
      me.pos = { x: 0, z: 0 };
      me.vel = { x: me.vel.x * 0.1, z: me.vel.z * 0.1 };
      break;
    case 'buff':
      me.buff = { from: me.spec.id, time: s.time, mods: s.mods };
      break;
    case 'hex':
      if (opp.alive) opp.hex = { from: me.spec.id, time: s.time, mods: s.mods };
      break;
  }
}
