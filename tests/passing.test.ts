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

test('the stick picks the receiver; for lofted balls the power picks the near or far man', () => {
  const { m, passer } = sandbox(); const mates = m.teams[0].agents;
  place(passer, 0, 0, 0, 1);
  const near = mates[9], far = mates[10], side = mates[8];
  place(near, 2, 10); place(far, 4, 38); place(side, 9, 12);
  // aimed straight at the near man (the side man is 20° off): him
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: 0.2, z: 1 }), false, false, 0.25), near);
  // the side man when aimed at him
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: 9, z: 12 }), false, false, 0.3), side);
  // lofted, two men the same way: a short charge finds the near man, a hard one the far man
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: 0.1, z: 1 }), false, true, 0.1), near);
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: 0.1, z: 1 }), false, true, 0.75), far);
  // ...but the stick still decides the direction
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: 9, z: 12 }), false, true, 0.75), side);
});

/** Fly a lofted pass from `passer` to `mate` (power p): where it first comes down, how high it went, how long it took. */
function lofted(p: number) {
  const { m, passer, mate } = sandbox();
  place(passer, 0, 0, 0, 1); place(mate, 3, 28, 0, -1);
  (m as any).setControlled(passer); m.ball.reset(0, 0.4); m.ball.owner = passer;
  m.startKick(passer, 'lob', p, v2.norm({ x: 0.35, z: 1 }), { targetAgent: mate }); // (aimed a bit off: the assist puts it on him)
  let apex = 0, t0 = -1, land: { x: number; z: number; t: number } | null = null;
  for (let i = 0; i < 60 * 4 && !land; i++) {
    m.update(1 / 60, neutral()); const b = m.ball;
    if (t0 < 0 && b.lastTouch === passer && !b.owner) t0 = m.time;
    if (t0 >= 0) { apex = Math.max(apex, b.y); if (b.y < 0.5 && b.vy < 0 && m.time - t0 > 0.3) land = { x: b.x, z: b.z, t: m.time - t0 }; if (b.lastTouch !== passer) land = { x: b.x, z: b.z, t: m.time - t0 }; }
  }
  return { land: land!, apex, mate };
}

test('lofted balls land on the team-mate: a tap floats it high, a long hold drives it in flat', () => {
  const floated = lofted(0.15), driven = lofted(1);
  for (const r of [floated, driven]) assert.ok(r.land && Math.hypot(r.land.x - r.mate.pos.x, r.land.z - r.mate.pos.z) < 3.5, `landed by the receiver (${r.land && Math.hypot(r.land.x - r.mate.pos.x, r.land.z - r.mate.pos.z).toFixed(1)} m)`);
  console.log(`  floated: apex ${floated.apex.toFixed(1)} m in ${floated.land.t.toFixed(2)} s · driven: apex ${driven.apex.toFixed(1)} m in ${driven.land.t.toFixed(2)} s`);
  assert.ok(floated.apex > driven.apex + 2, 'the tap is the higher ball');
  assert.ok(driven.land.t < floated.land.t - 0.3, 'the held one gets there quicker');
});

test('a cross to the player you control is not finished for you: shoot to head it at goal, otherwise he brings it down', () => {
  for (const press of [false, true]) {
    const { m, passer, mate } = sandbox(); const at = m.teams[0].attackDir;
    place(passer, at * 38, 26, 0, -1); place(mate, at * 44, 2, at, 0);
    (m as any).setControlled(passer); m.ball.reset(at * 38, 25.6); m.ball.owner = passer;
    m.startKick(passer, 'lob', 0.2, v2.norm({ x: at * 6, z: -24 }), { targetAgent: mate });
    let t = 0; while (t < 1 && !(m.ball.lastTouch === passer && !m.ball.owner)) { m.update(1 / 60, neutral()); t += 1 / 60; }
    assert.equal(m.controlled, mate);
    if (press) { // shoot, held a moment, while the cross is in the air
      for (let i = 0; i < 12; i++) m.update(1 / 60, press_('shoot', true, i === 0, false, { x: at, y: 0 }));
      m.update(1 / 60, press_('shoot', false, false, true, { x: at, y: 0 }));
    }
    let shot = false, headed = false;
    const busy = () => { const p = neutral(); p.sprint = { down: true, justPressed: false, justReleased: false }; return p; }; // (an active player: no auto-pilot)
    for (let i = 0; i < 60 * 4.5 && !shot; i++) { m.update(1 / 60, busy()); if (m.ball.lastTouch === mate) { headed = true; shot = !!m.ball.inFlightShot; } }
    if (press) assert.ok(shot, 'pressing shoot finishes it');
    else { assert.ok(headed || m.ball.owner === mate, 'he dealt with it'); assert.ok(!shot, 'but no shot without pressing shoot'); }
  }
});
const press_ = (k: string, down: boolean, jp: boolean, jr: boolean, move = { x: 0, y: 0 }) => { const p = neutral(); p.move = move; p[k] = { down, justPressed: jp, justReleased: jr }; return p; };

test('RB + pass is a driven pass: much quicker than a normal one, still to its man', () => {
  const speed = (driven: boolean) => {
    const { m, passer, mate } = sandbox(); place(passer, 0, 0); place(mate, 20, 0, -1, 0);
    (m as any).setControlled(passer); m.ball.reset(0.4, 0); m.ball.owner = passer;
    m.startKick(passer, 'pass', 0.5, { x: 1, z: 0 }, { targetAgent: mate, driven });
    let t = 0; while (t < 1 && !(m.ball.lastTouch === passer && !m.ball.owner)) { m.update(1 / 60, neutral()); t += 1 / 60; }
    const v0 = m.ball.speed(); const arrived = runUntil(m, 4, () => m.ball.owner === mate || m.ball.lastTouch === mate);
    return { v0, arrived };
  };
  const n = speed(false), d = speed(true);
  console.log(`  normal ${n.v0.toFixed(1)} m/s, driven ${d.v0.toFixed(1)} m/s`);
  assert.ok(d.v0 > n.v0 + 4, 'driven is much firmer');
  assert.ok(d.arrived > 0 && n.arrived > 0, 'both reach the team-mate');
});

test('a long driven pass skims low and quick to its man', () => {
  const { m, passer, mate } = sandbox(); place(passer, 0, 0); place(mate, 40, 3, -1, 0);
  (m as any).setControlled(passer); m.ball.reset(0.4, 0); m.ball.owner = passer;
  m.startKick(passer, 'pass', 0.6, v2.norm({ x: 40, z: 3 }), { targetAgent: mate, driven: true });
  let apex = 0, t0 = -1; const t = runUntil(m, 4, () => { const b = m.ball; if (t0 < 0 && b.lastTouch === passer && !b.owner) t0 = m.time; if (t0 >= 0 && b.lastTouch === passer) apex = Math.max(apex, b.y); return b.owner === mate || b.lastTouch === mate; });
  console.log(`  40 m driven pass: there in ${(m.time - t0).toFixed(2)} s, apex ${apex.toFixed(2)} m`);
  assert.ok(t > 0, 'it reached him');
  assert.ok(m.time - t0 < 2.0, 'quickly');
  assert.ok(apex < 1.4, 'and low');
});

test('double-tap pass: a bounce pass that hops on its way and still reaches its man', () => {
  const { m, passer, mate } = sandbox(); place(passer, 0, 0); place(mate, 18, 0, -1, 0);
  (m as any).setControlled(passer); m.ball.reset(0.4, 0); m.ball.owner = passer;
  m.update(1 / 60, press_('pass', true, true, false, { x: 1, y: 0 }));
  m.update(1 / 60, press_('pass', false, false, true, { x: 1, y: 0 }));
  m.update(1 / 60, neutral());
  m.update(1 / 60, press_('pass', true, true, false, { x: 1, y: 0 }));
  m.update(1 / 60, press_('pass', false, false, true, { x: 1, y: 0 }));
  let apex = 0, struck = false, bounces = 0, prevVy = 0;
  for (let i = 0; i < 60 * 3 && !(m.ball.owner === mate); i++) {
    m.update(1 / 60, neutral()); const b = m.ball;
    if (b.lastTouch === passer && !b.owner) { struck = true; apex = Math.max(apex, b.y); if (prevVy < -0.5 && b.vy > 0.3) bounces++; prevVy = b.vy; }
  }
  assert.ok(struck, 'played');
  assert.ok(apex > 0.35 && apex < 1.6, `a low hop (apex ${apex.toFixed(2)} m)`);
  assert.ok(bounces >= 1, 'it bounced on the way');
  assert.ok(m.ball.owner === mate || m.ball.lastTouch === mate, 'and reached its man');
});

test('through balls: with two runners the same way, a short hold finds the near one, a long hold the far one', () => {
  const { m, passer } = sandbox(); const mates = m.teams[0].agents; const dir = m.teams[0].attackDir;
  place(passer, 0, 0, dir, 0);
  const near = mates[9], far = mates[10]; place(near, dir * 8, 3, dir, 0); place(far, dir * 26, 5, dir, 0);
  near.vel = { x: dir * 5, z: 0 }; far.vel = { x: dir * 5, z: 0 };
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: dir, z: 0.15 }), true, false, 0.1), near);
  assert.equal(m.pickPassTarget(passer, v2.norm({ x: dir, z: 0.15 }), true, false, 0.95), far);
});

test('LB + through ball is lofted over the top; LB + shoot is a chip', () => {
  const { m, passer, mate } = sandbox(); const dir = m.teams[0].attackDir;
  place(passer, 0, 0, dir, 0); place(mate, dir * 12, 5, dir, 0);
  (m as any).setControlled(passer); m.ball.reset(dir * 0.4, 0); m.ball.owner = passer;
  m.update(1 / 60, { ...press_('through', true, true, false, { x: dir, y: 0.3 }), loft: { down: true, justPressed: false, justReleased: false } });
  m.update(1 / 60, { ...press_('through', false, false, true, { x: dir, y: 0.3 }), loft: { down: true, justPressed: false, justReleased: false } });
  let apex = 0; for (let i = 0; i < 60 * 2; i++) { m.update(1 / 60, neutral()); if (m.ball.lastTouch === passer && !m.ball.owner) apex = Math.max(apex, m.ball.y); }
  assert.ok(apex > 3, `lofted (apex ${apex.toFixed(1)} m)`);
  // the chip
  const c = sandbox(); const s = c.mate; const at = c.m.teams[0].attackDir;
  place(s, at * 34, 0, at, 0); (c.m as any).setControlled(s); c.m.ball.reset(at * 34.4, 0); c.m.ball.owner = s;
  for (let i = 0; i < 20; i++) c.m.update(1 / 60, { ...press_('shoot', true, i === 0, false, { x: at, y: 0 }), loft: { down: true, justPressed: false, justReleased: false } });
  c.m.update(1 / 60, { ...press_('shoot', false, false, true, { x: at, y: 0 }), loft: { down: true, justPressed: false, justReleased: false } });
  let ap = 0, y = -1; for (let i = 0; i < 60 * 4 && y < 0; i++) { c.m.update(1 / 60, neutral()); const b = c.m.ball; if (b.lastTouch === s && !b.owner) ap = Math.max(ap, b.y); if (Math.abs(b.x) > 52.5) y = b.y; }
  console.log(`  lofted through apex ${apex.toFixed(1)} m · chip apex ${ap.toFixed(1)} m, at the line ${y.toFixed(2)} m`);
  assert.ok(ap > 3.5, 'the chip goes up and over');
  assert.ok(y > 0 && y < 2.44, 'and drops under the bar');
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

test('a pass aimed a little off still reaches its receiver (it is solved for him, no help in flight)', () => {
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

test('the power bar sets how firmly a pass arrives, and both reach the team-mate', () => {
  const pace = (power: number) => {
    const { m, passer, mate } = sandbox();
    place(passer, 0, 0, 0, 1); place(mate, 0, 18, 0, -1);
    (m as any).setControlled(passer); m.ball.reset(0, 0.4); m.ball.owner = passer;
    m.startKick(passer, 'pass', power, { x: 0, z: 1 }, { targetAgent: mate });
    let arrive = 0, prev = 0;
    const t = runUntil(m, 4, () => { if (m.ball.lastTouch === mate && !arrive) arrive = prev; prev = m.ball.speed(); return m.ball.owner === mate; });
    return { t, arrive };
  };
  const soft = pace(0.1), firm = pace(1);
  console.log(`  soft pass arrives at ${soft.arrive.toFixed(1)} m/s, firm at ${firm.arrive.toFixed(1)} m/s`);
  assert.ok(soft.t > 0 && firm.t > 0, 'both were controlled');
  assert.ok(firm.arrive > soft.arrive + 3, 'a fuller bar zips it in');
});

test('an underhit through ball: the runner turns and comes back for it, even with the stick held forward', () => {
  for (const factor of [0.4, 0.55]) for (const human of [true, false]) {
    const { m, passer, mate } = sandbox(); const at = m.teams[0].attackDir;
    if (!human) mate.isHuman = false;
    place(passer, 0, 0, at, 0); place(mate, at * 10, 6, at, 0); mate.vel = { x: at * 7, z: 0 };
    (m as any).setControlled(passer); m.ball.reset(at * 0.4, 0); m.ball.owner = passer;
    m.startKick(passer, 'through', 0.7, v2.norm({ x: at * 10, z: 6 }), { targetAgent: mate });
    let struck = false, got = -1;
    for (let i = 0; i < 60 * 6 && got < 0; i++) {
      // the player keeps pushing forward the whole time (stick world x = attack direction)
      m.update(1 / 60, human ? { ...neutral(), move: { x: at, y: 0 } } : neutral());
      if (!struck && m.ball.lastTouch === passer && !m.ball.owner) { struck = true; m.ball.vx *= factor; m.ball.vz *= factor; m.ball.setRolling(); } // badly underhit
      if (m.ball.owner === mate) got = i / 60;
      if (human && struck && got < 0) assert.equal(m.controlled, mate, 'you keep control of the receiver while your pass is on its way');
    }
    assert.ok(got > 0 && got < 4, `${human ? 'human' : 'AI'} receiver came back and collected a ${factor * 100}%-pace ball promptly (${got.toFixed(2)} s)`);
  }
});

const press = (k: string, down: boolean, jp: boolean, jr: boolean, move = { x: 0, y: 0 }) => { const p = neutral(); p.move = move; p[k] = { down, justPressed: jp, justReleased: jr }; return p; };

test('first time: a pass pressed while the ball is on its way is played on without stopping it (one-two)', () => {
  const { m, passer, mate } = sandbox();
  place(passer, 0, 0); place(mate, 15, 0, -1, 0);
  // the A pass to the team-mate (control switches to him as it is played)
  (m as any).setControlled(passer); m.ball.reset(0.4, 0); m.ball.owner = passer;
  m.update(1 / 60, press('pass', true, true, false, { x: 1, y: 0 }));
  for (let i = 0; i < 8; i++) m.update(1 / 60, press('pass', true, false, false, { x: 1, y: 0 }));
  m.update(1 / 60, press('pass', false, false, true, { x: 1, y: 0 }));
  let t = 0; while (t < 1 && !(m.ball.lastTouch === passer && !m.ball.owner)) { m.update(1 / 60, neutral()); t += 1 / 60; }
  assert.equal(m.controlled, mate, 'control on the receiver while the ball travels');
  assert.ok(v2.dist({ x: m.ball.x, z: m.ball.z }, mate.pos) > 6, 'still well short of him');
  // press pass early, stick back toward the passer: the return ball is queued
  m.update(1 / 60, press('pass', true, true, false, { x: -1, y: 0 }));
  for (let i = 0; i < 5; i++) m.update(1 / 60, press('pass', true, false, false, { x: -1, y: 0 }));
  m.update(1 / 60, press('pass', false, false, true, { x: -1, y: 0 }));
  assert.ok(m.queued, 'queued');
  let owned = 0, returned = false;
  for (let i = 0; i < 60 * 2.5 && !returned; i++) { m.update(1 / 60, neutral()); if (m.ball.owner === mate) owned++; returned = m.ball.lastTouch === mate && !m.ball.owner && m.ball.vx < -3; }
  assert.ok(returned, 'played straight back first time');
  assert.ok(owned < 12, `not stopped and settled first (on the ball ${owned} steps)`);
});

test('first time: a shot pressed while a pass is on its way is a one-timer', () => {
  const { m, passer, mate } = sandbox();
  const at = m.teams[0].attackDir;
  place(passer, at * 30, -12, 0, 1); place(mate, at * 38, -2, at, 0);
  (m as any).setControlled(passer); m.ball.reset(at * 30, -11.6); m.ball.owner = passer;
  m.startKick(passer, 'pass', 0.5, v2.norm({ x: at * 8, z: 10 }), { targetAgent: mate });
  let t = 0; while (t < 1 && !(m.ball.lastTouch === passer && !m.ball.owner)) { m.update(1 / 60, neutral()); t += 1 / 60; }
  (m as any).setControlled(mate);
  m.update(1 / 60, press('shoot', true, true, false, { x: at, y: 0 }));
  for (let i = 0; i < 20; i++) m.update(1 / 60, press('shoot', true, false, false, { x: at, y: 0 }));
  m.update(1 / 60, press('shoot', false, false, true, { x: at, y: 0 }));
  let shot = false;
  for (let i = 0; i < 60 * 3 && !shot; i++) { m.update(1 / 60, neutral()); shot = m.ball.lastTouch === mate && !!m.ball.inFlightShot; }
  assert.ok(shot, 'struck first time at goal');
});
