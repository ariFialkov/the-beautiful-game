import type { V2 } from './pitch';

/** A formation slot: a role and a base position (x from own goal -1 to the opponents' goal +1, z across -1..1). */
export interface Slot { role: string; x: number; z: number; }
export interface Formation { id: string; label: string; slots: Slot[]; }

const BACK4: Slot[] = [{ role: 'RB', x: -0.55, z: 0.72 }, { role: 'CB', x: -0.62, z: 0.25 }, { role: 'CB', x: -0.62, z: -0.25 }, { role: 'LB', x: -0.55, z: -0.72 }];
const BACK3: Slot[] = [{ role: 'CB', x: -0.62, z: 0.42 }, { role: 'CB', x: -0.65, z: 0 }, { role: 'CB', x: -0.62, z: -0.42 }];
const GK: Slot = { role: 'GK', x: -0.95, z: 0 };

/** 11-a-side shapes. Slot order doesn't need to match between them: players are fitted to slots by position. */
export const FORMATIONS_11: Formation[] = [
  { id: '4-3-3', label: '4-3-3', slots: [GK, ...BACK4, { role: 'CDM', x: -0.3, z: 0 }, { role: 'CM', x: -0.12, z: 0.35 }, { role: 'CAM', x: -0.1, z: -0.35 }, { role: 'RW', x: 0.3, z: 0.65 }, { role: 'ST', x: 0.4, z: 0 }, { role: 'LW', x: 0.3, z: -0.65 }] },
  { id: '4-4-2', label: '4-4-2', slots: [GK, ...BACK4, { role: 'RM', x: -0.1, z: 0.68 }, { role: 'CM', x: -0.2, z: 0.2 }, { role: 'CM', x: -0.2, z: -0.2 }, { role: 'LM', x: -0.1, z: -0.68 }, { role: 'ST', x: 0.36, z: 0.2 }, { role: 'ST', x: 0.38, z: -0.2 }] },
  { id: '4-2-3-1', label: '4-2-3-1', slots: [GK, ...BACK4, { role: 'CDM', x: -0.3, z: 0.2 }, { role: 'CDM', x: -0.3, z: -0.2 }, { role: 'RM', x: 0.12, z: 0.62 }, { role: 'CAM', x: 0.1, z: 0 }, { role: 'LM', x: 0.12, z: -0.62 }, { role: 'ST', x: 0.4, z: 0 }] },
  { id: '4-1-2-1-2', label: '4-1-2-1-2', slots: [GK, ...BACK4, { role: 'CDM', x: -0.32, z: 0 }, { role: 'CM', x: -0.14, z: 0.36 }, { role: 'CM', x: -0.14, z: -0.36 }, { role: 'CAM', x: 0.1, z: 0 }, { role: 'ST', x: 0.38, z: 0.2 }, { role: 'ST', x: 0.38, z: -0.2 }] },
  { id: '3-5-2', label: '3-5-2', slots: [GK, ...BACK3, { role: 'RWB', x: -0.22, z: 0.78 }, { role: 'CDM', x: -0.3, z: 0 }, { role: 'CM', x: -0.12, z: 0.3 }, { role: 'CM', x: -0.12, z: -0.3 }, { role: 'LWB', x: -0.22, z: -0.78 }, { role: 'ST', x: 0.36, z: 0.2 }, { role: 'ST', x: 0.38, z: -0.2 }] },
  { id: '3-4-3', label: '3-4-3', slots: [GK, ...BACK3, { role: 'RM', x: -0.14, z: 0.72 }, { role: 'CM', x: -0.22, z: 0.22 }, { role: 'CM', x: -0.22, z: -0.22 }, { role: 'LM', x: -0.14, z: -0.72 }, { role: 'RW', x: 0.3, z: 0.6 }, { role: 'ST', x: 0.4, z: 0 }, { role: 'LW', x: 0.3, z: -0.6 }] },
  { id: '5-3-2', label: '5-3-2', slots: [GK, { role: 'RWB', x: -0.48, z: 0.8 }, { role: 'CB', x: -0.62, z: 0.38 }, { role: 'CB', x: -0.65, z: 0 }, { role: 'CB', x: -0.62, z: -0.38 }, { role: 'LWB', x: -0.48, z: -0.8 }, { role: 'CM', x: -0.2, z: 0.38 }, { role: 'CDM', x: -0.28, z: 0 }, { role: 'CM', x: -0.2, z: -0.38 }, { role: 'ST', x: 0.34, z: 0.2 }, { role: 'ST', x: 0.36, z: -0.2 }] },
];
/** Futsal shapes (four outfield players). */
export const FORMATIONS_FUTSAL: Formation[] = [
  { id: '1-2-1', label: '1-2-1 Diamond', slots: [{ role: 'GK', x: -0.9, z: 0 }, { role: 'CB', x: -0.45, z: 0 }, { role: 'RM', x: -0.05, z: 0.6 }, { role: 'LM', x: -0.05, z: -0.6 }, { role: 'ST', x: 0.4, z: 0 }] },
  { id: '2-2', label: '2-2 Square', slots: [{ role: 'GK', x: -0.9, z: 0 }, { role: 'CB', x: -0.42, z: 0.45 }, { role: 'CB', x: -0.42, z: -0.45 }, { role: 'RW', x: 0.22, z: 0.45 }, { role: 'LW', x: 0.22, z: -0.45 }] },
  { id: '3-1', label: '3-1', slots: [{ role: 'GK', x: -0.9, z: 0 }, { role: 'CB', x: -0.45, z: 0 }, { role: 'RB', x: -0.28, z: 0.65 }, { role: 'LB', x: -0.28, z: -0.65 }, { role: 'ST', x: 0.4, z: 0 }] },
];

/** -2 Ultra defensive .. +2 Ultra attacking. */
export type Mentality = -2 | -1 | 0 | 1 | 2;
export type Pressing = 'low' | 'mid' | 'high';
export type Width = 'narrow' | 'balanced' | 'wide';
export type BuildUp = 'short' | 'balanced' | 'direct';
export interface Tactics { formation: string; mentality: Mentality; pressing: Pressing; width: Width; buildUp: BuildUp; }

export const DEFAULT_TACTICS: Tactics = { formation: '4-3-3', mentality: 0, pressing: 'mid', width: 'balanced', buildUp: 'balanced' };
export const DEFAULT_TACTICS_FUTSAL: Tactics = { ...DEFAULT_TACTICS, formation: '1-2-1' };

export const TACTIC_OPTIONS = {
  mentality: [{ id: '-2', label: 'Ultra defensive' }, { id: '-1', label: 'Defensive' }, { id: '0', label: 'Balanced' }, { id: '1', label: 'Attacking' }, { id: '2', label: 'Ultra attacking' }],
  pressing: [{ id: 'low', label: 'Drop off' }, { id: 'mid', label: 'Balanced' }, { id: 'high', label: 'High press' }],
  width: [{ id: 'narrow', label: 'Narrow' }, { id: 'balanced', label: 'Balanced' }, { id: 'wide', label: 'Wide' }],
  buildUp: [{ id: 'short', label: 'Short passing' }, { id: 'balanced', label: 'Balanced' }, { id: 'direct', label: 'Direct' }],
};
export const TACTIC_HINTS = {
  mentality: 'How many bodies go forward, and how high the whole team sits.',
  pressing: 'Drop off: hold the shape and let them come. High press: close them down everywhere, with a high line.',
  width: 'How far the team spreads across the pitch with the ball.',
  buildUp: 'Short: patient passes to feet. Direct: early balls forward and in behind.',
};

export function formationsFor(futsal: boolean) { return futsal ? FORMATIONS_FUTSAL : FORMATIONS_11; }
export function formationById(id: string, futsal: boolean): Formation { const fs = formationsFor(futsal); return fs.find((f) => f.id === id) ?? fs[0]; }
export function normalizeTactics(t: Partial<Tactics> | undefined, futsal: boolean): Tactics {
  const base = futsal ? DEFAULT_TACTICS_FUTSAL : DEFAULT_TACTICS; const o = { ...base, ...(t ?? {}) };
  o.formation = formationById(o.formation, futsal).id; o.mentality = Math.max(-2, Math.min(2, Math.round(Number(o.mentality) || 0))) as Mentality;
  return o;
}

/** A team's own way of playing (for the bots): picked from its identity, so a club always lines up the same way. */
export function teamTactics(teamId: string, rating: number, futsal: boolean): Tactics {
  let h = 2166136261; for (let i = 0; i < teamId.length; i++) { h ^= teamId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const pick = <T>(xs: readonly T[], salt: number) => xs[((h >>> salt) ^ (h >>> (salt + 7))) % xs.length];
  const fs = formationsFor(futsal);
  // the better sides tend to keep the ball and press; the weaker ones sit deeper and go direct
  const strong = rating >= 82, weak = rating < 76;
  return {
    formation: pick(fs.map((f) => f.id), 3),
    mentality: (strong ? pick([0, 1, 1], 5) : weak ? pick([-1, 0, 0], 5) : pick([-1, 0, 0, 1], 5)) as Mentality,
    pressing: strong ? pick(['mid', 'high', 'high'] as const, 9) : weak ? pick(['low', 'low', 'mid'] as const, 9) : pick(['low', 'mid', 'mid', 'high'] as const, 9),
    width: pick(['narrow', 'balanced', 'balanced', 'wide'] as const, 13),
    buildUp: strong ? pick(['short', 'short', 'balanced'] as const, 17) : weak ? pick(['direct', 'balanced'] as const, 17) : pick(['short', 'balanced', 'direct'] as const, 17),
  };
}

const LINE: Record<string, number> = { GK: 0, CB: 1, RB: 1, LB: 1, RWB: 1.5, LWB: 1.5, CDM: 2, CM: 2, RM: 2.5, LM: 2.5, CAM: 2.6, RW: 3, LW: 3, ST: 3.2 };
const SIDE: Record<string, number> = { RB: 1, RWB: 1, RM: 1, RW: 1, LB: -1, LWB: -1, LM: -1, LW: -1 };

/** Fit players to a formation's slots: each keeps a slot near where he was playing, and that suits his position.
 *  `from` is each player's current base spot, `positions` his natural position; returns a slot index per player. */
export function fitSlots(from: V2[], positions: string[], slots: Slot[]): number[] {
  const n = from.length; const out = new Array<number>(n).fill(-1); const used = new Set<number>();
  const cost = (i: number, s: number) => {
    const sl = slots[s]; const p = positions[i];
    const dl = Math.abs((LINE[p] ?? 2) - (LINE[sl.role] ?? 2)); const ds = (SIDE[p] ?? 0) * (SIDE[sl.role] ?? 0) < 0 ? 0.6 : 0;
    return Math.hypot(from[i].x - sl.x, from[i].z - sl.z) + dl * 0.35 + ds + (p === sl.role ? -0.15 : 0);
  };
  // the keeper stays in goal
  for (let i = 0; i < n; i++) if (positions[i] === 'GK' || i === 0) { const g = slots.findIndex((s) => s.role === 'GK'); if (g >= 0 && !used.has(g) && i === 0) { out[i] = g; used.add(g); } }
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) if (out[i] < 0) for (let s = 0; s < slots.length; s++) if (slots[s].role !== 'GK') pairs.push([cost(i, s), i, s]);
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [, i, s] of pairs) if (out[i] < 0 && !used.has(s)) { out[i] = s; used.add(s); }
  // then swap any two players whose swap lowers the total (the greedy pass can cross a winger over to the other flank)
  for (let pass = 0, better = true; better && pass < 20; pass++) {
    better = false;
    for (let i = 1; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (out[i] < 0 || out[j] < 0) continue;
      if (cost(i, out[j]) + cost(j, out[i]) < cost(i, out[i]) + cost(j, out[j]) - 1e-9) { const t = out[i]; out[i] = out[j]; out[j] = t; better = true; }
    }
  }
  return out;
}
