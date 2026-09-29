import { ARENA, inPocket } from './arena';
import type { Rng } from './rng';
import type { TopSpec, TopState, V2 } from './types';

/** 玩家／CPU 推移的最大加速度 */
const CONTROL_ACCEL = 3.4;
/** 推移時每秒額外消耗的轉速比例 */
const CONTROL_SPIN_COST = 0.012;
/** 轉速衰減：常數項（rad/s²）與比例項（1/s），都會再除以持久力 */
const DECAY_CONST = 4.2;
const DECAY_LINEAR = 0.013;
/** 切向進動漂移佔驅動力的比例 */
const PRECESSION_SWIRL = 0.15;
/** 轉速比例低於此值開始晃動，低於 SPIN_FINISH_RATIO 倒下 */
const WOBBLE_RATIO = 0.35;
export const SPIN_FINISH_RATIO = 0.12;
/** 接觸面速度的正規化基準（約為滿轉時的邊緣線速度） */
const SURFACE_REF = 100;
/** 同向旋轉時表面互相摩擦產生的額外彈開力 */
const SPIN_REPEL = 1.35;
/** 撞擊時切向摩擦係數 */
const CLASH_MU = 0.35;
/** 每單位撞擊強度造成的轉速損失（佔最高轉速比例） */
const SPIN_LOSS = 0.008;
/** 撞擊強度超過此值才累積爆裂量 */
const BURST_MIN_INTENSITY = 2.6;
const BURST_K = 0.03;
/** 每單位撞擊強度累積的必殺量 */
const SPECIAL_K = 0.045;

/** 建立一顆陀螺的初始狀態；spinRatio 為發射轉速佔最高轉速的比例 */
export function createTop(id: number, spec: TopSpec, pos: V2, vel: V2, spinRatio: number, spinDir: 1 | -1): TopState {
  return {
    id,
    spec,
    pos: { ...pos },
    vel: { ...vel },
    spin: spec.maxSpin * spinRatio,
    spinDir,
    angle: 0,
    tilt: 0,
    precession: 0,
    burst: 0,
    special: 0,
    specialUsed: false,
    control: { x: 0, z: 0 },
    buff: null,
    alive: true,
    finish: null,
    finishTime: 0,
  };
}

/** 計入必殺增益後的攻擊力 */
export function effAttack(t: TopState): number {
  const k = t.buff?.kind === 'rush' ? 2.2 : t.buff?.kind === 'nova' ? 1.6 : 1;
  return t.spec.attack * k;
}

/** 計入必殺增益後的防禦力 */
export function effDefense(t: TopState): number {
  const k = t.buff?.kind === 'fortress' ? 2.5 : t.buff?.kind === 'nova' ? 1.6 : 1;
  return t.spec.defense * k;
}

/** 計入必殺增益後的質量 */
export function effMass(t: TopState): number {
  return t.spec.mass * (t.buff?.kind === 'fortress' ? 3 : 1);
}

/** 目前轉速佔最高轉速的比例 */
export function spinRatio(t: TopState): number {
  return t.spin / t.spec.maxSpin;
}

/**
 * 推進一顆陀螺 dt 秒：碗形坡度把它拉回中心、軸心驅動力帶它繞場、
 * 摩擦減速、玩家推移、轉速衰減與晃動。只處理單顆陀螺，不含碰撞與牆。
 */
export function integrateTop(t: TopState, dt: number): void {
  const r = Math.hypot(t.pos.x, t.pos.z);
  const ratio = spinRatio(t);
  let ax = 0;
  let az = 0;

  // 坡度：沿碗面往中心的重力分量
  if (r > 1e-6) {
    const slope = 2 * ARENA.bowlK * r;
    const a = (ARENA.gravity * slope) / Math.sqrt(1 + slope * slope);
    ax -= (t.pos.x / r) * a;
    az -= (t.pos.z / r) * a;

    // 進動：轉速帶來少量切向漂移，讓軌跡帶點旋渦感（接近中心時減弱，避免奇異點）
    const swirl = t.spec.drive * PRECESSION_SWIRL * ratio * Math.min(1, r / 0.8);
    ax += (-t.pos.z / r) * swirl * t.spinDir;
    az += (t.pos.x / r) * swirl * t.spinDir;
  }

  // 軸心驅動：沿行進方向把速度維持在巡航速度附近。
  // 配合碗形坡度，陀螺會走出穿越中心的花瓣軌跡，而不是貼牆繞圈。
  const speed = Math.hypot(t.vel.x, t.vel.z);
  if (speed > 0.05) {
    const cap = t.spec.cruise * ratio;
    let push = t.spec.drive * ratio * Math.max(-1, Math.min(1, 1 - speed / Math.max(cap, 0.01)));
    // 靠近邊緣且正往外衝時，軸心爬坡吃力：驅動力大幅減弱，避免自己衝出場
    if (push > 0 && r > 1e-6) {
      const outward = Math.max(0, (t.vel.x * t.pos.x + t.vel.z * t.pos.z) / (speed * r));
      const edge = Math.min(1, Math.max(0, (r - 1.6) / 1.2));
      push *= 1 - 0.9 * outward * edge;
    }
    ax += (t.vel.x / speed) * push;
    az += (t.vel.z / speed) * push;
  }

  // 推移輸入（鐵壁狀態下幾乎推不動）
  const ctrlK = CONTROL_ACCEL * (t.buff?.kind === 'fortress' ? 0.25 : 1);
  ax += t.control.x * ctrlK;
  az += t.control.z * ctrlK;

  t.vel.x += ax * dt;
  t.vel.z += az * dt;

  // 摩擦阻尼：晃動時軸心磨地更嚴重；鐵壁狀態下牢牢抓地
  const fric = t.spec.friction * (1 + t.tilt * 2) * (t.buff?.kind === 'fortress' ? 4 : 1);
  const damp = Math.max(0, 1 - fric * dt);
  t.vel.x *= damp;
  t.vel.z *= damp;

  t.pos.x += t.vel.x * dt;
  t.pos.z += t.vel.z * dt;

  // 轉速衰減（常數 + 比例），推移會額外消耗轉速
  const decayK = t.buff?.kind === 'cyclone' ? 0.3 : t.buff?.kind === 'fortress' ? 0.7 : 1;
  const decay = ((DECAY_CONST + DECAY_LINEAR * t.spin) / t.spec.stamina) * decayK;
  const ctrlCost = Math.hypot(t.control.x, t.control.z) * t.spec.maxSpin * CONTROL_SPIN_COST;
  t.spin = Math.max(0, t.spin - (decay + ctrlCost) * dt);

  const nr = spinRatio(t);
  t.angle += t.spinDir * t.spin * dt;
  t.tilt = Math.min(1, Math.max(0, (WOBBLE_RATIO - nr) / (WOBBLE_RATIO - SPIN_FINISH_RATIO)));
  t.precession += (3 + 9 * t.tilt) * dt;

  if (t.buff) {
    t.buff.time -= dt;
    if (t.buff.time <= 0) t.buff = null;
  }
}

/** 一次撞擊的結果（供事件、特效、鏡頭、音效使用） */
export interface ClashResult {
  pos: V2;
  normal: V2;
  intensity: number;
  sameSpin: boolean;
}

/**
 * 解算兩顆陀螺的碰撞。
 * - 法線衝量：一般彈性碰撞，攻擊力越高反彈係數越大。
 * - 旋轉衝量：接觸點的表面速度差（同向旋轉時相加、逆向時相消）轉成額外彈開力與切向摩擦，
 *   所以同向旋轉會猛烈彈開，這是戰鬥陀螺的招牌手感。
 * - 所有衝量等大反向，總動量守恆。
 * 沒有接觸、或已經在分離中就回傳 null。
 */
export function resolveCollision(a: TopState, b: TopState, rng: Rng): ClashResult | null {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const dist = Math.hypot(dx, dz);
  const minD = a.spec.radius + b.spec.radius;
  if (dist >= minD) return null;

  const n: V2 = dist > 1e-6 ? { x: dx / dist, z: dz / dist } : { x: 1, z: 0 };
  const invA = 1 / effMass(a);
  const invB = 1 / effMass(b);
  const invSum = invA + invB;

  // 位置修正：依質量倒數分攤，讓兩顆不再重疊
  const pen = minD - dist;
  a.pos.x -= n.x * pen * (invA / invSum);
  a.pos.z -= n.z * pen * (invA / invSum);
  b.pos.x += n.x * pen * (invB / invSum);
  b.pos.z += n.z * pen * (invB / invSum);

  const vn = (b.vel.x - a.vel.x) * n.x + (b.vel.z - a.vel.z) * n.z;
  if (vn >= 0) return null;

  // 主動衝撞的比例（衝量改變速度前先算）：衝過去的一方傷害較少、造成的傷害較多
  const pushA = Math.max(0, a.vel.x * n.x + a.vel.z * n.z);
  const pushB = Math.max(0, -(b.vel.x * n.x + b.vel.z * n.z));
  const shareA = (pushA + 0.01) / (pushA + pushB + 0.02);
  const dmgToA = 0.6 + 0.8 * (1 - shareA);
  const dmgToB = 0.6 + 0.8 * shareA;

  // 接觸點表面相對速度（沿切線 t）：a 的表面速度減 b 的表面速度
  const t: V2 = { x: n.z, z: -n.x };
  const slip = a.spinDir * a.spin * a.spec.radius + b.spinDir * b.spin * b.spec.radius;
  const slipN = slip / SURFACE_REF;

  const atkA = effAttack(a);
  const atkB = effAttack(b);
  const e = Math.min(0.9, 0.55 + 0.1 * Math.max(atkA, atkB));
  const jn = (-(1 + e) * vn) / invSum;
  const jSpin = (SPIN_REPEL * Math.abs(slipN) * ((atkA + atkB) / 2)) / invSum;
  const J = jn + jSpin;
  a.vel.x -= n.x * J * invA;
  a.vel.z -= n.z * J * invA;
  b.vel.x += n.x * J * invB;
  b.vel.z += n.z * J * invB;

  // 切向摩擦：把兩顆往表面滑動的反方向甩開
  const jt = CLASH_MU * J * Math.sign(slip) * Math.min(1, Math.abs(slipN) * 2);
  a.vel.x -= t.x * jt * invA;
  a.vel.z -= t.z * jt * invA;
  b.vel.x += t.x * jt * invB;
  b.vel.z += t.z * jt * invB;

  const intensity = -vn + 1.2 * Math.abs(slipN);

  // 傷害：轉速損失與爆裂量，受攻防比與隨機浮動影響
  const rfA = 0.75 + 0.5 * rng();
  const rfB = 0.75 + 0.5 * rng();
  const defA = effDefense(a);
  const defB = effDefense(b);
  a.spin = Math.max(0, a.spin - a.spec.maxSpin * SPIN_LOSS * intensity * (atkB / defA) * rfA * dmgToA);
  b.spin = Math.max(0, b.spin - b.spec.maxSpin * SPIN_LOSS * intensity * (atkA / defB) * rfB * dmgToB);
  if (intensity > BURST_MIN_INTENSITY) {
    const over = intensity - BURST_MIN_INTENSITY;
    a.burst += BURST_K * over * (atkB / defA) * rfA * dmgToA;
    b.burst += BURST_K * over * (atkA / defB) * rfB * dmgToB;
    // 同一次撞擊不讓雙方同時爆裂：較低的一方停在爆裂邊緣
    if (a.burst >= 1 && b.burst >= 1) {
      if (a.burst >= b.burst) b.burst = 0.97;
      else a.burst = 0.97;
    }
  }
  const gain = SPECIAL_K * Math.max(0, intensity - 1);
  a.special = Math.min(1, a.special + gain);
  b.special = Math.min(1, b.special + gain);

  return {
    pos: { x: a.pos.x + n.x * a.spec.radius, z: a.pos.z + n.z * a.spec.radius },
    normal: n,
    intensity,
    sameSpin: a.spinDir === b.spinDir,
  };
}

/** 場地邊緣的處理結果：ringOut 表示從出場口飛出；hit 為撞牆時的徑向速度 */
export interface RimResult {
  ringOut: boolean;
  hit: number;
}

/**
 * 處理陀螺碰到場地邊緣：在出場口且往外夠快就出場；
 * 其他情況把它夾回場內、反彈，並依轉速沿牆面甩出（磨牆）。
 */
export function resolveRim(t: TopState): RimResult {
  const r = Math.hypot(t.pos.x, t.pos.z);
  const limit = ARENA.radius - t.spec.radius;
  if (r <= limit) return { ringOut: false, hit: 0 };

  const dir: V2 = { x: t.pos.x / r, z: t.pos.z / r };
  const vr = t.vel.x * dir.x + t.vel.z * dir.z;
  if (vr > ARENA.overSpeed && inPocket(Math.atan2(t.pos.z, t.pos.x))) {
    return { ringOut: true, hit: vr };
  }

  t.pos.x = dir.x * limit;
  t.pos.z = dir.z * limit;
  if (vr > 0) {
    t.vel.x -= (1 + ARENA.wallRestitution) * vr * dir.x;
    t.vel.z -= (1 + ARENA.wallRestitution) * vr * dir.z;
    // 磨牆：轉速把陀螺沿切線甩出去，同時損失一些轉速
    const kick = 0.25 * vr * spinRatio(t) * t.spinDir;
    t.vel.x += -dir.z * kick;
    t.vel.z += dir.x * kick;
    t.spin = Math.max(0, t.spin - t.spec.maxSpin * 0.008 * vr);
  }
  return { ringOut: false, hit: Math.max(0, vr) };
}
