import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPaytable, expectedReturn, pickTier } from '../shared/paytable';
import { generateMatchScript, generateFreeKickScript } from '../shared/script';
import { Rng } from '../shared/rng';
import { TEAMS, rosterOf, startingXI } from '../shared/teams';
import type { GameMode, MatchTier } from '../shared/types';

const MODES: GameMode[] = ['kickoff', 'futsal', 'fut', 'freekick'];

test('paytables hit the configured RTP exactly', () => {
  for (const mode of MODES) for (const rtp of [0.85, 0.9, 0.96, 0.98]) {
    const pt = buildPaytable(mode, rtp);
    assert.ok(Math.abs(expectedReturn(pt) - rtp) < 1e-9, `${mode} ${rtp}`);
    const total = pt.entries.reduce((s, e) => s + e.probability, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
    for (const e of pt.entries) assert.ok(e.probability >= 0);
  }
});

test('empirical RTP from tier sampling converges', () => {
  const pt = buildPaytable('kickoff', 0.96);
  const rng = new Rng('rtp-sim');
  let sum = 0; const n = 200000;
  for (let i = 0; i < n; i++) sum += pickTier(pt, rng.next()).multiplier;
  assert.ok(Math.abs(sum / n - 0.96) < 0.01, `empirical ${sum / n}`);
});

test('match scripts always end with the tier result', () => {
  const tiers: MatchTier[] = ['loss', 'draw', 'win', 'bigwin'];
  for (let i = 0; i < 500; i++) for (const tier of tiers) for (const mode of ['kickoff', 'futsal'] as const) {
    const s = generateMatchScript(new Rng(`m${i}${tier}${mode}`), mode, tier, 2, 0.5);
    const { home, away } = s.finalScore;
    if (tier === 'loss') assert.ok(away > home);
    if (tier === 'draw') assert.equal(home, away);
    if (tier === 'win') assert.ok(home > away && home - away < 3);
    if (tier === 'bigwin') assert.ok(home - away >= 3);
    assert.equal(s.events.length, home + away);
    assert.equal(s.events.filter((e) => e.side === 'home').length, home);
    for (let k = 1; k < s.events.length; k++) assert.ok(s.events[k].t >= s.events[k - 1].t);
  }
});

test('free kick decision trees are decisive and consistent with the tier', () => {
  for (let i = 0; i < 500; i++) for (const tier of ['loss', 'win'] as const) {
    const s = generateFreeKickScript(new Rng(`fk${i}${tier}`), tier, 1.92);
    const last = s.rounds[s.rounds.length - 1];
    for (const r of s.rounds) {
      if (tier === 'loss') { assert.equal(r.ifPlayerScores, 'score'); assert.ok(!r.goalMagnet); if (r.keeperWall) assert.equal(r.ifPlayerMisses, 'score'); }
      else { assert.equal(r.ifPlayerScores, 'miss'); assert.equal(r.ifPlayerMisses, 'miss'); assert.ok(!r.keeperWall); }
    }
    if (tier === 'loss') assert.ok(last.keeperWall && last.ifPlayerMisses === 'score');
    else assert.ok(last.goalMagnet);
  }
});

test('rosters are deterministic and well formed', () => {
  for (const t of TEAMS) {
    const r = rosterOf(t.id);
    assert.equal(r.length, 18);
    assert.deepEqual(r.map((p) => p.name), rosterOf(t.id).map((p) => p.name));
    const xi = startingXI(r);
    assert.equal(xi.length, 11);
    assert.equal(new Set(xi.map((p) => p.id)).size, 11);
    assert.equal(xi[0].position, 'GK');
  }
});
