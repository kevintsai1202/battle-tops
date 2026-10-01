# 線上對戰伺服器

Battle Tops 線上對戰的權威伺服器（Node.js＋ws），設計見 [docs/online-design.md](../docs/online-design.md)。

## Zeabur Deployment
- Project ID: 6abd618f454b8f31a5eff9e8（battle-tops，東京騰訊主機 server-69c0fc8a4fe7cb44c896c3e5）
- Service ID: 6abd61c9454b8f31a5eff9f9（battle-tops-server）
- Environment ID: 6abd618f6a5a32a7a9bb30a8
- 網址：https://battle-tops.zeabur.app（WebSocket：wss://battle-tops.zeabur.app/ws）

## 規則
- 部署一律用 `.\scripts\deploy-server.ps1`（會帶上既有服務 ID；不要直接 `zeabur deploy` 不帶 `--service-id`，會重複建服務）。
- 服務必須保留環境變數 `ZBPACK_DOCKERFILE_PATH=Dockerfile`，否則 Zeabur 會把部署目錄當靜態網站。
- 伺服器共用前端的 `src/sim/`、`src/director/`、`src/net/`；型別檢查用 `npm run typecheck:server`（`npm run build` 已包含）。
- 主機記憶體吃緊（其他專案約用 83%），不要在伺服器常駐大型快取。
