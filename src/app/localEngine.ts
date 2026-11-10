import { Engine, DEFAULT_CONFIG, type CryptoProvider, type PlayerRecord, type StoreLike } from '@shared/engine';
import type { GameMode } from '@shared/types';

/** Browser-side outcome engine for static hosting (GitHub Pages) and offline demo play.
 *  Same code as the server engine; seeds and the wallet live in this browser only. */
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
const webCrypto: CryptoProvider = {
  sha256: async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s))),
  hmacSha256: async (key, msg) => { const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg))); },
  randomHex: (n) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer),
  uuid: () => (crypto.randomUUID ? crypto.randomUUID() : hex(crypto.getRandomValues(new Uint8Array(16)).buffer)),
};

class LocalStore implements StoreLike {
  players: Record<string, PlayerRecord> = {};
  private timer = 0;
  constructor() { try { const s = localStorage.getItem('tbg.localStore'); if (s) this.players = JSON.parse(s).players ?? {}; } catch { /* fresh */ } }
  save() { clearTimeout(this.timer); this.timer = window.setTimeout(() => { try { localStorage.setItem('tbg.localStore', JSON.stringify({ players: this.players })); } catch (e) { console.warn('local store', e); } }, 150); }
}

function loadConfig() {
  const cfg = structuredClone(DEFAULT_CONFIG);
  try { const r = localStorage.getItem('tbg.localRtp'); if (r) Object.assign(cfg.rtp, JSON.parse(r)); } catch { /* ignore */ }
  return cfg;
}

export const localEngine = new Engine(loadConfig(), new LocalStore(), webCrypto);
export function persistLocalRtp(rtp: Record<GameMode, number>) { localStorage.setItem('tbg.localRtp', JSON.stringify(rtp)); }
