import * as THREE from 'three';

/** 建立指定大小的 canvas 與 2D context */
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** 數字色碼轉 CSS 字串 */
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** 地板貼圖的風格：一般格線、齒軌（標準戰鬥盤）、熔岩裂縫、冰面、極限軌道帶 */
export type FloorStyle = 'grid' | 'gear' | 'lava' | 'ice' | 'rail';

/**
 * 競技場地板的霓虹貼圖。套在 LatheGeometry 上：
 * 水平線（固定 v）會變成同心圓，垂直線（固定 u）會變成放射線。
 * grid 為格線主色、rim 為最外圈與中心的亮色；style 決定額外花紋。
 */
export function floorTexture(grid = 0x1a7fff, rim = 0x44ffff, style: FloorStyle = 'grid'): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 512);
  const main = hex(grid);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 512);
  if (style === 'rail') {
    // 極限軌道帶：斜向齒紋，沿 u 方向重複（在旋轉面上會繞一圈）
    g.fillStyle = main;
    for (let x = -64; x < 1024 + 64; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 14, 0);
      g.lineTo(x + 40, 512);
      g.lineTo(x + 26, 512);
      g.fill();
    }
    g.fillStyle = hex(rim);
    g.fillRect(0, 0, 1024, 10);
    g.fillRect(0, 500, 1024, 12);
  } else {
    // 同心圓
    for (let i = 1; i <= 8; i++) {
      const y = (i / 8) * 512 - 2;
      g.globalAlpha = i === 8 ? 1 : i % 2 === 0 ? 0.9 : 0.4;
      g.fillStyle = i === 8 ? hex(rim) : main;
      g.fillRect(0, y - (i === 8 ? 3 : 1), 1024, i === 8 ? 6 : 2);
    }
    // 放射線
    for (let i = 0; i < 24; i++) {
      const x = (i / 24) * 1024;
      g.globalAlpha = i % 2 === 0 ? 0.85 : 0.35;
      g.fillStyle = main;
      g.fillRect(x - 1, 60, 2, 452);
    }
    g.globalAlpha = 1;
    if (style === 'lava') {
      // 熔岩裂縫：隨機折線，發亮的橘紅色
      g.strokeStyle = '#ff5a14';
      g.shadowColor = '#ff8a2a';
      g.shadowBlur = 10;
      for (let n = 0; n < 40; n++) {
        let x = Math.random() * 1024;
        let y = Math.random() * 512;
        g.lineWidth = 1 + Math.random() * 3;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          x += (Math.random() - 0.5) * 80;
          y += (Math.random() - 0.3) * 50;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.shadowBlur = 0;
    } else if (style === 'ice') {
      // 冰面裂紋與霜花：細白線
      g.strokeStyle = 'rgba(220,250,255,0.55)';
      for (let n = 0; n < 60; n++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 512;
        g.lineWidth = 0.5 + Math.random() * 1.5;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 60);
        g.stroke();
      }
    } else if (style === 'gear') {
      // 標準戰鬥盤：中心的比賽標記環
      g.fillStyle = hex(rim);
      g.fillRect(0, 150, 1024, 4);
    }
  }
  // 中心圓盤
  if (style !== 'rail') {
    g.fillStyle = hex(rim);
    g.fillRect(0, 0, 1024, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 水面波紋：同心的亮帶加上螺旋條紋（旋轉時看得出水流方向） */
export function rippleTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 512);
  g.translate(256, 256);
  for (let r = 20; r < 256; r += 18) {
    g.strokeStyle = `rgba(255,255,255,${0.12 + 0.2 * Math.abs(Math.sin(r * 0.11))})`;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  // 螺旋條紋
  for (let arm = 0; arm < 5; arm++) {
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 4;
    g.beginPath();
    for (let t = 0; t < 1; t += 0.02) {
      const a = arm * ((Math.PI * 2) / 5) + t * 2.4;
      const r = 20 + t * 230;
      if (t === 0) g.moveTo(r * Math.cos(a), r * Math.sin(a));
      else g.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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
