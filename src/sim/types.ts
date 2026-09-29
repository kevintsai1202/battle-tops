/** 地面平面上的 2D 向量（x、z 對應 three.js 的水平座標） */
export type V2 = { x: number; z: number };

/** 陀螺類型：攻擊、防禦、持久、平衡 */
export type TopType = 'attack' | 'defense' | 'stamina' | 'balance';

/** 終結方式：停轉、出場、爆裂 */
export type FinishType = 'spin' | 'over' | 'burst';

/** 陀螺規格（不變的數值） */
export interface TopSpec {
  type: TopType;
  /** 顯示名稱（日文） */
  nameJa: string;
  /** 顯示名稱（中文） */
  nameZh: string;
  /** 必殺技名稱（日文，與語音台詞一致） */
  specialJa: string;
  /** 半徑（世界單位） */
  radius: number;
  /** 質量 */
  mass: number;
  /** 攻擊力：影響對手轉速損失、爆裂量、撞擊彈開力道 */
  attack: number;
  /** 防禦力：抵銷對手攻擊 */
  defense: number;
  /** 持久力：轉速衰減越慢 */
  stamina: number;
  /** 軸心驅動力：轉速帶動、沿行進方向維持巡航速度的加速度（平頭軸心高、尖軸心低） */
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

/** 必殺技帶來的暫時增益 */
export interface Buff {
  kind: 'rush' | 'fortress' | 'cyclone' | 'nova';
  /** 剩餘秒數（模擬時間） */
  time: number;
}

/** 陀螺在場上的即時狀態 */
export interface TopState {
  id: number;
  spec: TopSpec;
  pos: V2;
  vel: V2;
  /** 轉速大小（rad/s，恆 ≥ 0） */
  spin: number;
  /** 旋轉方向：1 = 從上方看逆時針，-1 = 順時針 */
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
  buff: Buff | null;
  /** 是否仍在場上旋轉 */
  alive: boolean;
  /** 已被終結時的方式 */
  finish: FinishType | null;
  /** 被終結後經過的秒數（渲染倒下／飛出動畫用） */
  finishTime: number;
}

/** 模擬過程中發出的事件，由遊戲層取出後驅動特效、鏡頭、音效 */
export type SimEvent =
  | { type: 'clash'; pos: V2; normal: V2; intensity: number; a: number; b: number; sameSpin: boolean }
  | { type: 'wall'; pos: V2; intensity: number; id: number }
  | { type: 'finish'; finish: FinishType; loser: number; pos: V2 }
  | { type: 'special'; id: number; kind: TopType };

/** 一回合的結果 */
export interface RoundResult {
  finish: FinishType;
  loser: number;
  /** 勝者；雙方同時倒下時為 null（平手） */
  winner: number | null;
}
