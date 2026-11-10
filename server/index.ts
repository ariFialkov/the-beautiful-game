import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, DEFAULT_CONFIG } from './engine';
import type { GameMode, PackType, ServerConfigPublic } from '../shared/types';

const PORT = Number(process.env.PORT ?? 8787);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'change-me';
const MODES: GameMode[] = ['kickoff', 'futsal', 'fut', 'freekick'];

const config = structuredClone(DEFAULT_CONFIG);
if (process.env.RTP) for (const m of MODES) config.rtp[m] = Number(process.env.RTP);
for (const m of MODES) { const v = process.env[`RTP_${m.toUpperCase()}`]; if (v) config.rtp[m] = Number(v); }
const engine = createEngine(config);

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = [path.join(here, '..', 'dist'), path.join(here, 'dist'), path.join(process.cwd(), 'dist')].find((d) => fs.existsSync(path.join(d, 'index.html')));
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}
function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const pid = (v: unknown): string => { if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{6,64}$/.test(v)) throw new Error('invalid playerId'); return v; };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST' }); return res.end(); }

    if (url.pathname.startsWith('/api/')) {
      const route = `${req.method} ${url.pathname}`;
      switch (route) {
        case 'GET /api/config': {
          const body: ServerConfigPublic = { modes: Object.fromEntries(MODES.map((m) => [m, engine.paytable(m)])) as ServerConfigPublic['modes'], minStake: config.minStake, maxStake: config.maxStake, stakes: config.stakes, packs: config.packs };
          return json(res, 200, body);
        }
        case 'GET /api/wallet': { const id = pid(url.searchParams.get('playerId')); return json(res, 200, { wallet: engine.wallet(id), nextServerSeedHash: await engine.nextSeedHash(id) }); }
        case 'GET /api/history': { const id = pid(url.searchParams.get('playerId')); return json(res, 200, { rounds: engine.history(id) }); }
        case 'POST /api/round/start': {
          const b = await readBody(req);
          if (!MODES.includes(b.mode)) throw new Error('invalid mode');
          return json(res, 200, await engine.startRound(pid(b.playerId), b.mode, Number(b.stake), String(b.clientSeed ?? ''), b.homeTeamId, b.awayTeamId));
        }
        case 'POST /api/round/settle': { const b = await readBody(req); return json(res, 200, await engine.settle(pid(b.playerId), String(b.roundId))); }
        case 'GET /api/fut/club': { const id = pid(url.searchParams.get('playerId')); return json(res, 200, { club: engine.club(id), wallet: engine.wallet(id) }); }
        case 'POST /api/fut/squad': { const b = await readBody(req); return json(res, 200, { club: engine.saveSquad(pid(b.playerId), b.squad ?? {}, b.clubName) }); }
        case 'POST /api/fut/pack': { const b = await readBody(req); return json(res, 200, engine.openPack(pid(b.playerId), b.type as PackType)); }
        case 'GET /api/fut/opponent': { const id = pid(url.searchParams.get('playerId')); return json(res, 200, { squad: engine.opponentSquad(id, url.searchParams.get('seed') ?? String(Date.now())) }); }
        case 'POST /api/admin/rtp': {
          const b = await readBody(req);
          if (b.token !== ADMIN_TOKEN) return json(res, 403, { error: 'forbidden' });
          engine.setRtp(b.mode ?? 'all', Number(b.rtp));
          return json(res, 200, { rtp: config.rtp });
        }
        case 'GET /api/admin/rtp': {
          if (url.searchParams.get('token') !== ADMIN_TOKEN) return json(res, 403, { error: 'forbidden' });
          return json(res, 200, { rtp: config.rtp });
        }
        default: return json(res, 404, { error: 'not found' });
      }
    }

    // Static PWA (production): serve dist/ with SPA fallback.
    if (distDir && req.method === 'GET') {
      let p = path.normalize(path.join(distDir, decodeURIComponent(url.pathname)));
      if (!p.startsWith(distDir)) { res.writeHead(403); return res.end(); }
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(distDir, 'index.html');
      const ext = path.extname(p);
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' || p.endsWith('sw.js') ? 'no-cache' : 'public, max-age=31536000, immutable' });
      return fs.createReadStream(p).pipe(res);
    }
    res.writeHead(404); res.end('not found');
  } catch (e: any) {
    json(res, 400, { error: e?.message ?? 'error' });
  }
});

server.listen(PORT, () => {
  console.log(`[tbg] outcome server on http://localhost:${PORT}  RTP=${JSON.stringify(config.rtp)}  static=${distDir ?? 'none (dev)'}`);
});
