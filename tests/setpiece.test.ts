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

// ---------------------------------------------------------------- penalties
function penaltyMatch(human: number | null) {
  const m = match(human); const at = m.teams[0].attackDir;
  (m as any).restart('penalty', 0, { x: at * (52.5 - 11), z: 0 });
  m.controlBasis = { right: { x: 0, z: at }, forward: { x: at, z: 0 } };
  return { m, at, pen: m.penalty! };
}
test('penalty: you aim (the cursor springs back to the middle), hold for power, and a well-timed second press puts it where you aimed', () => {
  let greens = 0, goals = 0;
  for (let k = 0; k < 6; k++) {
    const { m, pen } = penaltyMatch(0);
    for (let i = 0; i < 60 * 3 && m.phase !== 'play'; i++) m.update(1 / 60, pad());
    // the cursor follows the stick, then comes back when it's let go
    for (let i = 0; i < 30; i++) m.update(1 / 60, pad({ move: { x: 1, y: 0 } }));
    assert.ok(Math.abs(pen.aim.z) > 3, 'the cursor went to the side');
    for (let i = 0; i < 40; i++) m.update(1 / 60, pad());
    assert.ok(Math.abs(pen.aim.z) < 0.4, 'and sprang back to the middle');
    // aim bottom right, hold for power, release, then the second press timed to the strike
    const aimIn = { x: 0.85, y: -0.6 };
    for (let i = 0; i < 30; i++) m.update(1 / 60, pad({ move: aimIn, shoot: btn(true, i === 0) }));
    m.update(1 / 60, pad({ move: aimIn, shoot: btn(false, false, true) }));
    assert.equal(pen.stage, 'runup');
    let pressed = false, scored = false; m.on((e) => { if (e.type === 'goal' && e.team === 0) scored = true; });
    for (let i = 0; i < 60 * 3; i++) {
      const tm = m.penaltyTiming(); const now = !pressed && tm && tm.progress >= (tm.green[0] + tm.green[1]) / 2;
      m.update(1 / 60, pad({ move: aimIn, shoot: btn(!!now, !!now) })); if (now) pressed = true;
      if (scored) break;
    }
    if (pen.result === 'green') greens++; if (scored) goals++;
  }
  console.log(`  ${greens}/6 green, ${goals}/6 scored`);
  assert.ok(greens >= 4, 'pressing on the green zone is green timing');
  assert.ok(goals >= 4, 'well-taken penalties go in');
});
test("penalty: facing one, the stick picks the keeper's dive", () => {
  const { m, pen, at } = penaltyMatch(1); // (the human defends)
  const gk = m.teams[1].agents[0];
  for (let i = 0; i < 60 * 6 && pen.stage !== 'struck'; i++) m.update(1 / 60, pad({ move: { x: -1, y: 0 } }));
  assert.equal(pen.stage, 'struck', 'the bot took it');
  const z0 = gk.pos.z; for (let i = 0; i < 30; i++) m.update(1 / 60, pad({ move: { x: -1, y: 0 } }));
  const right = m.stickToWorld(1, 0); void at;
  assert.ok((gk.pos.z - z0) * Math.sign(right.z) < -0.8, `the keeper went the way chosen (moved ${(gk.pos.z - z0).toFixed(2)})`);
});

test('cards: a second yellow is a red, the player walks off and his side plays a man down', () => {
  const m = match(1); const events: any[] = []; m.on((e) => events.push(e));
  const by = m.teams[1].agents.find((a) => !a.isGK)!; const on = m.teams[0].agents.find((a) => !a.isGK)!;
  const n = m.teams[1].agents.length; const rnd = Math.random; Math.random = () => 0.5;
  try {
    m.setControlled(by);
    on.pos = { x: 0, z: 5 }; on.heading = { x: 1, z: 0 }; // midfield: not the last man
    (m as any).foul(by, on, true, { x: 1, z: 0 });
    assert.equal(events.filter((e) => e.type === 'foul').at(-1).card, 'yellow');
    assert.equal(by.yellow, 1); assert.equal(m.teams[1].agents.length, n);
    for (let i = 0; i < 200; i++) m.update(1 / 60, pad());
    on.pos = { x: 0, z: 5 }; on.heading = { x: 1, z: 0 };
    (m as any).foul(by, on, true, { x: 1, z: 0 });
    const e = events.filter((x) => x.type === 'foul').at(-1);
    assert.equal(e.card, 'red'); assert.ok(e.secondYellow);
    assert.equal(m.teams[1].reds, 1); assert.equal(m.teams[1].agents.length, n - 1);
    assert.ok(!m.agents.includes(by) && m.benched.includes(by));
    assert.notEqual(m.controlled, by, 'control moves to a teammate');
    assert.equal(m.controlled!.team, 1);
  } finally { Math.random = rnd; }
  for (let i = 0; i < 600; i++) m.update(1 / 60, pad());
  assert.ok(Math.abs(by.pos.z) > m.pitch.width / 2, 'off the pitch');
});

test('a ball the keeper catches stays his: a team-mate shaping to take it does not end up holding it', () => {
  const m = match(0); const b = m.ball;
  const gk = m.teams[0].agents.find((a) => a.isGK)!; const def = m.teams[0].agents.find((a) => !a.isGK)!;
  const gx = -m.teams[0].attackDir * 52.5;
  gk.pos = { x: gx * 0.9, z: 0 }; def.pos = { x: gx * 0.9 + m.teams[0].attackDir * 0.8, z: 0.3 };
  b.reset(gk.pos.x + m.teams[0].attackDir * 0.4, 0.2); b.y = 0.9;
  def.startAction('trap', 0.4, 1, { side: 'R', contact: { x: b.x, y: b.y, z: b.z }, tc: 0.05, part: 'chest', done: false });
  (m as any).keeperHands(gk);
  for (let i = 0; i < 30; i++) m.update(1 / 60, pad());
  assert.ok(b.owner === gk || !b.held, 'nobody but the keeper has it in his hands');
  // and if it ever happens, it is dropped to his feet and playable
  b.owner = def; b.held = true;
  m.update(1 / 60, pad());
  assert.equal(b.held, false); assert.ok(b.y < 0.3);
});

test('offside: a team-mate beyond the second-last defender when it is played is flagged when he touches it; one level is not', () => {
  const m = match(0); const events: any[] = []; m.on((e) => events.push(e));
  (m as any).phase = 'play'; (m as any).setPiece = null;
  const dir = m.teams[0].attackDir; const [passer, fwd] = m.teams[0].agents.filter((a) => !a.isGK);
  passer.pos = { x: dir * 5, z: 0 }; m.ball.reset(passer.pos.x + dir * 0.4, 0);
  const line = m.offsideLine(0);
  fwd.pos = { x: dir * (line - 1), z: 4 };
  (m as any).markOffside(passer, 'through', false);
  assert.ok(!m.offsideWatch?.marks.has(fwd), 'level/behind: onside');
  fwd.pos = { x: dir * (line + 3), z: 4 };
  assert.ok(m.inOffsidePosition(fwd));
  (m as any).markOffside(passer, 'through', false);
  assert.ok(m.offsideWatch?.marks.has(fwd));
  (m as any).markOffside(passer, 'through', true); // (a throw-in, goal kick or corner)
  assert.equal(m.offsideWatch, null);
  (m as any).markOffside(passer, 'through', false);
  m.ball.lastTouch = fwd; m.ball.lastTouchTeam = 0; m.ball.lastTouchTime = m.time + 0.01;
  (m as any).checkOffside();
  assert.equal(events.at(-1)?.type, 'offside'); assert.equal(m.phase, 'dead');
  // the AI keeps its runners on the line
  const ai = match(null); (ai as any).phase = 'play';
  for (let i = 0; i < 600; i++) ai.update(1 / 60);
  for (const t of [0, 1]) {
    const dirT = ai.teams[t].attackDir; const ln = ai.offsideLine(t);
    const off = ai.teams[t].agents.filter((a) => !a.isGK && a.pos.x * dirT > ln + 2.5 && a.ai.mode === 'shape');
    assert.ok(off.length === 0, `team ${t}: ${off.length} loitering offside`);
  }
});

test('your side heads a cross only when you press: control moves to the man meeting it and he cushions it', () => {
  const m = match(0); (m as any).phase = 'play'; m.passAssist = null;
  const dir = m.teams[0].attackDir; const outs = m.teams[0].agents.filter((a) => !a.isGK);
  const mate = outs.find((a) => a !== m.controlled)!; const crosser = outs.find((a) => a !== mate)!;
  mate.pos = { x: dir * 40, z: 2 }; mate.vel = { x: 0, z: 0 }; mate.heading = { x: -dir, z: 0 }; mate.action = null; mate.cooldown = 0;
  for (const a of m.agents) if (a !== mate && a.team === 1) a.pos = { x: a.pos.x, z: -30 };
  const b = m.ball; b.reset(mate.pos.x - dir * 4, mate.pos.z); b.y = 1.9; b.vx = dir * 12; b.vy = 1.4; b.vz = 0;
  b.lastTouch = crosser; b.lastTouchTeam = 0; b.lastTouchTime = m.time; b.inFlightShot = null;
  (m as any).anticipate();
  assert.equal(m.controlled, mate, 'you take over the man meeting the cross');
  assert.equal(mate.action?.type, 'header');
  assert.equal(mate.action!.data.control, true, 'no press: cushioned, not headed at goal');
});
