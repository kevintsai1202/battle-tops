import { lang as currentLang, type Lang } from '../i18n';
import type { TopSpec } from '../sim/types';
import type { AudioEngine } from './engine';
import tutorialLines from './tutorial-lines.json';
import { trimRange } from './trim';
import jaLines from './voice-lines.json';
import zhLines from './voice-lines.zh.json';

/** 台詞 id（對應 voice-lines.json 的 lines；中文表 voice-lines.zh.json 用同一組 id） */
export type VoiceId = keyof typeof jaLines.lines;

/** 語音來源：預先生成的音檔、瀏覽器語音合成（退路）、都沒有（含載入中） */
export type VoiceMode = 'fish-files' | 'speechSynthesis' | 'none';

/** 操作教學的解說台詞 id（tutorial-lines.json，只有中文） */
export type GuideId = keyof typeof tutorialLines.lines;

/** 播放優先權：0 閒聊（有人講話就放棄）、1 一般、2 重要（倒數、終結、勝負）、3 教學解說（最優先） */
export type Priority = 0 | 1 | 2 | 3;

/** 一套音檔：日文、中文，或操作教學的解說 */
type SetId = Lang | 'tutorial';

/** 一句台詞：角色與文字（方括號是語氣標記） */
interface Line {
  speaker: string;
  text: string;
}

/** 各語言的台詞表；中文表少了任何一句時，這裡的型別檢查會報錯 */
const LINES: Record<Lang, Record<VoiceId, Line>> = { ja: jaLines.lines, zh: zhLines.lines };
/** 各套音檔的資料夾（相對 BASE_URL）：日文沿用原本的 voice/，中文在 voice/zh/，教學解說在 voice/tutorial/ */
export const VOICE_DIR: Record<SetId, string> = { ja: 'voice/', zh: 'voice/zh/', tutorial: 'voice/tutorial/' };
/** 語音合成退路用的語言 */
const SYNTH_LANG: Record<Lang, string> = { ja: 'ja-JP', zh: 'zh-TW' };

/** 原創四顆沿用舊的必殺語音檔（依類型命名），其餘用 p_special_<代號> */
const LEGACY_SPECIAL_VOICE: Record<string, VoiceId> = {
  blaze: 'p_special_attack',
  turtle: 'p_special_defense',
  gale: 'p_special_stamina',
  wolf: 'p_special_balance',
};

/** 陀螺的必殺技台詞 id */
export function specialVoice(spec: TopSpec): VoiceId {
  return LEGACY_SPECIAL_VOICE[spec.id] ?? (`p_special_${spec.id}` as VoiceId);
}

/** 去掉方括號語氣標記，給語音合成退路用 */
function plainText(l: Lang, id: VoiceId): string {
  return LINES[l][id].text.replace(/\[[^\]]*\]/g, '').trim();
}

/** 教學解說去掉語氣標記的文字 */
function guideText(id: GuideId): string {
  return tutorialLines.lines[id].text.replace(/\[[^\]]*\]/g, '').trim();
}

/** 一套音檔：解碼後的音訊（依台詞 id）、來源（載入完成前為 none） */
interface VoiceSet {
  buffers: Map<string, AudioBuffer>;
  mode: VoiceMode;
  loading: Promise<void>;
}

/**
 * 台詞播放器（日語或中文，跟著介面語言）。
 * 載入該語言 manifest.json 列出的 Fish Audio 音檔並解碼，
 * 去掉開頭與結尾的靜音（讓「ゴー・シュート！」「發射！」準確落在倒數節拍上）。
 * 同一時間只講一句：高優先權可以打斷低優先權，閒聊類台詞遇到有人在講就略過。
 * 播放時自動壓低音效與音樂。整批缺檔時退回瀏覽器該語言的語音合成；個別台詞缺檔時只有那一句用語音合成。
 * 切換語言時另一套音檔在背景載入，載完之前不講話（不會冒出另一種語言或機器人聲音）。
 */
export class VoicePlayer {
  /** 目前講的語言 */
  lang: Lang;
  /** 累計播放句數（e2e 觀察用） */
  played = 0;
  /** 最近播放的台詞 id（e2e 觀察用） */
  last: VoiceId | null = null;
  /** 教學解說：累計播放句數與最近一句（e2e 觀察用） */
  guidePlayed = 0;
  guideLast: GuideId | null = null;
  private readonly audio: AudioEngine;
  private readonly sets = new Map<SetId, VoiceSet>();
  private current: { src: AudioBufferSourceNode | null; priority: Priority; until: number } | null = null;

  constructor(audio: AudioEngine, l: Lang = currentLang()) {
    this.audio = audio;
    this.lang = l;
  }

  /** 目前語言的語音來源（還在載入時為 none） */
  get mode(): VoiceMode {
    return this.sets.get(this.lang)?.mode ?? 'none';
  }

  /** 目前語言已解碼的句數（e2e 觀察用） */
  get loaded(): number {
    return this.sets.get(this.lang)?.buffers.size ?? 0;
  }

  /** 載入目前語言的音檔（已在載入或載過就沿用同一個 Promise） */
  load(): Promise<void> {
    return this.loadSet(this.lang).loading;
  }

  /** 換語言：之後播放該語言的台詞；那一套還沒載過就開始載入 */
  setLang(l: Lang): void {
    this.lang = l;
    void this.load();
  }

  /** 載入教學解說的音檔（開始教學時呼叫；已載過就沿用） */
  loadGuide(): Promise<void> {
    return this.loadSet('tutorial').loading;
  }

  /** 取得（必要時開始載入）某一套音檔；失敗時那一套改用語音合成退路 */
  private loadSet(l: SetId): VoiceSet {
    const hit = this.sets.get(l);
    if (hit) return hit;
    const set: VoiceSet = { buffers: new Map(), mode: 'none', loading: Promise.resolve() };
    this.sets.set(l, set);
    set.loading = (async () => {
      try {
        const base = `${import.meta.env.BASE_URL}${VOICE_DIR[l]}`;
        const res = await fetch(`${base}manifest.json`);
        if (!res.ok) throw new Error(`manifest ${res.status}`);
        const manifest = (await res.json()) as Record<string, { file: string }>;
        await Promise.all(
          Object.entries(manifest).map(async ([id, m]) => {
            const r = await fetch(`${base}${m.file}`);
            if (!r.ok) return;
            const buf = await this.audio.ctx.decodeAudioData(await r.arrayBuffer());
            set.buffers.set(id, this.trim(buf));
          }),
        );
        if (set.buffers.size === 0) throw new Error('沒有可用的音檔');
        set.mode = 'fish-files';
      } catch (e) {
        console.warn(`[voice] ${l} 音檔載入失敗，改用瀏覽器語音合成：`, e);
        set.mode = 'speechSynthesis' in window ? 'speechSynthesis' : 'none';
      }
      console.info(`[voice] ${l} 語音來源：${set.mode}（${set.buffers.size} 句）`);
    })();
    return set;
  }

  /** 去掉頭尾靜音（門檻與留白見 trim.ts；生成腳本記錄的播放長度用同一份計算） */
  private trim(buf: AudioBuffer): AudioBuffer {
    const [s, e] = trimRange(buf.getChannelData(0), buf.sampleRate);
    const out = this.audio.ctx.createBuffer(buf.numberOfChannels, e - s + 1, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(s, e + 1), c);
    return out;
  }

  /** 台詞長度（秒）；語音合成模式下粗估 */
  duration(id: VoiceId): number {
    const b = this.sets.get(this.lang)?.buffers.get(id);
    return b ? b.duration : 0.12 * plainText(this.lang, id).length + 0.3;
  }

  /** 教學解說的長度（秒）；還沒載好時依字數粗估 */
  guideDuration(id: GuideId): number {
    const b = this.sets.get('tutorial')?.buffers.get(id);
    return b ? b.duration : 0.2 * guideText(id).length + 0.3;
  }

  /**
   * 播放教學解說（最優先，會打斷主播與角色台詞；中文，不跟介面語言切換）。
   * 音檔還沒載好或缺檔時用瀏覽器的中文語音合成。回傳是否真的播出。
   */
  guide(id: GuideId): boolean {
    const set = this.sets.get('tutorial');
    const buf = set?.mode === 'fish-files' ? set.buffers.get(id) : undefined;
    const ok = this.start(buf, guideText(id), 'guide', 'zh-TW', 3, buf ? buf.duration : this.guideDuration(id));
    if (ok) {
      this.guidePlayed++;
      this.guideLast = id;
    }
    return ok;
  }

  /** 目前是否有人在講話 */
  get busy(): boolean {
    return this.current !== null && this.audio.ctx.currentTime < this.current.until;
  }

  /** 播放台詞；回傳是否真的播出 */
  play(id: VoiceId, priority: Priority = 1): boolean {
    // 這一句沒有音檔（例如新增的台詞還沒生成）：單句退回瀏覽器語音合成；整套還在載入時不講話
    const mode = this.mode;
    if (mode === 'none') return false;
    const buf = mode === 'fish-files' ? this.sets.get(this.lang)?.buffers.get(id) : undefined;
    const ok = this.start(buf, plainText(this.lang, id), LINES[this.lang][id].speaker, SYNTH_LANG[this.lang], priority, this.duration(id));
    if (ok) {
      this.played++;
      this.last = id;
    }
    return ok;
  }

  /**
   * 實際播出一句：有音檔就播音檔（主播加場館殘響），沒有就用語音合成；
   * 同一時間只講一句，高優先權打斷低優先權，閒聊（0）遇到有人講話就略過。播放時壓低音效與音樂。
   */
  private start(buf: AudioBuffer | undefined, text: string, speaker: string, synthLang: string, priority: Priority, dur: number): boolean {
    const now = this.audio.ctx.currentTime;
    if (this.busy && this.current) {
      if (priority === 0 || priority < this.current.priority) return false;
      this.current.src?.stop();
      if (this.current.src === null && 'speechSynthesis' in window) speechSynthesis.cancel();
    }
    if (buf) {
      const src = this.audio.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.audio.voice);
      // 實況主播加一點場館殘響，像從廣播喇叭出來
      if (speaker === 'announcer') {
        const wet = this.audio.ctx.createGain();
        wet.gain.value = 0.25;
        src.connect(wet).connect(this.audio.reverbSend);
      }
      src.start();
      this.current = { src, priority, until: now + dur };
    } else if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = synthLang;
      u.rate = 1.15;
      u.pitch = speaker === 'player' ? 1.4 : 1.0;
      speechSynthesis.speak(u);
      this.current = { src: null, priority, until: now + dur };
    } else {
      return false;
    }
    this.audio.duck(dur + 0.1);
    return true;
  }
}
