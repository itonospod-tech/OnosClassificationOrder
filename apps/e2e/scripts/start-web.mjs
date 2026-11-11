/**
 * Starts a SECOND Vite dev server for apps/web on 5273 without touching the developer one on 5173:
 *  - loads apps/web/vite.config.js exactly as `vite` would (plugins, aliases), then overrides
 *  - its own dependency cache (apps/e2e/.vite-cache) — sharing node_modules/.vite with the running dev
 *    server could make one re-optimise under the other,
 *  - VITE_API_URL → the e2e API on 3107 (a variable already in process.env beats the .env files in Vite),
 *  - the Zalo proxy target → 3107.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..', '..', 'web');
const apiPort = process.env.E2E_API_PORT || '3107';
const port = Number(process.env.E2E_WEB_PORT || 5273);
// PostCSS / Tailwind look their config up from the working directory.
process.chdir(webDir);
process.env.VITE_API_URL = `http://localhost:${apiPort}/api`;

const require = createRequire(path.join(webDir, 'package.json'));
const viteDir = path.dirname(require.resolve('vite/package.json'));
const vite = await import(pathToFileURL(path.join(viteDir, 'dist', 'node', 'index.js')).href);
const loaded = await vite.loadConfigFromFile({ command: 'serve', mode: 'development' }, path.join(webDir, 'vite.config.js'), webDir);
const config = {
  ...loaded.config,
  configFile: false,
  root: webDir,
  envDir: webDir,
  cacheDir: path.resolve(here, '..', '.vite-cache'),
  clearScreen: false,
  server: {
    ...loaded.config.server,
    host: 'localhost',
    port,
    strictPort: true,
    proxy: { '/api/zalo-multi': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
};
const server = await vite.createServer(config);
await server.listen();
console.log(`[e2e web] vite on http://localhost:${port} → API ${process.env.VITE_API_URL}`);
