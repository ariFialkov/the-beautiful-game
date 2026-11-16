import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11 } from '../src/game/pitch';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

// The keyboard is driven through the real InputManager: a stub window that receives key events.
const listeners = new Map<string, Array<(e: any) => void>>();
(globalThis as any).window = {
  addEventListener: (t: string, f: (e: any) => void) => { listeners.set(t, [...(listeners.get(t) ?? []), f]); },
  innerWidth: 1280, innerHeight: 720,
};
const fire = (type: 'keydown' | 'keyup', code: string) => { for (const f of listeners.get(type) ?? []) f({ code, target: null, preventDefault() {} }); };
const { InputManager } = await import('../src/input/input');

function kb() { const i = new InputManager(); i.menuMode = false; return i; }
function onTheBall() {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script: null, durationSec: 3000, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  m.agents.forEach((a, i) => { a.isHuman = true; a.pos = { x: 40 + (i % 6) * 2, z: -30 + Math.floor(i / 6) * 2 }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; });
  m.phase = 'play'; m.phaseTimer = 0; m.setPiece = null;
  m.controlBasis = { right: { x: 0, z: 1 }, forward: { x: 1, z: 0 } };
  const p = m.teams[0].agents[8]; p.pos = { x: 0, z: 0 }; p.prevPos = { x: 0, z: 0 }; p.heading = { x: 1, z: 0 };
  (m as any).setControlled(p); m.ball.reset(0.42, 0); m.ball.owner = p;
  const events: any[] = []; m.on((e) => events.push(e));
  return { m, p, events };
}
const run = (m: Match, i: InstanceType<typeof InputManager>, frames: number) => { for (let k = 0; k < frames; k++) { i.update(); m.update(1 / 60, i); } };

test('keyboard: the right hand plays - K pass, L shoot, I through, J cross; U and O are the bumpers; H shields', () => {
  const i = kb();
  const press = (code: string) => { fire('keydown', code); i.update(); const s = { pass: i.pass.down, shoot: i.shoot.down, through: i.through.down, lob: i.lob.down, slide: i.slide.down, sw: i.switch.down, loft: i.loft.down, fin: i.finesse.down, shield: i.shield.down }; fire('keyup', code); i.update(); return s; };
  assert.ok(press('KeyK').pass); assert.ok(press('KeyL').shoot); assert.ok(press('KeyI').through);
  const j = press('KeyJ'); assert.ok(j.lob && j.slide, 'J: cross, and slide tackle when defending');
  const u = press('KeyU'); assert.ok(u.sw && u.loft, 'U: switch player, and the loft modifier');
  assert.ok(press('KeyO').fin); assert.ok(press('Semicolon').fin); assert.ok(press('KeyH').shield);
  // the old left-hand action keys are free again (no accidental shots while moving)
  for (const old of ['KeyZ', 'KeyX', 'KeyC', 'KeyQ', 'KeyE', 'KeyR', 'KeyF']) { const s = press(old); assert.ok(!Object.values(s).some(Boolean), `${old} does nothing now`); }
});

test('keyboard: WASD moves; holding Space turns WASD into the skill stick while he keeps running', () => {
  const i = kb();
  fire('keydown', 'KeyD'); i.update(); assert.deepEqual([i.move.x, i.aim.x], [1, 0]);
  fire('keydown', 'Space'); i.update(); fire('keyup', 'KeyD'); fire('keydown', 'KeyA'); i.update();
  assert.equal(i.aim.x, -1, 'A flicks the skill stick left'); assert.equal(i.move.x, 1, 'and he carries on running right');
  fire('keyup', 'KeyA'); fire('keyup', 'Space'); i.update();
  assert.deepEqual([i.move.x, i.aim.x], [0, 0], 'Space let go: WASD moves again');
  fire('keydown', 'ArrowLeft'); i.update(); assert.equal(i.aim.x, -1, 'the arrows still work as a skill stick'); fire('keyup', 'ArrowLeft'); i.update();
});

test('keyboard in a match: K plays a pass, Space + a flick does a skill move, L shoots', () => {
  { const { m, i, events } = { ...onTheBall(), i: kb() };
    fire('keydown', 'KeyK'); run(m, i, 8); fire('keyup', 'KeyK'); run(m, i, 40);
    assert.ok(events.some((e) => e.type === 'kick' && e.kind === 'pass'), 'K passed it'); }
  { const { m, i, events } = { ...onTheBall(), i: kb() };
    fire('keydown', 'Space'); run(m, i, 2); fire('keydown', 'KeyD'); run(m, i, 4); fire('keyup', 'KeyD'); run(m, i, 3); fire('keyup', 'Space'); run(m, i, 30);
    const sk = events.find((e) => e.type === 'skill');
    assert.ok(sk, 'Space + D: a skill move'); console.log(`  Space + D (a flick to his side): ${sk.move}`); }
  { const { m, i, events } = { ...onTheBall(), i: kb() };
    fire('keydown', 'KeyL'); run(m, i, 20); fire('keyup', 'KeyL'); run(m, i, 40);
    assert.ok(events.some((e) => e.type === 'kick' && e.kind === 'shoot'), 'L shot'); }
});
