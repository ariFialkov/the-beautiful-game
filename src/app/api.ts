import type { FutClub, GameMode, PackType, PlayerCard, ServerConfigPublic, SettleRoundResponse, StartRoundResponse, Wallet } from '@shared/types';

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function getPlayerId(): string {
  let id = localStorage.getItem('tbg.playerId');
  if (!id) { id = 'p' + uuid().slice(0, 24); localStorage.setItem('tbg.playerId', id); }
  return id;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `bad response (${res.status})` }));
  if (!res.ok || data.error) throw new Error(data.error ?? `request failed (${res.status})`);
  return data as T;
}

export const api = {
  config: () => call<ServerConfigPublic>('/api/config'),
  wallet: () => call<{ wallet: Wallet; nextServerSeedHash: string }>(`/api/wallet?playerId=${getPlayerId()}`),
  history: () => call<{ rounds: any[] }>(`/api/history?playerId=${getPlayerId()}`),
  startRound: (mode: GameMode, stake: number, homeTeamId?: string, awayTeamId?: string) => {
    const clientSeed = uuid().slice(0, 16);
    return call<StartRoundResponse>('/api/round/start', { playerId: getPlayerId(), mode, stake, clientSeed, homeTeamId, awayTeamId }).then((r) => ({ ...r, clientSeed }));
  },
  settle: (roundId: string) => call<SettleRoundResponse>('/api/round/settle', { playerId: getPlayerId(), roundId }),
  club: () => call<{ club: FutClub; wallet: Wallet }>(`/api/fut/club?playerId=${getPlayerId()}`),
  saveSquad: (squad: Record<string, string | null>, clubName?: string) => call<{ club: FutClub }>('/api/fut/squad', { playerId: getPlayerId(), squad, clubName }),
  openPack: (type: PackType) => call<{ cards: PlayerCard[]; wallet: Wallet; club: FutClub }>('/api/fut/pack', { playerId: getPlayerId(), type }),
  opponent: (seed: string) => call<{ squad: PlayerCard[] }>(`/api/fut/opponent?playerId=${getPlayerId()}&seed=${encodeURIComponent(seed)}`),
  adminGetRtp: (token: string) => call<{ rtp: Record<GameMode, number> }>(`/api/admin/rtp?token=${encodeURIComponent(token)}`),
  adminSetRtp: (token: string, mode: GameMode | 'all', rtp: number) => call<{ rtp: Record<GameMode, number> }>('/api/admin/rtp', { token, mode, rtp }),
};
