import * as THREE from 'three';

/** 一顆陀螺的轉動聲（持續播放，音高與音量跟著轉速） */
export interface Hum {
  /** 每幀更新位置與轉速比例 */
  set(pos: THREE.Vector3, ratio: number, alive: boolean): void;
  stop(): void;
}

/**
 * Web Audio 音效引擎：所有音效都以程式合成（沒有素材授權問題）。
 * - 空間化：PannerNode（HRTF），聆聽者跟著鏡頭走，音效從撞擊點的方向傳來。
 * - 匯流排：sfx / music / voice 三條，語音播放時壓低 sfx 與 music（ducking）。
 * - 殘響：以雜訊生成的 impulse response 模擬場館迴響。
 * - 主輸出前有壓縮器，避免撞擊、重低音、喊聲疊加時破音。
 * - 慢動作：所有持續音的音高跟著時間流速往下掉，做出動畫式的「時間凍結」聲。
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly sfx: GainNode;
  readonly music: GainNode;
  readonly voice: GainNode;
  /** 送往殘響的輸入 */
  readonly reverbSend: GainNode;
  private readonly noise: AudioBuffer;
  private readonly hums = new Set<{ osc: OscillatorNode[]; base: number[]; filters: BiquadFilterNode[]; fbase: number[] }>();
  private pitch = 1;
  private crowdGain: GainNode | null = null;
  private excitement = 0;
  private bgm: Bgm | null = null;
  /** 累計播放的音效數（e2e 觀察用） */
  sfxCount = 0;
  /** 主輸出的音量分析器（e2e 用來證明真的有聲音輸出） */
  private readonly analyser: AnalyserNode;
  private readonly analyserBuf: Float32Array<ArrayBuffer>;
  /** 最近一段時間的輸出峰值 RMS */
  peakLevel = 0;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyserBuf = new Float32Array(this.analyser.fftSize);
    comp.connect(this.analyser);

    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.music.gain.value = 0.32;
    this.voice = ctx.createGain();
    this.voice.gain.value = 1.15;
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.voice.connect(this.master);

    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.6, 2.4);
    const ret = ctx.createGain();
    ret.gain.value = 0.4;
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(conv).connect(ret).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** 瀏覽器要求使用者操作後才能出聲 */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** 以指數衰減雜訊生成立體聲殘響 */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  /** 聆聽者跟著鏡頭：位置與朝向 */
  setListener(camera: THREE.Camera): void {
    const l = this.ctx.listener;
    const p = camera.getWorldPosition(new THREE.Vector3());
    const f = camera.getWorldDirection(new THREE.Vector3());
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02);
      l.upY.setTargetAtTime(u.y, t, 0.02);
      l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      // 舊版瀏覽器沒有 AudioParam 版本
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  /** 建立一個放在世界座標 pos 的 3D 聲源 */
  private panner(pos: THREE.Vector3, out: AudioNode = this.sfx): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.2;
    p.maxDistance = 60;
    p.rolloffFactor = 1;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(out);
    return p;
  }

  /** 一段雜訊來源（從 offset 隨機位置開始） */
  private noiseSrc(): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = 0;
    s.loopEnd = this.noise.duration;
    return s;
  }

  /** 快速起音、指數衰減的包絡 */
  private env(g: GainNode, t0: number, peak: number, decay: number, attack = 0.002): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  /** 播放一個正弦（或其他波形）音，頻率可指數滑動 */
  private tone(out: AudioNode, t0: number, type: OscillatorType, f0: number, f1: number, peak: number, decay: number, attack = 0.002): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + attack + decay);
    const g = this.ctx.createGain();
    this.env(g, t0, peak, decay, attack);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
  }

  /** 播放一段濾波雜訊；filter 頻率可滑動 */
  private noiseHit(out: AudioNode, t0: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, decay: number, attack = 0.002): void {
    const s = this.noiseSrc();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + attack + decay);
    const g = this.ctx.createGain();
    this.env(g, t0, peak, decay, attack);
    s.connect(f).connect(g).connect(out);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + attack + decay + 0.05);
  }

  /** 建立陀螺轉動聲：鋸齒＋方波和聲、帶通雜訊的呼嘯、顫動（葉片切風）、3D 定位 */
  createHum(pos: THREE.Vector3, bright: number): Hum {
    const ctx = this.ctx;
    const out = this.panner(pos);
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.Q.value = 2;
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 20;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;
    lfo.connect(lfoDepth).connect(trem.gain);
    lfo.start();

    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const o2g = ctx.createGain();
    o2g.gain.value = 0.25;
    o1.connect(lp);
    o2.connect(o2g).connect(lp);
    const whine = this.noiseSrc();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 14;
    const wg = ctx.createGain();
    wg.gain.value = 0.5 * bright;
    whine.connect(bp).connect(wg).connect(trem);
    lp.connect(trem).connect(g).connect(out);
    o1.start();
    o2.start();
    whine.start();

    const entry = { osc: [o1, o2, lfo], base: [0, 0, 0], filters: [bp, lp], fbase: [0, 0] };
    this.hums.add(entry);
    const self = this;
    return {
      set(p: THREE.Vector3, ratio: number, alive: boolean) {
        const t = ctx.currentTime;
        out.positionX.setTargetAtTime(p.x, t, 0.02);
        out.positionY.setTargetAtTime(p.y, t, 0.02);
        out.positionZ.setTargetAtTime(p.z, t, 0.02);
        const r = Math.max(0, ratio);
        entry.base = [48 + 210 * r, (48 + 210 * r) * 1.503, 6 + 30 * r];
        entry.fbase = [700 + 2600 * r, 300 + 2200 * r];
        const pm = self.pitch;
        o1.frequency.setTargetAtTime(entry.base[0] * pm, t, 0.05);
        o2.frequency.setTargetAtTime(entry.base[1] * pm, t, 0.05);
        lfo.frequency.setTargetAtTime(entry.base[2] * pm, t, 0.05);
        bp.frequency.setTargetAtTime(entry.fbase[0] * pm, t, 0.05);
        lp.frequency.setTargetAtTime(entry.fbase[1] * pm, t, 0.05);
        g.gain.setTargetAtTime(alive ? 0.2 * Math.pow(r, 0.6) : 0, t, alive ? 0.05 : 0.25);
      },
      stop() {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.05);
        for (const o of [o1, o2, lfo]) o.stop(t + 0.3);
        whine.stop(t + 0.3);
        self.hums.delete(entry);
      },
    };
  }

  /**
   * 時間流速（慢動作）：持續音的音高跟著下降，做出「時間凍結」的低沉感。
   * ts = 1 為正常，0.07 時音高約降到 35%。
   */
  setTimeScale(ts: number): void {
    const pm = 0.3 + 0.7 * Math.min(1, ts);
    if (Math.abs(pm - this.pitch) < 0.005) return;
    this.pitch = pm;
    const t = this.ctx.currentTime;
    for (const h of this.hums) {
      h.osc.forEach((o, i) => o.frequency.setTargetAtTime(h.base[i] * pm, t, 0.05));
      h.filters.forEach((f, i) => f.frequency.setTargetAtTime(h.fbase[i] * pm, t, 0.05));
    }
    if (this.bgm) this.bgm.setRate(pm);
  }

  /**
   * 陀螺互撞：非諧波泛音的金屬撞擊聲、高頻雜訊爆裂、次低頻衝擊；
   * 同向旋轉加上摩擦刮擦聲；重擊再加上低頻爆炸與長殘響。
   */
  clash(pos: THREE.Vector3, intensity: number, big: boolean, sameSpin: boolean): void {
    const t0 = this.ctx.currentTime + 0.005;
    const amp = Math.min(1, 0.25 + intensity / 10);
    const out = this.panner(pos);
    const wet = this.ctx.createGain();
    wet.gain.value = big ? 0.9 : 0.3;
    out.connect(wet).connect(this.reverbSend);

    const base = (560 + Math.random() * 360) * (1 - Math.min(0.45, intensity * 0.035));
    const ratios = [1, 2.76, 5.4, 8.93, 13.34, 17.2];
    const decays = [1.0, 0.62, 0.4, 0.26, 0.17, 0.12];
    const gains = [0.5, 0.35, 0.28, 0.2, 0.14, 0.1];
    const len = 0.45 + intensity * 0.06;
    ratios.forEach((r, i) => this.tone(out, t0, 'sine', base * r * (1 + (Math.random() - 0.5) * 0.02), base * r * 0.985, amp * gains[i], decays[i] * len));
    this.noiseHit(out, t0, 'highpass', 2500, 1800, 0.7, amp * 0.9, 0.08);
    this.noiseHit(out, t0, 'bandpass', 5200, 3000, 1.5, amp * 0.5, 0.18);
    // 次低頻衝擊不定位，直接進 sfx（像胸口被打一拳）
    this.tone(this.sfx, t0, 'sine', 150, 40, amp * 0.9, 0.35);
    if (sameSpin) {
      // 同向旋轉的表面摩擦：快速斷續的刮擦
      const s = this.noiseSrc();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200;
      bp.Q.value = 3;
      const g = this.ctx.createGain();
      this.env(g, t0, amp * 0.45, 0.25, 0.01);
      const am = this.ctx.createGain();
      const lfo = this.ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 70;
      lfo.connect(am.gain);
      s.connect(bp).connect(am).connect(g).connect(out);
      s.start(t0, Math.random());
      lfo.start(t0);
      s.stop(t0 + 0.3);
      lfo.stop(t0 + 0.3);
    }
    if (big) {
      this.noiseHit(this.sfx, t0, 'lowpass', 900, 120, 0.8, 1.0, 1.6, 0.005);
      this.tone(this.sfx, t0, 'sine', 70, 26, 1.0, 1.8, 0.01);
      this.tone(this.reverbSend, t0, 'triangle', base * 0.5, base * 0.45, 0.4, 2.2);
    }
    this.excitement = Math.min(1, this.excitement + intensity * 0.05);
    this.sfxCount++;
  }

  /** 撞牆：悶悶的碰撞加一點雜訊 */
  wall(pos: THREE.Vector3, intensity: number): void {
    const t0 = this.ctx.currentTime + 0.005;
    const amp = Math.min(0.8, intensity / 6);
    const out = this.panner(pos);
    this.tone(out, t0, 'sine', 200, 70, amp, 0.14);
    this.noiseHit(out, t0, 'lowpass', 1400, 400, 0.8, amp * 0.6, 0.1);
    this.tone(out, t0, 'sine', 1400 + Math.random() * 300, 1380, amp * 0.12, 0.25);
    this.sfxCount++;
  }

  /** 特寫開始：往下掉的呼嘯（時間凍結） */
  slowmoIn(): void {
    const t0 = this.ctx.currentTime;
    this.noiseHit(this.sfx, t0, 'bandpass', 5000, 250, 2, 0.6, 0.6, 0.01);
    this.tone(this.sfx, t0, 'sawtooth', 900, 60, 0.12, 0.7, 0.01);
  }

  /** 特寫結束、時間恢復：往上揚的吸氣聲 */
  slowmoOut(): void {
    const t0 = this.ctx.currentTime;
    this.noiseHit(this.sfx, t0, 'bandpass', 300, 6000, 1.5, 0.35, 0.35, 0.25);
  }

  /** 必殺技：上升的鋸齒掃頻 + 閃亮的鐘聲 */
  special(pos: THREE.Vector3): void {
    const t0 = this.ctx.currentTime + 0.01;
    const out = this.panner(pos);
    const wet = this.ctx.createGain();
    wet.gain.value = 0.6;
    out.connect(wet).connect(this.reverbSend);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(160, t0);
    o.frequency.exponentialRampToValueAtTime(1500, t0 + 0.9);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 8;
    f.frequency.setValueAtTime(500, t0);
    f.frequency.exponentialRampToValueAtTime(7000, t0 + 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
    o.connect(f).connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + 1.2);
    this.noiseHit(out, t0, 'bandpass', 400, 8000, 1.2, 0.4, 1.0, 0.6);
    for (const [fr, d] of [[1320, 1.4], [1980, 1.1], [2640, 0.9], [3960, 0.7]] as const) {
      this.tone(out, t0 + 0.9, 'sine', fr, fr, 0.18, d);
    }
    this.tone(this.sfx, t0 + 0.9, 'sine', 110, 40, 0.8, 0.6);
    this.excitement = 1;
    this.sfxCount++;
  }

  /** 回合終結：大爆炸 + 觀眾歡呼 */
  finish(pos: THREE.Vector3): void {
    const t0 = this.ctx.currentTime + 0.01;
    const out = this.panner(pos);
    out.connect(this.reverbSend);
    this.noiseHit(this.sfx, t0, 'lowpass', 2500, 90, 0.7, 1.0, 2.4, 0.005);
    this.tone(this.sfx, t0, 'sine', 90, 24, 1.0, 2.0, 0.01);
    this.clash(pos, 12, false, false);
    // 歡呼：多段帶通雜訊慢慢湧起再退去
    for (const [f, q] of [[700, 0.8], [1500, 1.2], [3000, 1.5]] as const) {
      this.noiseHit(this.sfx, t0 + 0.15, 'bandpass', f, f * 1.1, q, 0.28, 3.2, 0.5);
    }
    this.excitement = 1;
    this.sfxCount++;
  }

  /** 倒數嗶聲；go 為最後的發射號令 */
  countdown(go: boolean): void {
    const t0 = this.ctx.currentTime + 0.005;
    if (!go) {
      this.tone(this.sfx, t0, 'square', 880, 880, 0.18, 0.14);
      this.tone(this.sfx, t0, 'sine', 1760, 1760, 0.1, 0.2);
      return;
    }
    for (const f of [440, 554.4, 659.3, 880]) this.tone(this.sfx, t0, 'sawtooth', f, f, 0.1, 0.7, 0.005);
    this.noiseHit(this.sfx, t0, 'highpass', 3000, 3000, 0.7, 0.35, 0.4);
    this.tone(this.sfx, t0, 'sine', 130, 45, 0.9, 0.4);
  }

  /** 發射：拉條的棘輪聲 + 咻的一聲 */
  launch(pos: THREE.Vector3): void {
    const t0 = this.ctx.currentTime + 0.005;
    const out = this.panner(pos);
    let t = t0;
    for (let i = 0; i < 16; i++) {
      this.noiseHit(out, t, 'highpass', 3500, 3500, 1, 0.35, 0.012, 0.001);
      t += 0.028 * Math.pow(0.9, i);
    }
    this.noiseHit(out, t0, 'bandpass', 700, 6000, 2, 0.45, 0.35, 0.02);
    this.tone(out, t, 'sine', 220, 60, 0.6, 0.3);
    this.sfxCount++;
  }

  /** 語音播放時壓低音效與音樂 */
  duck(seconds: number): void {
    const t = this.ctx.currentTime;
    for (const [bus, low, normal] of [
      [this.sfx, 0.4, 1],
      [this.music, 0.12, 0.32],
    ] as const) {
      bus.gain.cancelScheduledValues(t);
      bus.gain.setTargetAtTime(low, t, 0.03);
      bus.gain.setTargetAtTime(normal, t + seconds, 0.15);
    }
  }

  /** 觀眾席環境音（持續），音量跟著比賽激烈程度 */
  startCrowd(): void {
    if (this.crowdGain) return;
    const ctx = this.ctx;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.03;
    for (const [f, q] of [[600, 0.7], [1400, 1], [2600, 1.3]] as const) {
      const s = this.noiseSrc();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.3 + Math.random() * 0.6;
      const depth = ctx.createGain();
      depth.gain.value = 0.3;
      g.gain.value = 0.7;
      lfo.connect(depth).connect(g.gain);
      s.connect(bp).connect(g).connect(this.crowdGain);
      s.start();
      lfo.start();
    }
    this.crowdGain.connect(this.sfx);
  }

  /** 每幀：激烈程度衰減、更新觀眾音量、量測輸出音量 */
  update(dt: number): number {
    this.excitement *= Math.exp(-dt * 0.5);
    this.analyser.getFloatTimeDomainData(this.analyserBuf);
    let sum = 0;
    for (const v of this.analyserBuf) sum += v * v;
    const rms = Math.sqrt(sum / this.analyserBuf.length);
    this.peakLevel = Math.max(rms, this.peakLevel * Math.exp(-dt * 0.3));
    if (this.crowdGain) this.crowdGain.gain.setTargetAtTime(0.03 + this.excitement * 0.14, this.ctx.currentTime, 0.2);
    return this.excitement;
  }

  /** 開始／停止戰鬥 BGM */
  setMusic(on: boolean, intense = true): void {
    if (on && !this.bgm) {
      this.bgm = new Bgm(this);
      this.bgm.start();
    } else if (!on && this.bgm) {
      this.bgm.stop();
      this.bgm = null;
    }
    this.bgm?.setIntense(intense);
  }

  /** 供 BGM 使用的內部工具 */
  bgmTone(t0: number, type: OscillatorType, f0: number, f1: number, peak: number, decay: number, attack = 0.002): void {
    this.tone(this.music, t0, type, f0, f1, peak, decay, attack);
  }

  bgmNoise(t0: number, type: BiquadFilterType, f: number, peak: number, decay: number): void {
    this.noiseHit(this.music, t0, type, f, f, 0.8, peak, decay);
  }
}

/**
 * 程序生成的熱血戰鬥 BGM：152 BPM、A 小調（Am-F-G-E），
 * 大鼓／小鼓／腳踏鈸、鋸齒貝斯、十六分音符琶音主旋律。
 * 以「預先排程」方式（每 25ms 排下一段 0.15 秒內的音符）確保節拍穩定。
 */
class Bgm {
  private readonly a: AudioEngine;
  private timer = 0;
  private step = 0;
  private next = 0;
  private rate = 1;
  private intense = true;
  private readonly bpm = 152;

  constructor(a: AudioEngine) {
    this.a = a;
  }

  start(): void {
    this.next = this.a.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    window.clearInterval(this.timer);
  }

  /** 慢動作時整首歌一起變慢變低 */
  setRate(r: number): void {
    this.rate = r;
  }

  setIntense(on: boolean): void {
    this.intense = on;
  }

  private schedule(): void {
    const ctx = this.a.ctx;
    const sixteenth = 60 / this.bpm / 4 / this.rate;
    while (this.next < ctx.currentTime + 0.15) {
      this.play(this.step, this.next);
      this.next += sixteenth;
      this.step = (this.step + 1) % 256;
    }
  }

  /** 播放第 s 個十六分音符上的所有聲部 */
  private play(s: number, t: number): void {
    const a = this.a;
    const r = this.rate;
    const inBar = s % 16;
    const bar = Math.floor(s / 16) % 4;
    // Am - F - G - E 的根音（A2 = 110Hz）
    const roots = [110, 87.31, 98, 82.41];
    const chordTones = [
      [220, 261.63, 329.63, 440],
      [174.61, 220, 261.63, 349.23],
      [196, 246.94, 293.66, 392],
      [164.81, 207.65, 246.94, 329.63],
    ];
    const root = roots[bar] * r;

    // 大鼓：1、3 拍 + 切分
    if (inBar === 0 || inBar === 8 || inBar === 10 || (this.intense && inBar === 14)) a.bgmTone(t, 'sine', 150 * r, 42 * r, 0.9, 0.22);
    // 小鼓：2、4 拍
    if (inBar === 4 || inBar === 12) {
      a.bgmNoise(t, 'highpass', 1500 * r, 0.5, 0.16);
      a.bgmTone(t, 'triangle', 200 * r, 160 * r, 0.3, 0.08);
    }
    // 腳踏鈸：八分音符
    if (this.intense && inBar % 2 === 0) a.bgmNoise(t, 'highpass', 8000, inBar % 4 === 2 ? 0.16 : 0.08, 0.04);
    // 貝斯：八分音符，偶爾跳八度
    if (inBar % 2 === 0) {
      const f = inBar === 6 || inBar === 14 ? root * 2 : root;
      a.bgmTone(t, 'sawtooth', f, f, 0.32, 0.14, 0.004);
    }
    // 琶音主旋律：十六分音符上下跑和弦音
    if (this.intense) {
      const pat = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2];
      const f = chordTones[bar][pat[inBar]] * 2 * r;
      a.bgmTone(t, 'square', f, f, 0.05, 0.09, 0.003);
    }
    // 每小節第一拍：和弦長音墊底
    if (inBar === 0) for (const f of chordTones[bar]) a.bgmTone(t, 'sawtooth', f * r, f * r, 0.035, 1.4, 0.05);
  }
}
