import * as THREE from 'three';
import { ARENA, floorHeight } from '../sim/arena';
import { TOP_EMBLEM } from '../sim/tops';
import type { TopSpec, TopState, TopType, V2 } from '../sim/types';
import { emblemTexture, spinBlurTexture } from './textures';

/** 攻擊環（能量層）的外形：回傳角度 θ 處的半徑 */
function layerRadius(type: TopType, theta: number, R: number): number {
  const f = (x: number) => x - Math.floor(x);
  switch (type) {
    case 'attack': // 三片鋸齒刃
      return R * (0.7 + 0.3 * Math.pow(f((3 * theta) / (Math.PI * 2)), 2.2));
    case 'defense': // 圓厚、六個凸塊
      return R * (0.9 + 0.1 * Math.cos(6 * theta));
    case 'stamina': // 寬大圓盤、八片薄翼
      return R * (0.86 + 0.14 * Math.pow(Math.abs(Math.sin(4 * theta)), 6));
    case 'balance': // 四支獠牙
      return R * (0.68 + 0.32 * Math.pow(Math.abs(Math.cos(2 * theta)), 6));
  }
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

  constructor(scene: THREE.Scene, spec: TopSpec) {
    this.scene = scene;
    const R = spec.radius;
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0d0, metalness: 1, roughness: 0.22 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22242c, metalness: 0.6, roughness: 0.4 });
    const glowMat = new THREE.MeshBasicMaterial({ color: spec.glow });

    // 軸心（尖端朝下，尖端在 y = 0）
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 16), dark);
    tip.rotation.x = Math.PI;
    tip.position.y = 0.06;
    const driver = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.07, 0.1, 24), dark);
    driver.position.y = 0.16;

    // 金屬盤
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.86, R * 0.8, 0.06, 48), metal);
    disc.position.y = 0.23;
    const discRing = new THREE.Mesh(new THREE.TorusGeometry(R * 0.84, 0.012, 6, 48), glowMat);
    discRing.rotation.x = Math.PI / 2;
    discRing.position.y = 0.25;

    // 攻擊環：以極座標外形擠出
    const shape = new THREE.Shape();
    const N = 160;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const r = layerRadius(spec.type, th, R);
      const x = r * Math.cos(th);
      const y = r * Math.sin(th);
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const layerGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.07,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 2,
      curveSegments: 1,
    });
    layerGeo.rotateX(-Math.PI / 2);
    const layer = new THREE.Mesh(
      layerGeo,
      new THREE.MeshStandardMaterial({
        color: spec.color,
        metalness: 0.55,
        roughness: 0.3,
        emissive: spec.glow,
        emissiveIntensity: 0.18,
      }),
    );
    layer.position.y = 0.27;
    const layerRing = new THREE.Mesh(new THREE.TorusGeometry(R * 0.55, 0.014, 6, 48), glowMat);
    layerRing.rotation.x = Math.PI / 2;
    layerRing.position.y = 0.36;

    // 紋章晶片
    const chip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.04, 32),
      [
        dark,
        new THREE.MeshBasicMaterial({ map: emblemTexture(TOP_EMBLEM[spec.type], '#' + new THREE.Color(spec.glow).getHexString()) }),
        dark,
      ],
    );
    chip.position.y = 0.37;

    for (const m of [tip, driver, disc, layer, chip]) {
      m.castShadow = true;
    }
    this.spinGroup.add(tip, driver, disc, discRing, layer, layerRing, chip);

    // 旋轉模糊盤：轉得越快越明顯
    this.blur = new THREE.Mesh(
      new THREE.CircleGeometry(R * 1.04, 48),
      new THREE.MeshBasicMaterial({
        map: spinBlurTexture(),
        color: spec.color,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.blur.rotation.x = -Math.PI / 2;
    this.blur.position.y = 0.39;
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
    const r = Math.hypot(t.pos.x, t.pos.z);
    const ratio = t.spin / t.spec.maxSpin;
    let y = floorHeight(Math.min(r, ARENA.radius));

    if (t.finish === 'over' && r > ARENA.radius - t.spec.radius) {
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
    this.spinGroup.rotation.y = t.angle;
    (this.blur.material as THREE.MeshBasicMaterial).opacity = 0.04 + 0.22 * ratio;
    this.blur.visible = !this.bursted;

    // 必殺氣場
    this.aura.visible = t.buff !== null && t.alive;
    if (this.aura.visible) {
      this.aura.rotation.y += dt * 8;
      (this.aura.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(time * 30);
      this.aura.scale.setScalar(1 + 0.08 * Math.sin(time * 12));
    }

    const speed = Math.hypot(t.vel.x, t.vel.z);
    this.trail.update(
      new THREE.Vector3(t.pos.x, y + 0.03, t.pos.z),
      this.bursted || (t.finish === 'over' && r > ARENA.radius) ? 0 : Math.min(0.09, speed * 0.02) * (0.4 + ratio),
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
      const floor = r < ARENA.radius ? floorHeight(r) + 0.03 : -1.15;
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
