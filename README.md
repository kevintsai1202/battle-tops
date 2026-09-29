# Battle Tops（戰鬥陀螺）

瀏覽器上的 3D 戰鬥陀螺對戰遊戲，1P 對 CPU，先拿 3 分獲勝。

**線上遊玩：<https://kevintsai1202.github.io/battle-tops/>**（需要鍵盤；建議戴耳機）

| 撞擊特寫 | 必殺技 cut-in |
| --- | --- |
| ![撞擊特寫](docs/screenshots/closeup.png) | ![必殺技](docs/screenshots/special-cutin.png) |
| **爆裂終結** | **選擇陀螺** |
| ![爆裂終結](docs/screenshots/burst-finish.png) | ![選擇陀螺](docs/screenshots/select.png) |

- 撞擊特寫：重擊時切到撞擊點側面的低角度鏡頭，時間慢到 7%，一邊環繞一邊推近。畫面上同時有反白衝擊幀、放射模糊、色差、集中線、放電弧線、火花與衝擊波，並跳出擬聲字（ドゴォォン！）。
- 立體音效：全部由 Web Audio 程式合成，沒有素材授權問題。聲源用 HRTF 定位，聆聽者跟著鏡頭移動。
  - 轉速嗡鳴：音高隨轉速變化。
  - 金屬撞擊：非諧波泛音 + 次低頻。
  - 慢動作：音高下沉。
  - 其他：場館殘響、觀眾歡呼、152 BPM 程序生成戰鬥 BGM。
- 熱血日語語音：用 Fish Audio 預先生成的 28 句台詞，分三個角色：
  - 實況主播：倒數、激突、終結。
  - 玩家：ゴー・シュート、必殺技名。
  - 對手：挑釁、必殺、敗北。

## 執行

需要 Node.js 22 以上（開發時用 24）。

```powershell
npm install
npm run dev          # 開發伺服器，瀏覽器開 http://localhost:5173
```

正式建置與預覽：

```powershell
npm run build
npm run preview      # http://localhost:4173
```

網址參數：

| 參數 | 說明 |
| --- | --- |
| `?demo=1` | CPU 對 CPU 自動對打、不需點擊，可連續看特寫效果 |
| `&seed=42` | 亂數種子，同一種子重現同一場 |
| `&p=attack&c=balance` | 展示模式指定雙方陀螺（attack / defense / stamina / balance） |

建議戴耳機，才聽得出 3D 定位。

## 玩法

1. 選陀螺（← → 選擇、Enter 決定）。

   | 陀螺 | 類型 | 特性 |
   | --- | --- | --- |
   | ブレイズ・ドラゴン（烈焰龍） | 攻擊型 | 高速、攻擊力高、持久差 |
   | アイアン・タートル（鐵壁龜） | 防禦型 | 重、耐打 |
   | ゲイル・フェニックス（疾風鳳） | 持久型 | 轉得久 |
   | ギャラクシー・ウルフ（星河狼） | 平衡型 | 各項平均 |

   相剋關係：攻擊克持久、防禦克攻擊，平衡型居中。

2. 倒數「スリー、ツー、ワン、ゴー・シュート！」：外圈縮到內圈、喊出「ゴー」的瞬間按 Space（或點擊）。時機越準，初始轉速越高（PERFECT / GREAT / GOOD / WEAK）。
3. 對戰中：
   - WASD 或方向鍵推移陀螺（方向相對於鏡頭）。推移會消耗轉速。
   - 主動衝撞的一方受到的傷害較少。
   - 撞擊會累積必殺量表，滿了按 Space 發動必殺技，每回合限用一次。
4. 終結方式：停轉 Spin Finish 1 分、出場 Over Finish 2 分、爆裂 Burst Finish 2 分。雙方同時倒下判平手重賽。
5. M 鍵：音樂開關。

## 測試

```powershell
npm test                   # 單元測試：物理、計分、鏡頭導演、CPU 對打耐久（Vitest）
npm run balance            # 平衡報表：16 種對戰組合各跑 100 場，印勝率與終結方式分布
npm run build; npx playwright test   # e2e：在真的瀏覽器跑，截圖存到 e2e/screenshots/
```

e2e 會實際確認以下幾件事：

- 撞擊特寫與慢動作有觸發。
- 火花有發射。
- 主輸出音量（RMS）大於 0。
- 語音來源是預先生成的音檔。
- 必殺 cut-in 會出現。
- 對戰能打到回合終結。
- 停轉倒下與出場飛出動畫的截圖。
- 需要手勢才能出聲的瀏覽器開展示模式不會卡住。

headless 用軟體 WebGL，約 15 fps，全套約 5～6 分鐘，一次只跑一個 worker。GitHub Actions 只跑單元測試與建置（CI 沒有 GPU），e2e 在本機跑。要對線上網址跑 e2e：

```powershell
$env:BASE_URL = 'https://kevintsai1202.github.io/battle-tops/'
npx playwright test -g 展示模式
Remove-Item Env:BASE_URL
```

## 發佈

推到 `main` 會由 [.github/workflows/pages.yml](.github/workflows/pages.yml) 自動跑單元測試、建置並發佈到 GitHub Pages。Vite 的 `base` 設成相對路徑（`./`），同一份 `dist/` 放在子路徑或任何靜態主機都能用，不需要後端。

## 語音台詞

台詞表在 [src/audio/voice-lines.json](src/audio/voice-lines.json)，遊戲與生成腳本共用。音檔已經生成在 `public/voice/`，要改台詞或換聲音才需要重新生成。

```powershell
# 金鑰擇一：寫進專案根目錄 .env（已在 .gitignore），或設在目前的 PowerShell 工作階段
$env:FISH_API_KEY = '<你的 Fish Audio 金鑰>'

npm run voice                                   # 只重生文字或聲音有變的台詞（依雜湊快取）
npm run voice -- --only go_shoot,clash_1 --force   # 強制重生指定台詞
npm run voice -- --voice announcer=<voiceId>    # 暫時換某個角色的聲音

$env:GROQ_API_KEY = '<你的 Groq 金鑰>'
npm run voice:check -- --only go_shoot          # 用 Whisper 聽寫抽查發音
```

目前使用的聲音都是 Fish Audio 官方（Fish Official）的公開聲音：

- 主播：じん。
- 玩家：男の子。
- 對手：さとる。

模型是免費的 `s2.1-pro-free`。如果要商用，請先確認 Fish Audio 的授權條款。方括號是 s2 系列的語氣標記（例如 `[shouting]`、`[excited]`），要用方括號，圓括號會被直接唸出來。

## 專案結構

| 路徑 | 內容 |
| --- | --- |
| `src/sim/` | 純邏輯：碗形場地、陀螺物理、碰撞衝量、爆裂／出場／停轉判定、計分、CPU。固定步長、可指定種子。 |
| `src/director/` | 鏡頭導演：決定全景、撞擊特寫、終結鏡頭與時間流速，以牆鐘時間推進。 |
| `src/render/` | Three.js 場景、陀螺模型與終結動畫、特效、後製 shader、鏡頭擺位。 |
| `src/audio/` | Web Audio 合成引擎、BGM、語音播放（頭尾靜音裁切、優先權、ducking）。 |
| `src/ui/` | DOM 覆蓋層：HUD、選角、發射量表、擬聲字、cut-in、結果畫面。 |
| `src/game/` | 狀態機與每幀迴圈，把模擬事件分派給特效、鏡頭、音效、語音。 |
| `scripts/` | 語音生成與抽查腳本、平衡報表。 |
| `tests/`、`e2e/` | 單元測試、Playwright 端對端測試。 |

## 已知限制

- 手機可以開啟、點選陀螺、點擊發射，但對戰中的推移（WASD）與必殺技（Space）目前只能用鍵盤，還沒有觸控按鈕；手機 GPU 的效能也還沒測過。
- 需要 WebGL；沒有 WebGL 的環境（部分遠端桌面、VS Code 內建瀏覽器）會顯示提示文字。
- 生成語音每次的語氣可能不同，不滿意可以用 `--only <id> --force` 重生單句。
