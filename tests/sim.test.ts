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

/** The result the script drew (win / draw / loss) is what was played. */
function assertResult(m: Match, label: string) {
  const d = m.director!; const D = m.teams[0].score - m.teams[1].score;
  assert.ok(m.ended, `${label}: match ended`);
  assert.ok(D >= d.lo && D <= d.hi, `${label}: ${m.teams[0].score}-${m.teams[1].score} is outside the drawn result (${d.lo}..${d.hi}, scenario ${d.scenario})`);
}

test('AI-vs-AI matches end with the drawn result, whatever scenario is played (kickoff)', () => {
  const tiers: MatchTier[] = ['loss', 'draw', 'win']; let awarded = 0;
  for (let i = 0; i < 3; i++) for (const tier of tiers) {
    const { m, events } = runMatch('kickoff', tier, `k${i}${tier}`, false);
    assertResult(m, tier);
    // winning results: the player's side always scores first
    if (tier === 'win') assert.ok(events[0]?.startsWith('0@'), `${tier}: first goal ${events[0]}`);
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
  for (const tier of ['loss', 'draw', 'win'] as MatchTier[]) for (let i = 0; i < 40; i++) {
    const script = generateMatchScript(new Rng(`scen-${tier}-${i}`), 'kickoff', tier, 2, 0.6);
    const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script, durationSec: script.durationSec, clockMinutes: 90,
      teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
    const d = m.director!; (names.get(tier) ?? names.set(tier, new Set()).get(tier)!).add(d.scenario);
    const firstGoal = d.beats.find((b) => b.do === 'goal' || b.do === 'wait');
    if (tier === 'win') assert.ok(firstGoal && (firstGoal.do === 'wait' || firstGoal.side === 0), `${tier} ${d.scenario}: the player's goal comes first`);
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

test("the player's chances count: clean finishes from inside the box go in, even in a match drawn as a defeat", () => {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  let goals = 0, forcedMisses = 0; const n = 12;
  const press = (k: string, down: boolean, jp: boolean, jr: boolean, move: { x: number; y: number }) => ({ ...idleIn, move, sprint: { down: false }, [k]: { down, justPressed: jp, justReleased: jr } });
  for (let i = 0; i < n; i++) {
    const script = generateMatchScript(new Rng(`sitter-${i}`), 'kickoff', 'loss', 0, 0.6);
    const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script, durationSec: script.durationSec, clockMinutes: 90,
      teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
    while (m.frac < 0.1 + i * 0.05 || m.phase !== 'play') m.update(1 / 60, idleIn);
    const at = m.teams[0].attackDir; const s = m.teams[0].agents[9]; const gk = m.teams[1].agents[0];
    for (const a of m.teams[1].agents) if (!a.isGK) { a.pos = { x: a.pos.x * 0.3, z: a.pos.z }; a.prevPos = { ...a.pos }; } // (a clear sight of goal)
    gk.pos = { x: at * 51.5, z: 0 }; gk.prevPos = { ...gk.pos }; gk.ai.dive = null; gk.action = null;
    const dist = 9 + (i % 4) * 1.5, z0 = ((i % 5) - 2) * 2.2;
    s.pos = { x: at * (52.5 - dist), z: z0 }; s.prevPos = { ...s.pos }; s.heading = { x: at, z: 0 }; s.vel = { x: 0, z: 0 }; s.action = null;
    (m as any).setControlled(s); m.ball.reset(s.pos.x + at * 0.4, z0); m.ball.owner = s;
    m.controlBasis = { right: { x: 0, z: at }, forward: { x: at, z: 0 } };
    const stick = i % 3 === 0 ? { x: 0, y: 0 } : { x: (i % 2 ? 0.35 : -0.35), y: 1 }; // (roughly at goal, or no stick)
    const vet0 = (m.director as any).lastVet;
    for (let k = 0; k < 24; k++) m.update(1 / 60, press('shoot', true, k === 0, false, stick));
    m.update(1 / 60, press('shoot', false, false, true, stick));
    let scored = false; m.on((e) => { if (e.type === 'goal' && e.team === 0) scored = true; });
    let fate = 'none';
    for (let k = 0; k < 120 && !scored; k++) { m.update(1 / 60, idleIn); const b = m.ball; if (fate === 'none') { if (b.lastTouch === gk) fate = 'saved'; else if (b.lastTouch && b.lastTouch.team === 1) fate = 'blocked'; else if (Math.abs(b.x) > 52.5) fate = `out z ${b.z.toFixed(2)} y ${b.y.toFixed(2)}`; } }
    if (process.env.SITTER_DEBUG) console.log(`  shot ${i}: from ${dist.toFixed(1)} m z ${z0.toFixed(1)} stick ${JSON.stringify(stick)} -> ${scored ? 'GOAL' : fate} keeper ${m.mods.keeper[1]}`);
    if (scored) goals++;
    const lv = (m.director as any).lastVet; if (lv !== vet0 && lv?.hit?.team === 0) forcedMisses++;
  }
  console.log(`  ${goals}/${n} chances scored, ${forcedMisses} made to miss`);
  assert.equal(forcedMisses, 0, 'no shot of the player is turned into a miss');
  assert.ok(goals >= n * 0.6, 'most clean chances go in');
});

test('a player who never shoots still gets a drawn win through play: the goal it needs comes from the defence cracking (an own goal), never awarded', () => {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  const script = generateMatchScript(new Rng('never-shoots'), 'kickoff', 'win', 2, 0.6);
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script, durationSec: script.durationSec, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  const goals: string[] = []; let awarded = 0;
  m.on((e) => { if (e.type === 'goal') { goals.push(`${e.team}${e.ownGoal ? 'og' : ''}@${m.frac.toFixed(2)}`); if (e.forced) awarded++; } });
  const btn = { down: false, justPressed: false, justReleased: false }; let t = 0;
  while (!m.ended && m.frac < 1.5) {
    // carries it forward and lays it off now and then, but never shoots (and never touches shoot for a header)
    t += 1 / 60; const me = m.controlled; const dir = m.teams[0].attackDir; const pass = Math.floor(t * 2) % 7 === 0;
    m.controlBasis = { right: { x: 0, z: -dir }, forward: { x: dir, z: 0 } };
    m.update(1 / 60, { move: { x: me?.hasBall ? 0.3 : 0, y: me?.hasBall ? 1 : 0 }, sprint: btn, pass: { down: pass, justPressed: false, justReleased: !pass && Math.floor((t - 1 / 60) * 2) % 7 === 0 }, shoot: btn, through: btn, lob: btn, switch: btn, slide: btn, finesse: btn, shield: btn, touchCurl: 0 } as any);
  }
  const D = m.teams[0].score - m.teams[1].score;
  console.log(`  ${m.director!.scenario}: ${m.teams[0].score}-${m.teams[1].score}  goals ${goals.join(' ')}  ended at ${m.frac.toFixed(2)}`);
  assert.ok(m.ended && D >= 1, 'the win came');
  assert.equal(awarded, 0, 'no goal had to be awarded');
});
