import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, v2 } from '../src/game/pitch';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

const btn = (down = false, justPressed = false, justReleased = false) => ({ down, justPressed, justReleased });
const pad = (o: Record<string, any> = {}) => ({ move: { x: 0, y: 0 }, sprint: btn(), pass: btn(), shoot: btn(), through: btn(), lob: btn(), switch: btn(), slide: btn(), finesse: btn(), shield: btn(), ...o }) as any;

/** A striker 22 m out, keeper parked off his line so every shot reaches the goal line. */
function setup(z0 = 6) {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script: null, durationSec: 3000, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  m.agents.forEach((a, i) => { a.isHuman = true; a.pos = { x: -45 + (i % 6) * 2, z: -30 + Math.floor(i / 6) * 2 }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; });
  m.phase = 'play'; m.phaseTimer = 0; m.setPiece = null; m.controlBasis = { right: { x: 1, z: 0 }, forward: { x: 0, z: 1 } };
  const at = m.teams[0].attackDir; const s = m.teams[0].agents[9];
  s.pos = { x: at * 30.5, z: z0 }; s.prevPos = { ...s.pos }; s.heading = { x: at, z: 0 };
  (m as any).setControlled(s); m.ball.reset(at * 31, z0); m.ball.owner = s;
  return { m, s, at };
}
/** Fly the shot to the goal line: apex, height and position there, and how far it bent off its starting line. */
function flight(m: Match, s: any, input?: () => any) {
  let apex = 0, y = -1, z = 0, start: any = null, bend = 0;
  for (let i = 0; i < 60 * 4; i++) {
    m.update(1 / 60, input ? input() : pad()); const b = m.ball;
    if (b.lastTouch === s && !b.owner) {
      apex = Math.max(apex, b.y);
      if (!start) start = { x: b.x, z: b.z, vx: b.vx, vz: b.vz };
      else { const l = Math.hypot(start.vx, start.vz); bend = Math.max(bend, Math.abs(((b.x - start.x) * start.vz - (b.z - start.z) * start.vx) / l)); }
    }
    if (Math.abs(b.x) > 52.0) { y = b.y; z = b.z; break; } // (half a metre out: a shot that clips the post still counts as reaching goal)
  }
  return { apex, y, z, bend, started: !!start };
}

test('a full-power shot is a clean, driven strike, not a skied one', () => {
  for (let k = 0; k < 6; k++) {
    const { m, s, at } = setup(k % 2 ? 6 : -6);
    m.startKick(s, 'shoot', 1, v2.norm({ x: at * 22, z: (k % 2 ? 1 : -1) * 2.5 - (k % 2 ? 6 : -6) }), {});
    const f = flight(m, s);
    assert.ok(f.y >= 0 && f.y < 2.44, `under the bar (crossed at ${f.y.toFixed(2)} m)`);
    assert.ok(f.apex < 2.8, `a driven trajectory (apex ${f.apex.toFixed(1)} m)`);
  }
});

test('a finesse shot curls; a low driven shot skims the turf', () => {
  const fin = setup(-8); fin.m.startKick(fin.s, 'shoot', 0.7, v2.norm({ x: fin.at * 22, z: 10.5 }), { finesse: true });
  const f = flight(fin.m, fin.s);
  assert.ok(f.bend > 1.2, `the finesse shot bent ${f.bend.toFixed(1)} m`);
  const low = setup(4); low.m.startKick(low.s, 'shoot', 0.8, v2.norm({ x: low.at * 22, z: -6 }), { low: true });
  const l = flight(low.m, low.s);
  assert.ok(l.apex < 0.6, `the low shot stayed low (apex ${l.apex.toFixed(2)} m)`);
});

test('the controls: hold-and-release shoots, a double tap then hold is a low driven shot', () => {
  const run = (frames: Array<Record<string, any>>) => {
    const { m, s, at } = setup(0); let i = 0;
    const f = flight(m, s, () => { const o = frames[i++] ?? {}; return pad({ move: { x: at, y: 0 }, ...o }); });
    return f;
  };
  const hold = (n: number) => Array.from({ length: n }, () => ({ shoot: btn(true) }));
  // hold for ~0.4 s and release: a power shot
  const power = run([{ shoot: btn(true, true) }, ...hold(24), { shoot: btn(false, false, true) }]);
  assert.ok(power.started && power.apex > 0.6, `power shot rises (apex ${power.apex.toFixed(2)})`);
  // tap, tap-and-hold, release: a low shot
  const low = run([{ shoot: btn(true, true) }, ...hold(3), { shoot: btn(false, false, true) }, {}, {}, {}, { shoot: btn(true, true) }, ...hold(24), { shoot: btn(false, false, true) }]);
  assert.ok(low.started && low.apex < 0.6, `low shot stays down (apex ${low.apex.toFixed(2)})`);
  // a single quick tap still shoots (after a short wait for a second tap)
  const tap = run([{ shoot: btn(true, true) }, ...hold(3), { shoot: btn(false, false, true) }]);
  assert.ok(tap.started, 'a tap shoots');
});
