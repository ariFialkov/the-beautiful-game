import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, PITCH_FUTSAL } from '../src/game/pitch';
import { generateMatchScript } from '../shared/script';
import { Rng } from '../shared/rng';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';
import type { MatchTier } from '../shared/types';

function futsalFive(xi: ReturnType<typeof startingXI>) { return [xi[0], xi[2], xi[8], xi[10], xi[9]]; }

function runMatch(mode: 'kickoff' | 'futsal', tier: MatchTier, seed: string, humanIdle: boolean) {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  const script = generateMatchScript(new Rng(seed), mode, tier, 2, 0.6);
  // real durations so the director's windows are realistic
  const hx = startingXI(rosterOf(home.id)), ax = startingXI(rosterOf(away.id));
  const futsal = mode === 'futsal';
  const m = new Match({
    pitch: futsal ? PITCH_FUTSAL : PITCH_11, mode, humanTeam: humanIdle ? 0 : null, script,
    durationSec: script.durationSec, clockMinutes: futsal ? 40 : 90,
    teams: [
      { team: home, players: futsal ? futsalFive(hx) : hx, kit: home.home, kitKey: home.id + ':h', name: home.name, short: home.short },
      { team: away, players: futsal ? futsalFive(ax) : ax, kit: away.home, kitKey: away.id + ':h', name: away.name, short: away.short },
    ],
  });
  const events: string[] = [];
  m.on((e) => { if (e.type === 'goal') events.push(`${e.team}@${m.frac.toFixed(2)}${e.forced ? '!' : ''}`); });
  const dt = 1 / 60; let steps = 0;
  const idle = { move: { x: 0, y: 0 }, sprint: { down: false }, shoot: { down: false, justReleased: false, justPressed: false }, pass: { down: false, justReleased: false }, through: { justPressed: false }, lob: { justPressed: false }, shield: { down: false }, slide: { justPressed: false }, switch: { justPressed: false }, finesse: { down: false } } as any;
  while (!m.ended && steps < 60 * 60 * 20) { m.update(dt, humanIdle ? idle : undefined); steps++; }
  for (const a of m.agents) { assert.ok(Number.isFinite(a.pos.x) && Number.isFinite(a.pos.z), 'agent position finite'); }
  assert.ok(Number.isFinite(m.ball.x) && Number.isFinite(m.ball.y) && Number.isFinite(m.ball.z), 'ball finite');
  return { m, script, events };
}

test('AI-vs-AI matches end on the scripted score (kickoff)', () => {
  const tiers: MatchTier[] = ['loss', 'draw', 'win', 'bigwin'];
  for (let i = 0; i < 2; i++) for (const tier of tiers) {
    const { m, script, events } = runMatch('kickoff', tier, `k${i}${tier}`, false);
    assert.ok(m.ended, 'match ended');
    assert.equal(m.teams[0].score, script.finalScore.home, `home score ${tier} ${events.join(',')} vs ${JSON.stringify(script.events.map((e) => `${e.side[0]}@${e.t.toFixed(2)}`))}`);
    assert.equal(m.teams[1].score, script.finalScore.away, `away score ${tier}`);
    const forced = events.filter((e) => e.endsWith('!')).length;
    console.log(`  ${tier}: ${m.teams[0].score}-${m.teams[1].score}  goals ${events.join(' ')}  forced=${forced} frac=${m.frac.toFixed(2)}`);
  }
});

test('AI-vs-AI matches end on the scripted score (futsal)', () => {
  for (const tier of ['loss', 'win'] as MatchTier[]) {
    const { m, script, events } = runMatch('futsal', tier, `f${tier}`, false);
    assert.equal(m.teams[0].score, script.finalScore.home);
    assert.equal(m.teams[1].score, script.finalScore.away);
    console.log(`  futsal ${tier}: ${m.teams[0].score}-${m.teams[1].score}  goals ${events.join(' ')} frac=${m.frac.toFixed(2)}`);
  }
});

test('an idle human still gets the scripted result', () => {
  const { m, script, events } = runMatch('kickoff', 'win', 'idle-win', true);
  assert.equal(m.teams[0].score, script.finalScore.home);
  assert.equal(m.teams[1].score, script.finalScore.away);
  console.log(`  idle human: ${m.teams[0].score}-${m.teams[1].score}  goals ${events.join(' ')} frac=${m.frac.toFixed(2)}`);
});
