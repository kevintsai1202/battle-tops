import * as THREE from 'three';
import { floorHeight, ventPhase, type ArenaSpec } from '../sim/arena';
import { floorTexture, glowTexture, rippleTexture } from './textures';

/** 場地中需要每幀更新、切換場地時要釋放的物件 */
export interface Stadium {
  group: THREE.Group;
  /**
   * 每幀更新：出場口閃爍、觀眾席閃光燈、場地機關動畫。
   * time 為牆鐘秒數，simTime 為對戰模擬時間（熔岩噴發的預兆要跟模擬同步）。
   */
  update(time: number, excitement: number, simTime: number): void;
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

/** 碗形地板的旋轉剖面（r 從 r0 到 r1） */
function bowlProfile(arena: ArenaSpec, r0: number, r1: number, lift = 0): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i <= 48; i++) {
    const r = r0 + ((r1 - r0) * i) / 48;
    out.push(new THREE.Vector2(r, floorHeight(r, arena) + lift));
  }
  return out;
}

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
      hemi.color.setHex(a.id === 'volcano' ? 0xff7744 : a.id === 'glacier' ? 0x99ccff : a.id === 'stadium' ? 0xffcc88 : 0x5577ff);
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

  // 碗形地板：以地面高度剖面繞 Y 軸旋轉
  const style = arena.id === 'volcano' ? 'lava' : arena.id === 'glacier' ? 'ice' : arena.id === 'stadium' ? 'gear' : 'grid';
  const icy = arena.id === 'glacier';
  const bowl = new THREE.Mesh(
    new THREE.LatheGeometry(bowlProfile(arena, 0, R), 96),
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
  const pockets = [...arena.pockets].map((p) => ((p % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).sort((a, b) => a - b);
  const w = arena.pocketHalfWidth;
  for (let i = 0; i < pockets.length; i++) {
    const from = pockets[i] + w;
    let to = pockets[(i + 1) % pockets.length] - w;
    if (to < from) to += Math.PI * 2;
    group.add(new THREE.Mesh(arcWall(R + 0.02, rimY - 0.05, rimY + 0.32, from, to, 48), wallMat));
    group.add(arcTube(R + 0.02, rimY + 0.33, from, to, 0.025, neon));
  }

  // 出場口：紅色警示光條，會隨比賽激烈程度閃爍
  const pocketMats: THREE.MeshBasicMaterial[] = [];
  for (const p of pockets) {
    const m = new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.8 });
    pocketMats.push(m);
    group.add(arcTube(R + 0.08, rimY + 0.02, p - w, p + w, 0.035, m));
    const pit = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.copy(polar(R + 0.8, p, rimY - 0.6));
    group.add(pit);
  }

  // 外圍平台
  const deck = new THREE.Mesh(
    new THREE.RingGeometry(R + 0.3, R + 2.4, 96, 1),
    new THREE.MeshStandardMaterial({ color: 0x10152a, metalness: 0.7, roughness: 0.45 }),
  );
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = rimY - 0.25;
  deck.receiveShadow = true;
  group.add(deck);
  const deckGlow = new THREE.Mesh(new THREE.RingGeometry(R + 2.35, R + 2.45, 96, 1), new THREE.MeshBasicMaterial({ color: th.accent }));
  deckGlow.rotation.x = -Math.PI / 2;
  deckGlow.position.y = rimY - 0.24;
  group.add(deckGlow);

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

  // 標準戰鬥盤：外圈極限軌道（齒軌發光帶），激烈時流動加快
  if (arena.rail) {
    const railTex = floorTexture(th.accent, th.neon, 'rail');
    railTex.wrapS = THREE.RepeatWrapping;
    railTex.repeat.set(6, 1);
    const rail = new THREE.Mesh(
      new THREE.LatheGeometry(bowlProfile(arena, arena.rail.from, R - 0.01, 0.006), 128),
      new THREE.MeshBasicMaterial({ map: railTex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    group.add(rail);
    tickers.push((time) => {
      railTex.offset.x = -time * 0.15;
    });
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
    update(time: number, excitement: number, simTime: number) {
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
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
