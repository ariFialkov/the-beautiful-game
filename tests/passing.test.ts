import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, v2 } from '../src/game/pitch';
import type { Agent } from '../src/game/player';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

const btn = () => ({ down: false, justPressed: false, justReleased: false });
const neutral = () => ({ move: { x: 0, y: 0 }, sprint: btn(), pass: btn(), shoot: btn(), through: btn(), lob: btn(), switch: btn(), slide: btn(), finesse: btn(), shield: btn() }) as any;

/** Human team 0, everyone else parked with the AI switched off. */
function sandbox() {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script: null, durationSec: 3000, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  m.agents.forEach((a, i) => { a.isHuman = true; a.pos = { x: 40 + (i % 6) * 2, z: -30 + Math.floor(i / 6) * 2 }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; a.intent = { move: { x: 0, z: 0 }, sprint: false }; });
  m.phase = 'play'; m.phaseTimer = 0; m.setPiece = null;
  m.controlBasis = { right: { x: 1, z: 0 }, forward: { x: 0, z: 1 } }; // stick x = world x, stick y = world z
  return { m, passer: m.teams[0].agents[6], mate: m.teams[0].agents[9] };
}
function place(a: Agent, x: number, z: number, hx = 1, hz = 0) { a.pos = { x, z }; a.prevPos = { x, z }; a.vel = { x: 0, z: 0 }; a.heading = v2.norm({ x: hx, z: hz }); a.action = null; a.cooldown = 0; }
function givePass(m: Match, passer: Agent, aim: { x: number; z: number }, power: number) {
  (m as any).setControlled(passer); m.ball.reset(passer.pos.x + passer.heading.x * 0.4, passer.pos.z + passer.heading.z * 0.4); m.ball.owner = passer;
  m.startKick(passer, 'pass', power, v2.norm(aim), {});
}
const runUntil = (m: Match, sec: number, done: () => boolean) => { for (let t = 0; t < sec; t += 1 / 60) { m.update(1 / 60, neutral()); if (done()) return t; } return -1; };

test('a roughly aimed light pass still finds the team-mate', () => {
  const { m, passer, mate } = sandbox();
  place(passer, 0, 0); place(mate, 14, 0, -1, 0);
  givePass(m, passer, { x: Math.cos(0.6), z: Math.sin(0.6) }, 0.15); // aimed 34° wide, almost no power
  const t = runUntil(m, 4, () => m.ball.owner === mate);
  assert.ok(t > 0, 'the receiver controlled it');
  assert.equal(m.controlled, mate, 'control switched to the receiver');
});

test('passes lead a moving receiver, who comes to meet the ball', () => {
  const { m, passer, mate } = sandbox();
  place(passer, 0, 0, 0, 1); place(mate, 4, 16, 1, 0); mate.vel = { x: 6, z: 0 };
  mate.intent = { move: { x: 1, z: 0 }, sprint: true };
  givePass(m, passer, { x: 0.4, z: 1 }, 0.4);
  const t = runUntil(m, 4, () => m.ball.owner === mate);
  assert.ok(t > 0, `the runner collected the pass (ball ended at ${m.ball.x.toFixed(1)}, ${m.ball.z.toFixed(1)}; runner at ${mate.pos.x.toFixed(1)}, ${mate.pos.z.toFixed(1)})`);
});

test('a full-power pass into space carries across the pitch; a light one stays short', () => {
  const travel = (power: number) => {
    const { m, passer } = sandbox(); place(passer, -20, -30, 0, 1);
    givePass(m, passer, { x: 0, z: 1 }, power); runUntil(m, 0.4, () => false);
    place(passer, 46, 0); m.agents.forEach((a) => { a.isHuman = true; }); // nobody chases it down: measure the roll alone
    const z0 = m.ball.z; runUntil(m, 10, () => m.ball.speed() < 0.5 || m.phase !== 'play');
    return { dist: m.ball.z - z0 + 0.4, z: m.ball.z };
  };
  const hard = travel(1), soft = travel(0.1);
  console.log(`  full power travels ${hard.dist.toFixed(0)} m, a soft one ${soft.dist.toFixed(0)} m`);
  assert.ok(hard.dist > 55 || hard.z > 33, 'a hard pass crosses the 68 m width');
  assert.ok(soft.dist > 8 && soft.dist < hard.dist * 0.6, 'a soft pass is a short one');
});

test('the stick picks the receiver, and the power bar picks how far for a lofted pass', () => {
  const { m, passer } = sandbox(); const mates = m.teams[0].agents;
  place(passer, 0, 0, 0, 1);
  const near = mates[9], far = mates[10], side = mates[8];
  place(near, 2, 10); place(far, 4, 38); place(side, 9, 12);
  // aimed straight at the near man (the side man is 20° off): him
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: 0.2, z: 1 }), false, false, 0.25), near);
  // the side man when aimed at him
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: 9, z: 12 }), false, false, 0.3), side);
  // lofted, same direction: a short charge finds the near man, a long one the far man
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: 0.1, z: 1 }), false, true, 0.1), near);
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: 0.1, z: 1 }), false, true, 0.75), far);
});

test("a through ball is played into the runner's path and he runs onto it", () => {
  const { m, passer, mate } = sandbox(); const dir = m.teams[0].attackDir;
  place(passer, 0, 0, dir, 0); place(mate, dir * 12, 5, dir, 0);
  (m as any).setControlled(passer); m.ball.reset(dir * 0.4, 0); m.ball.owner = passer;
  m.startKick(passer, 'through', 0.7, v2.norm({ x: dir * 12, z: 5 }), { targetAgent: mate });
  const t = runUntil(m, 5, () => m.ball.owner === mate);
  assert.ok(t > 0, 'the runner collected it');
  assert.ok((mate.pos.x - 12 * dir) * dir > 2, `he ran on to meet it (now ${mate.pos.x.toFixed(1)})`);
  assert.ok(m.ball.vx * dir > -0.5, 'and took it on, not back toward his own goal');
});

test('a pass aimed a little off still homes in on its receiver', () => {
  let hits = 0;
  for (let k = 0; k < 6; k++) {
    const { m, passer, mate } = sandbox();
    place(passer, 0, 0, 0, 1); place(mate, 4, 22, 0, -1);
    const off = (k % 2 ? 1 : -1) * 0.12; const aim = Math.atan2(22, 4) + off; // ~7° wide
    (m as any).setControlled(passer); m.ball.reset(0, 0.4); m.ball.owner = passer;
    const target = m.pickPassTarget(passer, { x: Math.cos(aim), z: Math.sin(aim) }, false, false, 0.5);
    m.startKick(passer, 'pass', 0.5, { x: Math.cos(aim), z: Math.sin(aim) }, { targetAgent: target ?? undefined });
    if (runUntil(m, 4, () => m.ball.owner === mate) > 0) hits++;
  }
  assert.ok(hits >= 5, `${hits}/6 arrived`);
});

/** A team-mate sprinting on the AI receives a pass; returns how far he turned and whether he kept the ball close. */
function receiveInStride(rcv: [number, number], runZ: number, k: number) {
  const { m, passer, mate } = sandbox(); const at = m.teams[0].attackDir;
  mate.isHuman = false;
  const run = v2.norm({ x: at, z: runZ });
  place(passer, 0, 0, at, 0); place(mate, rcv[0] * at, rcv[1] + k * 0.4, run.x, run.z);
  mate.vel = v2.scale(run, mate.maxSpeed * 0.95); mate.intent = { move: run, sprint: true };
  m.ball.reset(at * 0.4, 0); m.ball.owner = passer;
  m.startKick(passer, 'pass', 0.45, v2.norm(v2.sub(v2.add(mate.pos, v2.scale(mate.vel, 0.8)), passer.pos)), { targetAgent: mate });
  let started = false, maxTurn = 0, touched = -1, close = false, heavy = false, played = false; const h0 = Math.atan2(run.z, run.x);
  m.on((e) => { if (e.type === 'touch' && e.agent === mate && touched < 0) heavy = e.heavy; if (e.type === 'kick' && e.agent === mate) played = true; });
  for (let i = 0; i < 60 * 5; i++) {
    m.update(1 / 60, neutral());
    if (m.ball.lastTouch === passer && !m.ball.owner) started = true;
    if (started && touched < 0) { let d = Math.atan2(mate.heading.z, mate.heading.x) - h0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; maxTurn = Math.max(maxTurn, Math.abs(d)); }
    if (touched < 0 && m.ball.lastTouch === mate) touched = m.time;
    if (touched > 0 && (played || m.time - touched > 0.6)) { close = played || v2.dist(mate.pos, m.ball) < 2.5; break; }
  }
  return { turn: maxTurn * 57.3, touched: touched > 0, close, heavy };
}

test('a runner receives in his stride: no turning round, and the ball stays under control', () => {
  let lost = 0;
  for (const [rcv, runZ] of [[[14, 4], 0.2], [[0, 16], 0], [[12, 18], -1.3]] as Array<[[number, number], number]>) {
    for (let k = 0; k < 3; k++) {
      const r = receiveInStride(rcv, runZ, k);
      assert.ok(r.touched, `the pass reached him (${rcv})`);
      assert.ok(r.turn < 70, `he kept his line (turned ${r.turn.toFixed(0)}° for ${rcv})`);
      if (!r.close) lost++;
    }
  }
  assert.ok(lost <= 1, `the first touch kept it under control (${lost}/9 got away)`);
});
