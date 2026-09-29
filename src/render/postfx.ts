import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * 撞擊後製 shader：放射模糊（zoom blur）、色差、動畫風集中線、反白衝擊幀、暗角。
 * 放在 OutputPass 之後，直接在 sRGB 畫面上做風格化處理。
 */
const ImpactShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uAberration: { value: 0 },
    uRadial: { value: 0 },
    uLines: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uVignette: { value: 0.35 },
    uTint: { value: new THREE.Color(1, 0.25, 0.15) },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uFlash;
    uniform float uAberration;
    uniform float uRadial;
    uniform float uLines;
    uniform vec2 uCenter;
    uniform float uVignette;
    uniform vec3 uTint;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(float n) { return fract(sin(n) * 43758.5453123); }

    void main() {
      vec2 d = vUv - uCenter;
      vec2 off = d * uAberration * 0.025;
      vec3 col = vec3(0.0);
      float total = 0.0;
      // 放射模糊：沿著往撞擊中心的方向多次取樣；uRadial 為 0 時只取一次
      for (int i = 0; i < 14; i++) {
        float t = float(i) / 13.0;
        vec2 suv = uCenter + d * (1.0 - uRadial * t * 0.14);
        col.r += texture2D(tDiffuse, suv + off).r;
        col.g += texture2D(tDiffuse, suv).g;
        col.b += texture2D(tDiffuse, suv - off).b;
        total += 1.0;
        if (uRadial < 0.001) break;
      }
      col /= total;

      // 集中線：以撞擊點為中心的放射狀白線，隨時間閃動
      vec2 dd = vec2(d.x * uAspect, d.y);
      float ang = atan(dd.y, dd.x);
      float r = length(dd);
      float seg = floor((ang + 3.14159265) / 6.2831853 * 150.0);
      float h = hash(seg * 1.37 + floor(uTime * 20.0) * 17.0);
      float line = step(0.6, h) * smoothstep(0.22 + h * 0.3, 0.95, r);
      col = mix(col, vec3(1.0), clamp(line * uLines, 0.0, 1.0) * 0.9);

      // 反白衝擊幀：暗處變亮（帶色調）、亮處變黑，像動畫的衝擊定格
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      float s = 1.0 - smoothstep(0.12, 0.3, l);
      vec3 impact = mix(vec3(0.02, 0.0, 0.03), mix(vec3(1.0), uTint, 0.35), s);
      col = mix(col, impact, uFlash);

      // 暗角
      vec2 vd = (vUv - 0.5) * vec2(uAspect * 0.75, 1.0);
      float v = smoothstep(0.95, 0.3, length(vd));
      col *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/** 後製參數（每幀由遊戲層設定） */
export interface ImpactParams {
  flash: number;
  aberration: number;
  radial: number;
  lines: number;
  /** 撞擊點在螢幕上的位置（0..1） */
  center: THREE.Vector2;
  vignette: number;
}

/** WebGL 渲染器 + 後製管線 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly impact: ShaderPass;
  /**
   * Bloom 內部緩衝相對畫面的比例。UnrealBloomPass 本身已在一半解析度運算，
   * 省電模式再乘 0.6（約 1/3）。composer.setSize 會把 Bloom 重設回預設，所以每次 resize 都要重新套用。
   */
  private readonly bloomScale: number;

  /** lowPower：手機等觸控裝置用，降低像素比與 Bloom 解析度 */
  constructor(container: HTMLElement, lowPower = false) {
    this.bloomScale = lowPower ? 0.6 : 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x03040a);
    this.scene.fog = new THREE.Fog(0x03040a, 14, 34);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(480, 270), 1.05, 0.55, 0.62);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.impact = new ShaderPass(ImpactShader);
    this.composer.addPass(this.impact);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** 視窗大小改變時更新相機與各 pass 尺寸 */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    if (this.bloomScale !== 1) {
      const pr = this.renderer.getPixelRatio();
      this.bloom.setSize(w * pr * this.bloomScale, h * pr * this.bloomScale);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.impact.uniforms.uAspect.value = w / h;
  }

  /** 設定本幀的撞擊後製參數與 Bloom 強度 */
  setImpact(p: ImpactParams, time: number, bloomBoost: number): void {
    const u = this.impact.uniforms;
    u.uTime.value = time;
    u.uFlash.value = p.flash;
    u.uAberration.value = p.aberration;
    u.uRadial.value = p.radial;
    u.uLines.value = p.lines;
    u.uCenter.value.copy(p.center);
    u.uVignette.value = p.vignette;
    this.bloom.strength = 1.05 + bloomBoost;
  }

  render(): void {
    this.composer.render();
  }
}
