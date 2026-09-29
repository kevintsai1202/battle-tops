import lines from './voice-lines.json';
import type { AudioEngine } from './engine';

/** 台詞 id（對應 voice-lines.json 的 lines） */
export type VoiceId = keyof typeof lines.lines;

/** 語音來源：預先生成的音檔、瀏覽器語音合成（退路）、都沒有 */
export type VoiceMode = 'fish-files' | 'speechSynthesis' | 'none';

/** 播放優先權：0 閒聊（有人講話就放棄）、1 一般、2 重要（倒數、終結、勝負） */
export type Priority = 0 | 1 | 2;

/** 去掉方括號語氣標記，給語音合成退路用 */
function plainText(id: VoiceId): string {
  return lines.lines[id].text.replace(/\[[^\]]*\]/g, '').trim();
}

/**
 * 日語台詞播放器。
 * 載入 public/voice/manifest.json 列出的 Fish Audio 音檔並解碼，
 * 去掉開頭與結尾的靜音（讓「ゴー・シュート！」準確落在倒數節拍上）。
 * 同一時間只講一句：高優先權可以打斷低優先權，閒聊類台詞遇到有人在講就略過。
 * 播放時自動壓低音效與音樂。缺檔時退回瀏覽器的日語語音合成。
 */
export class VoicePlayer {
  mode: VoiceMode = 'none';
  /** 累計播放句數（e2e 觀察用） */
  played = 0;
  /** 最近播放的台詞 id（e2e 觀察用） */
  last: VoiceId | null = null;
  private readonly audio: AudioEngine;
  private readonly buffers = new Map<VoiceId, AudioBuffer>();
  private current: { src: AudioBufferSourceNode | null; priority: Priority; until: number } | null = null;

  constructor(audio: AudioEngine) {
    this.audio = audio;
  }

  /** 載入並解碼全部台詞音檔；失敗時切到語音合成退路 */
  async load(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL;
      const res = await fetch(`${base}voice/manifest.json`);
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      const manifest = (await res.json()) as Record<string, { file: string }>;
      await Promise.all(
        Object.entries(manifest).map(async ([id, m]) => {
          const r = await fetch(`${base}voice/${m.file}`);
          if (!r.ok) return;
          const buf = await this.audio.ctx.decodeAudioData(await r.arrayBuffer());
          this.buffers.set(id as VoiceId, this.trim(buf));
        }),
      );
      if (this.buffers.size === 0) throw new Error('沒有可用的音檔');
      this.mode = 'fish-files';
    } catch (e) {
      console.warn('[voice] 音檔載入失敗，改用瀏覽器語音合成：', e);
      this.mode = 'speechSynthesis' in window ? 'speechSynthesis' : 'none';
    }
    console.info(`[voice] 語音來源：${this.mode}（${this.buffers.size} 句）`);
  }

  /**
   * 去掉頭尾靜音：開頭用約 -34 dBFS 的門檻（讓台詞準確對上節拍），
   * 結尾用較低的約 -44 dBFS 門檻，避免切掉輕聲的尾音子音。
   */
  private trim(buf: AudioBuffer): AudioBuffer {
    const ch = buf.getChannelData(0);
    let s = 0;
    while (s < ch.length && Math.abs(ch[s]) < 0.02) s++;
    let e = ch.length - 1;
    while (e > s && Math.abs(ch[e]) < 0.006) e--;
    const pad = Math.floor(buf.sampleRate * 0.01);
    s = Math.max(0, s - pad);
    e = Math.min(ch.length - 1, e + pad * 4);
    const out = this.audio.ctx.createBuffer(buf.numberOfChannels, e - s + 1, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(s, e + 1), c);
    return out;
  }

  /** 台詞長度（秒）；語音合成模式下粗估 */
  duration(id: VoiceId): number {
    const b = this.buffers.get(id);
    return b ? b.duration : 0.12 * plainText(id).length + 0.3;
  }

  /** 目前是否有人在講話 */
  get busy(): boolean {
    return this.current !== null && this.audio.ctx.currentTime < this.current.until;
  }

  /** 播放台詞；回傳是否真的播出 */
  play(id: VoiceId, priority: Priority = 1): boolean {
    const now = this.audio.ctx.currentTime;
    if (this.busy && this.current) {
      if (priority === 0 || priority < this.current.priority) return false;
      this.current.src?.stop();
      if (this.mode === 'speechSynthesis') speechSynthesis.cancel();
    }
    const dur = this.duration(id);
    if (this.mode === 'fish-files') {
      const buf = this.buffers.get(id);
      if (!buf) return false;
      const src = this.audio.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.audio.voice);
      // 實況主播加一點場館殘響，像從廣播喇叭出來
      if (lines.lines[id].speaker === 'announcer') {
        const wet = this.audio.ctx.createGain();
        wet.gain.value = 0.25;
        src.connect(wet).connect(this.audio.reverbSend);
      }
      src.start();
      this.current = { src, priority, until: now + dur };
    } else if (this.mode === 'speechSynthesis') {
      const u = new SpeechSynthesisUtterance(plainText(id));
      u.lang = 'ja-JP';
      u.rate = 1.15;
      u.pitch = lines.lines[id].speaker === 'player' ? 1.4 : 1.0;
      speechSynthesis.speak(u);
      this.current = { src: null, priority, until: now + dur };
    } else {
      return false;
    }
    this.audio.duck(dur + 0.1);
    this.played++;
    this.last = id;
    return true;
  }
}
