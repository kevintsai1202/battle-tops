import * as THREE from 'three';
import { ARENA, floorHeight, type ArenaSpec } from '../sim/arena';
import type { V2 } from '../sim/types';
import { glowTexture, ringTexture } from './textures';

/** 火花粒子上限 */
const MAX_SPARKS = 2000;

/** 擴散環（衝擊波） */
interface Ring {
  mesh: THREE.Mesh | THREE.Sprite;
  life: number;
  max: number;
  size: number;
}

/** 放電弧線 */
interface Arc {
  line: THREE.Line;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  life: number;
  max: number;
}

/**
 * 撞擊特效：火花（光點 + 拖尾線）、地面與視角衝擊波環、閃光、放電弧線、瞬間補光。
 * 時間用「特效時間」推進：慢動作時變慢但不會完全停住，特寫中仍看得到火花飛散。
 */
export class Effects {
  private readonly scene: THREE.Scene;
  // 火花資料（結構化陣列，避免每幀配置物件）
  private readonly sp = new Float32Array(MAX_SPARKS * 3);
  private readonly sv = new Float32Array(MAX_SPARKS * 3);
  private readonly sc = new Float32Array(MAX_SPARKS * 3);
  private readonly sLife = new Float32Array(MAX_SPARKS);
  private readonly sMax = new Float32Array(MAX_SPARKS);
  private sNext = 0;
  private readonly pointPos: Float32Array;
  private readonly pointCol: Float32Array;
  private readonly linePos: Float32Array;
  private readonly lineCol: Float32Array;
  private readonly points: THREE.Points;
  private readonly lines: THREE.LineSegments;
  private rings: Ring[] = [];
  private arcs: Arc[] = [];
  private readonly flash: THREE.Sprite;
  private flashLife = 0;
  private readonly light: THREE.PointLight;
  private readonly ringTex = ringTexture();
  private readonly glowTex = glowTexture();
  /** 累計發射的火花數（e2e 觀察用） */
  sparksEmitted = 0;
  /** 目前場地（火花落地、特效貼地用） */
  arena: ArenaSpec = ARENA;
  /** 雙層戰鬥盤中央降下的程度（遊戲每幀設定；火花落地、撞擊點貼著凹槽的地面） */
  level = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.pointPos = new Float32Array(MAX_SPARKS * 3);
    this.pointCol = new Float32Array(MAX_SPARKS * 3);
    this.linePos = new Float32Array(MAX_SPARKS * 6);
    this.lineCol = new Float32Array(MAX_SPARKS * 6);

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pointCol, 3));
    this.points = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        size: 0.09,
        map: this.glowTex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3));
    this.lines = new THREE.LineSegments(
      lg,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.lines.frustumCulled = false;

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.flash.visible = false;

    this.light = new THREE.PointLight(0xffaa55, 0, 6, 2);
    scene.add(this.points, this.lines, this.flash, this.light);
  }

  /** 從 sim 座標取得撞擊點的世界座標（離地一點點） */
  worldAt(p: V2, lift = 0.3): THREE.Vector3 {
    const r = Math.min(Math.hypot(p.x, p.z), this.arena.radius);
    return new THREE.Vector3(p.x, floorHeight(r, this.arena, this.level) + lift, p.z);
  }

  /** 發射 count 顆火花：主方向 dir 附近隨機散開 */
  private emit(at: THREE.Vector3, count: number, dir: THREE.Vector3, spread: number, speed: number, colors: THREE.Color[], life: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.sNext;
      this.sNext = (this.sNext + 1) % MAX_SPARKS;
      const v = new THREE.Vector3(
        dir.x + (Math.random() - 0.5) * spread,
        dir.y + Math.random() * spread * 0.8,
        dir.z + (Math.random() - 0.5) * spread,
      )
        .normalize()
        .multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      this.sp.set([at.x, at.y, at.z], i * 3);
      this.sv.set([v.x, v.y, v.z], i * 3);
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.sc.set([c.r, c.g, c.b], i * 3);
      this.sMax[i] = life * (0.5 + Math.random());
      this.sLife[i] = this.sMax[i];
    }
    this.sparksEmitted += count;
  }

  /** 新增一個擴散環；flat 為平躺在地面，否則是面向鏡頭的圓環 */
  private ring(at: THREE.Vector3, color: THREE.Color, size: number, life: number, flat: boolean): void {
    const mat = new THREE.MeshBasicMaterial({
      map: this.ringTex,
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    let mesh: THREE.Mesh | THREE.Sprite;
    if (flat) {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.rotation.x = -Math.PI / 2;
    } else {
      mesh = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.ringTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mat.dispose();
    }
    mesh.position.copy(at);
    mesh.scale.setScalar(0.01);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, max: life, size });
  }

  /** 放電弧線：從撞擊點往外亂竄的鋸齒光 */
  private arc(at: THREE.Vector3, color: THREE.Color, count: number, life: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0.2 + Math.random() * 0.7, Math.sin(a)).normalize();
      const geo = new THREE.BufferGeometry().setFromPoints(new Array(10).fill(0).map(() => at.clone()));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      line.frustumCulled = false;
      this.scene.add(line);
      this.arcs.push({ line, origin: at.clone(), dir, len: 0.6 + Math.random() * 0.9, life, max: life });
    }
  }

  /** 閃光與補光 */
  private burstLight(at: THREE.Vector3, color: THREE.Color, size: number, power: number): void {
    this.flash.position.copy(at);
    this.flash.material.color.copy(color);
    this.flash.scale.setScalar(size);
    this.flash.visible = true;
    this.flashLife = 1;
    this.light.position.copy(at);
    this.light.color.copy(color);
    this.light.intensity = power;
  }

  /**
   * 陀螺互撞。big 為觸發特寫的重擊：火花更多、加上視角衝擊波與放電。
   * 火花主要沿切線方向噴出（表面互相摩擦的方向）。
   */
  clash(p: V2, normal: V2, intensity: number, colorA: number, colorB: number, big: boolean): void {
    const at = this.worldAt(p);
    const hot = [new THREE.Color(0xfff6d0), new THREE.Color(0xffc040), new THREE.Color(0xff7a20)];
    const cols = [...hot, new THREE.Color(colorA), new THREE.Color(colorB)];
    const tangent = new THREE.Vector3(normal.z, 0.35, -normal.x);
    const n = Math.min(260, Math.round(18 + intensity * (big ? 28 : 10)));
    this.emit(at, n / 2, tangent, 1.2, 3 + intensity * 0.9, cols, 0.55);
    this.emit(at, n / 2, tangent.clone().multiplyScalar(-1).setY(0.35), 1.2, 3 + intensity * 0.9, cols, 0.55);
    this.ring(at.clone().setY(at.y - 0.25), new THREE.Color(0xffd080), 1.2 + intensity * 0.25, 0.45, true);
    this.burstLight(at, new THREE.Color(0xffc070), 0.6 + intensity * 0.12, 4 + intensity * 2);
    if (big) {
      this.ring(at, new THREE.Color(0xffffff), 2.4, 0.35, false);
      this.ring(at, new THREE.Color(colorA).lerp(new THREE.Color(colorB), 0.5), 1.6, 0.5, false);
      this.ring(at.clone().setY(at.y - 0.25), new THREE.Color(colorA), 4, 0.8, true);
      this.arc(at, new THREE.Color(colorA), 4, 0.7);
      this.arc(at, new THREE.Color(colorB), 4, 0.7);
      this.burstLight(at, new THREE.Color(0xfff0e0), 2.2, 16);
    }
  }

  /** 撞牆：少量火花 */
  wall(p: V2, intensity: number, color: number): void {
    const at = this.worldAt(p, 0.2);
    const out = new THREE.Vector3(-p.x, 0.6, -p.z).normalize();
    this.emit(at, Math.round(6 + intensity * 6), out, 1.4, 2 + intensity, [new THREE.Color(0xffd090), new THREE.Color(color)], 0.35);
  }

  /** 必殺技發動：光柱、上升火花與地面環 */
  special(p: V2, color: number): void {
    const at = this.worldAt(p, 0.1);
    const c = new THREE.Color(color);
    this.emit(at, 160, new THREE.Vector3(0, 1, 0), 0.9, 7, [c, new THREE.Color(0xffffff)], 0.9);
    this.ring(at, c, 3.5, 0.7, true);
    this.ring(at.clone().setY(at.y + 0.4), c, 3, 0.6, false);
    this.arc(at, c, 6, 0.8);
    this.burstLight(at, c, 1.8, 12);
  }

  /** 回合終結：大爆發 */
  finish(p: V2, color: number): void {
    const at = this.worldAt(p);
    const c = new THREE.Color(color);
    const cols = [new THREE.Color(0xffffff), new THREE.Color(0xffd070), c];
    this.emit(at, 420, new THREE.Vector3(0, 0.6, 0), 2.2, 9, cols, 1.1);
    this.ring(at.clone().setY(at.y - 0.25), new THREE.Color(0xffffff), 7, 0.9, true);
    this.ring(at.clone().setY(at.y - 0.2), c, 5, 1.0, true);
    this.ring(at, new THREE.Color(0xffffff), 2.2, 0.5, false);
    this.arc(at, c, 10, 1.0);
    this.burstLight(at, new THREE.Color(0xfff0e0), 3, 20);
  }

  /**
   * 場地機關：熔岩噴發（火柱）、濺水（水花）、撞冰柱（冰屑）。
   * intensity 為事件強度（噴發時為被轟到的陀螺數）。
   */
  hazard(kind: 'erupt' | 'splash' | 'pillar', p: V2, intensity: number): void {
    if (kind === 'erupt') {
      const at = this.worldAt(p, 0.05);
      const cols = [new THREE.Color(0xffe080), new THREE.Color(0xff7a1a), new THREE.Color(0xff3a0a)];
      this.emit(at, 150, new THREE.Vector3(0, 1, 0), 0.7, 7.5, cols, 1.1);
      this.ring(at, new THREE.Color(0xff6a1a), 2.2, 0.7, true);
      this.burstLight(at, new THREE.Color(0xff8a3a), intensity > 0 ? 2.2 : 1.4, intensity > 0 ? 14 : 8);
    } else if (kind === 'splash') {
      const at = this.worldAt(p, 0.1);
      const cols = [new THREE.Color(0xd8ffff), new THREE.Color(0x60e0ff), new THREE.Color(0xffffff)];
      this.emit(at, Math.round(10 + intensity * 6), new THREE.Vector3(0, 1, 0), 1.6, 2.5 + intensity * 0.5, cols, 0.6);
      this.ring(at.clone().setY(at.y - 0.05), new THREE.Color(0x80f0ff), 1 + intensity * 0.2, 0.6, true);
    } else {
      const at = this.worldAt(p, 0.25);
      const out = new THREE.Vector3(p.x, 0.5, p.z).normalize();
      this.emit(at, Math.round(12 + intensity * 8), out, 1.4, 2 + intensity, [new THREE.Color(0xffffff), new THREE.Color(0x9ae8ff)], 0.45);
    }
  }

  /** 清除所有進行中的特效（新回合） */
  clear(): void {
    this.sLife.fill(0);
    for (const r of this.rings) this.disposeObj(r.mesh);
    for (const a of this.arcs) this.disposeObj(a.line);
    this.rings = [];
    this.arcs = [];
  }

  private disposeObj(o: THREE.Mesh | THREE.Sprite | THREE.Line): void {
    o.removeFromParent();
    o.geometry.dispose();
    const m = o.material as THREE.Material;
    m.dispose();
  }

  /** 每幀推進：fxDt 為特效時間，wallDt 為牆鐘時間 */
  update(fxDt: number, wallDt: number): void {
    // 火花：重力、空氣阻力、碰地反彈
    const drag = Math.exp(-fxDt * 1.6);
    for (let i = 0; i < MAX_SPARKS; i++) {
      const k = i * 3;
      if (this.sLife[i] <= 0) {
        this.pointCol.fill(0, k, k + 3);
        this.lineCol.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      this.sLife[i] -= fxDt;
      this.sv[k + 1] -= 9.8 * fxDt;
      this.sv[k] *= drag;
      this.sv[k + 1] *= drag;
      this.sv[k + 2] *= drag;
      this.sp[k] += this.sv[k] * fxDt;
      this.sp[k + 1] += this.sv[k + 1] * fxDt;
      this.sp[k + 2] += this.sv[k + 2] * fxDt;
      const r = Math.hypot(this.sp[k], this.sp[k + 2]);
      const floor = r < this.arena.radius ? floorHeight(r, this.arena, this.level) : -1.2;
      if (this.sp[k + 1] < floor) {
        this.sp[k + 1] = floor;
        this.sv[k + 1] = Math.abs(this.sv[k + 1]) * 0.4;
      }
      const f = Math.max(0, this.sLife[i] / this.sMax[i]);
      const b = f * f * 1.6;
      this.pointPos.set([this.sp[k], this.sp[k + 1], this.sp[k + 2]], k);
      this.pointCol.set([this.sc[k] * b, this.sc[k + 1] * b, this.sc[k + 2] * b], k);
      // 拖尾：往速度反方向畫一段，速度越快越長
      const tl = 0.035;
      this.linePos.set(
        [this.sp[k], this.sp[k + 1], this.sp[k + 2], this.sp[k] - this.sv[k] * tl, this.sp[k + 1] - this.sv[k + 1] * tl, this.sp[k + 2] - this.sv[k + 2] * tl],
        i * 6,
      );
      this.lineCol.set([this.sc[k] * b, this.sc[k + 1] * b, this.sc[k + 2] * b, 0, 0, 0], i * 6);
    }
    for (const g of [this.points.geometry, this.lines.geometry]) {
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    }

    // 擴散環
    this.rings = this.rings.filter((r) => {
      r.life -= fxDt;
      if (r.life <= 0) {
        this.disposeObj(r.mesh);
        return false;
      }
      const t = 1 - r.life / r.max;
      const e = 1 - Math.pow(1 - t, 3);
      r.mesh.scale.setScalar(0.05 + r.size * e);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * (1 - t);
      return true;
    });

    // 放電弧線：每幀重新抖動
    this.arcs = this.arcs.filter((a) => {
      a.life -= fxDt;
      if (a.life <= 0) {
        this.disposeObj(a.line);
        return false;
      }
      const pos = a.line.geometry.attributes.position as THREE.BufferAttribute;
      const t = 1 - a.life / a.max;
      const len = a.len * Math.min(1, t * 4);
      for (let i = 0; i < pos.count; i++) {
        const s = (i / (pos.count - 1)) * len;
        const j = i === 0 ? 0 : 0.12;
        pos.setXYZ(
          i,
          a.origin.x + a.dir.x * s + (Math.random() - 0.5) * j,
          a.origin.y + a.dir.y * s + (Math.random() - 0.5) * j,
          a.origin.z + a.dir.z * s + (Math.random() - 0.5) * j,
        );
      }
      pos.needsUpdate = true;
      (a.line.material as THREE.LineBasicMaterial).opacity = Math.random() < 0.25 ? 0.2 : 1 - t;
      return true;
    });

    // 閃光用牆鐘時間：慢動作時也要一閃即逝
    if (this.flashLife > 0) {
      this.flashLife -= wallDt * 5;
      this.flash.material.opacity = Math.max(0, this.flashLife) * 0.8;
      this.flash.visible = this.flashLife > 0;
    }
    this.light.intensity *= Math.exp(-wallDt * 7);
  }
}
