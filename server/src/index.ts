import { startServer } from './app';

/**
 * Battle Tops 線上對戰伺服器入口（設計見 docs/online-design.md）。
 * Zeabur 會注入 PORT（實際為 8080）；本機開發預設 8787。
 * ALLOWED_ORIGINS（逗號分隔）設定允許連線的網頁來源；ARRANGE_MS 設定組隊第 2 步的時間限制（測試用）。
 */
const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://kevintsai1202.github.io,http://localhost:5173,http://localhost:4173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** 組隊第 2 步的時間限制（毫秒）：正式環境用預設 60 秒，e2e 用環境變數 ARRANGE_MS 縮短 */
const arrangeMs = process.env.ARRANGE_MS ? Number(process.env.ARRANGE_MS) : undefined;

void startServer({ port, allowedOrigins, arrangeMs });
