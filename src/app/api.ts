import type { FutClub, GameMode, PackType, PlayerCard, ServerConfigPublic, SettleRoundResponse, StartRoundResponse, Wallet } from '@shared/types';
import { state } from './state';

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getPlayerId(): string {
  let id = localStorage.getItem('tbg.playerId');
  if (!id) { id = 'p' + uuid().slice(0, 24); localStorage.setItem('tbg.playerId', id); }
  return id;
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const MODES: GameMode[] = ['kickoff', 'futsal', 'fut', 'freekick'];

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `bad response (${res.status})` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `request failed (${res.status})`);
  return data as T;
}

/** The in-browser engine is used on static hosting (no outcome server) and as an offline fallback. */
async function local() { return (await import('./localEngine')); }

export const api = {
  config: async (): Promise<ServerConfigPublic> => {
    if (state.local) { const { localEngine: e } = await local(); return { modes: Object.fromEntries(MODES.map((m) => [m, e.paytable(m)])) as ServerConfigPublic['modes'], minStake: e.config.minStake, maxStake: e.config.maxStake, stakes: e.config.stakes, packs: e.config.packs }; }
    return call<ServerConfigPublic>('/api/config');
  },
  wallet: async () => {
    if (state.local) { const { localEngine: e } = await local(); return { wallet: e.wallet(getPlayerId()), nextServerSeedHash: await e.nextSeedHash(getPlayerId()) }; }
    return call<{ wallet: Wallet; nextServerSeedHash: string }>(`/api/wallet?playerId=${getPlayerId()}`);
  },
  history: async () => {
    if (state.local) { const { localEngine: e } = await local(); return { rounds: e.history(getPlayerId()) }; }
    return call<{ rounds: any[] }>(`/api/history?playerId=${getPlayerId()}`);
  },
  startRound: async (mode: GameMode, stake: number, homeTeamId?: string, awayTeamId?: string) => {
    const clientSeed = uuid().slice(0, 16);
    if (state.local) { const { localEngine: e } = await local(); const r = await e.startRound(getPlayerId(), mode, stake, clientSeed, homeTeamId, awayTeamId); return { ...structuredClone(r), clientSeed }; }
    return call<StartRoundResponse>('/api/round/start', { playerId: getPlayerId(), mode, stake, clientSeed, homeTeamId, awayTeamId }).then((r) => ({ ...r, clientSeed }));
  },
  settle: async (roundId: string) => {
    if (state.local) { const { localEngine: e } = await local(); return structuredClone(await e.settle(getPlayerId(), roundId)); }
    return call<SettleRoundResponse>('/api/round/settle', { playerId: getPlayerId(), roundId });
  },
  club: async () => {
    if (state.local) { const { localEngine: e } = await local(); return structuredClone({ club: e.club(getPlayerId()), wallet: e.wallet(getPlayerId()) }); }
    return call<{ club: FutClub; wallet: Wallet }>(`/api/fut/club?playerId=${getPlayerId()}`);
  },
  saveSquad: async (squad: Record<string, string | null>, clubName?: string) => {
    if (state.local) { const { localEngine: e } = await local(); return structuredClone({ club: e.saveSquad(getPlayerId(), squad, clubName) }); }
    return call<{ club: FutClub }>('/api/fut/squad', { playerId: getPlayerId(), squad, clubName });
  },
  openPack: async (type: PackType) => {
    if (state.local) { const { localEngine: e } = await local(); return structuredClone(e.openPack(getPlayerId(), type)); }
    return call<{ cards: PlayerCard[]; wallet: Wallet; club: FutClub }>('/api/fut/pack', { playerId: getPlayerId(), type });
  },
  opponent: async (seed: string) => {
    if (state.local) { const { localEngine: e } = await local(); return { squad: e.opponentSquad(getPlayerId(), seed) }; }
    return call<{ squad: PlayerCard[] }>(`/api/fut/opponent?playerId=${getPlayerId()}&seed=${encodeURIComponent(seed)}`);
  },
  adminGetRtp: async (token: string) => {
    if (state.local) { const { localEngine: e } = await local(); return { rtp: e.config.rtp }; }
    return call<{ rtp: Record<GameMode, number> }>(`/api/admin/rtp?token=${encodeURIComponent(token)}`);
  },
  adminSetRtp: async (token: string, mode: GameMode | 'all', rtp: number) => {
    if (state.local) { const { localEngine: e, persistLocalRtp } = await local(); e.setRtp(mode, rtp); persistLocalRtp(e.config.rtp); return { rtp: e.config.rtp }; }
    return call<{ rtp: Record<GameMode, number> }>('/api/admin/rtp', { token, mode, rtp });
  },
};
