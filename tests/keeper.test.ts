import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, v2 } from '../src/game/pitch';
import { pointSegment } from '../src/game/skeleton';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** One bot shot from 12–26 m at a point on the goal line (z, height y); the keeper has settled in position first. */
function shot(zHit: number, y: number, mode: 'normal' | 'wall' | 'soft' = 'normal') {
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: null, script: null, durationSec: 3000, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  m.agents.forEach((a, i) => { if (a.isGK) return; a.isHuman = true; a.pos = { x: -45 + (i % 6) * 2, z: -30 + Math.floor(i / 6) * 2 }; a.prevPos = { ...a.pos }; });
  m.phase = 'play'; m.phaseTimer = 0; m.setPiece = null; m.mods.keeper = [mode, mode];
  const at = m.teams[0].attackDir; const s = m.teams[0].agents[9]; const gk = m.teams[1].agents[0]; gk.isHuman = false;
  const dist = 12 + rnd() * 14, z0 = (rnd() - 0.5) * 16;
  s.pos = { x: at * (52.5 - dist), z: z0 }; s.prevPos = { ...s.pos }; s.heading = { x: at, z: 0 };
  m.ball.reset(s.pos.x + at * 0.4, z0); m.ball.owner = s;
  for (let i = 0; i < 90; i++) { m.mods.keeper = [mode, mode]; m.update(1 / 60); }
  m.ball.reset(s.pos.x + at * 0.4, z0); m.ball.owner = s;
  const gx = at * 52.8;
  m.startKick(s, 'shoot', 0.75, v2.norm({ x: gx - s.pos.x, z: zHit - z0 }), { target: { x: gx, z: zHit, y }, botSkill: 1 });
  let struck = -1, diveAt = -1, result = 'none', ghost = false;
  for (let i = 0; i < 60 * 3 && result === 'none'; i++) {
    m.mods.keeper = [mode, mode]; m.update(1 / 60); const b = m.ball;
    if (struck < 0 && b.lastTouch === s && !b.owner) struck = m.time;
    if (diveAt < 0 && gk.action?.type === 'dive') diveAt = m.time;
    // a hand clearly through the ball that does not count as a touch would be a "ghost" save
    if (struck > 0 && b.lastTouch === s) for (const c of gk.motion!.colliders()) if (c.part === 'hand' && pointSegment(b.x, b.y, b.z, c).d < c.r + b.radius - 0.03) ghost = true;
    if (struck > 0 && Math.abs(b.x) > 53) result = Math.abs(b.z) < 3.66 && b.y < 2.44 ? 'goal' : 'wide';
    if (struck > 0 && b.lastTouch === gk) result = 'saved';
  }
  return { result, ghost: ghost && result !== 'saved', diveDelay: diveAt > 0 ? diveAt - struck : null };
}

test('keeper: what it touches it saves, and it never dives the instant the ball is struck', () => {
  let ghosts = 0, dives = 0;
  for (const z of [0.4, 1.9, 3.1]) for (const y of [0.3, 1.2, 2.0]) for (let k = 0; k < 2; k++) {
    const r = shot((k ? 1 : -1) * z, y);
    if (r.ghost) ghosts++;
    if (r.diveDelay !== null) { dives++; assert.ok(r.diveDelay >= 0.1, `dive ${r.diveDelay.toFixed(2)} s after the strike`); }
  }
  assert.equal(ghosts, 0);
  assert.ok(dives > 3, `only ${dives} dives`);
});

test('keeper: stops shots at the keeper, but a well-placed top corner beats it', () => {
  let near = 0, nearN = 0, corner = 0, cornerN = 0;
  for (let k = 0; k < 8; k++) {
    const side = k % 2 ? 1 : -1;
    const a = shot(side * 0.6, k % 4 < 2 ? 0.3 : 1.2); nearN++; if (a.result === 'saved') near++;
    const b = shot(side * 3.15, 2.05); if (b.result !== 'wide') { cornerN++; if (b.result === 'goal') corner++; }
  }
  assert.ok(near >= nearN - 1, `saved ${near}/${nearN} shots at the keeper`);
  assert.ok(cornerN >= 4 && corner >= cornerN / 2, `top corners scored ${corner}/${cornerN}`);
});
