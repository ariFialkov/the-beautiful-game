import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Match } from '../src/game/match';
import { PITCH_11, PITCH_FUTSAL } from '../src/game/pitch';
import { CameraRig, groundBasis } from '../src/render/camera';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

/** For the broadcast camera at several ball positions, a stick push must move a player the same way on screen. */
for (const futsal of [false, true]) {
  test(`stick directions match the screen (${futsal ? 'futsal' : '11-a-side'})`, () => {
    const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
    const xi = (id: string) => { const s = startingXI(rosterOf(id)); return futsal ? [s[0], s[2], s[8], s[10], s[9]] : s; };
    const pitch = futsal ? PITCH_FUTSAL : PITCH_11;
    const m = new Match({ pitch, mode: futsal ? 'futsal' : 'kickoff', humanTeam: 0, script: null, durationSec: 300, clockMinutes: 90,
      teams: [{ team: home, players: xi(home.id), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: xi(away.id), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
    const cam = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 600);
    const rig = new CameraRig(cam, pitch.length, pitch.width);
    const L = pitch.length / 2, W = pitch.width / 2;
    for (const [bx, bz] of [[0, 0], [L * 0.7, 0], [-L * 0.7, 0], [0, W * 0.8], [0, -W * 0.8], [L * 0.6, -W * 0.6]]) {
      const target = new THREE.Vector3(bx, 0.1, bz);
      for (let i = 0; i < 300; i++) rig.update(1 / 60, target, new THREE.Vector3(1, 0, 0), i / 60);
      cam.updateMatrixWorld();
      m.controlBasis = groundBasis(cam);
      const screen = (p: { x: number; z: number }) => new THREE.Vector3(p.x, 0, p.z).project(cam);
      const at = (sx: number, sy: number) => { const d = m.stickToWorld(sx, sy); const a = screen({ x: bx, z: bz }), b = screen({ x: bx + d.x * 2, z: bz + d.z * 2 }); return { dx: b.x - a.x, dy: b.y - a.y }; };
      const where = `ball (${bx.toFixed(0)}, ${bz.toFixed(0)})`;
      const r = at(1, 0), l = at(-1, 0), u = at(0, 1), d = at(0, -1);
      assert.ok(r.dx > 0 && Math.abs(r.dx) > Math.abs(r.dy) * 2, `right at ${where}: ${JSON.stringify(r)}`);
      assert.ok(l.dx < 0 && Math.abs(l.dx) > Math.abs(l.dy) * 2, `left at ${where}: ${JSON.stringify(l)}`);
      assert.ok(u.dy > 0 && Math.abs(u.dy) > Math.abs(u.dx), `up at ${where}: ${JSON.stringify(u)}`);
      assert.ok(d.dy < 0 && Math.abs(d.dy) > Math.abs(d.dx), `down at ${where}: ${JSON.stringify(d)}`);
    }
  });
}

// ---------------------------------------------------------------- the goalkeeper in your hands
import { Match as M2 } from '../src/game/match';
import { PITCH_11 as P11, v2 as V2 } from '../src/game/pitch';
import { TEAM_BY_ID as TB, rosterOf as RO, startingXI as SX } from '../shared/teams';
const kb = (o: Record<string, any> = {}) => { const b = () => ({ down: false, justPressed: false, justReleased: false }); return { move: { x: 0, y: 0 }, sprint: b(), pass: b(), shoot: b(), through: b(), lob: b(), switch: b(), slide: b(), finesse: b(), shield: b(), ...o } as any; };
function keeperMatch() {
  const home = TB['lon-royals'], away = TB['mad-blancos'];
  const m = new M2({ pitch: P11, mode: 'kickoff', humanTeam: 0, script: null, durationSec: 3000, clockMinutes: 90,
    teams: [{ team: home, players: SX(RO(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: SX(RO(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  for (let i = 0; i < 30; i++) m.update(1 / 60, kb());
  m.phase = 'play'; m.phaseTimer = 0; m.setPiece = null;
  for (const a of m.teams[1].agents) { a.pos = { x: a.pos.x * 0.2, z: a.pos.z }; a.prevPos = { ...a.pos }; } // (opponents out of the way)
  const gk = m.teams[0].agents[0]; const at = m.teams[0].attackDir;
  gk.pos = { x: -at * 49, z: 0 }; gk.prevPos = { ...gk.pos }; gk.heading = { x: at, z: 0 };
  m.controlBasis = { right: { x: 0, z: at }, forward: { x: at, z: 0 } };
  m.ball.reset(gk.pos.x, 0); m.ball.owner = gk; m.ball.held = true; gk.ai.dive = null;
  return { m, gk, at };
}
test('keeper: in his hands you control him: walk with it, then roll it out, throw it, or drop-kick it', () => {
  for (const [btn, kind] of [['pass', 'roll'], ['lob', 'throw'], ['shoot', 'punt']] as const) {
    const { m, gk, at } = keeperMatch();
    m.update(1 / 60, kb()); assert.equal(m.controlled, gk, 'control goes to the keeper with the ball');
    const x0 = gk.pos.x; for (let i = 0; i < 40; i++) m.update(1 / 60, kb({ move: { x: 0, y: 1 } }));
    assert.ok((gk.pos.x - x0) * at > 1, 'he walks with it');
    assert.ok(m.ball.held && m.ball.owner === gk, 'still in his hands');
    for (let i = 0; i < (kind === 'punt' ? 55 : 20); i++) m.update(1 / 60, kb({ [btn]: { down: true, justPressed: i === 0, justReleased: false }, move: { x: 0, y: 1 } })); // (a full bar for the long kick)
    m.update(1 / 60, kb({ [btn]: { down: false, justPressed: false, justReleased: true }, move: { x: 0, y: 1 } }));
    let apex = 0, dist = 0; const p0 = { x: m.ball.x, z: m.ball.z };
    for (let i = 0; i < 60 * 3; i++) { m.update(1 / 60, kb()); if (m.ball.lastTouch === gk && !m.ball.owner) { apex = Math.max(apex, m.ball.y); dist = Math.max(dist, V2.dist(p0, { x: m.ball.x, z: m.ball.z })); } }
    console.log(`  ${kind}: apex ${apex.toFixed(1)} m, travelled ${dist.toFixed(0)} m`);
    assert.ok(dist > 8, `${kind}: released`);
    if (kind === 'roll') assert.ok(apex < 0.6, 'rolled along the floor');
    if (kind === 'punt') assert.ok(dist > 30 && apex > 6, 'a long high drop kick');
    assert.notEqual(m.controlled, gk, 'control moved off the keeper');
  }
});
test('keeper: dropping it to his feet, and an easy back pass to him', () => {
  const { m, gk } = keeperMatch(); m.update(1 / 60, kb());
  m.update(1 / 60, kb({ through: { down: true, justPressed: true, justReleased: false } }));
  for (let i = 0; i < 20; i++) m.update(1 / 60, kb());
  assert.ok(!m.ball.held && m.ball.owner === gk, 'at his feet, his to play');
  // a defender aiming roughly back at him finds him
  const def = m.teams[0].agents[2]; def.pos = { x: gk.pos.x + m.teams[0].attackDir * 18, z: 6 }; def.prevPos = { ...def.pos };
  const back = V2.norm(V2.sub(gk.pos, def.pos)); const off = { x: back.x + back.z * 0.3, z: back.z - back.x * 0.3 };
  assert.equal(m.pickPassTarget(def, V2.norm(off), false), gk);
});
test('keeper: you take goal kicks yourself, aimed with the stick: pass short, cross, or boot it long', () => {
  const { m, gk, at } = keeperMatch(); m.ball.held = false; m.ball.owner = null;
  (m as any).restart('goalkick', 0, { x: -at * 47, z: 6 });
  assert.equal(m.controlled, gk, 'the keeper is yours for the goal kick');
  for (let i = 0; i < 60 * 6 && m.phase !== 'play'; i++) m.update(1 / 60, kb({ sprint: { down: true, justPressed: false, justReleased: false } }));
  for (let i = 0; i < 50; i++) m.update(1 / 60, kb({ shoot: { down: true, justPressed: i === 0, justReleased: false }, move: { x: 0, y: 1 } }));
  m.update(1 / 60, kb({ shoot: { down: false, justPressed: false, justReleased: true }, move: { x: 0, y: 1 } }));
  let dist = 0; const p0 = { x: m.ball.x, z: m.ball.z };
  for (let i = 0; i < 60 * 3; i++) { m.update(1 / 60, kb()); if (m.ball.lastTouch === gk) dist = Math.max(dist, V2.dist(p0, { x: m.ball.x, z: m.ball.z })); }
  assert.ok(dist > 35, `booted upfield (${dist.toFixed(0)} m)`);
});
