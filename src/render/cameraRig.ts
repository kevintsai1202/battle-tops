import * as THREE from 'three';
import type { CameraDirector } from '../director/director';
import { ARENA, floorHeight, type ArenaSpec } from '../sim/arena';
import type { TopState, V2 } from '../sim/types';

/** 遊戲層告訴鏡頭目前要拍什麼 */
export type Shot = 'title' | 'select' | 'launch' | 'battle';

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/**
 * 直向或窄螢幕的視角補償：鏡頭參數是以 16:9 設計的，畫面變窄時加大垂直 FOV，
 * 讓水平視野不要縮太多（直向手機才看得到整個場地）。16:9 以上不變，最大 95°。
 */
export function aspectFov(vfov: number, aspect: number): number {
  const k = Math.min(2.2, Math.max(1, 16 / 9 / aspect));
  const out = (2 * Math.atan(Math.tan((vfov * Math.PI) / 360) * k) * 180) / Math.PI;
  return Math.min(95, out);
}

/**
 * 鏡頭擺位：依導演模式（全景／撞擊特寫／終結）與遊戲階段計算相機位置、視角、FOV 與傾斜，
 * 再疊上畫面震動。特寫與終結鏡頭用「硬切」進場，像動畫分鏡。
 */
export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly pos = new THREE.Vector3(0, 5, 8);
  private readonly look = new THREE.Vector3();
  private orbit = -Math.PI / 2;
  private fov = 50;
  private roll = 0;
  private lastMode = 'overview';
  private shotTime = 0;
  private lastShot: Shot = 'title';
  /** 特寫時從撞擊點的哪一側拍（1 或 -1） */
  private side = 1;
  /** 目前場地（鏡頭焦點貼地用） */
  arena: ArenaSpec = ARENA;
  /** 雙層戰鬥盤中央降下的程度（遊戲每幀設定；鏡頭焦點貼著凹槽的地面） */
  level = 0;
  /** 自己的座位：發射鏡頭從自己陀螺的背後拍（1 號座位在右側，鏡頭繞場地中心轉 180°） */
  seat: 0 | 1 = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /** 每幀更新；tops 為場上陀螺（沒有時傳空陣列） */
  update(shot: Shot, director: CameraDirector, tops: TopState[], dt: number): void {
    if (shot !== this.lastShot) {
      this.shotTime = 0;
      this.lastShot = shot;
    }
    this.shotTime += dt;
    const k = 1 - Math.exp(-dt * 3.2);
    let targetPos = new THREE.Vector3();
    let targetLook = new THREE.Vector3();
    let targetFov = 50;
    let targetRoll = 0;
    let snap = false;

    const mode = shot === 'battle' ? director.mode : 'overview';
    if (mode !== this.lastMode) {
      snap = mode !== 'overview';
      if (mode === 'closeup') this.side = Math.random() < 0.5 ? 1 : -1;
      this.lastMode = mode;
    }

    if (shot === 'title') {
      this.orbit += dt * 0.12;
      targetPos.set(Math.cos(this.orbit) * 7.5, 3.6, Math.sin(this.orbit) * 7.5);
      targetLook.set(0, 0.2, 0);
    } else if (shot === 'select') {
      this.orbit += dt * 0.25;
      targetPos.set(Math.cos(this.orbit) * 2.4, 1.25, Math.sin(this.orbit) * 2.4);
      targetLook.set(0, 0.3, 0);
      targetFov = 42;
    } else if (shot === 'launch') {
      // 發射前：從玩家身後低角度慢慢推近
      const p = ease(this.shotTime / 3);
      targetPos.set(-6.5 + p * 1.8, 2.8 - p * 0.9, -2.2 + p * 0.8);
      if (this.seat === 1) targetPos.set(-targetPos.x, targetPos.y, -targetPos.z);
      targetLook.set(0, 0.2, 0);
      targetFov = 48;
      this.orbit = Math.atan2(targetPos.z, targetPos.x);
    } else if (mode === 'closeup') {
      // 撞擊特寫：貼近撞擊點側面低角度，邊環繞邊推近，開頭快速變焦
      const f = worldOf(this.arena, director.focus, 0.22, this.level);
      const n = director.normal;
      const p = director.progress;
      const sideDir = new THREE.Vector3(-n.z * this.side, 0, n.x * this.side);
      const ang = 0.8 * ease(p * 1.3);
      const dist = 2.0 - 0.4 * ease(p);
      const off = sideDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang).multiplyScalar(dist);
      targetPos.copy(f).add(off).add(new THREE.Vector3(0, 0.45 + 0.15 * p, 0));
      targetLook.copy(f);
      targetFov = 40 + 20 * (1 - ease(p * 5));
      targetRoll = 0.2 * this.side * (1 - p * 0.5);
    } else if (mode === 'finish') {
      // 終結鏡頭：繞著終結點慢慢轉
      const f = worldOf(this.arena, director.focus, 0.2, this.level);
      const ang = director.modeTime * 0.45 + this.side;
      targetPos.set(f.x + Math.cos(ang) * 2.6, f.y + 1.3, f.z + Math.sin(ang) * 2.6);
      targetLook.copy(f);
      targetFov = 46;
      targetRoll = 0.08;
    } else {
      // 對戰全景：看著兩顆陀螺的中點（偏向場地中心），鏡頭慢慢繞場
      const alive = tops.filter((t) => t.alive);
      const mid = new THREE.Vector3();
      for (const t of alive.length ? alive : tops) mid.add(new THREE.Vector3(t.pos.x, 0, t.pos.z));
      if (tops.length) mid.multiplyScalar(1 / Math.max(1, (alive.length ? alive : tops).length));
      mid.multiplyScalar(0.55);
      let spread = 0;
      if (tops.length === 2) spread = Math.hypot(tops[0].pos.x - tops[1].pos.x, tops[0].pos.z - tops[1].pos.z);
      this.orbit += dt * 0.07;
      const rad = 5.6 + spread * 0.45;
      targetPos.set(mid.x + Math.cos(this.orbit) * rad, 4.4 + spread * 0.25, mid.z + Math.sin(this.orbit) * rad);
      targetLook.set(mid.x, 0.2, mid.z);
    }

    if (snap) {
      this.pos.copy(targetPos);
      this.look.copy(targetLook);
      this.fov = targetFov;
      this.roll = targetRoll;
    } else {
      const kk = mode === 'overview' ? k : 1 - Math.exp(-dt * 10);
      this.pos.lerp(targetPos, kk);
      this.look.lerp(targetLook, kk);
      this.fov += (targetFov - this.fov) * kk;
      this.roll += (targetRoll - this.roll) * kk;
    }

    // 畫面震動
    const s = director.shake * director.shake;
    const jitter = new THREE.Vector3((Math.random() - 0.5) * s * 0.3, (Math.random() - 0.5) * s * 0.3, (Math.random() - 0.5) * s * 0.3);
    this.camera.position.copy(this.pos).add(jitter);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    // 荷蘭角（鏡頭滾轉）：沿相機自身的視線軸旋轉
    this.camera.rotateZ(this.roll + (Math.random() - 0.5) * s * 0.06);
    const fov = aspectFov(this.fov, this.camera.aspect);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

/** sim 座標轉世界座標（貼著碗面，再往上 lift） */
function worldOf(arena: ArenaSpec, p: V2, lift: number, level = 0): THREE.Vector3 {
  return new THREE.Vector3(p.x, floorHeight(Math.min(Math.hypot(p.x, p.z), arena.radius), arena, level) + lift, p.z);
}
