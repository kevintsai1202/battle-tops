import * as THREE from 'three';
import { floorHeight, ventPhase, type ArenaSpec, type Pocket } from '../sim/arena';
import { floorTexture, glowTexture, rippleTexture } from './textures';

/** 場地中需要每幀更新、切換場地時要釋放的物件 */
export interface Stadium {
  group: THREE.Group;
  /**
   * 每幀更新：出場口閃爍、觀眾席閃光燈、場地機關動畫。
   * time 為牆鐘秒數，simTime 為對戰模擬時間（熔岩噴發的預兆要跟模擬同步）；
   * lift 為雙層戰鬥盤中央的升降狀態（level 0 = 升起、1 = 降下；warn 為下降前的預兆，由 liftPhase 依模擬時間算出）。
   */
  update(time: number, excitement: number, simTime: number, lift?: { level: number; warn: number }): void;
  /** 從場景移除並釋放幾何與材質 */
  dispose(): void;
}

/** 場館燈光（整場遊戲只建一次，切換場地時換顏色） */
export interface StadiumLights {
  setTheme(arena: ArenaSpec): void;
}

/** 由 sim 座標角度 φ（atan2(z, x)）與半徑取世界座標點 */
function polar(r: number, phi: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi));
}

/** 產生一段圓弧牆面（直立的帶狀面），φ 從 phi0 到 phi1 */
function arcWall(r: number, y0: number, y1: number, phi0: number, phi1: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / segs;
    const a = polar(r, phi, y0);
    const b = polar(r, phi, y1);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(i / segs, 0, i / segs, 1);
    if (i < segs) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 沿圓弧的發光管（牆頂霓虹） */
function arcTube(r: number, y: number, phi0: number, phi1: number, radius: number, mat: THREE.Material): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) pts.push(polar(r, phi0 + ((phi1 - phi0) * i) / n, y));
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, radius, 8, false);
  return new THREE.Mesh(geo, mat);
}

/** 貼著地面的圓盤（熔岩噴口用）：每個頂點依所在半徑抬到地面高度 */
function conformDisc(cx: number, cz: number, rad: number, arena: ArenaSpec, lift: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.CircleGeometry(rad, 40, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx;
    const z = p.getZ(i) + cz;
    p.setY(i, floorHeight(Math.hypot(x, z), arena) + lift);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.position.set(cx, 0, cz);
  return m;
}

/** 碗形地板的旋轉剖面（r 從 r0 到 r1，分 n 段；level 為雙層戰鬥盤中央降下的程度） */
function bowlProfile(arena: ArenaSpec, r0: number, r1: number, lift = 0, n = 48, level = 0): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i <= n; i++) {
    const r = r0 + ((r1 - r0) * i) / n;
    out.push(new THREE.Vector2(r, floorHeight(r, arena, level) + lift));
  }
  return out;
}

/** 把旋轉體（地板、內圈軌道）的每個頂點貼回 level 狀態下的地面高度（雙層戰鬥盤升降時呼叫） */
function conformLathe(geo: THREE.BufferGeometry, arena: ArenaSpec, level: number, lift: number): void {
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, floorHeight(Math.hypot(p.getX(i), p.getZ(i)), arena, level) + lift);
  p.needsUpdate = true;
  geo.computeVertexNormals();
}

/** 平放在地上的文字牌（出場區的名稱）：canvas 畫字，做成貼圖 */
function labelPlane(text: string, color: string, w: number, h: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.font = 'bold 72px "Dela Gothic One", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.fillStyle = color;
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** 出場區的顏色：中間寬口的 Xtreme 區是金色，其他出場口是紅色 */
const pocketColor = (p: Pocket) => (p.kind === 'xtreme' ? 0xffc21a : 0xff2a3a);

/** 飄動的粒子（火山的火星、冰川的雪）：回傳物件與每幀更新函式 */
function drifting(count: number, color: number, size: number, rise: boolean): { obj: THREE.Points; step: (dt: number) => void } {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count);
  const reset = (i: number, fresh: boolean) => {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 7;
    const y = rise ? (fresh ? Math.random() * 5 : -0.5) : fresh ? Math.random() * 6 : 6;
    pos.set([r * Math.cos(a), y, r * Math.sin(a)], i * 3);
    vel[i] = (rise ? 0.4 : -0.35) * (0.5 + Math.random());
  };
  for (let i = 0; i < count; i++) reset(i, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const obj = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size, color, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  obj.frustumCulled = false;
  return {
    obj,
    step(dt: number) {
      for (let i = 0; i < count; i++) {
        pos[i * 3 + 1] += vel[i] * dt;
        pos[i * 3] += Math.sin(pos[i * 3 + 1] * 1.3 + i) * 0.1 * dt;
        if (rise ? pos[i * 3 + 1] > 5 : pos[i * 3 + 1] < -0.6) reset(i, false);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/** 建立場館燈光：半球光、主光（投影）、兩盞主題色邊光 */
export function buildLights(scene: THREE.Scene, lowPower = false): StadiumLights {
  const hemi = new THREE.HemisphereLight(0x5577ff, 0x080410, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 9, 3);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(lowPower ? 512 : 1024);
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -5;
  sc.right = sc.top = 5;
  sc.near = 1;
  sc.far = 20;
  scene.add(key);
  const rimA = new THREE.PointLight(0xff3df0, 30, 14, 2);
  rimA.position.set(-4, 3, -4);
  const rimB = new THREE.PointLight(0x2af0ff, 30, 14, 2);
  rimB.position.set(4, 3, 4);
  scene.add(rimA, rimB);
  return {
    setTheme(a: ArenaSpec) {
      rimA.color.setHex(a.theme.accent);
      rimB.color.setHex(a.theme.neon);
      hemi.color.setHex(a.id === 'volcano' ? 0xff7744 : a.id === 'glacier' ? 0x99ccff : a.id === 'stadium' ? 0xffcc88 : a.id === 'double' ? 0x88aaff : 0x5577ff);
    },
  };
}

/**
 * 建立競技場：碗形霓虹地板、圍牆與出場口、外圍平台、觀眾席，以及各場地的機關外觀
 * （標準戰鬥盤的極限軌道、火山的火山錐與熔岩噴口、冰川的冰柱與雪、積水的水面）。
 * 機關的位置直接取自場地規格，看到的就是實際作用的範圍。
 */
export function buildStadium(scene: THREE.Scene, arena: ArenaSpec): Stadium {
  const group = new THREE.Group();
  const R = arena.radius;
  const rimY = floorHeight(R, arena);
  const th = arena.theme;
  /** 每幀要跑的更新（機關動畫） */
  const tickers: ((time: number, simTime: number, dt: number) => void)[] = [];
  let lastTime = 0;

  // 碗形地板：以地面高度剖面繞 Y 軸旋轉（實體戰鬥盤的龍捲脊、升降凹槽比較細，剖面分得密一點）
  const physical = arena.frame === 'square';
  const style = arena.id === 'volcano' ? 'lava' : arena.id === 'glacier' ? 'ice' : physical ? 'gear' : 'grid';
  const icy = arena.id === 'glacier';
  const bowlGeo = new THREE.LatheGeometry(bowlProfile(arena, 0, R, 0, physical ? 120 : 48), 96);
  const bowl = new THREE.Mesh(
    bowlGeo,
    new THREE.MeshStandardMaterial({
      color: th.floor,
      metalness: icy ? 0.9 : 0.55,
      roughness: icy ? 0.08 : 0.32,
      emissive: 0xffffff,
      emissiveMap: floorTexture(th.grid, th.neon, style),
      emissiveIntensity: 0.75,
      side: THREE.DoubleSide,
    }),
  );
  bowl.receiveShadow = true;
  group.add(bowl);

  // 圍牆：出場口之間的各段，外加牆頂霓虹管
  const wallMat = new THREE.MeshStandardMaterial({
    color: th.wall,
    metalness: 0.8,
    roughness: 0.3,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: icy ? 0.7 : 0.92,
  });
  const neon = new THREE.MeshBasicMaterial({ color: th.neon });
  /** 出場口（中心角正規化到 0..2π、依角度排序），牆面是相鄰兩個出場口之間的弧 */
  const TAU = Math.PI * 2;
  const pockets = arena.pockets.map((p) => ({ ...p, at: ((p.at % TAU) + TAU) % TAU })).sort((a, b) => a.at - b.at);
  for (let i = 0; i < pockets.length; i++) {
    const from = pockets[i].at + pockets[i].half;
    const next = pockets[(i + 1) % pockets.length];
    let to = next.at - next.half;
    if (to < from) to += TAU;
    group.add(new THREE.Mesh(arcWall(R + 0.02, rimY - 0.05, rimY + 0.32, from, to, 48), wallMat));
    group.add(arcTube(R + 0.02, rimY + 0.33, from, to, 0.025, neon));
  }

  // 出場口：警示光條（Xtreme 區金色、其他紅色），會隨比賽激烈程度閃爍
  const pocketMats: THREE.MeshBasicMaterial[] = [];
  for (const p of pockets) {
    const m = new THREE.MeshBasicMaterial({ color: pocketColor(p), transparent: true, opacity: 0.8 });
    pocketMats.push(m);
    group.add(arcTube(R + 0.08, rimY + 0.02, p.at - p.half, p.at + p.half, 0.035, m));
    if (!physical) {
      const pit = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
      pit.rotation.x = -Math.PI / 2;
      pit.position.copy(polar(R + 0.8, p.at, rimY - 0.6));
      group.add(pit);
    }
  }

  const deckY = rimY - 0.25;
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x10152a, metalness: 0.7, roughness: 0.45 });
  if (!physical) {
    // 外圍平台（圓形）
    const deck = new THREE.Mesh(new THREE.RingGeometry(R + 0.3, R + 2.4, 96, 1), deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = deckY;
    deck.receiveShadow = true;
    group.add(deck);
    const deckGlow = new THREE.Mesh(new THREE.RingGeometry(R + 2.35, R + 2.45, 96, 1), new THREE.MeshBasicMaterial({ color: th.accent }));
    deckGlow.rotation.x = -Math.PI / 2;
    deckGlow.position.y = rimY - 0.24;
    group.add(deckGlow);
  } else {
    // 實體戰鬥盤的方形外框（純外觀，模擬裡的牆仍是圓的）：方形平台挖出戰鬥區的圓洞、四邊的矮牆與牆頂霓虹，
    // 出場口那一邊（-z）在每個出場口外面畫出場區（Xtreme 區金色、Over 區紅色，平放區名）
    const S = R + 1.35;
    const shape = new THREE.Shape();
    shape.moveTo(-S, -S);
    shape.lineTo(S, -S);
    shape.lineTo(S, S);
    shape.lineTo(-S, S);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, R + 0.3, 0, TAU, true);
    shape.holes.push(hole);
    const deck = new THREE.Mesh(new THREE.ShapeGeometry(shape, 64), deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = deckY;
    deck.receiveShadow = true;
    group.add(deck);
    const frameMat = new THREE.MeshStandardMaterial({ color: th.wall, metalness: 0.6, roughness: 0.25, transparent: true, opacity: 0.55 });
    const frameNeon = new THREE.MeshBasicMaterial({ color: th.accent });
    for (const [x, z, sx, sz] of [
      [0, -S, 2 * S + 0.12, 0.12],
      [0, S, 2 * S + 0.12, 0.12],
      [-S, 0, 0.12, 2 * S],
      [S, 0, 0.12, 2 * S],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.55, sz), frameMat);
      wall.position.set(x, deckY + 0.27, z);
      group.add(wall);
      const top = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.03, sz + 0.02), frameNeon);
      top.position.set(x, deckY + 0.56, z);
      group.add(top);
    }
    for (const p of pockets) {
      const xt = p.kind === 'xtreme';
      const color = pocketColor(p);
      const dist = R + 0.85;
      const zone = new THREE.Group();
      const w = xt ? 2.3 : 1.45;
      const d = 0.95;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x020308, transparent: true, opacity: 0.92 }));
      floor.rotation.x = -Math.PI / 2;
      zone.add(floor);
      const edgeMat = new THREE.MeshBasicMaterial({ color });
      for (const [x, z, sx, sz] of [
        [0, -d / 2, w, 0.04],
        [-w / 2, 0, 0.04, d],
        [w / 2, 0, 0.04, d],
      ]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.03, sz), edgeMat);
        e.position.set(x, 0.015, z);
        zone.add(e);
      }
      const label = labelPlane(xt ? 'XTREME' : 'OVER', xt ? '#ffd23a' : '#ff4a5a', w * 0.8, w * 0.2);
      label.position.y = 0.02;
      // 字頭朝外；朝向玩家這一側（-x，CPU 模式的鏡頭在玩家身後）的出場區把字轉 180°，從玩家的視角才不會倒過來
      if (Math.cos(p.at) < -0.1) label.rotation.z = Math.PI;
      zone.add(label);
      // 區塊的 -z 方向朝外：轉到出場口的方向
      zone.position.copy(polar(dist, p.at, deckY + 0.012));
      zone.rotation.y = -p.at - Math.PI / 2;
      group.add(zone);
    }
  }

  // 地面
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: 0x05070f, metalness: 0.3, roughness: 0.8 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  group.add(ground);

  // 觀眾席：一圈圈往外升高的暗色看台
  const standGeo = new THREE.BoxGeometry(1, 1, 1);
  const standMat = new THREE.MeshStandardMaterial({ color: 0x0c1022, metalness: 0.2, roughness: 0.9 });
  const rows = 6;
  const perRow = 64;
  const stands = new THREE.InstancedMesh(standGeo, standMat, rows * perRow);
  const m4 = new THREE.Matrix4();
  let k = 0;
  for (let row = 0; row < rows; row++) {
    const r = 11 + row * 1.6;
    for (let i = 0; i < perRow; i++) {
      const a = (i / perRow) * Math.PI * 2;
      m4.compose(
        new THREE.Vector3(r * Math.cos(a), -1 + row * 0.9, r * Math.sin(a)),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
        new THREE.Vector3(1.4, 0.9 + row * 0.9, (2 * Math.PI * r) / perRow),
      );
      stands.setMatrixAt(k++, m4);
    }
  }
  group.add(stands);

  // 觀眾的手機／相機閃光：隨機閃爍的光點
  const flashCount = 420;
  const flashPos = new Float32Array(flashCount * 3);
  const flashCol = new Float32Array(flashCount * 3);
  const flashPhase = new Float32Array(flashCount);
  for (let i = 0; i < flashCount; i++) {
    const row = Math.floor(Math.random() * rows);
    const r = 10.2 + row * 1.6;
    const a = Math.random() * Math.PI * 2;
    flashPos.set([r * Math.cos(a), -0.3 + row * 0.9 + row * 0.45 + Math.random() * 0.3, r * Math.sin(a)], i * 3);
    flashPhase[i] = Math.random() * 100;
  }
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.BufferAttribute(flashPos, 3));
  flashGeo.setAttribute('color', new THREE.BufferAttribute(flashCol, 3));
  const flashes = new THREE.Points(
    flashGeo,
    new THREE.PointsMaterial({
      size: 0.35,
      map: glowTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(flashes);

  // 頭頂燈環
  const halo = new THREE.Mesh(new THREE.TorusGeometry(6, 0.08, 8, 96), new THREE.MeshBasicMaterial({ color: th.accent }));
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 7.5;
  group.add(halo);

  // ---------------- 場地機關 ----------------

  // 實體戰鬥盤：外圈極限軌道（齒軌發光帶），流動表示加速方向；雙層戰鬥盤的內圈軌道貼著凹槽壁，中央降下時才亮
  /** 隨中央升降要重新貼地的旋轉體（地板、內圈軌道）與它離地的高度 */
  const conform: { geo: THREE.BufferGeometry; lift: number }[] = arena.lift ? [{ geo: bowlGeo, lift: 0 }] : [];
  /** 內圈軌道的材質：亮度跟著中央降下的程度 */
  const loweredRails: THREE.MeshBasicMaterial[] = [];
  for (const rl of arena.rails) {
    const railTex = floorTexture(rl.lowered ? th.neon : th.accent, th.neon, 'rail');
    railTex.wrapS = THREE.RepeatWrapping;
    railTex.repeat.set(rl.lowered ? 3 : 6, 1);
    const to = rl.lowered && arena.lift ? arena.lift.r : R - 0.01;
    const geo = new THREE.LatheGeometry(bowlProfile(arena, rl.from, to, 0.006, rl.lowered ? 12 : 48), 128);
    const mat = new THREE.MeshBasicMaterial({ map: railTex, transparent: true, opacity: rl.lowered ? 0 : 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(geo, mat));
    if (rl.lowered) {
      loweredRails.push(mat);
      conform.push({ geo, lift: 0.006 });
    }
    tickers.push((time) => {
      railTex.offset.x = -time * (rl.lowered ? 0.25 : 0.15);
    });
  }

  // 實體戰鬥盤的兩層：內圈平台邊緣的龍捲脊畫一圈細光環
  if (arena.ridge) {
    const ridgeMat = new THREE.MeshBasicMaterial({ color: th.neon, transparent: true, opacity: 0.55 });
    group.add(arcTube(arena.ridge.r, floorHeight(arena.ridge.r, arena) + 0.012, 0, TAU, 0.012, ridgeMat));
  }

  // 雙層戰鬥盤：升降平台的邊緣光環（跟著平台降下；下降前的預兆變紅閃爍）與凹槽外緣的固定光環
  let liftRing: THREE.Mesh | null = null;
  let liftRingMat: THREE.MeshBasicMaterial | null = null;
  let lastLevel = 0;
  if (arena.lift) {
    const lf = arena.lift;
    liftRingMat = new THREE.MeshBasicMaterial({ color: th.neon, transparent: true, opacity: 0.8 });
    liftRing = arcTube(lf.r - lf.edge, floorHeight(lf.r - lf.edge, arena) + 0.01, 0, TAU, 0.018, liftRingMat);
    group.add(liftRing);
    group.add(arcTube(lf.r, floorHeight(lf.r, arena) + 0.01, 0, TAU, 0.014, new THREE.MeshBasicMaterial({ color: th.accent, transparent: true, opacity: 0.7 })));
  }

  // 火山：熔岩噴口（平常暗紅脈動，預兆時越來越亮，噴發時白熱）與上升的火星
  if (arena.vents.length) {
    for (const v of arena.vents) {
      const lava = new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.9, map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false });
      group.add(conformDisc(v.x, v.z, v.r * 1.25, arena, 0.01, lava));
      const core = new THREE.MeshBasicMaterial({ color: 0x3a0800 });
      group.add(conformDisc(v.x, v.z, v.r * 0.55, arena, 0.004, core));
      const glowLight = new THREE.PointLight(0xff5a1a, 0, 3, 2);
      glowLight.position.set(v.x, floorHeight(Math.hypot(v.x, v.z), arena) + 0.4, v.z);
      group.add(glowLight);
      tickers.push((time, simTime) => {
        const ph = ventPhase(v, simTime);
        const heat = ph.erupt >= 0 ? 1 : ph.warn;
        lava.color.setHex(ph.erupt >= 0 ? 0xffe0a0 : 0xff4a10).lerp(new THREE.Color(0xffa040), heat * 0.6);
        lava.opacity = 0.55 + 0.25 * Math.sin(time * 3 + v.phase) + 0.4 * heat;
        core.color.setHex(0x3a0800).lerp(new THREE.Color(0xff6a1a), heat);
        glowLight.intensity = 2 + 10 * heat + Math.sin(time * 5 + v.phase);
      });
    }
    const embers = drifting(260, 0xff7a2a, 0.08, true);
    group.add(embers.obj);
    tickers.push((_t, _s, dt) => embers.step(dt));
  }

  // 冰川：冰柱與飄雪
  if (arena.pillars.length) {
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xbfefff,
      emissive: 0x3aa8ff,
      emissiveIntensity: 0.35,
      metalness: 0.1,
      roughness: 0.05,
      transparent: true,
      opacity: 0.78,
    });
    for (const p of arena.pillars) {
      const y = floorHeight(Math.hypot(p.x, p.z), arena);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.85, p.r, 0.7, 7), iceMat);
      body.position.set(p.x, y + 0.35, p.z);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(p.r * 0.85, 0.45, 7), iceMat);
      tip.position.set(p.x, y + 0.92, p.z);
      body.castShadow = tip.castShadow = true;
      group.add(body, tip);
    }
    const snow = drifting(420, 0xe8f6ff, 0.06, false);
    group.add(snow.obj);
    tickers.push((_t, _s, dt) => snow.step(dt));
  }

  // 積水：中央低窪處的水面，波紋依水流方向（逆時針）慢慢旋轉
  if (arena.water) {
    const wr = arena.water.r;
    const level = floorHeight(wr, arena) + 0.004;
    const ripple = rippleTexture();
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(wr, 64),
      new THREE.MeshStandardMaterial({
        color: 0x1a8fb0,
        emissive: th.neon,
        emissiveMap: ripple,
        emissiveIntensity: 0.55,
        metalness: 0.2,
        roughness: 0.05,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = level;
    group.add(water);
    const shore = new THREE.Mesh(new THREE.RingGeometry(wr - 0.03, wr + 0.03, 96), new THREE.MeshBasicMaterial({ color: th.neon, transparent: true, opacity: 0.8 }));
    shore.rotation.x = -Math.PI / 2;
    shore.position.y = level + 0.002;
    group.add(shore);
    tickers.push((time) => {
      // 貼圖在平面上旋轉 = 水面繞中心流動
      water.rotation.z = time * 0.35;
    });
  }

  scene.add(group);

  return {
    group,
    update(time: number, excitement: number, simTime: number, lift = { level: 0, warn: 0 }) {
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      if (arena.lift) {
        // 中央升降：地板與內圈軌道貼回目前的高度（只在升降途中重算）、平台邊緣光環跟著降下
        if (lift.level !== lastLevel) {
          lastLevel = lift.level;
          for (const c of conform) conformLathe(c.geo, arena, lift.level, c.lift);
          liftRing!.position.y = -arena.lift.depth * lift.level;
        }
        for (const m of loweredRails) m.opacity = 0.85 * lift.level;
        const blink = lift.warn > 0 ? 0.5 + 0.5 * Math.sin(time * (10 + lift.warn * 14)) : 0;
        liftRingMat!.color.setHex(th.neon).lerp(new THREE.Color(0xff2a3a), lift.warn > 0 ? 0.4 + 0.6 * blink : 0);
        liftRingMat!.opacity = 0.8 + 0.2 * blink;
      }
      for (const m of pocketMats) m.opacity = 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(time * (4 + excitement * 10)));
      // 閃光燈：激烈時閃得更頻繁
      const rate = 0.004 + excitement * 0.05;
      for (let i = 0; i < flashCount; i++) {
        let v = flashCol[i * 3] * 0.82;
        if (Math.random() < rate) v = 1;
        flashPhase[i] += 0.01;
        flashCol[i * 3] = v;
        flashCol[i * 3 + 1] = v;
        flashCol[i * 3 + 2] = v * 0.95 + 0.05 * Math.sin(flashPhase[i]);
      }
      flashGeo.attributes.color.needsUpdate = true;
      for (const t of tickers) t(time, simTime, dt);
    },
    dispose() {
      group.removeFromParent();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.InstancedMesh) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.dispose();
        }
        if (o instanceof THREE.PointLight) o.dispose();
      });
    },
  };
}
