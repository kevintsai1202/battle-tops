import * as THREE from 'three';
import { emblemOf, specialName } from '../i18n';
import { ARENAS, floorHeight } from '../sim/arena';
import { BattleSim } from '../sim/battle';
import { createTop } from '../sim/physics';
import { TOP_SPECS } from '../sim/tops';
import type { SimEvent, TopSpec } from '../sim/types';
import { Effects } from './effects';
import { TopView } from './topView';

/** 模擬固定步長 */
const STEP = 1 / 120;
/** 示範一輪的長度（秒）與放必殺的時間點 */
const LOOP = 4.6;
const FIRE_AT = 1.3;
/** 縮圖大小（px） */
const THUMB = 128;

/** 示範用的灰色假人陀螺（平衡型基底，不會放必殺） */
const DUMMY: TopSpec = {
  ...TOP_SPECS.wolf,
  id: 'dummy',
  nameZh: '練習用陀螺',
  nameEn: 'Practice Top',
  emblem: '練',
  glow: 0x9aa4b4,
  color: 0x70767f,
  look: { ...TOP_SPECS.wolf.look, primary: 0x70767f, secondary: 0x4a4f58, tip: 0x3a3d42 },
};

/** 示範用的場地（練習場的碗形，物理與畫面一致） */
const ARENA = ARENAS.practice;

/** 縮圖工作：規格、快取鍵、完成時的回呼 */
interface ThumbJob {
  spec: TopSpec;
  key: string;
  cb: (url: string) => void;
}

/** 縮圖快取（dataURL）：跨組隊畫面保留，換零件時依零件組合另外算一張 */
const thumbCache = new Map<string, string>();

/** 縮圖快取鍵：陀螺代號＋盤＋軸＋紋章字（中文版的紋章字形不同，切換語言後另外算一張） */
const thumbKey = (sp: TopSpec) => `${sp.id}:${sp.parts.disk}:${sp.parts.driver}:${emblemOf(sp)}`;

/**
 * 組隊畫面的外觀與絕招示範：在詳細資料的舞台窗裡用獨立的小渲染器，
 * 讓目前選到的陀螺對灰色假人放一次必殺（循環播放），特效沿用對戰用的 Effects。
 * 同一個渲染器也負責產生名鑑小格的 3D 縮圖（每幀最多一張，避免開畫面時卡頓）。
 * 不用主場景的原因：舞台窗的長寬比隨版面（橫向、直向手機）改變，獨立鏡頭才能一律把陀螺框在窗內。
 * 離開組隊畫面時呼叫 dispose 釋放 WebGL 資源。
 */
export class Showcase {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 2, 0.1, 50);
  private readonly effects: Effects;
  /** 縮圖用的場景與鏡頭（只有燈光與一顆陀螺） */
  private readonly thumbScene = new THREE.Scene();
  private readonly thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private readonly queue: ThumbJob[] = [];
  /** 目前的示範：陀螺規格、模擬、畫面、經過時間、是否已放必殺、分出勝負後經過的時間 */
  private demo: { spec: TopSpec; sim: BattleSim; views: TopView[]; t: number; fired: boolean; acc: number } | null = null;
  /** 鏡頭注視點：跟著兩顆陀螺的中點慢慢移動，突進或被撞飛時也留在窗內 */
  private readonly look = new THREE.Vector3(0, 0.15, 0);
  /** 放必殺時呼叫（顯示招式名） */
  private readonly onFire: (text: string) => void;
  /** 已完成的示範輪數與放出的必殺次數（e2e 觀察用） */
  loops = 0;
  fires = 0;

  constructor(canvas: HTMLCanvasElement, onFire: (text: string) => void) {
    this.canvas = canvas;
    this.onFire = onFire;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    for (const sc of [this.scene, this.thumbScene]) addLights(sc);
    this.scene.add(buildFloor());
    this.effects = new Effects(this.scene);
    this.effects.arena = ARENA;
    this.camera.position.set(0, 2.5, 3.3);
    this.camera.lookAt(0, 0.15, 0);
    this.thumbCam.position.set(0, 1.15, 0.95);
    this.thumbCam.lookAt(0, 0.2, 0);
  }

  /** 換成另一顆陀螺（spec 已套用零件），從頭播放示範 */
  setSpec(spec: TopSpec): void {
    if (this.demo && this.demo.spec === spec) return;
    this.start(spec);
  }

  /**
   * 要一張縮圖：已經有就立刻回呼，否則排隊（之後的 update 會產生並回呼）。
   * 同一顆陀螺的新請求會取代還沒處理的舊請求。
   */
  thumb(spec: TopSpec, cb: (url: string) => void): void {
    const key = thumbKey(spec);
    const hit = thumbCache.get(key);
    if (hit) {
      cb(hit);
      return;
    }
    const i = this.queue.findIndex((j) => j.spec.id === spec.id);
    if (i >= 0) this.queue.splice(i, 1);
    this.queue.push({ spec, key, cb });
  }

  /** 每幀：產生一張排隊中的縮圖、推進示範並渲染到舞台窗 */
  update(dt: number): void {
    const job = this.queue.shift();
    if (job) this.renderThumb(job);
    this.fit();
    const d = this.demo;
    if (d) {
      d.t += dt;
      if (!d.fired && d.t >= FIRE_AT) {
        d.fired = true;
        d.sim.tops[0].special = 1;
        d.sim.useSpecial(0);
      }
      d.acc += dt;
      let guard = 0;
      while (d.acc >= STEP && guard++ < 30) {
        d.acc -= STEP;
        d.sim.step(STEP);
        for (const e of d.sim.drainEvents()) this.onEvent(e);
      }
      d.views.forEach((v, i) => v.update(d.sim.tops[i], dt, d.t));
      this.follow(dt);
      if (d.t >= LOOP) {
        this.loops++;
        this.start(d.spec);
      }
    }
    this.effects.update(dt, dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** 釋放 WebGL 資源（離開組隊畫面時） */
  dispose(): void {
    this.clearDemo();
    this.effects.clear();
    this.queue.length = 0;
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** 開始一輪示範：陀螺在左、假人在右，都靠近中央，開場不久就會碰上 */
  private start(spec: TopSpec): void {
    this.clearDemo();
    const sim = new BattleSim(spec, DUMMY, { seed: 7, launch: [1, 0.85], arena: ARENA });
    const [me, dummy] = sim.tops;
    me.pos = { x: -0.75, z: 0.15 };
    me.vel = { x: 0.5, z: 0.9 };
    dummy.pos = { x: 0.7, z: -0.1 };
    dummy.vel = { x: -0.3, z: -0.6 };
    this.effects.clear();
    this.look.set(0, 0.15, 0);
    this.demo = { spec, sim, views: sim.tops.map((t) => new TopView(this.scene, t.spec, ARENA)), t: 0, fired: false, acc: 0 };
  }

  /** 移除目前示範的陀螺畫面 */
  private clearDemo(): void {
    for (const v of this.demo?.views ?? []) v.dispose();
    this.demo = null;
  }

  /** 示範中的模擬事件：撞擊火花、必殺特效與招式名 */
  private onEvent(e: SimEvent): void {
    const d = this.demo!;
    if (e.type === 'clash') {
      const [a, b] = d.sim.tops;
      this.effects.clash(e.pos, e.normal, e.intensity, a.spec.glow, b.spec.glow, false);
      d.views.forEach((v) => v.hit(e.normal, e.intensity));
    } else if (e.type === 'special') {
      const t = d.sim.tops[e.id];
      this.effects.special(t.pos, t.spec.glow);
      this.fires++;
      this.onFire(specialName(t.spec));
    }
  }

  /** 鏡頭跟著兩顆陀螺的中點（限制在中央附近），從斜上方看 */
  private follow(dt: number): void {
    const tops = this.demo?.sim.tops ?? [];
    let x = 0;
    let z = 0;
    for (const t of tops) {
      x += t.pos.x / tops.length;
      z += t.pos.z / tops.length;
    }
    const r = Math.hypot(x, z);
    if (r > 1.2) {
      x *= 1.2 / r;
      z *= 1.2 / r;
    }
    const k = 1 - Math.exp(-dt * 3);
    this.look.x += (x - this.look.x) * k;
    this.look.z += (z - this.look.z) * k;
    this.camera.position.set(this.look.x, 2.7, this.look.z + 3.1);
    this.camera.lookAt(this.look);
  }

  /** 依舞台窗的實際大小調整繪圖緩衝與鏡頭比例 */
  private fit(): void {
    const pr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * pr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * pr));
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // 垂直視角至少 34°；窗比 1:1 還窄時再加大，讓左右也看得到約 3 個單位寬
    this.camera.fov = aspect >= 1 ? 34 : (2 * Math.atan(Math.tan((17 * Math.PI) / 180) / aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  /** 產生一張縮圖：靜止的陀螺從斜上方看，透明背景 */
  private renderThumb(job: ThumbJob): void {
    const view = new TopView(this.thumbScene, job.spec, ARENA);
    const st = createTop(0, job.spec, { x: 0, z: 0 }, { x: 0, z: 0 }, 0);
    st.angle = 0.5;
    view.update(st, 0, 0);
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.renderer.setSize(THUMB, THUMB, false);
    this.renderer.render(this.thumbScene, this.thumbCam);
    const url = this.canvas.toDataURL('image/png');
    view.dispose();
    this.renderer.setSize(w, h, false);
    thumbCache.set(job.key, url);
    job.cb(url);
  }
}

/** 示範與縮圖共用的燈光：天空光、主光與一點背光 */
function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x141824, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2, 4, 3);
  const back = new THREE.DirectionalLight(0x7fb8ff, 1.2);
  back.position.set(-2, 2, -3);
  scene.add(key, back);
}

/** 示範場地：練習場碗形的中央一塊，加上極座標格線 */
function buildFloor(): THREE.Object3D {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const r = (i / 24) * 2.8;
    pts.push(new THREE.Vector2(r, floorHeight(r, ARENA)));
  }
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), new THREE.MeshStandardMaterial({ color: 0x141c30, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }));
  const grid = new THREE.PolarGridHelper(1.6, 8, 5, 64, 0x2a6bff, 0x1a3a7a);
  grid.position.y = 0.01;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  g.add(bowl, grid);
  return g;
}
