import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FutClub, Wallet, RoundScript } from '../shared/types';

export interface StoredRound {
  id: string;
  playerId: string;
  mode: string;
  stake: number;
  clientSeed: string;
  serverSeed: string;
  serverSeedHash: string;
  nonce: number;
  tier: string;
  multiplier: number;
  script: RoundScript;
  createdAt: number;
  settledAt: number | null;
  payout: number;
}

export interface PlayerRecord {
  wallet: Wallet;
  club: FutClub;
  nonce: number;
  nextServerSeed: string;
  rounds: Record<string, StoredRound>;
}

interface StoreShape { players: Record<string, PlayerRecord>; }

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const file = path.join(dir, 'store.json');

export class Store {
  private data: StoreShape = { players: {} };
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    try {
      if (fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { console.warn('[store] could not load store, starting fresh', e); }
  }
  get players() { return this.data.players; }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(this.data)); } catch (e) { console.warn('[store] save failed', e); }
    }, 250);
  }
}
