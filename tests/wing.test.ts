import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, v2 } from '../src/game/pitch';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
const B = () => ({ down: false, justPressed: false, justReleased: false, heldTime: 0 });
function pitch() {
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script: null, durationSec: 3000, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  const D = m.teams[0].attackDir;
  m.agents.forEach((a, i) => { a.pos = { x: -D * 45 + (i % 5), z: -30 + i * 2 }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; });
  m.phase = 'play'; m.phaseTimer = 0; m.setPiece = null; m.controlBasis = { right: { x: 0, z: D }, forward: { x: D, z: 0 } };
  return { m, D };
}

test('a through ball down the touchline to a winger at full speed stays in play and he takes it in his stride', () => {
  for (const [wx, wz, px, pz, az] of [[0, 31, -6, 18, 0.6], [5, 32, -2, 25, 0.3], [-10, 30, -12, 10, 0.8]]) for (const power of [0.15, 1]) {
    const { m, D } = pitch();
    const p = m.teams[0].agents[6]; p.pos = { x: D * px, z: pz }; p.prevPos = { ...p.pos }; p.heading = { x: D, z: 0 };
    const w = m.teams[0].agents[8]; w.pos = { x: D * wx, z: wz }; w.prevPos = { ...w.pos }; w.heading = { x: D, z: 0 };
    (m as any).setControlled(p); m.ball.reset(p.pos.x + D * 0.42, p.pos.z); m.ball.owner = p;
    (m as any).markOffside = () => {}; // (a passing drill with no defenders back: no offside)
    let kicked = false, out = false; m.on((e) => { if (e.type === 'kick') kicked = true; if (e.type === 'out') out = true; });
    const aim = v2.norm({ x: D, z: az }); const tgt = m.pickPassTarget(p, aim, true, false, power);
    assert.equal(tgt, w, 'the winger is the target');
    m.startKick(p, 'through', power, aim, { targetAgent: tgt ?? undefined });
    // he's holding the stick down the line, sprinting
    const inp: any = { move: { x: 0, y: 1 }, aim: { x: 0, y: 0 }, sprint: { ...B(), down: true }, pass: B(), shoot: B(), through: B(), lob: B(), switch: B(), slide: B(), finesse: B(), shield: B(), loft: B(), skillMod: B(), pause: B(), touchCurl: 0, passKey: false, lastSource: 'gamepad' };
    let got = false; let zGot = 0;
    for (let i = 0; i < 60 * 6 && !got && !out; i++) { if (!kicked) w.vel = { x: D * w.maxSpeed * 0.95, z: 0 }; m.update(1 / 60, m.controlled === w ? inp : undefined); if (kicked && m.ball.owner === w) { got = true; zGot = m.ball.z; } }
    assert.ok(!out, `(${wx},${wz}) p${power}: it ran out of play`);
    assert.ok(got, `(${wx},${wz}) p${power}: the winger got it (owner ${m.ball.owner?.role} ball (${(m.ball.x * D).toFixed(1)},${m.ball.z.toFixed(1)}) w (${(w.pos.x * D).toFixed(1)},${w.pos.z.toFixed(1)}) ctrl ${m.controlled?.role})`);
    assert.ok(zGot > 26, `(${wx},${wz}) p${power}: taken out wide on his line (z ${zGot.toFixed(1)}), not after cutting inside for it`);
  }
});

test('lofted balls: aimed at the back post or across the field, they find the free man out there, not the covered one in between', () => {
  const { m, D } = pitch(); const t = m.teams[0].agents; const opp = m.teams[1].agents;
  const put = (a: any, x: number, z: number) => { a.pos = { x: D * x, z }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; };
  // a cross from the right: the striker at the near post is marked, a runner at the back post is free
  const wing = t[8]; put(wing, 38, 26); const near = t[9]; put(near, 44, 5); const far = t[10]; put(far, 41, -8);
  put(opp[2], 44.6, 4.2); put(opp[3], 45.5, 6);
  for (const p of [0.35, 0.6, 0.9]) assert.equal(m.pickPassTarget(wing, v2.norm({ x: D * 0.08, z: -1 }), false, true, p), far, `back post at power ${p}`);
  // a long diagonal from the left back to the right winger, past a covered midfielder
  const lb = t[4]; put(lb, -10, -26); const cm = t[7]; put(cm, 2, -6); const rw = t[8]; put(rw, 8, 27); put(opp[4], 3.5, -5);
  for (const p of [0.6, 0.8, 1]) assert.equal(m.pickPassTarget(lb, v2.norm({ x: D * 0.45, z: 1 }), false, true, p), rw, `switch at power ${p}`);
});
