import { ARENA, floorSlope, inCircle, inPocket, type ArenaSpec } from './arena';
import type { Rng } from './rng';
import type { BuffMods, TopSpec, TopState, V2 } from './types';

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
/** 熔岩灼燒時的轉速衰減倍率 */
const LAVA_HEAT = 2.2;
/** 熔岩噴發的往外衝量（速度）與轉速損失比例 */
const ERUPT_SPEED = 5.5;
const ERUPT_SPIN_LOSS = 0.05;

/** 建立一顆陀螺的初始狀態；spinRatio 為發射轉速佔最高轉速的比例；spinDir 省略時用陀螺本身的旋轉方向 */
export function createTop(id: number, spec: TopSpec, pos: V2, vel: V2, spinRatio: number, spinDir: 1 | -1 = spec.spinDir): TopState {
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
    hex: null,
    alive: true,
    finish: null,
    finishTime: 0,
    terrain: 'ground',
  };
}

/** 取自己增益與對手減益的某個倍率相乘（沒設定視為 1） */
export function mod(t: TopState, key: 'atk' | 'def' | 'mass' | 'decay' | 'fric' | 'ctrl' | 'cruise' | 'burstDealt'): number {
  return (t.buff?.mods[key] ?? 1) * (t.hex?.mods[key] ?? 1);
}

/** 自己增益中的特殊效果（吸轉、反擊、力場）；沒有時為 undefined */
function own<K extends keyof BuffMods>(t: TopState, key: K): BuffMods[K] | undefined {
  return t.buff?.mods[key];
}

/** 計入必殺增益後的攻擊力 */
export function effAttack(t: TopState): number {
  return t.spec.attack * mod(t, 'atk');
}

/** 計入必殺增益後的防禦力 */
export function effDefense(t: TopState): number {
  return t.spec.defense * mod(t, 'def');
}

/** 計入必殺增益後的質量 */
export function effMass(t: TopState): number {
  return t.spec.mass * mod(t, 'mass');
}

/** 目前轉速佔最高轉速的比例 */
export function spinRatio(t: TopState): number {
  return t.spin / t.spec.maxSpin;
}

/** 場地機關在這一步產生的事件（交給 BattleSim 轉成 SimEvent） */
export interface TerrainHit {
  kind: 'erupt' | 'splash' | 'pillar';
  pos: V2;
  intensity: number;
}

/**
 * 推進一顆陀螺 dt 秒：地面坡度（碗形／火山錐）、軸心驅動力帶它繞場、
 * 場地地面性質（冰面打滑、積水阻力與水流、極限軌道加速、熔岩灼燒）、摩擦、玩家推移、轉速衰減與晃動。
 * 只處理單顆陀螺，不含碰撞、牆與熔岩噴發（噴發由 BattleSim 依時間觸發）；回傳濺水事件。
 */
export function integrateTop(t: TopState, dt: number, arena: ArenaSpec = ARENA): TerrainHit | null {
  const r = Math.hypot(t.pos.x, t.pos.z);
  const ratio = spinRatio(t);
  const grip = arena.gripMul;
  let ax = 0;
  let az = 0;
  let hit: TerrainHit | null = null;

  // 坡度：沿地面往低處的重力分量（碗形往中心；火山錐附近往外）
  if (r > 1e-6) {
    const slope = floorSlope(r, arena);
    const a = (arena.gravity * slope) / Math.sqrt(1 + slope * slope);
    ax -= (t.pos.x / r) * a;
    az -= (t.pos.z / r) * a;

    // 進動：轉速帶來少量切向漂移，讓軌跡帶點旋渦感（接近中心時減弱，避免奇異點）
    const swirl = t.spec.drive * PRECESSION_SWIRL * ratio * Math.min(1, r / 0.8) * grip;
    ax += (-t.pos.z / r) * swirl * t.spinDir;
    az += (t.pos.x / r) * swirl * t.spinDir;
  }

  // 地形判定
  const inWater = arena.water !== null && r < arena.water.r;
  const onRail = arena.rail !== null && r > arena.rail.from;
  const lava = arena.vents.find((v) => inCircle(t.pos, v.x, v.z, v.r)) ?? null;
  t.terrain = lava ? 'lava' : inWater ? 'water' : onRail ? 'rail' : 'ground';

  // 軸心驅動：沿行進方向把速度維持在巡航速度附近。
  // 配合碗形坡度，陀螺會走出穿越中心的花瓣軌跡，而不是貼牆繞圈。
  const speed = Math.hypot(t.vel.x, t.vel.z);
  const waterGrip = inWater ? 0.6 : 1;
  if (speed > 0.05) {
    // 極限軌道上軸心咬住齒軌，巡航上限提高（否則軌道加速會被驅動力煞掉）
    const cap = t.spec.cruise * ratio * mod(t, 'cruise') * (onRail ? 1.7 : 1);
    let push = t.spec.drive * ratio * grip * waterGrip * Math.max(-1, Math.min(1, 1 - speed / Math.max(cap, 0.01)));
    // 靠近邊緣且正往外衝時，軸心爬坡吃力：驅動力大幅減弱，避免自己衝出場
    if (push > 0 && r > 1e-6) {
      const outward = Math.max(0, (t.vel.x * t.pos.x + t.vel.z * t.pos.z) / (speed * r));
      const edge = Math.min(1, Math.max(0, (r - 1.6) / 1.2));
      push *= 1 - 0.9 * outward * edge;
    }
    ax += (t.vel.x / speed) * push;
    az += (t.vel.z / speed) * push;
  }

  // 極限軌道（X Dash）：沿切線（依旋轉方向）加速並往內甩出，機動力高的陀螺吃到更多。
  // 只往切線加速的話陀螺會一直貼著外圈繞、打不到對手，所以加上往內的分量。
  if (onRail && r > 1e-6) {
    const k = arena.rail!.accel * ratio * (0.3 + 0.7 * Math.min(1, t.spec.stats.dash / 10));
    ax += ((-t.pos.z / r) * t.spinDir * 0.75 - (t.pos.x / r) * 0.65) * k;
    az += ((t.pos.x / r) * t.spinDir * 0.75 - (t.pos.z / r) * 0.65) * k;
  }

  // 積水：阻力把速度拉向水流速度（逆時針繞中心），水越深（越靠中心）阻力越大
  if (inWater) {
    const w = arena.water!;
    const depth = 0.5 + 0.5 * (1 - r / w.r);
    const fx = r > 1e-6 ? (-t.pos.z / r) * w.current * Math.min(1, r / 0.5) : 0;
    const fz = r > 1e-6 ? (t.pos.x / r) * w.current * Math.min(1, r / 0.5) : 0;
    ax += (fx - t.vel.x) * w.drag * depth;
    az += (fz - t.vel.z) * w.drag * depth;
    if (speed > 2.2) hit = { kind: 'splash', pos: { ...t.pos }, intensity: speed };
  }

  // 推移輸入（冰面、減益時推不太動）
  const ctrlK = CONTROL_ACCEL * mod(t, 'ctrl') * (0.35 + 0.65 * grip);
  ax += t.control.x * ctrlK;
  az += t.control.z * ctrlK;

  t.vel.x += ax * dt;
  t.vel.z += az * dt;

  // 摩擦阻尼：晃動時軸心磨地更嚴重；鐵壁等增益會牢牢抓地；冰面幾乎沒有摩擦
  const fric = t.spec.friction * (1 + t.tilt * 2) * mod(t, 'fric') * arena.frictionMul;
  const damp = Math.max(0, 1 - fric * dt);
  t.vel.x *= damp;
  t.vel.z *= damp;

  t.pos.x += t.vel.x * dt;
  t.pos.z += t.vel.z * dt;

  // 轉速衰減（常數 + 比例），推移會額外消耗轉速；熔岩灼燒與積水會加快流失
  const terrainK = lava ? LAVA_HEAT : inWater ? arena.water!.spinDrag : 1;
  const decay = ((DECAY_CONST + DECAY_LINEAR * t.spin) / t.spec.stamina) * mod(t, 'decay') * arena.decayMul * terrainK;
  const ctrlCost = Math.hypot(t.control.x, t.control.z) * t.spec.maxSpin * CONTROL_SPIN_COST;
  t.spin = Math.max(0, t.spin - (decay + ctrlCost) * dt);

  const nr = spinRatio(t);
  t.angle += t.spinDir * t.spin * dt;
  t.tilt = Math.min(1, Math.max(0, (WOBBLE_RATIO - nr) / (WOBBLE_RATIO - SPIN_FINISH_RATIO)));
  t.precession += (3 + 9 * t.tilt) * dt;

  for (const key of ['buff', 'hex'] as const) {
    const b = t[key];
    if (b) {
      b.time -= dt;
      if (b.time <= 0) t[key] = null;
    }
  }
  return hit;
}

/** 熔岩噴發：把陀螺從噴口中心 (cx, cz) 往外轟開並扣轉速 */
export function eruptPush(t: TopState, cx: number, cz: number): void {
  let dx = t.pos.x - cx;
  let dz = t.pos.z - cz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-3) {
    // 正好在中心：往場地中心方向轟
    dx = -cx;
    dz = -cz;
  }
  const n = Math.hypot(dx, dz) || 1;
  t.vel.x += (dx / n) * ERUPT_SPEED;
  t.vel.z += (dz / n) * ERUPT_SPEED;
  t.spin = Math.max(0, t.spin - t.spec.maxSpin * ERUPT_SPIN_LOSS);
}

/**
 * 力場型增益（aura）：把對手往自己拉近（k > 0）或推開（k < 0），距離越近越強。
 * 由 BattleSim 在碰撞前呼叫。
 */
export function applyAura(src: TopState, target: TopState, dt: number): void {
  const aura = own(src, 'aura');
  if (!aura || !src.alive || !target.alive) return;
  const dx = src.pos.x - target.pos.x;
  const dz = src.pos.z - target.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > aura.range || d < 1e-6) return;
  const k = aura.k * (1 - d / aura.range);
  target.vel.x += (dx / d) * k * dt;
  target.vel.z += (dz / d) * k * dt;
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
 *   所以同向旋轉會猛烈彈開，這是戰鬥陀螺的招牌手感；左旋對右旋則貼身互磨。
 * - 所有衝量等大反向，總動量守恆。
 * - 必殺效果：爆裂傷害倍率、吸取轉速、反擊（被撞時對方承受同比例爆裂量）。
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

  // 傷害：轉速損失與爆裂量，受攻防比、爆裂抵抗與隨機浮動影響
  const rfA = 0.75 + 0.5 * rng();
  const rfB = 0.75 + 0.5 * rng();
  const defA = effDefense(a);
  const defB = effDefense(b);
  a.spin = Math.max(0, a.spin - a.spec.maxSpin * SPIN_LOSS * intensity * (atkB / defA) * rfA * dmgToA);
  b.spin = Math.max(0, b.spin - b.spec.maxSpin * SPIN_LOSS * intensity * (atkA / defB) * rfB * dmgToB);
  if (intensity > BURST_MIN_INTENSITY) {
    const over = intensity - BURST_MIN_INTENSITY;
    let toA = (BURST_K * over * (atkB / defA) * rfA * dmgToA * mod(b, 'burstDealt')) / a.spec.burstRes;
    let toB = (BURST_K * over * (atkA / defB) * rfB * dmgToB * mod(a, 'burstDealt')) / b.spec.burstRes;
    // 反擊：被撞的一方把一部分爆裂量回敬給對方
    const reflA = own(a, 'reflect') ?? 0;
    const reflB = own(b, 'reflect') ?? 0;
    const backToB = toA * reflA;
    const backToA = toB * reflB;
    toA += backToA;
    toB += backToB;
    a.burst += toA;
    b.burst += toB;
    // 同一次撞擊不讓雙方同時爆裂：較低的一方停在爆裂邊緣
    if (a.burst >= 1 && b.burst >= 1) {
      if (a.burst >= b.burst) b.burst = 0.97;
      else a.burst = 0.97;
    }
  }
  // 吸取轉速：每次撞擊吸走對手一部分轉速（左旋吸右旋時效果加倍）
  for (const [me, opp] of [
    [a, b],
    [b, a],
  ] as const) {
    const steal = own(me, 'spinSteal');
    if (!steal) continue;
    const k = steal * (me.spinDir !== opp.spinDir ? 2 : 1) * opp.spec.maxSpin;
    const got = Math.min(opp.spin, k);
    opp.spin -= got;
    me.spin = Math.min(me.spec.maxSpin, me.spin + got * 0.7);
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
export function resolveRim(t: TopState, arena: ArenaSpec = ARENA): RimResult {
  const r = Math.hypot(t.pos.x, t.pos.z);
  const limit = arena.radius - t.spec.radius;
  if (r <= limit) return { ringOut: false, hit: 0 };

  const dir: V2 = { x: t.pos.x / r, z: t.pos.z / r };
  const vr = t.vel.x * dir.x + t.vel.z * dir.z;
  if (vr > arena.overSpeed && inPocket(Math.atan2(t.pos.z, t.pos.x), arena)) {
    return { ringOut: true, hit: vr };
  }

  t.pos.x = dir.x * limit;
  t.pos.z = dir.z * limit;
  if (vr > 0) {
    t.vel.x -= (1 + arena.wallRestitution) * vr * dir.x;
    t.vel.z -= (1 + arena.wallRestitution) * vr * dir.z;
    // 磨牆：轉速把陀螺沿切線甩出去，同時損失一些轉速
    const kick = 0.25 * vr * spinRatio(t) * t.spinDir;
    t.vel.x += -dir.z * kick;
    t.vel.z += dir.x * kick;
    t.spin = Math.max(0, t.spin - t.spec.maxSpin * 0.008 * vr);
  }
  return { ringOut: false, hit: Math.max(0, vr) };
}

/**
 * 冰柱碰撞：陀螺碰到固定的圓柱就彈開（冰柱不動、反彈係數高），回傳撞擊的法向速度（沒撞到為 0）。
 */
export function resolvePillars(t: TopState, arena: ArenaSpec): { hit: number; pos: V2 } | null {
  for (const p of arena.pillars) {
    const dx = t.pos.x - p.x;
    const dz = t.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    const minD = p.r + t.spec.radius;
    if (d >= minD || d < 1e-6) continue;
    const n = { x: dx / d, z: dz / d };
    t.pos.x = p.x + n.x * minD;
    t.pos.z = p.z + n.z * minD;
    const vn = t.vel.x * n.x + t.vel.z * n.z;
    if (vn >= 0) continue;
    t.vel.x -= 1.75 * vn * n.x;
    t.vel.z -= 1.75 * vn * n.z;
    t.spin = Math.max(0, t.spin - t.spec.maxSpin * 0.006 * -vn);
    return { hit: -vn, pos: { x: p.x + n.x * p.r, z: p.z + n.z * p.r } };
  }
  return null;
}
