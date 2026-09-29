# Battle Tops — 3D 戰鬥陀螺 設計草案

## 已確認的決定（2026-09-29）

- 平台：Web，Three.js + Vite + TypeScript，陀螺物理自寫（純函式、可單元測試）。
- 日語語音：Fish Audio `s2.1-pro-free` 預先生成台詞音檔放 `public/voice/`，缺檔時退回 `speechSynthesis`。
- 範圍：1P vs CPU 完整一場，先拿 3 分獲勝。
- 風格：動畫霓虹風（暗色競技場、Bloom、發光軌跡、反白衝擊幀、集中線）。

## 模組

| 路徑 | 職責 |
| --- | --- |
| `src/sim/` | 純邏輯：陀螺狀態、碗形場地、碰撞衝量、轉速衰減、爆裂／出場／停轉判定、計分、發射時機換算。固定步長 1/120 s，亂數可指定種子。 |
| `src/sim/cpu.ts` | CPU 操控（依陀螺類型：攻擊型追擊、持久型守中）。 |
| `src/director/` | 鏡頭導演：一般追蹤、撞擊特寫（慢動作 + 切到撞擊點環繞）、終結鏡頭。冷卻時間避免頻繁觸發。邏輯與 three 解耦，可測。 |
| `src/render/` | 場景、陀螺模型、粒子火花、衝擊波、軌跡、後製（Bloom + 自訂 shader：色差、放射模糊、反白衝擊幀、暗角）。 |
| `src/audio/` | Web Audio 合成：轉速嗡鳴（音高隨轉速）、金屬撞擊（非諧波泛音 + 噪音 + 次低頻）、慢動作 whoosh、場館殘響（生成 IR）、HRTF PannerNode 跟隨鏡頭。 |
| `src/audio/voice.ts` | 語音台詞播放與佇列（避免台詞互相蓋掉）。 |
| `src/ui/` | DOM 覆蓋層：HUD、選角、蓄力發射、擬聲字、必殺 cut-in、集中線。 |
| `scripts/gen-voice.mjs` | 呼叫 Fish Audio 產生台詞，依「文字＋聲音」雜湊快取。 |
| `tests/` | Vitest 單元測試（sim、director）。 |
| `e2e/` | Playwright 腳本：載入 → 選陀螺 → 發射 → 對戰 → 截圖，檢查特寫觸發與無 console 錯誤。 |

## 規則

- 停轉（Spin Finish）1 分；出場（Over Finish）、爆裂（Burst Finish）2 分；先拿 3 分勝。
- 四種陀螺：攻擊（高攻、低持久）、防禦（重、抗擊退）、持久（轉速衰減慢）、平衡。
- 對戰中玩家可用方向鍵小幅推移；撞擊累積必殺量表，滿了按 Space 放必殺技（cut-in + 喊招）。
- 發射：倒數「3、2、1、ゴー・シュート！」，在 ゴー 時按下，時機越準初始轉速越高。
