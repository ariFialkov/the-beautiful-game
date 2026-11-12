import type { GameMode, ModePaytable, PaytableEntry } from './types';

/** Paying outcomes per mode. `weight` fixes the relative shape of the paying outcomes;
 *  the solver scales all of them so the expected return equals the configured RTP, and
 *  the remainder of the probability mass is the losing outcome. */
const SHAPES: Record<GameMode, Array<{ tier: string; label: string; multiplier: number; weight: number }>> = {
  kickoff: [
    { tier: 'draw', label: 'Draw', multiplier: 1.0, weight: 0.22 },
    { tier: 'win', label: 'Win', multiplier: 2.2, weight: 0.25 },
  ],
  // (No 'win by N goals' outcome: a margin the player must score their way to can't be guaranteed honestly.)
  // Futsal has no draws: a level game goes to sudden death (3v3, then 2v2, then 1v1). A sudden-death win pays less
  // than a win in normal time; a sudden-death defeat is a loss.
  futsal: [
    { tier: 'otwin', label: 'Win in sudden death', multiplier: 1.6, weight: 0.12 },
    { tier: 'win', label: 'Win', multiplier: 2.2, weight: 0.27 },
  ],
  fut: [
    { tier: 'draw', label: 'Draw', multiplier: 1.0, weight: 0.22 },
    { tier: 'win', label: 'Win', multiplier: 2.2, weight: 0.25 },
  ],
  freekick: [
    { tier: 'win', label: 'Win the duel', multiplier: 1.92, weight: 0.5 },
  ],
};

export function buildPaytable(mode: GameMode, rtp: number): ModePaytable {
  const shape = SHAPES[mode];
  const ev = shape.reduce((s, e) => s + e.weight * e.multiplier, 0);
  const k = rtp / ev;
  const entries: PaytableEntry[] = shape.map((e) => ({ tier: e.tier, label: e.label, multiplier: e.multiplier, probability: e.weight * k }));
  const paying = entries.reduce((s, e) => s + e.probability, 0);
  if (paying > 1) throw new Error(`RTP ${rtp} for ${mode} is not achievable with the current paytable shape`);
  entries.unshift({ tier: 'loss', label: 'Loss', multiplier: 0, probability: 1 - paying });
  return { mode, rtp, entries };
}

/** Map a uniform random number in [0,1) to an outcome tier using the paytable. */
export function pickTier(paytable: ModePaytable, u: number): PaytableEntry {
  let acc = 0;
  for (const e of paytable.entries) { acc += e.probability; if (u < acc) return e; }
  return paytable.entries[0];
}

export function expectedReturn(paytable: ModePaytable): number {
  return paytable.entries.reduce((s, e) => s + e.probability * e.multiplier, 0);
}
