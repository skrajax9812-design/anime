/**
 * HindiAnime — static site + Renime API on one server.
 * - Serves ./public (the website)
 * - Mounts Renime API router (all /api/* endpoints) from ./renime-api
 */
const path = require('path');
const express = require('express');
const { setupRouter } = require('./renime-api/src/router');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

// Website static files FIRST so our index.html wins over Renime's landing page.
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Renime router: helmet (CSP relaxed), CORS, /api routes, fallback 403/404 pages.
setupRouter(app);

const PORT = parseInt(process.env.PORT || '3001', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`HindiAnime site + Renime API listening on http://0.0.0.0:${PORT}`);
  console.log(`  site: /   api: /api/health  /api/search?q=...`);
});
