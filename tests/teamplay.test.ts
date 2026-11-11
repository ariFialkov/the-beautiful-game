import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, type SetPieceKind } from '../src/game/match';
import { PITCH_11, v2 } from '../src/game/pitch';
import type { Agent } from '../src/game/player';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
const make = (humanTeam: 0 | null) => new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam, script: null, durationSec: 3000, clockMinutes: 90,
  teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
const place = (a: Agent, x: number, z: number) => { a.pos = { x, z }; a.prevPos = { x, z }; a.vel = { x: 0, z: 0 }; a.action = null; a.cooldown = 0; };

test('a held cross is driven: lower and quicker than a floated one', () => {
  const cross = (power: number) => {
    const m = make(0);
    m.agents.forEach((a, i) => { a.isHuman = true; place(a, -40 + (i % 6) * 2, -30 + Math.floor(i / 6) * 2); a.intent = { move: { x: 0, z: 0 }, sprint: false }; });
    m.phase = 'play'; m.phaseTimer = 0; m.setPiece = null;
    const dir = m.teams[0].attackDir; const passer = m.teams[0].agents[7], mate = m.teams[0].agents[9];
    place(passer, dir * 34, 26); passer.heading = { x: 0, z: -1 }; place(mate, dir * 44, 0);
    m.ball.reset(passer.pos.x, passer.pos.z - 0.4); m.ball.owner = passer;
    m.startKick(passer, 'lob', power, v2.norm(v2.sub(mate.pos, passer.pos)), { targetAgent: mate });
    let apex = 0, t = 0, launched = -1; const start = { x: 0, z: 0 };
    for (let i = 0; i < 60 * 4; i++) {
      m.update(1 / 60); apex = Math.max(apex, m.ball.y);
      if (launched < 0 && m.ball.y > 0.3) { launched = m.time; start.x = m.ball.x; start.z = m.ball.z; }
      if (launched > 0 && Math.abs(m.ball.z) < 3) { t = m.time - launched; break; }
    }
    return { apex, t };
  };
  const avg = (p: number) => { const r = [cross(p), cross(p), cross(p)]; return { apex: r.reduce((a, x) => a + x.apex, 0) / 3, t: r.reduce((a, x) => a + x.t, 0) / 3 }; };
  const floated = avg(0.15), driven = avg(1);
  console.log(`  floated cross apex ${floated.apex.toFixed(1)} m in ${floated.t.toFixed(2)} s; driven apex ${driven.apex.toFixed(1)} m in ${driven.t.toFixed(2)} s`);
  assert.ok(driven.t > 0 && floated.t > 0, 'both crosses reached the middle');
  assert.ok(driven.apex < floated.apex * 0.8, 'the driven cross is flatter');
  assert.ok(driven.t < floated.t * 0.85, 'the driven cross arrives sooner');
});

test('at a restart the opponents clear out of the way and the restart is taken', () => {
  const kinds: Array<[SetPieceKind, number]> = [['goalkick', 12], ['freekick', 9.15], ['corner', 9.15], ['throw', 3]];
  for (const [kind, room] of kinds) {
    const m = make(null);
    for (let i = 0; i < 240; i++) m.update(1 / 60);
    const dir = m.teams[0].attackDir;
    const pos = kind === 'goalkick' ? { x: -dir * 47, z: 6 } : kind === 'corner' ? { x: dir * 52.1, z: 33.6 } : kind === 'throw' ? { x: 5, z: 34 } : { x: dir * -10, z: 8 };
    // everyone piles in around the ball first, as after a scramble
    m.agents.forEach((a, i) => { if (!a.isGK) place(a, Math.max(-52, Math.min(52, pos.x + ((i * 7) % 11 - 5) * 1.2)), Math.max(-33, Math.min(33, pos.z + ((i * 5) % 9 - 4) * 1.2))); });
    (m as any).restart(kind, 0, pos);
    let nearest = Infinity, taken = false;
    m.on((e) => { if (e.type === 'kick' && !taken && e.agent.team === 0) { taken = true; for (const a of m.teams[1].agents) if (!(a.isGK && kind === 'corner')) nearest = Math.min(nearest, v2.dist(a.pos, pos)); } });
    for (let i = 0; i < 60 * 8 && !taken; i++) m.update(1 / 60);
    assert.ok(taken, `the ${kind} was taken`);
    assert.ok(nearest > room - 0.6, `${kind}: nearest opponent ${nearest.toFixed(1)} m from the ball (needs ${room})`);
  }
});

test('teams hold their shape instead of swarming the ball', () => {
  const m = make(null); let n = 0, near = 0;
  for (let i = 0; i < 60 * 90; i++) {
    m.update(1 / 60); if (m.phase !== 'play') continue; n++;
    for (const a of m.agents) if (Math.hypot(a.pos.x - m.ball.x, a.pos.z - m.ball.z) < 5) near++;
  }
  console.log(`  players within 5 m of the ball: ${(near / n).toFixed(2)} on average`);
  assert.ok(near / n < 2.8, 'only the ball carrier and one or two challengers are near the ball');
});
