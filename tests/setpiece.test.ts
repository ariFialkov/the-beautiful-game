import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, v2 } from '../src/game/pitch';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

const btn = (down = false, justPressed = false, justReleased = false) => ({ down, justPressed, justReleased });
const pad = (o: Record<string, any> = {}) => ({ move: { x: 0, y: 0 }, sprint: btn(), pass: btn(), shoot: btn(), through: btn(), lob: btn(), switch: btn(), slide: btn(), finesse: btn(), shield: btn(), touchCurl: 0, ...o }) as any;

function match(human: number | null) {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: human, script: null, durationSec: 3000, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  for (let i = 0; i < 30; i++) m.update(1 / 60, human === null ? undefined : pad());
  return m;
}
/** A free kick to the home side, `dist` m from goal and `z` across. The camera sits behind the taker (as in the game). */
function freeKick(m: Match, dist: number, z: number) {
  const at = m.teams[0].attackDir;
  (m as any).restart('freekick', 0, { x: at * (52.5 - dist), z });
  m.controlBasis = { right: { x: 0, z: at }, forward: { x: at, z: 0 } };
  return m.freeKick!;
}

test('free kick: a full wall close in, a short one wide, none when it can only be passed', () => {
  const m = match(null); const fk = freeKick(m, 19, -3);
  assert.ok(fk.direct, 'a shooting chance');
  assert.equal(fk.wall.length, 5);
  const gx = m.teams[0].attackDir * 52.5;
  for (const p of fk.wallSpots) {
    assert.ok(v2.dist(p, fk.pos) >= 9.15, 'the wall is the full distance away');
    assert.ok(Math.abs(p.x - fk.pos.x) < Math.abs(gx - fk.pos.x), 'between the ball and the goal');
  }
  for (const a of fk.wall) assert.ok(v2.dist(a.pos, fk.pos) >= 9.15 && a.team === 1);
  // the wall covers the near post; the keeper shades to the other side
  assert.equal(fk.nearSide, -1);
  assert.ok(fk.keeperZ > 0.4, `keeper at z ${fk.keeperZ}`);
  assert.equal(freeKick(match(null), 28, 2).wall.length, 3);
  const far = freeKick(match(null), 55, 10);
  assert.ok(!far.direct && far.wall.length === 0, 'a free kick from deep: no wall');
});

test('free kick: the human lines it up at leisure, aims, curls and strikes it; the wall jumps', () => {
  const m = match(0); const fk = freeKick(m, 22, 3);
  const taker = fk.taker; assert.equal(m.controlled, taker);
  // nothing happens on its own: no auto-pilot, no kick
  for (let i = 0; i < 60 * 6; i++) m.update(1 / 60, pad());
  assert.ok(m.freeKick && !m.autopilot && m.ball.owner === taker, 'still waiting for the taker');
  // the stick moves the aim across the goal (to the right of the screen, and up)
  const z0 = fk.aim.z, y0 = fk.aim.y;
  for (let i = 0; i < 20; i++) m.update(1 / 60, pad({ move: { x: 1, y: 0.5 } }));
  const right = m.stickToWorld(1, 0);
  assert.ok((fk.aim.z - z0) * Math.sign(right.z) > 0.6 && fk.aim.y > y0 + 0.2, 'aim moved right and up');
  // curl with RB
  for (let i = 0; i < 30; i++) m.update(1 / 60, pad({ finesse: btn(true) }));
  assert.ok(fk.curl > 0.6, `curl ${fk.curl}`);
  // hold shoot for power, then release
  for (let i = 0; i < 36; i++) m.update(1 / 60, pad({ shoot: btn(true, i === 0) }));
  assert.equal(m.charge?.kind, 'fk');
  m.update(1 / 60, pad({ shoot: btn(false, false, true) }));
  let struck = false, jumped = false;
  for (let i = 0; i < 90 && !struck; i++) { m.update(1 / 60, pad()); struck = m.ball.lastTouch === taker && !m.ball.owner; }
  assert.ok(struck, 'the taker steps up and strikes it');
  assert.equal(m.freeKick, null, 'the free kick is over once it is struck');
  for (const w of fk.wall) jumped ||= w.action?.type === 'header';
  assert.ok(jumped, 'the wall jumps');
  assert.ok(m.ball.inFlightShot, 'a shot at goal');
});

test('free kick: curl bends the ball the way it is set (round the wall) and it still finds the aim', () => {
  for (const curl of [1, -1]) {
    const m = match(0); const fk = freeKick(m, 24, 0);
    for (const w of fk.wall) { w.pos = { x: w.pos.x, z: 30 }; w.prevPos = { ...w.pos }; } // (out of the way)
    const gk = m.teams[1].agents[0]; gk.pos = { x: 0, z: -30 }; gk.prevPos = { ...gk.pos };
    for (let i = 0; i < 70; i++) m.update(1 / 60, pad());
    const taker = fk.taker; const at = m.teams[0].attackDir;
    m.takeFreeKickShot(taker, 0.6, 2.2, 1.5, curl);
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < 60 * 3; i++) {
      m.update(1 / 60, pad()); const b = m.ball;
      if (b.lastTouch === taker && !b.owner) pts.push({ x: b.x, z: b.z });
      if (pts.length && Math.abs(b.x) > 52.5) break;
    }
    assert.ok(pts.length > 10 && Math.abs(pts[pts.length - 1].x) > 52.5, 'the strike reaches the goal line');
    const s0 = pts[0], s1 = pts[pts.length - 1];
    assert.ok(Math.abs(s1.z - 2.2) < 1.2, `curl ${curl}: crossed at z ${s1.z.toFixed(2)} (aimed 2.2)`);
    // the arc's side of the straight line: a ball bending to the taker's right bows out to his left
    const chord = v2.norm(v2.sub(s1, s0)); const rightOf = { x: -chord.z, z: chord.x }; void at;
    let bow = 0; for (const p of pts) { const off = (p.x - s0.x) * rightOf.x + (p.z - s0.z) * rightOf.z; if (Math.abs(off) > Math.abs(bow)) bow = off; }
    assert.ok(Math.abs(bow) > 0.4, `it bends (${bow.toFixed(2)} m)`);
    assert.equal(Math.sign(bow), -curl, `curl ${curl} bows ${bow.toFixed(2)} m`);
  }
});

test('free kick: a bot taker lines it up, then strikes over or round the wall', () => {
  let cleared = 0, shots = 0, waited = true;
  for (let k = 0; k < 10; k++) {
    const m = match(null); const fk = freeKick(m, 18 + (k % 4) * 3, (k % 5) - 2); const wall = fk.wall.slice(); const t0 = m.time;
    let kickAt = -1, hitWall = false;
    for (let i = 0; i < 60 * 7; i++) {
      m.update(1 / 60); const b = m.ball;
      if (kickAt < 0 && m.lastFreeKick) kickAt = m.time - t0;
      if (kickAt > 0 && wall.includes(b.lastTouch as any)) hitWall = true;
      if (kickAt > 0 && (Math.abs(b.x) > 52.6 || b.lastTouch?.isGK)) break;
    }
    if (kickAt > 0 && kickAt < 2.5) waited = false;
    if (kickAt > 0 && m.lastFreeKick?.direct) { shots++; if (!hitWall) cleared++; } // (a bot may play it short instead)
  }
  assert.ok(waited, 'the taker takes a moment over it');
  assert.ok(shots >= 5 && cleared >= shots * 0.8, `cleared the wall ${cleared}/${shots}`);
});
