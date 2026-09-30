import * as THREE from 'three';
import { ARENA, floorHeight, type ArenaSpec } from '../sim/arena';
import type { PartId } from '../sim/parts';
import { TOP_SPECS } from '../sim/tops';
import type { Lobe, TopLook, TopSpec, TopState, V2 } from '../sim/types';
import { emblemTexture, spinBlurTexture } from './textures';

/** 輪廓起伏的放大倍率：原型的凸起多半很淺，縮小到遊戲尺寸後放大一點才看得出形狀 */
const LOBE_EXAGGERATE = 1.4;

/** 兩個角度（度）的差，落在 -180..180 */
function angDiff(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * 攻擊環輪廓：角度 θ（弧度）處的半徑。基準圓加上每組凸起；凸起是峰值位置可偏移的平滑隆起，
 * skew 讓峰值往旋轉前方偏（spinDir 決定哪邊是前方），做出鋸齒或前傾的刃。最外緣約等於 R。
 */
export function ringRadius(lobes: Lobe[], theta: number, R: number, spinDir: 1 | -1 = 1): number {
  const total = lobes.reduce((a, l) => a + Math.max(0, l.height), 0) * LOBE_EXAGGERATE;
  let r = 1 - Math.min(0.45, total);
  const deg = (theta * 180) / Math.PI;
  for (const l of lobes) {
    const sk = Math.max(-0.9, Math.min(0.9, (l.skew ?? 0) * spinDir));
    for (let k = 0; k < l.n; k++) {
      const u = angDiff(deg, l.phase + (k * 360) / l.n) / (l.width / 2);
      if (u <= -1 || u >= 1) continue;
      // 峰值在 u = sk 的不對稱隆起：從 -1 升到 sk、再降到 1
      const v = u < sk ? (u + 1) / (sk + 1) : (1 - u) / (1 - sk);
      r += l.height * LOBE_EXAGGERATE * v * v * (3 - 2 * v);
    }
  }
  return R * r;
}

/** 依輪廓擠出一片環（在 xz 平面，底面在 y = 0）；hole > 0 時中間挖一個圓孔 */
function extrudeProfile(lobes: Lobe[], R: number, spinDir: 1 | -1, depth: number, hole = 0): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const N = 180;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const r = ringRadius(lobes, th, R, spinDir);
    if (i === 0) shape.moveTo(r * Math.cos(th), r * Math.sin(th));
    else shape.lineTo(r * Math.cos(th), r * Math.sin(th));
  }
  if (hole > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, hole, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * 軸心（尖端在 y = 0）：依軸心零件做出不同外形——平頭、橡膠平頭、錐頭、尖頭、針頭、球頭、寬球、軸承。
 * 上方的外殼用外觀的軸心顏色。
 */
function buildDriver(part: PartId, look: TopLook): THREE.Object3D {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: look.tip, metalness: 0.3, roughness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d22, metalness: 0.5, roughness: 0.5 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, metalness: 0, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: look.metal, metalness: 1, roughness: 0.25 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, sy = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.scale.y = sy;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  switch (part) {
    case 'flat':
      add(new THREE.CylinderGeometry(0.055, 0.06, 0.07, 20), dark, 0.035);
      break;
    case 'rubber':
      add(new THREE.CylinderGeometry(0.07, 0.078, 0.07, 20), rubber, 0.035);
      break;
    case 'taper':
      add(new THREE.CylinderGeometry(0.065, 0.028, 0.08, 20), dark, 0.04);
      break;
    case 'sharp': {
      const c = add(new THREE.ConeGeometry(0.05, 0.1, 18), metal, 0.05);
      c.rotation.x = Math.PI;
      break;
    }
    case 'needle': {
      const c = add(new THREE.ConeGeometry(0.032, 0.12, 14), metal, 0.06);
      c.rotation.x = Math.PI;
      break;
    }
    case 'ball':
      add(new THREE.SphereGeometry(0.052, 18, 12), metal, 0.052);
      break;
    case 'wideBall':
      add(new THREE.SphereGeometry(0.08, 20, 12), dark, 0.05, 0.62);
      break;
    case 'bearing': {
      const c = add(new THREE.ConeGeometry(0.045, 0.09, 18), metal, 0.045);
      c.rotation.x = Math.PI;
      const ring = add(new THREE.TorusGeometry(0.06, 0.013, 8, 24), new THREE.MeshStandardMaterial({ color: look.tip, metalness: 0.8, roughness: 0.2 }), 0.1);
      ring.rotation.x = Math.PI / 2;
      break;
    }
    default:
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 16), dark, 0.035);
  }
  // 外殼：尖端上方的圓台
  add(new THREE.CylinderGeometry(0.11, 0.07, 0.09, 24), shell, 0.155);
  return g;
}

/**
 * 重心盤（金屬件，放在 y = 0.2 附近）：依盤零件做出不同外形——
 * 標準圓盤、輕量（鏤空缺口）、重量（厚大）、外緣（外圈加厚）、刃盤（外緣小刃）、護鎖盤（三個鎖扣）。
 */
function buildDisk(part: PartId, R: number, look: TopLook, spinDir: 1 | -1): THREE.Object3D {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: look.metal, metalness: 1, roughness: 0.22 });
  const add = (geo: THREE.BufferGeometry, y: number) => {
    const m = new THREE.Mesh(geo, metal);
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  switch (part) {
    case 'light':
      add(extrudeProfile([{ n: 6, phase: 30, width: 30, height: -0.12 }], R * 0.82, spinDir, 0.035), 0.205);
      break;
    case 'heavy':
      add(new THREE.CylinderGeometry(R * 0.92, R * 0.88, 0.085, 48), 0.225);
      break;
    case 'rim': {
      add(new THREE.CylinderGeometry(R * 0.8, R * 0.76, 0.045, 48), 0.215);
      const t = add(new THREE.TorusGeometry(R * 0.82, 0.03, 10, 48), 0.225);
      t.rotation.x = Math.PI / 2;
      break;
    }
    case 'blade':
      add(extrudeProfile([{ n: 8, phase: 0, width: 26, height: 0.12, skew: 0.7 }], R * 0.9, spinDir, 0.05), 0.2);
      break;
    case 'guard': {
      add(new THREE.CylinderGeometry(R * 0.84, R * 0.8, 0.06, 48), 0.22);
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        const tab = add(new THREE.BoxGeometry(0.07, 0.05, 0.06), 0.26);
        tab.position.x = Math.cos(a) * R * 0.78;
        tab.position.z = Math.sin(a) * R * 0.78;
        tab.rotation.y = -a;
      }
      break;
    }
    default:
      add(new THREE.CylinderGeometry(R * 0.86, R * 0.8, 0.06, 48), 0.22);
  }
  return g;
}

/** 拖尾光帶：記錄最近的位置，組成一條往後漸細、漸淡的發光帶 */
class Trail {
  readonly mesh: THREE.Mesh;
  private readonly pts: THREE.Vector3[] = [];
  private readonly max = 46;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly color: THREE.Color;

  constructor(color: number) {
    this.color = new THREE.Color(color);
    this.pos = new Float32Array(this.max * 2 * 3);
    this.col = new Float32Array(this.max * 2 * 3);
    // uv 的 v 橫跨光帶寬度：配合柔邊貼圖，邊緣淡出、中間最亮
    const uv = new Float32Array(this.max * 2 * 2);
    for (let i = 0; i < this.max; i++) uv.set([i / this.max, 0, i / this.max, 1], i * 4);
    const idx: number[] = [];
    for (let i = 0; i < this.max - 1; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        map: trailTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
  }

  /** 清空軌跡（新回合時） */
  reset(): void {
    this.pts.length = 0;
  }

  /** 加入目前位置並重建光帶；width 依速度決定 */
  update(p: THREE.Vector3, width: number): void {
    const head = this.pts[0];
    if (!head || head.distanceTo(p) > 0.04) {
      this.pts.unshift(p.clone());
      if (this.pts.length > this.max) this.pts.pop();
    } else {
      head.copy(p);
    }
    const n = this.pts.length;
    for (let i = 0; i < this.max; i++) {
      const a = this.pts[Math.min(i, n - 1)] ?? p;
      const prev = this.pts[Math.max(0, i - 1)] ?? a;
      const next = this.pts[Math.min(n - 1, i + 1)] ?? a;
      let dx = prev.x - next.x;
      let dz = prev.z - next.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      const fade = i < n ? 1 - i / this.max : 0;
      const w = width * fade;
      this.pos.set([a.x - dz * w, a.y, a.z + dx * w, a.x + dz * w, a.y, a.z - dx * w], i * 6);
      const c = fade * fade * 0.8;
      this.col.set([this.color.r * c, this.color.g * c, this.color.b * c, this.color.r * c, this.color.g * c, this.color.b * c], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

/** 爆裂時飛散的零件 */
interface Debris {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

/**
 * 一顆陀螺的 3D 外觀：軸心、金屬盤、攻擊環、紋章晶片、旋轉模糊盤、拖尾與必殺氣場，
 * 以及停轉倒下、出場飛出、爆裂飛散三種終結動畫。
 */
export class TopView {
  /** 放在場上的根節點（位置） */
  readonly root = new THREE.Group();
  /** 晃動用（傾斜） */
  private readonly tiltGroup = new THREE.Group();
  /** 自轉用 */
  private readonly spinGroup = new THREE.Group();
  private readonly blur: THREE.Mesh;
  private readonly aura: THREE.Mesh;
  private readonly trail: Trail;
  private readonly scene: THREE.Scene;
  private debris: Debris[] = [];
  private bursted = false;
  /** 被撞時的額外晃動量與方向 */
  private wobble = 0;
  private wobbleAxis = new THREE.Vector3(1, 0, 0);
  /** 倒下時固定的傾倒軸 */
  private fallAxis: THREE.Vector3 | null = null;
  /** 所在場地（貼地高度用） */
  private readonly arena: ArenaSpec;
  private readonly glow: THREE.Color;

  constructor(scene: THREE.Scene, spec: TopSpec, arena: ArenaSpec = ARENA) {
    this.scene = scene;
    this.arena = arena;
    this.glow = new THREE.Color(spec.glow);
    const R = spec.radius;
    const look = spec.look;
    const glowMat = new THREE.MeshBasicMaterial({ color: spec.glow });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22242c, metalness: 0.6, roughness: 0.4 });

    // 軸心與重心盤：外形依目前裝的零件
    const driver = buildDriver(spec.parts.driver, look);
    const disk = buildDisk(spec.parts.disk, R, look, spec.spinDir);
    const discRing = new THREE.Mesh(new THREE.TorusGeometry(R * 0.84, 0.012, 6, 48), glowMat);
    discRing.rotation.x = Math.PI / 2;
    discRing.position.y = 0.255;

    // 攻擊環（主色）：依原型輪廓擠出
    const layer = new THREE.Mesh(
      extrudeProfile(look.ring, R, spec.spinDir, 0.07, R * 0.3),
      new THREE.MeshStandardMaterial({ color: look.primary, metalness: 0.45, roughness: 0.32, emissive: spec.glow, emissiveIntensity: 0.12 }),
    );
    layer.position.y = 0.27;
    // 第二層（副色，像能量環或透明件）：縮小一圈疊在上面
    const inner = new THREE.Mesh(
      extrudeProfile(look.inner, R * 0.7, spec.spinDir, 0.035, 0.1),
      new THREE.MeshStandardMaterial({ color: look.secondary, metalness: 0.3, roughness: 0.35, transparent: true, opacity: 0.92 }),
    );
    inner.position.y = 0.345;
    const layerRing = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.012, 6, 48), glowMat);
    layerRing.rotation.x = Math.PI / 2;
    layerRing.position.y = 0.39;

    // 紋章晶片
    const chip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.04, 32),
      [
        dark,
        new THREE.MeshBasicMaterial({ map: emblemTexture(spec.emblem, '#' + new THREE.Color(spec.glow).getHexString()) }),
        dark,
      ],
    );
    chip.position.y = 0.4;

    for (const m of [layer, inner, chip]) m.castShadow = true;
    this.spinGroup.add(driver, disk, discRing, layer, inner, layerRing, chip);

    // 旋轉模糊盤：轉得越快越明顯
    this.blur = new THREE.Mesh(
      new THREE.CircleGeometry(R * 1.04, 48),
      new THREE.MeshBasicMaterial({
        map: spinBlurTexture(),
        color: look.primary,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.blur.rotation.x = -Math.PI / 2;
    this.blur.position.y = 0.43;
    this.spinGroup.add(this.blur);

    // 必殺氣場（上下漸淡的光柱）
    this.aura = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 1.35, R * 0.9, 1.6, 32, 1, true),
      new THREE.MeshBasicMaterial({
        map: auraTexture(),
        color: spec.glow,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.aura.position.y = 0.75;
    this.aura.visible = false;

    this.tiltGroup.add(this.spinGroup);
    this.root.add(this.tiltGroup, this.aura);
    this.trail = new Trail(spec.glow);
    scene.add(this.root, this.trail.mesh);
  }

  /** 被撞時呼叫：加一點晃動（normal 為撞擊方向） */
  hit(normal: V2, intensity: number): void {
    this.wobble = Math.min(0.45, this.wobble + intensity * 0.04);
    this.wobbleAxis.set(-normal.z, 0, normal.x).normalize();
  }

  /** 依模擬狀態更新外觀；dt 為（已套用慢動作的）模擬時間 */
  update(t: TopState, dt: number, time: number): void {
    const R = this.arena.radius;
    const r = Math.hypot(t.pos.x, t.pos.z);
    const ratio = t.spin / t.spec.maxSpin;
    let y = floorHeight(Math.min(r, R), this.arena);

    if (t.finish === 'over' && r > R - t.spec.radius) {
      // 飛出場外：先往上拋再落下
      const ft = t.finishTime;
      y += 0.9 * ft - 5 * ft * ft;
      this.tiltGroup.rotation.x += dt * 6;
      this.tiltGroup.rotation.z += dt * 4;
    } else if (t.finish === 'spin') {
      // 停轉倒下
      if (!this.fallAxis) {
        const p = t.precession;
        this.fallAxis = new THREE.Vector3(Math.cos(p), 0, Math.sin(p));
      }
      const a = Math.min(1.25, t.finishTime * 3);
      this.tiltGroup.quaternion.setFromAxisAngle(this.fallAxis, a);
      y += Math.sin(a) * t.spec.radius * 0.5;
    } else if (t.finish === 'burst') {
      if (!this.bursted) this.explode(t);
    } else {
      // 正常旋轉：低轉速時繞進動角晃動，被撞時額外晃一下
      const p = t.precession;
      const axis = new THREE.Vector3(Math.cos(p), 0, Math.sin(p));
      const q = new THREE.Quaternion().setFromAxisAngle(axis, t.tilt * 0.45);
      const hitQ = new THREE.Quaternion().setFromAxisAngle(this.wobbleAxis, this.wobble * Math.sin(time * 40));
      this.tiltGroup.quaternion.copy(q.multiply(hitQ));
      this.wobble *= Math.exp(-dt * 6);
    }

    this.root.position.set(t.pos.x, y, t.pos.z);
    // 右旋（spinDir = 1）從上方看為順時針
    this.spinGroup.rotation.y = -t.angle;
    (this.blur.material as THREE.MeshBasicMaterial).opacity = 0.04 + 0.22 * ratio;
    this.blur.visible = !this.bursted;

    // 必殺氣場：自己的增益用自己的顏色；被對手施加減益時用對手的顏色、閃得比較慢
    const fx = t.buff ?? t.hex;
    this.aura.visible = fx !== null && t.alive;
    if (this.aura.visible) {
      const mat = this.aura.material as THREE.MeshBasicMaterial;
      const debuff = t.buff === null;
      mat.color.copy(debuff ? new THREE.Color(TOP_SPECS[fx!.from]?.glow ?? 0xffffff) : this.glow);
      this.aura.rotation.y += dt * (debuff ? -3 : 8);
      mat.opacity = debuff ? 0.3 + 0.2 * Math.sin(time * 8) : 0.55 + 0.35 * Math.sin(time * 30);
      this.aura.scale.setScalar((debuff ? 0.85 : 1) + 0.08 * Math.sin(time * 12));
    }

    const speed = Math.hypot(t.vel.x, t.vel.z);
    this.trail.update(
      new THREE.Vector3(t.pos.x, y + 0.03, t.pos.z),
      this.bursted || (t.finish === 'over' && r > R) ? 0 : Math.min(0.09, speed * 0.02) * (0.4 + ratio),
    );

    this.updateDebris(dt);
  }

  /** 爆裂：把零件拆開，各自帶速度飛散 */
  private explode(t: TopState): void {
    this.bursted = true;
    const parts = [...this.spinGroup.children].filter((c) => c !== this.blur);
    for (const obj of parts) {
      this.scene.attach(obj);
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 2.5;
      this.debris.push({
        obj,
        vel: new THREE.Vector3(Math.cos(a) * s + t.vel.x * 0.3, 2 + Math.random() * 2.5, Math.sin(a) * s + t.vel.z * 0.3),
        spin: new THREE.Vector3(Math.random() * 20 - 10, Math.random() * 30 - 15, Math.random() * 20 - 10),
      });
    }
  }

  /** 零件的拋物線運動與落地反彈 */
  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      d.vel.y -= 9.8 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      const r = Math.hypot(d.obj.position.x, d.obj.position.z);
      const floor = r < this.arena.radius ? floorHeight(r, this.arena) + 0.03 : -1.15;
      if (d.obj.position.y < floor) {
        d.obj.position.y = floor;
        d.vel.y = Math.abs(d.vel.y) * 0.35;
        d.vel.x *= 0.7;
        d.vel.z *= 0.7;
        d.spin.multiplyScalar(0.6);
      }
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
    }
  }

  /** 從場景移除並釋放資源 */
  dispose(): void {
    const drop = (o: THREE.Object3D) => {
      o.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
        }
      });
      o.removeFromParent();
    };
    drop(this.root);
    drop(this.trail.mesh);
    for (const d of this.debris) drop(d.obj);
    this.debris = [];
  }
}

let trailTex: THREE.CanvasTexture | null = null;
/** 拖尾柔邊貼圖：沿寬度方向中間亮、兩側淡出 */
function trailTexture(): THREE.CanvasTexture {
  if (trailTex) return trailTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  trailTex = new THREE.CanvasTexture(c);
  trailTex.colorSpace = THREE.SRGBColorSpace;
  return trailTex;
}

let auraTex: THREE.CanvasTexture | null = null;
/** 必殺氣場貼圖：垂直漸層 + 細條紋 */
function auraTexture(): THREE.CanvasTexture {
  if (auraTex) return auraTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < 64; x += 8) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x, 0, 3, 256);
  }
  auraTex = new THREE.CanvasTexture(c);
  auraTex.wrapS = THREE.RepeatWrapping;
  auraTex.colorSpace = THREE.SRGBColorSpace;
  return auraTex;
}
