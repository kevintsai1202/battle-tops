import * as THREE from 'three';
import { ARENA, floorHeight } from '../sim/arena';
import { floorTexture, glowTexture } from './textures';

/** 場地中需要每幀更新的物件 */
export interface Stadium {
  group: THREE.Group;
  /** 每幀更新：出場口閃爍、觀眾席閃光燈 */
  update(time: number, excitement: number): void;
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

/**
 * 建立競技場：碗形霓虹地板、有三個出場口的圍牆、外圍平台、觀眾席與燈光。
 */
export function buildStadium(scene: THREE.Scene): Stadium {
  const group = new THREE.Group();
  const R = ARENA.radius;
  const rimY = floorHeight(R);

  // 碗形地板：以 y = k r² 的剖面繞 Y 軸旋轉
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 48; i++) {
    const r = (i / 48) * R;
    profile.push(new THREE.Vector2(r, floorHeight(r)));
  }
  const tex = floorTexture();
  const bowl = new THREE.Mesh(
    new THREE.LatheGeometry(profile, 96),
    new THREE.MeshStandardMaterial({
      color: 0x0a1226,
      metalness: 0.55,
      roughness: 0.32,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.75,
      side: THREE.DoubleSide,
    }),
  );
  bowl.receiveShadow = true;
  group.add(bowl);

  // 圍牆：出場口之間的三段，外加牆頂霓虹管
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x1b2440,
    metalness: 0.8,
    roughness: 0.3,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });
  const neon = new THREE.MeshBasicMaterial({ color: 0x55f0ff });
  const pockets = [...ARENA.pockets].sort((a, b) => a - b);
  const w = ARENA.pocketHalfWidth;
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
    // 出場口外側的「掉落區」深坑
    const pit = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
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
  const deckGlow = new THREE.Mesh(new THREE.RingGeometry(R + 2.35, R + 2.45, 96, 1), new THREE.MeshBasicMaterial({ color: 0xff3df0 }));
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
  const halo = new THREE.Mesh(new THREE.TorusGeometry(6, 0.08, 8, 96), new THREE.MeshBasicMaterial({ color: 0x3a7bff }));
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 7.5;
  group.add(halo);

  // 燈光
  scene.add(new THREE.HemisphereLight(0x5577ff, 0x080410, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 9, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
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

  scene.add(group);

  return {
    group,
    update(time: number, excitement: number) {
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
    },
  };
}
