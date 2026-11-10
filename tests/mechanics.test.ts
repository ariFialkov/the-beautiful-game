import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, v2 } from '../src/game/pitch';
import type { Agent } from '../src/game/player';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

/** A live match with every player parked off to the side and AI disabled, so a scenario can be staged by hand. */
function sandbox() {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: null, script: null, durationSec: 3000, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  m.agents.forEach((a, i) => { a.isHuman = true; a.pos = { x: -40 + i * 3, z: 30 }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; a.intent = { move: { x: 0, z: 0 }, sprint: false }; });
  m.phase = 'play'; m.phaseTimer = 0; m.setPiece = null; m.ball.reset(0, 0);
  const events: any[] = []; m.on((e) => events.push(e));
  const run = (sec: number, each?: () => void) => { for (let t = 0; t < sec; t += 1 / 120) { each?.(); m.update(1 / 120); } };
  return { m, events, run, attacker: m.teams[0].agents[9], defender: m.teams[1].agents[3] };
}
function place(a: Agent, x: number, z: number, hx = 1, hz = 0) { a.pos = { x, z }; a.prevPos = { x, z }; a.vel = { x: 0, z: 0 }; a.heading = v2.norm({ x: hx, z: hz }); a.action = null; a.tackleCooldown = 0; a.cooldown = 0; }

test('dribbling: the ball is a free object, touched ahead and kept under control through a turn', () => {
  const { m, run, attacker: a } = sandbox();
  place(a, 0, 0); m.ball.reset(0.4, 0); m.ball.owner = a;
  let maxGap = 0, touches = 0, ballAhead = 0, samples = 0;
  const watch = () => { if (m.ball.owner === a) { const g = v2.dist(a.pos, { x: m.ball.x, z: m.ball.z }); maxGap = Math.max(maxGap, g); samples++; if (v2.dot(v2.sub({ x: m.ball.x, z: m.ball.z }, a.pos), a.heading) > 0) ballAhead++; } if (a.action?.type === 'touch' && a.action.t < 1 / 120 + 1e-9) touches++; };
  a.intent = { move: { x: 1, z: 0 }, sprint: true };
  run(4, watch);
  assert.equal(m.ball.owner, a, 'kept the ball while sprinting');
  assert.ok(a.pos.x > 22, `covered ground (${a.pos.x.toFixed(1)} m)`);
  assert.ok(touches >= 6, `took repeated touches (${touches})`);
  assert.ok(maxGap > 0.7 && maxGap < 3.0, `knocked the ball ahead when sprinting, gap ${maxGap.toFixed(2)} m`);
  assert.ok(ballAhead / samples > 0.85, 'ball stays in front');
  // Turn 90°: from a sprint the ball is a few metres ahead, so he has to run it down before he can turn it.
  a.intent = { move: { x: 0, z: 1 }, sprint: false };
  run(1.5, watch);
  const x0 = m.ball.x, z0 = m.ball.z;
  run(2, watch);
  assert.equal(m.ball.owner, a, 'kept the ball through a 90° turn');
  assert.ok(m.ball.z - z0 > 5 && Math.abs(m.ball.x - x0) < 1.5, `ball now travels the new way (dz ${(m.ball.z - z0).toFixed(1)}, dx ${(m.ball.x - x0).toFixed(1)})`);
  // Jog dribbling keeps it tighter than sprinting
  let jogGap = 0; a.intent = { move: { x: 1, z: 0 }, sprint: false }; run(1);
  run(3, () => { if (m.ball.owner === a) jogGap = Math.max(jogGap, v2.dist(a.pos, { x: m.ball.x, z: m.ball.z })); });
  assert.ok(jogGap < maxGap, `jogging keeps it closer (${jogGap.toFixed(2)} < ${maxGap.toFixed(2)})`);
});

test('a well-timed standing tackle wins the ball cleanly', () => {
  const { m, run, events, attacker: a, defender: d } = sandbox();
  place(a, 0, 0, 1, 0); m.ball.reset(0.75, 0); m.ball.owner = a; // ball exposed a little ahead
  place(d, 1.75, 0, -1, 0);
  assert.ok(m.tackle(d, 'tackle'));
  run(0.7);
  assert.ok(events.some((e) => e.type === 'tackle' && e.success && e.agent === d), 'won the ball');
  assert.ok(!events.some((e) => e.type === 'foul'), 'no foul');
  assert.notEqual(m.ball.owner, a);
});

test('a slide that misses the ball and takes the man is a foul and a free kick', () => {
  const { m, run, events, attacker: a, defender: d } = sandbox();
  place(a, 0, 0, 1, 0); m.ball.reset(0.45, 0); m.ball.owner = a;
  place(d, -2.2, 0.1, 1, 0); // from behind: the attacker's legs are between the tackler and the ball
  assert.ok(m.tackle(d, 'slide'));
  run(0.8);
  const foul = events.find((e) => e.type === 'foul');
  assert.ok(foul, 'foul given'); assert.equal(foul.by, d); assert.equal(foul.on, a);
  assert.ok(!events.some((e) => e.type === 'tackle' && e.success), 'did not win the ball');
  assert.equal(a.action?.type, 'fallen');
  run(1.5);
  assert.ok(events.some((e) => e.type === 'setpiece' && e.kind === 'freekick' && e.team === a.team), 'free kick to the fouled team');
});

test('a standing tackle with nothing in reach whiffs and leaves the defender off balance', () => {
  const { m, run, events, attacker: a, defender: d } = sandbox();
  place(a, 0, 0, 1, 0); m.ball.reset(0.4, 0); m.ball.owner = a;
  place(d, 4, 0, -1, 0); // far too far away
  m.tackle(d, 'tackle'); run(0.5);
  assert.ok(!events.some((e) => e.type === 'tackle' || e.type === 'foul'));
  assert.ok(d.stunned > 0 || d.tackleCooldown > 0);
  assert.equal(m.ball.owner, a);
});

test('button mashing does not produce repeated tackles', () => {
  const { m, run, attacker: a, defender: d } = sandbox();
  place(a, 0, 0, 1, 0); m.ball.reset(0.4, 0); m.ball.owner = a;
  place(d, 3, 2, -1, 0);
  let started = 0;
  run(1.5, () => { if (m.tackle(d, 'tackle')) started++; });
  assert.ok(started <= 2, `only ${started} tackles started in 1.5 s of mashing`);
  let slides = 0; d.tackleCooldown = 0; d.action = null;
  run(1.5, () => { if (m.tackle(d, 'slide')) slides++; });
  assert.equal(slides, 1, 'one slide, then committed to it');
});

test('kicks need the ball in reach: the player takes it when he gets there', () => {
  const { m, run, events, attacker: a } = sandbox();
  const mate = m.teams[0].agents[8]; place(mate, 18, 4);
  place(a, 0, 0, 1, 0); m.ball.reset(2.2, 0); m.ball.owner = a; // ball 2.2 m ahead after a touch
  m.startKick(a, 'pass', 0.6, { x: 1, z: 0.2 }, { targetAgent: mate });
  run(0.15);
  assert.ok(!events.some((e) => e.type === 'kick'), 'not struck from 2 m away');
  run(1.2);
  assert.ok(events.some((e) => e.type === 'kick' && e.agent === a), 'struck once in reach');
  assert.ok(m.ball.speed() > 6);
});
