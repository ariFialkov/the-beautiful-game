import crypto from 'node:crypto';
import { Rng } from '../shared/rng';
import { buildPaytable, pickTier } from '../shared/paytable';
import { generateFreeKickScript, generateMatchScript } from '../shared/script';
import { TEAM_BY_ID, allPlayers, rosterOf, startingXI } from '../shared/teams';
import type { GameMode, ModePaytable, PackType, PlayerCard, RoundScript, FutClub, Wallet, MatchTier, FreeKickTier } from '../shared/types';
import { Store, type PlayerRecord, type StoredRound } from './store';

export interface EngineConfig {
  rtp: Record<GameMode, number>;
  minStake: number;
  maxStake: number;
  stakes: number[];
  startingBalance: number;
  packs: Record<PackType, { price: number; label: string }>;
}

export const DEFAULT_CONFIG: EngineConfig = {
  rtp: { kickoff: 0.96, futsal: 0.96, fut: 0.96, freekick: 0.96 },
  minStake: 10,
  maxStake: 1000,
  stakes: [10, 25, 50, 100, 250, 500, 1000],
  startingBalance: 10000,
  packs: {
    bronze: { price: 400, label: 'Bronze Pack' },
    silver: { price: 1200, label: 'Silver Pack' },
    gold: { price: 3500, label: 'Gold Pack' },
    elite: { price: 9000, label: 'Elite Pack' },
  },
};

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key: string, msg: string) => crypto.createHmac('sha256', key).update(msg).digest('hex');
const newSeed = () => crypto.randomBytes(32).toString('hex');

export class Engine {
  readonly store = new Store();
  constructor(public config: EngineConfig) {}

  paytable(mode: GameMode): ModePaytable { return buildPaytable(mode, this.config.rtp[mode]); }

  setRtp(mode: GameMode | 'all', rtp: number) {
    if (!(rtp > 0 && rtp < 1)) throw new Error('rtp must be in (0,1)');
    const modes: GameMode[] = mode === 'all' ? ['kickoff', 'futsal', 'fut', 'freekick'] : [mode];
    for (const m of modes) { buildPaytable(m, rtp); }
    for (const m of modes) this.config.rtp[m] = rtp;
  }

  player(playerId: string): PlayerRecord {
    let p = this.store.players[playerId];
    if (!p) {
      p = {
        wallet: { playerId, balance: this.config.startingBalance, currency: 'CR' },
        club: this.starterClub(playerId),
        nonce: 0,
        nextServerSeed: newSeed(),
        rounds: {},
      };
      this.store.players[playerId] = p;
      this.store.save();
    }
    return p;
  }

  wallet(playerId: string): Wallet { return this.player(playerId).wallet; }
  nextSeedHash(playerId: string): string { return sha256(this.player(playerId).nextServerSeed); }

  startRound(playerId: string, mode: GameMode, stake: number, clientSeed: string, homeTeamId?: string, awayTeamId?: string) {
    const p = this.player(playerId);
    if (!Number.isFinite(stake) || stake < this.config.minStake || stake > this.config.maxStake) throw new Error(`stake must be between ${this.config.minStake} and ${this.config.maxStake}`);
    if (p.wallet.balance < stake) throw new Error('insufficient balance');
    if (!clientSeed || clientSeed.length > 64) throw new Error('invalid client seed');

    // Auto-settle anything left pending (e.g. player closed the app mid-match): the outcome was fixed at start.
    for (const r of Object.values(p.rounds)) if (!r.settledAt) this.settle(playerId, r.id);

    const serverSeed = p.nextServerSeed;
    const nonce = ++p.nonce;
    const digest = hmac(serverSeed, `${clientSeed}:${nonce}`);
    const u = parseInt(digest.slice(0, 13), 16) / 0x20000000000000; // 52 bits -> [0,1)
    const paytable = this.paytable(mode);
    const entry = pickTier(paytable, u);
    const rng = new Rng(digest.slice(13));

    let script: RoundScript;
    if (mode === 'freekick') {
      script = generateFreeKickScript(rng, entry.tier as FreeKickTier, entry.multiplier);
    } else {
      const home = homeTeamId ? TEAM_BY_ID[homeTeamId] : undefined;
      const away = awayTeamId ? TEAM_BY_ID[awayTeamId] : undefined;
      const diff = ((away?.rating ?? 80) - (home?.rating ?? 80)) / 20;
      const botStrength = Math.max(0.25, Math.min(0.9, 0.55 + diff * 0.5));
      script = generateMatchScript(rng, mode, entry.tier as MatchTier, entry.multiplier, botStrength);
    }

    p.wallet.balance -= stake;
    const round: StoredRound = {
      id: crypto.randomUUID(), playerId, mode, stake, clientSeed, serverSeed, serverSeedHash: sha256(serverSeed), nonce,
      tier: entry.tier, multiplier: entry.multiplier, script, createdAt: Date.now(), settledAt: null, payout: Math.round(stake * entry.multiplier * 100) / 100,
    };
    p.rounds[round.id] = round;
    p.nextServerSeed = newSeed();
    this.store.save();
    return { roundId: round.id, nonce, serverSeedHash: round.serverSeedHash, script, wallet: p.wallet };
  }

  settle(playerId: string, roundId: string) {
    const p = this.player(playerId);
    const r = p.rounds[roundId];
    if (!r) throw new Error('unknown round');
    if (!r.settledAt) {
      r.settledAt = Date.now();
      p.wallet.balance += r.payout;
      // keep history bounded
      const ids = Object.keys(p.rounds);
      if (ids.length > 50) for (const id of ids.slice(0, ids.length - 50)) delete p.rounds[id];
      this.store.save();
    }
    return {
      roundId, payout: r.payout, multiplier: r.multiplier, tier: r.tier, wallet: p.wallet,
      serverSeed: r.serverSeed, clientSeed: r.clientSeed, nonce: r.nonce, nextServerSeedHash: sha256(p.nextServerSeed),
    };
  }

  history(playerId: string) {
    return Object.values(this.player(playerId).rounds).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
      .map((r) => ({ id: r.id, mode: r.mode, stake: r.stake, tier: r.tier, multiplier: r.multiplier, payout: r.payout, settled: !!r.settledAt, createdAt: r.createdAt, serverSeedHash: r.serverSeedHash, serverSeed: r.settledAt ? r.serverSeed : null, clientSeed: r.clientSeed, nonce: r.nonce }));
  }

  /* ------------------------------ FUT ------------------------------ */
  private starterClub(playerId: string): FutClub {
    // A playable starter squad: pick a balanced XI of bronze/silver players spread across clubs.
    const pool = allPlayers().filter((c) => c.rating >= 56 && c.rating <= 70);
    const rng = new Rng(`starter:${playerId}`);
    const slots = ['GK', 'RB', 'CB1', 'CB2', 'LB', 'CDM', 'CM1', 'CM2', 'RW', 'ST', 'LW'];
    const want = ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CM', 'CAM', 'RW', 'ST', 'LW'];
    const squad: Record<string, string | null> = {}; const xi: PlayerCard[] = [];
    slots.forEach((s, i) => { const cands = pool.filter((c) => c.position === want[i] && !xi.includes(c)); const pick = cands.length ? rng.pick(cands) : rng.pick(pool.filter((c) => !xi.includes(c))); xi.push(pick); squad[s] = pick.id; });
    return { playerId, cards: xi.map((c) => c.id), squad, formation: '4-3-3', clubName: 'My Club' };
  }

  club(playerId: string): FutClub { return this.player(playerId).club; }

  saveSquad(playerId: string, squad: Record<string, string | null>, clubName?: string): FutClub {
    const p = this.player(playerId);
    const owned = new Set(p.club.cards);
    for (const [slot, id] of Object.entries(squad)) if (id !== null && !owned.has(id)) throw new Error(`card ${id} not owned (slot ${slot})`);
    const dup = new Set<string>();
    for (const id of Object.values(squad)) { if (id === null) continue; if (dup.has(id)) throw new Error('duplicate card in squad'); dup.add(id); }
    p.club.squad = squad;
    if (clubName) p.club.clubName = clubName.slice(0, 24);
    this.store.save();
    return p.club;
  }

  openPack(playerId: string, type: PackType): { cards: PlayerCard[]; wallet: Wallet; club: FutClub } {
    const p = this.player(playerId);
    const pack = this.config.packs[type];
    if (!pack) throw new Error('unknown pack');
    if (p.wallet.balance < pack.price) throw new Error('insufficient balance');
    p.wallet.balance -= pack.price;
    const pool = allPlayers();
    const rng = new Rng(crypto.randomBytes(8).toString('hex'));
    const draw = (min: number, max: number) => rng.pick(pool.filter((c) => c.rating >= min && c.rating <= max));
    const cards: PlayerCard[] = [];
    const spec: Record<PackType, Array<[number, number]>> = {
      bronze: [[55, 68], [55, 70], [55, 72]],
      silver: [[64, 76], [66, 78], [66, 78], [70, 80]],
      gold: [[74, 84], [75, 84], [75, 85], [78, 86], [80, 92]],
      elite: [[80, 86], [82, 88], [82, 90], [84, 92], [86, 95]],
    };
    for (const [lo, hi] of spec[type]) cards.push(draw(lo, hi));
    for (const c of cards) if (!p.club.cards.includes(c.id)) p.club.cards.push(c.id);
    this.store.save();
    return { cards, wallet: p.wallet, club: p.club };
  }

  /** Opponent Ultimate Team: a bot squad near the player's squad rating. */
  opponentSquad(playerId: string, seed: string): PlayerCard[] {
    const p = this.player(playerId);
    const own = Object.values(p.club.squad).filter((x): x is string => !!x).map((id) => pool(id)).filter((x): x is PlayerCard => !!x);
    const avg = own.length ? own.reduce((s, c) => s + c.rating, 0) / own.length : 70;
    const rng = new Rng(`opp:${seed}`);
    const candidates = allPlayers().filter((c) => Math.abs(c.rating - avg) <= 6);
    return startingXI(rng.shuffle(candidates.slice()).slice(0, 150));
  }
}

function pool(id: string): PlayerCard | undefined { const teamId = id.split(':')[0]; return rosterOf(teamId)?.find((c) => c.id === id); }
