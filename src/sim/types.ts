import type { StockParts } from './parts';

/** 地面平面上的 2D 向量（x、z 對應 three.js 的水平座標） */
export type V2 = { x: number; z: number };

/** 陀螺類型：攻擊、防禦、持久、平衡（決定 CPU 走位與卡片分類，不再是陀螺本身的代號） */
export type TopType = 'attack' | 'defense' | 'stamina' | 'balance';

/** 陀螺代號（TOP_SPECS 的鍵，例如 'blaze'） */
export type TopId = string;

/** 終結方式：停轉、出場、爆裂 */
export type FinishType = 'spin' | 'over' | 'burst';

/**
 * 陀螺的基本屬性（參考官方包裝的能力評分）。除了重量以外都是 1～10 分。
 * 物理能力值全部由這些屬性推導（見 sim/stats.ts 的 derivePhysics）。
 */
export interface BaseStats {
  /** 攻擊：撞擊造成的轉速損失、爆裂量、彈開力道 */
  attack: number;
  /** 防禦：抵銷對手攻擊、抓地（摩擦） */
  defense: number;
  /** 持久：轉速衰減慢、最高轉速 */
  stamina: number;
  /** 重量（公克）：質量與半徑 */
  weight: number;
  /** 爆裂抵抗：爆裂量累積得慢 */
  burst: number;
  /** 機動：軸心驅動力與巡航速度 */
  dash: number;
}

/**
 * 攻擊環外形的一組凸起：n 個平均分布，第一個在 phase 度，每個角寬 width 度、
 * 高度 height（佔半徑的比例，負值為凹口）、偏斜 skew（-1～1，峰值往旋轉前方偏，做出鋸齒或前傾的刃）。
 */
export interface Lobe {
  n: number;
  phase: number;
  width: number;
  height: number;
  skew?: number;
}

/**
 * 陀螺外觀（參考原型的配色與俯視輪廓，資料來源見 docs/design.md「外觀」）：
 * 攻擊環（主色）上疊一層較小的第二層（副色，像能量環或透明件），下面是金屬盤與軸心。
 */
export interface TopLook {
  /** 攻擊環主色、第二層副色、金屬件顏色、軸心外殼顏色 */
  primary: number;
  secondary: number;
  metal: number;
  tip: number;
  /** 攻擊環輪廓（凸起疊加） */
  ring: Lobe[];
  /** 第二層輪廓 */
  inner: Lobe[];
}

/** 必殺技觸發時對自己或對手套用的暫時倍率（沒寫的欄位視為 1 或不啟用） */
export interface BuffMods {
  /** 攻擊、防禦、質量倍率 */
  atk?: number;
  def?: number;
  mass?: number;
  /** 轉速衰減倍率（<1 更持久） */
  decay?: number;
  /** 地面摩擦倍率（>1 抓地、<1 打滑） */
  fric?: number;
  /** 推移加速度倍率 */
  ctrl?: number;
  /** 巡航速度倍率 */
  cruise?: number;
  /** 撞擊時造成的爆裂量倍率 */
  burstDealt?: number;
  /** 撞擊時吸取對手轉速的比例（佔對手最高轉速，每次撞擊） */
  spinSteal?: number;
  /** 反擊：被撞時對方也承受同比例的爆裂量 */
  reflect?: number;
  /** 力場：持續把對手拉近（正）或推開（負）的加速度，range 內有效 */
  aura?: { k: number; range: number };
}

/** 作用中的必殺效果 */
export interface Buff {
  /** 來源陀螺的代號（畫面依此上色） */
  from: TopId;
  /** 剩餘秒數（模擬時間） */
  time: number;
  mods: BuffMods;
}

/** 必殺技的一個動作（依序執行） */
export type SpecialStep =
  /** 朝對手突進：保留原速度 keep 倍再加上 speed */
  | { op: 'dash'; speed: number; keep: number }
  /** 急停：速度乘上 keep */
  | { op: 'brake'; keep: number }
  /** 回復自己的轉速（佔最高轉速） */
  | { op: 'spin'; ratio: number }
  /** 修復爆裂量 */
  | { op: 'repair'; amount: number }
  /** 吸取對手轉速（佔對手最高轉速），自己得到一半 */
  | { op: 'drain'; ratio: number }
  /** 衝擊波：對手在 range 內時往外推開 speed，並累積爆裂量 burst */
  | { op: 'shove'; speed: number; range: number; burst: number }
  /** 把對手往自己拉近 */
  | { op: 'pull'; speed: number }
  /** 反轉自己的旋轉方向（雙旋陀螺） */
  | { op: 'reverse' }
  /** 瞬移到對手背後 dist 處（限制在場內），再朝對手突進 speed */
  | { op: 'warp'; dist: number; speed: number }
  /** 瞬間回到場地中央並停下 */
  | { op: 'blink' }
  /** 自己獲得暫時效果 */
  | { op: 'buff'; time: number; mods: BuffMods }
  /** 對手受到暫時效果（減益） */
  | { op: 'hex'; time: number; mods: BuffMods };

/** CPU 何時放必殺：靠近對手、距離遠、自己轉速低、自己危險（爆裂量高或被猛衝） */
export type SpecialCue = 'close' | 'far' | 'lowSpin' | 'danger';

/** 必殺技定義（每顆陀螺一個） */
export interface SpecialDef {
  /** 招式名（日文，cut-in 與語音） */
  nameJa: string;
  /** 招式名（中文） */
  nameZh: string;
  /** 效果說明（選單顯示） */
  descZh: string;
  cue: SpecialCue;
  steps: SpecialStep[];
  /**
   * 集氣時間（秒，5～10）：一般對戰中大約多久集滿必殺量表。越強的必殺越慢。
   * 量表同時靠時間與撞擊累積，兩者都除以這個值（見 sim/physics.ts 的 addCharge）。
   */
  charge: number;
}

/** 陀螺規格（不變的數值）：基本屬性與由屬性推導出的物理能力值 */
export interface TopSpec {
  id: TopId;
  type: TopType;
  /** 顯示名稱（日文） */
  nameJa: string;
  /** 顯示名稱（中文） */
  nameZh: string;
  /** 致敬的原型陀螺（說明用；原創陀螺為 null） */
  origin: string | null;
  /** 旋轉方向：1 = 右旋，-1 = 左旋（渲染時右旋從上方看為順時針） */
  spinDir: 1 | -1;
  /** 紋章字（頂部晶片與小圖示） */
  emblem: string;
  /** 外觀：配色與攻擊環輪廓 */
  look: TopLook;
  /** 基本屬性（攻擊環 + 目前裝的盤與軸，限制在合法範圍） */
  stats: BaseStats;
  /** 攻擊環本身的屬性（= 原廠屬性 − 原廠盤 − 原廠軸；可能超出 1～10，只用來組裝） */
  ring: BaseStats;
  /** 原廠盤與原廠軸 */
  stock: StockParts;
  /** 目前裝的盤與軸（原廠組合時等於 stock） */
  parts: StockParts;
  special: SpecialDef;
  /** 以下為推導值 —— 半徑（世界單位） */
  radius: number;
  /** 質量 */
  mass: number;
  /** 攻擊力：影響對手轉速損失、爆裂量、撞擊彈開力道 */
  attack: number;
  /** 防禦力：抵銷對手攻擊 */
  defense: number;
  /** 持久力：轉速衰減越慢 */
  stamina: number;
  /** 爆裂抵抗：累積爆裂量時除以此值 */
  burstRes: number;
  /** 軸心驅動力：轉速帶動、沿行進方向維持巡航速度的加速度 */
  drive: number;
  /** 滿轉時的巡航速度；轉速下降時等比例降低 */
  cruise: number;
  /** 軸心摩擦：線性速度阻尼 */
  friction: number;
  /** 最高轉速（rad/s） */
  maxSpin: number;
  /** 主色與發光色（十六進位） */
  color: number;
  glow: number;
}

/** 陀螺在場上的即時狀態 */
export interface TopState {
  id: number;
  spec: TopSpec;
  pos: V2;
  vel: V2;
  /** 轉速大小（rad/s，恆 ≥ 0） */
  spin: number;
  /** 旋轉方向：1 或 -1（雙旋陀螺的必殺技可以反轉） */
  spinDir: 1 | -1;
  /** 累積自轉角度（渲染用） */
  angle: number;
  /** 晃動程度 0..1（轉速低時上升） */
  tilt: number;
  /** 晃動相位（進動角，渲染用） */
  precession: number;
  /** 爆裂量表 0..1，滿了就爆裂 */
  burst: number;
  /** 必殺量表 0..1 */
  special: number;
  /** 本回合是否已用過必殺技（每回合限一次） */
  specialUsed: boolean;
  /** 玩家／CPU 輸入的推移方向（長度 ≤ 1） */
  control: V2;
  /** 自己的必殺增益 */
  buff: Buff | null;
  /** 對手施加的減益 */
  hex: Buff | null;
  /** 是否仍在場上旋轉 */
  alive: boolean;
  /** 已被終結時的方式 */
  finish: FinishType | null;
  /** 被終結後經過的秒數（渲染倒下／飛出動畫用） */
  finishTime: number;
  /** 目前在哪種地形上（渲染與音效用） */
  terrain: 'ground' | 'lava' | 'water' | 'rail';
}

/** 場地機關造成的事件種類：熔岩噴發、濺水、撞冰柱 */
export type HazardKind = 'erupt' | 'splash' | 'pillar';

/** 模擬過程中發出的事件，由遊戲層取出後驅動特效、鏡頭、音效 */
export type SimEvent =
  | { type: 'clash'; pos: V2; normal: V2; intensity: number; a: number; b: number; sameSpin: boolean }
  | { type: 'wall'; pos: V2; intensity: number; id: number }
  | { type: 'finish'; finish: FinishType; loser: number; pos: V2 }
  | { type: 'special'; id: number; top: TopId }
  /** 快甩衝刺（手機）：dir 為衝刺方向 */
  | { type: 'dash'; id: number; pos: V2; dir: V2 }
  | { type: 'hazard'; kind: HazardKind; pos: V2; intensity: number };

/** 一回合的結果 */
export interface RoundResult {
  finish: FinishType;
  loser: number;
  /** 勝者；雙方同時倒下時為 null（平手） */
  winner: number | null;
}
