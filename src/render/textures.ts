import * as THREE from 'three';

/** 建立指定大小的 canvas 與 2D context */
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/**
 * 競技場地板的霓虹格線貼圖。套在 LatheGeometry 上：
 * 水平線（固定 v）會變成同心圓，垂直線（固定 u）會變成放射線。
 */
export function floorTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 512);
  // 同心圓
  for (let i = 1; i <= 8; i++) {
    const y = (i / 8) * 512 - 2;
    g.fillStyle = i === 8 ? '#4ff' : i % 2 === 0 ? '#1a7fff' : '#0b3a80';
    g.fillRect(0, y - (i === 8 ? 3 : 1), 1024, i === 8 ? 6 : 2);
  }
  // 放射線
  for (let i = 0; i < 24; i++) {
    const x = (i / 24) * 1024;
    g.fillStyle = i % 2 === 0 ? '#1a6fe0' : '#0a2f6a';
    g.fillRect(x - 1, 60, 2, 452);
  }
  // 中心圓盤
  g.fillStyle = '#2a8cff';
  g.fillRect(0, 0, 1024, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 圓形柔光點貼圖（火花、光暈共用） */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 高速旋轉時的模糊圓盤：一圈圈半透明的同心條紋 */
export function spinBlurTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  for (let r = 128; r > 10; r -= 3) {
    const a = 0.08 + 0.18 * Math.abs(Math.sin(r * 0.37));
    g.strokeStyle = `rgba(255,255,255,${a})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(128, 128, r - 1, 0, Math.PI * 2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 陀螺頂部晶片的紋章（一個發光漢字） */
export function emblemTexture(char: string, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#05060c';
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = 14;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = color;
  g.font = 'bold 150px "Dela Gothic One", "Yu Gothic", "Meiryo", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.fillText(char, 128, 136);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 衝擊波環貼圖：外緣亮、內部漸淡 */
export function ringTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const grad = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  grad.addColorStop(0.9, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
