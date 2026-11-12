import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/game/player';
import { TEAMS, rosterOf } from '../shared/teams';

const card = (stamina: number) => { const c = structuredClone(rosterOf(TEAMS[0].id)[9]); c.attrs.stamina = stamina; return c; };
/** Run him for `sec` seconds at a given pace (sprinting or not), a full match's worth of drain per real second. */
function work(a: Agent, sec: number, speed: number, sprint: boolean) {
  for (let t = 0; t < sec; t += 1 / 60) { a.vel = { x: speed, z: 0 }; a.intent.sprint = sprint; a.tire(1 / 60, 1); }
}

test('stamina: every player has the stat, spread by position and build', () => {
  const all = TEAMS.flatMap((t) => rosterOf(t.id));
  assert.ok(all.every((p) => typeof p.attrs.stamina === 'number' && p.attrs.stamina >= 35 && p.attrs.stamina <= 99));
  const avg = (pos: string[]) => { const xs = all.filter((p) => pos.includes(p.position)).map((p) => p.attrs.stamina!); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  assert.ok(avg(['CM', 'CDM', 'LB', 'RB']) > avg(['GK']) + 5, 'the engine room outlasts the keepers');
});

test('stamina: sprinting runs a player down, a high stamina stat lasts longer, and walking brings it back', () => {
  const lo = new Agent(card(50), 0, 0), hi = new Agent(card(95), 0, 0);
  assert.equal(lo.energy, 1); assert.equal(hi.energy, 1);
  work(lo, 60, 8.5, true); work(hi, 60, 8.5, true);
  console.log(`  a minute of sprinting: stamina 50 -> ${(lo.energy * 100).toFixed(0)}%, stamina 95 -> ${(hi.energy * 100).toFixed(0)}%`);
  assert.ok(lo.energy < 0.6 && hi.energy > lo.energy + 0.15, 'the fitter man has more left');
  const jog = new Agent(card(70), 0, 0); work(jog, 60, 3, false); const spr = new Agent(card(70), 0, 0); work(spr, 60, 8.5, true);
  assert.ok(jog.energy > spr.energy + 0.2, 'jogging costs far less than sprinting');
  const before = lo.energy; work(lo, 30, 0.5, false);
  assert.ok(lo.energy > before, 'standing and walking recover');
  // tired legs: less top speed and acceleration
  lo.energy = 0.1; assert.ok(lo.fatigue() > 0.8); hi.energy = 0.9; assert.equal(hi.fatigue(), 0);
});
