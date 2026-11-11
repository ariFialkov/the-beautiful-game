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
  // (the human's side may score off the script, but every such goal is answered: the margin is as drawn)
  assert.equal(m.teams[0].score - m.teams[1].score, script.finalScore.home - script.finalScore.away);
  assert.equal(m.teams[0].score - m.director!.answered, script.finalScore.home);
  console.log(`  idle human: ${m.teams[0].score}-${m.teams[1].score}  goals ${events.join(' ')} frac=${m.frac.toFixed(2)}`);
});

test('a losing script: the player can still score, and the opponent scores more (same result, same margin)', () => {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  let script = generateMatchScript(new Rng('lose-but-score'), 'kickoff', 'loss', 0, 0.6);
  for (let i = 0; script.finalScore.home > 0; i++) script = generateMatchScript(new Rng(`lose-but-score-${i}`), 'kickoff', 'loss', 0, 0.6); // (no goals scheduled for the player)
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script, durationSec: script.durationSec, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  const idle = { move: { x: 0, y: 0 }, sprint: { down: false }, shoot: { down: false, justReleased: false, justPressed: false }, pass: { down: false, justReleased: false }, through: { justPressed: false }, lob: { justPressed: false }, shield: { down: false }, slide: { justPressed: false }, switch: { justPressed: false }, finesse: { down: false } } as any;
  while (m.frac < 0.12 || m.phase !== 'play') m.update(1 / 60, idle);
  // a shot from the player's striker, already on its way into the bottom corner, outside any goal window
  const at = m.teams[0].attackDir; const s = m.teams[0].agents[9]; const b = m.ball;
  b.owner = null; b.held = false; b.x = at * 50; b.y = 0.3; b.z = 2.6; b.vx = at * 25; b.vy = 0; b.vz = 0.4; b.wx = b.wy = b.wz = 0; b.lastTouch = s; b.lastTouchTeam = 0; b.lastTouchTime = m.time;
  b.px = b.x; b.py = b.y; b.pz = b.z;
  const gk = m.teams[1].agents[0]; gk.pos = { x: at * 52, z: -3 }; gk.prevPos = { ...gk.pos };
  let goal = -1; m.on((e) => { if (e.type === 'goal' && goal < 0) goal = e.team; });
  for (let i = 0; i < 60 && goal < 0; i++) m.update(1 / 60, idle);
  assert.equal(goal, 0, 'the goal stands');
  assert.equal(m.director!.answered, 1);
  while (!m.ended && m.frac < 1.3) m.update(1 / 60, idle);
  assert.ok(m.ended);
  assert.equal(m.teams[0].score - m.teams[1].score, script.finalScore.home - script.finalScore.away, 'still a defeat by the drawn margin');
  assert.equal(m.teams[1].score, script.finalScore.away + m.director!.answered, 'the opponent answered every off-script goal'); // (the auto-piloted side may score again)
  console.log(`  scripted ${script.finalScore.home}-${script.finalScore.away}, played ${m.teams[0].score}-${m.teams[1].score}`);
});

test('futsal: a level game goes to sudden death (3v3, then 2v2, then 1v1) and the golden goal decides it', () => {
  const cases: Array<[MatchTier, string]> = [];
  for (const tier of ['otwin', 'loss'] as MatchTier[]) {
    let found = 0;
    for (let i = 0; i < 200 && found < 2; i++) { const sc = generateMatchScript(new Rng(`ot-${tier}-${i}`), 'futsal', tier, 1.6, 0.6); if (sc.overtime) { cases.push([tier, `ot-${tier}-${i}`]); found++; } }
  }
  assert.ok(cases.length >= 3, 'scripts with sudden death exist');
  for (const [tier, seed] of cases) {
    const { m, script, events } = runMatch('futsal', tier, seed, false);
    assert.ok(script.overtime, 'script has overtime');
    assert.ok(m.overtime, `sudden death was played (${tier} ${seed}: ended ${m.teams[0].score}-${m.teams[1].score} at ${m.frac.toFixed(3)}, goals ${events.join(' ')}, script ${JSON.stringify(script.finalScore)} ${JSON.stringify(script.events.map((e) => e.side[0] + '@' + e.t.toFixed(2)))})`);
    assert.equal(m.teams[0].score, script.finalScore.home, `home ${tier}`);
    assert.equal(m.teams[1].score, script.finalScore.away, `away ${tier}`);
    const shouldBe = script.overtime!.at < 15 ? 3 : script.overtime!.at < 30 ? 2 : 1;
    const el = m.clock - m.overtime!.start;
    assert.ok(el >= script.overtime!.at - 4.5, `the golden goal did not come early (${el.toFixed(1)} s, planned ${script.overtime!.at.toFixed(1)} s)`);
    assert.equal(m.overtime!.size, el < 15 ? 3 : el < 30 ? 2 : 1, 'the teams shrank on schedule: 3v3, 2v2 after 15 s, 1v1 after 30 s');
    assert.equal(m.benched.length, 2 * (4 - m.overtime!.size), 'players taken off for each stage');
    console.log(`  sudden death ${tier}: ${m.teams[0].score}-${m.teams[1].score}, planned at ${script.overtime!.at.toFixed(1)} s (${shouldBe}v${shouldBe}), ended ${m.overtime!.size}v${m.overtime!.size} after ${(m.clock - m.overtime!.start).toFixed(1)} s · goals ${events.join(' ')}`);
  }
});
