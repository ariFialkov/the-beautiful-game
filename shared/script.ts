import { Rng } from './rng';
import type { FreeKickRoundPlan, FreeKickScript, GoalEvent, MatchScript, MatchTier, FreeKickTier, Side, ShotStyle, MissStyle } from './types';

export const MATCH_DURATIONS: Record<'kickoff' | 'futsal' | 'fut', number> = { kickoff: 330, fut: 330, futsal: 170 };
export const CLOCK_MINUTES: Record<'kickoff' | 'futsal' | 'fut', number> = { kickoff: 90, fut: 90, futsal: 40 };

/** Decide the final score for a tier. The home side is the human player. */
function pickScore(rng: Rng, mode: 'kickoff' | 'futsal' | 'fut', tier: MatchTier): { home: number; away: number } {
  const futsal = mode === 'futsal';
  const loserGoals = futsal ? rng.weighted([[0, 0.15], [1, 0.3], [2, 0.3], [3, 0.18], [4, 0.07]] as const) : rng.weighted([[0, 0.45], [1, 0.38], [2, 0.14], [3, 0.03]] as const);
  switch (tier) {
    case 'draw': {
      const g = futsal ? rng.weighted([[1, 0.2], [2, 0.35], [3, 0.3], [4, 0.15]] as const) : rng.weighted([[0, 0.15], [1, 0.45], [2, 0.3], [3, 0.1]] as const);
      return { home: g, away: g };
    }
    case 'loss': { const d = rng.weighted([[1, 0.55], [2, 0.32], [3, 0.13]] as const); return { home: loserGoals, away: loserGoals + d }; }
    case 'win': { const d = rng.weighted([[1, 0.62], [2, 0.38]] as const); return { home: loserGoals + d, away: loserGoals }; }
    case 'bigwin': { const d = rng.weighted([[3, 0.6], [4, 0.3], [5, 0.1]] as const); return { home: Math.min(loserGoals, 2) + d, away: Math.min(loserGoals, 2) }; }
    case 'otwin': return pickScore(rng, mode, 'draw'); // level after regulation; decided in sudden death
  }
}

function drama(order: Side[], tier: MatchTier): number {
  // Reward sequences where the eventual result was in doubt: lead changes, trailing winners, late equalisers.
  let h = 0, a = 0, score = 0, prevLead = 0;
  const winner: Side | null = tier === 'draw' || tier === 'otwin' ? null : tier === 'loss' ? 'away' : 'home';
  order.forEach((s, i) => {
    if (s === 'home') h++; else a++;
    const lead = Math.sign(h - a);
    if (lead !== prevLead && prevLead !== 0) score += 2; // lead change / equaliser
    if (winner && lead !== 0 && (lead > 0 ? 'home' : 'away') !== winner) score += 1.5; // winner trailing
    if (i === order.length - 1 && lead === 0 && winner === null) score += 1; // late equaliser in a draw
    prevLead = lead;
  });
  return score;
}

export function generateMatchScript(rng: Rng, mode: 'kickoff' | 'futsal' | 'fut', tier: MatchTier, multiplier: number, botStrength: number): MatchScript {
  // Futsal sudden death: a sudden-death win, or now and then a defeat, comes after a level regulation game.
  const otSide: Side | null = mode === 'futsal' ? (tier === 'otwin' ? 'home' : tier === 'loss' && rng.bool(0.25) ? 'away' : null) : null;
  const finalScore = otSide ? pickScore(rng, mode, 'draw') : pickScore(rng, mode, tier);
  const total = finalScore.home + finalScore.away;
  const sides: Side[] = [...Array(finalScore.home).fill('home' as Side), ...Array(finalScore.away).fill('away' as Side)];

  // Choose the most dramatic of several candidate goal orders (with a little randomness so it is not always the max).
  let best: Side[] = sides.slice(); let bestScore = -1;
  for (let i = 0; i < 8; i++) {
    const cand = rng.shuffle(sides.slice());
    const s = drama(cand, otSide ? 'draw' : tier) + rng.range(0, 1.2);
    if (s > bestScore) { bestScore = s; best = cand; }
  }

  // Times: spread through the match with minimum spacing, avoiding the very start and leaving room for stoppage drama.
  const times: number[] = [];
  let guard = 0;
  while (times.length < total && guard++ < 500) {
    const t = rng.range(0.05, 0.96);
    if (times.every((x) => Math.abs(x - t) > 0.06)) times.push(t);
  }
  times.sort((a, b) => a - b);
  const styles: GoalEvent['style'][] = ['open', 'counter', 'longshot', 'header', 'scramble'];
  const events: GoalEvent[] = best.map((side, i) => ({ t: times[i] ?? Math.min(0.97, 0.1 + i * 0.1), side, style: rng.weighted(styles.map((s, k) => [s, [0.4, 0.25, 0.15, 0.1, 0.1][k]] as const)) }));
  if (otSide) {
    // when the golden goal comes: during 3v3 (first 15 s), 2v2 (next 15 s) or 1v1
    const at = rng.weighted([[0, 0.45], [1, 0.35], [2, 0.2]] as const) === 0 ? rng.range(4, 13.5) : rng.bool(0.35 / 0.55) ? rng.range(16.5, 28.5) : rng.range(32, 45);
    finalScore[otSide]++;
    return { kind: 'match', mode, tier, multiplier, finalScore, events, durationSec: MATCH_DURATIONS[mode], botStrength, overtime: { side: otSide, at } };
  }
  return { kind: 'match', mode, tier, multiplier, finalScore, events, durationSec: MATCH_DURATIONS[mode], botStrength };
}

const SHOTS: ShotStyle[] = ['curl', 'power', 'chip', 'driven'];
const MISSES: MissStyle[] = ['post', 'bar', 'over', 'wide', 'saved', 'wall'];

/** Build the reactive free-kick decision tree. The player always shoots first in a round.
 *  Loss: bot answers every player goal and the duel ends on a round where the keeper is guaranteed to stop the player.
 *  Win: bot misses whenever the player scores; the duel ends on a round where the player's shot is guaranteed in. */
export function generateFreeKickScript(rng: Rng, tier: FreeKickTier, multiplier: number): FreeKickScript {
  const situation = { distance: rng.range(18, 30), angleDeg: rng.range(-32, 32), wallSize: rng.int(3, 5), keeperBias: rng.range(-0.35, 0.35) };
  const maxRounds = rng.weighted([[2, 0.3], [3, 0.4], [4, 0.2], [5, 0.1]] as const);
  const rounds: FreeKickRoundPlan[] = [];
  for (let r = 0; r < maxRounds; r++) {
    const last = r === maxRounds - 1;
    const botShot = rng.pick(SHOTS);
    const botMiss = rng.weighted(MISSES.map((m) => [m, m === 'saved' ? 0.3 : m === 'wall' ? 0.1 : 0.15] as const));
    if (tier === 'loss') {
      // Keep the round alive when the player misses early on; the final round is decisive.
      const prolong = !last && rng.bool([0.7, 0.5, 0.35, 0.2, 0][r]);
      rounds.push({ ifPlayerScores: 'score', ifPlayerMisses: prolong ? 'miss' : 'score', botShot, botMiss, keeperWall: last, goalMagnet: false });
    } else {
      const assist = last || (r >= 1 && rng.bool([0, 0.25, 0.5, 0.7, 1][r]));
      rounds.push({ ifPlayerScores: 'miss', ifPlayerMisses: 'miss', botShot, botMiss, keeperWall: false, goalMagnet: assist });
    }
  }
  return { kind: 'freekick', mode: 'freekick', tier, multiplier, situation, rounds };
}
