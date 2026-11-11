import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, PITCH_FUTSAL } from '../src/game/pitch';
import { generateMatchScript } from '../shared/script';
import { predictPath } from '../src/game/ball';
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

/** The result the script drew (win / draw / loss, and the margin band for "win" and "win by 3+") is what was played. */
function assertResult(m: Match, label: string) {
  const d = m.director!; const D = m.teams[0].score - m.teams[1].score;
  assert.ok(m.ended, `${label}: match ended`);
  assert.ok(D >= d.lo && D <= d.hi, `${label}: ${m.teams[0].score}-${m.teams[1].score} is outside the drawn result (${d.lo}..${d.hi}, scenario ${d.scenario})`);
}

test('AI-vs-AI matches end with the drawn result, whatever scenario is played (kickoff)', () => {
  const tiers: MatchTier[] = ['loss', 'draw', 'win', 'bigwin']; let awarded = 0;
  for (let i = 0; i < 2; i++) for (const tier of tiers) {
    const { m, events } = runMatch('kickoff', tier, `k${i}${tier}`, false);
    assertResult(m, tier);
    // winning results: the player's side always scores first
    if (tier === 'win' || tier === 'bigwin') assert.ok(events[0]?.startsWith('0@'), `${tier}: first goal ${events[0]}`);
    awarded += events.filter((e) => e.endsWith('!')).length;
    assert.ok(awarded <= 1, `goals had to be awarded by the failsafe (${awarded})`); // (very rare: about one match in 30)
    console.log(`  ${tier} (${m.director!.scenario}): ${m.teams[0].score}-${m.teams[1].score}  goals ${events.join(' ')} frac=${m.frac.toFixed(2)}`);
  }
});

test('AI-vs-AI matches end with the drawn result (futsal)', () => {
  for (const tier of ['loss', 'win'] as MatchTier[]) {
    const { m, events } = runMatch('futsal', tier, `f${tier}`, false);
    assertResult(m, `futsal ${tier}`);
    console.log(`  futsal ${tier} (${m.director!.scenario}): ${m.teams[0].score}-${m.teams[1].score}  goals ${events.join(' ')} frac=${m.frac.toFixed(2)}`);
  }
});

test('an idle human still gets the drawn result', () => {
  const { m, events } = runMatch('kickoff', 'win', 'idle-win', true);
  assertResult(m, 'idle human');
  console.log(`  idle human (${m.director!.scenario}): ${m.teams[0].score}-${m.teams[1].score}  goals ${events.join(' ')} frac=${m.frac.toFixed(2)}`);
});

test('scoring scenarios: many shapes per result, losing ones often letting the player score first, winning ones always', () => {
  const names = new Map<string, Set<string>>(); let playerFirstLoss = 0, losses = 0;
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  for (const tier of ['loss', 'draw', 'win', 'bigwin'] as MatchTier[]) for (let i = 0; i < 40; i++) {
    const script = generateMatchScript(new Rng(`scen-${tier}-${i}`), 'kickoff', tier, 2, 0.6);
    const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script, durationSec: script.durationSec, clockMinutes: 90,
      teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
    const d = m.director!; (names.get(tier) ?? names.set(tier, new Set()).get(tier)!).add(d.scenario);
    const firstGoal = d.beats.find((b) => b.do === 'goal' || b.do === 'wait');
    if (tier === 'win' || tier === 'bigwin') assert.ok(firstGoal && (firstGoal.do === 'wait' || firstGoal.side === 0), `${tier} ${d.scenario}: the player's goal comes first`);
    if (tier === 'loss') { losses++; if (firstGoal && (firstGoal.do === 'wait' || firstGoal.side === 0)) playerFirstLoss++; }
  }
  for (const [tier, set] of names) console.log(`  ${tier}: ${[...set].join(', ')}`);
  assert.ok(names.get('loss')!.size >= 5 && names.get('draw')!.size >= 3 && names.get('win')!.size >= 2);
  assert.ok(playerFirstLoss / losses > 0.3, `losing scenarios set up for the player to score first: ${playerFirstLoss}/${losses}`);
});

/** A match with a director, in play, everyone else out of the way. */
function directed(tier: MatchTier, seed: string, want?: string) {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  for (let i = 0; i < 400; i++) {
    const script = generateMatchScript(new Rng(`${seed}-${i}`), 'kickoff', tier, 2, 0.6);
    const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script, durationSec: script.durationSec, clockMinutes: 90,
      teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
    if (!want || m.director!.scenario === want) return { m, script };
  }
  throw new Error(`no ${want} scenario found`);
}
const idleIn = { move: { x: 0, y: 0 }, sprint: { down: false }, shoot: { down: false, justReleased: false, justPressed: false }, pass: { down: false, justReleased: false }, through: { justPressed: false }, lob: { justPressed: false }, shield: { down: false }, slide: { justPressed: false }, switch: { justPressed: false }, finesse: { down: false } } as any;
/** A shot already on its way into the bottom corner of the goal `team` attacks. */
function shotAt(m: Match, team: number, z = 2.6) {
  const at = m.teams[team].attackDir; const s = m.teams[team].agents[9]; const b = m.ball;
  b.owner = null; b.held = false; b.x = at * 36; b.y = 0.2; b.z = z * 0.6; b.vx = at * 26; b.vy = 1.0; b.vz = (z - z * 0.6) / 0.62; b.wx = b.wy = b.wz = 0;
  b.lastTouch = s; b.lastTouchTeam = team; b.lastTouchTime = m.time; b.px = b.x; b.py = b.y; b.pz = b.z;
  const gk = m.opponentsOf(team).agents[0]; gk.pos = { x: at * 52, z: -Math.sign(z) * 3 }; gk.prevPos = { ...gk.pos };
}

test('a losing scenario that lets the player score first: the goal stands, and the bots come back to win', () => {
  const { m } = directed('loss', 'comeback', 'late comeback');
  while (m.frac < 0.08 || m.phase !== 'play') m.update(1 / 60, idleIn);
  shotAt(m, 0);
  let goal = -1; m.on((e) => { if (e.type === 'goal' && goal < 0) goal = e.team; });
  for (let i = 0; i < 60 && goal < 0; i++) m.update(1 / 60, idleIn);
  assert.equal(goal, 0, 'the player scores first');
  while (!m.ended && m.frac < 1.3) m.update(1 / 60, idleIn);
  assertResult(m, 'late comeback');
  console.log(`  late comeback: ${m.teams[0].score}-${m.teams[1].score}`);
});

test('a goal that must not count is a miss from the strike, and the ball then flies freely (no steering in the air)', () => {
  // a winning result before the player has scored: the bots may not score yet
  const { m } = directed('win', 'nosteer');
  while (m.frac < 0.05 || m.phase !== 'play') m.update(1 / 60, idleIn);
  for (const a of m.agents) if (!a.isGK) { a.pos = { x: 0, z: -30 + a.index }; a.prevPos = { ...a.pos }; }
  shotAt(m, 1, 2.2);
  const rnd = Math.random; Math.random = () => 0.5; // (a clean miss wide, not off the post)
  try { m.update(1 / 120, idleIn); } finally { Math.random = rnd; } // the strike is vetted on the first step
  const b = m.ball; const path = predictPath(b, 1.5, 1 / 120);
  let maxDev = 0, crossed: { y: number; z: number } | null = null;
  for (let i = 1; i < 150 && !crossed; i++) {
    m.update(1 / 120, idleIn);
    if (b.lastTouch?.isGK) break; // (a save is fine too)
    const p = path[i]; if (p && Math.abs(b.x) < 51.5) maxDev = Math.max(maxDev, Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z));
    if (Math.abs(b.x) > 52.5) crossed = { y: b.y, z: b.z };
  }
  assert.ok(maxDev < 0.05, `the ball followed its free flight (off by ${maxDev.toFixed(3)} m)`);
  assert.equal(m.teams[1].score, 0, 'no goal');
  if (crossed) assert.ok(Math.abs(crossed.z) > 3.6 || crossed.y > 2.4, `missed (${crossed.z.toFixed(2)}, ${crossed.y.toFixed(2)})`);
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
    assert.equal(Math.sign(m.teams[0].score - m.teams[1].score), script.overtime!.side === 'home' ? 1 : -1, `the golden goal went to the drawn side (${tier})`);
    const shouldBe = script.overtime!.at < 15 ? 3 : script.overtime!.at < 30 ? 2 : 1;
    const el = m.clock - m.overtime!.start;
    assert.ok(el >= script.overtime!.at - 4.5, `the golden goal did not come early (${el.toFixed(1)} s, planned ${script.overtime!.at.toFixed(1)} s)`);
    assert.equal(m.overtime!.size, el < 15 ? 3 : el < 30 ? 2 : 1, 'the teams shrank on schedule: 3v3, 2v2 after 15 s, 1v1 after 30 s');
    assert.equal(m.benched.length, 2 * (4 - m.overtime!.size), 'players taken off for each stage');
    console.log(`  sudden death ${tier}: ${m.teams[0].score}-${m.teams[1].score}, planned at ${script.overtime!.at.toFixed(1)} s (${shouldBe}v${shouldBe}), ended ${m.overtime!.size}v${m.overtime!.size} after ${(m.clock - m.overtime!.start).toFixed(1)} s · goals ${events.join(' ')}`);
  }
});
