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
