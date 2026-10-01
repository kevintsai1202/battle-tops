import { startServer } from './app';

/**
 * Battle Tops 線上對戰伺服器入口（設計見 docs/online-design.md）。
 * Zeabur 會注入 PORT（實際為 8080）；本機開發預設 8787。
 * ALLOWED_ORIGINS（逗號分隔）設定允許連線的網頁來源。
 */
const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://kevintsai1202.github.io,http://localhost:5173,http://localhost:4173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

void startServer({ port, allowedOrigins });
