import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, PITCH_FUTSAL, v2 } from '../src/game/pitch';
import { shapeTarget } from '../src/game/ai';
import { FORMATIONS_11, FORMATIONS_FUTSAL, teamTactics, type Tactics } from '../src/game/tactics';
import { generateMatchScript } from '../shared/script';
import { Rng } from '../shared/rng';
import { TEAM_BY_ID, TEAMS, rosterOf, startingXI } from '../shared/teams';
import type { MatchTier } from '../shared/types';

const five = (xi: ReturnType<typeof startingXI>) => [xi[0], xi[2], xi[8], xi[10], xi[9]];
function make(opts: { futsal?: boolean; tactics?: [Partial<Tactics>?, Partial<Tactics>?]; script?: any; human?: number | null } = {}) {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos']; const f = !!opts.futsal;
  const hx = startingXI(rosterOf(home.id)), ax = startingXI(rosterOf(away.id));
  return new Match({
    pitch: f ? PITCH_FUTSAL : PITCH_11, mode: f ? 'futsal' : 'kickoff', humanTeam: opts.human ?? null, script: opts.script ?? null,
    durationSec: opts.script?.durationSec ?? 3000, clockMinutes: f ? 40 : 90,
    teams: [
      { team: home, players: f ? five(hx) : hx, kit: home.home, kitKey: 'h', name: home.name, short: home.short, tactics: opts.tactics?.[0] },
      { team: away, players: f ? five(ax) : ax, kit: away.home, kitKey: 'a', name: away.name, short: away.short, tactics: opts.tactics?.[1] },
    ],
  });
}

test('formations: every shape has a keeper and a slot per player; a change refits the players to it', () => {
  for (const f of FORMATIONS_11) { assert.equal(f.slots.length, 11, f.id); assert.equal(f.slots.filter((s) => s.role === 'GK').length, 1, f.id); }
  for (const f of FORMATIONS_FUTSAL) assert.equal(f.slots.length, 5, f.id);
  const m = make();
  const t = m.teams[0]; const before = t.agents.map((a) => a.role).join(' ');
  assert.equal(before, 'GK RB CB CB LB CDM CM CAM RW ST LW', 'the default 4-3-3 keeps everyone in his own slot');
  m.setTactics(0, { formation: '3-5-2' });
  const roles = t.agents.map((a) => a.role);
  assert.equal(roles[0], 'GK');
  assert.deepEqual([...roles].sort(), [...FORMATIONS_11.find((f) => f.id === '3-5-2')!.slots.map((s) => s.role)].sort(), 'every 3-5-2 slot is filled once');
  // the strikers stay up front and a centre-back stays at the back
  assert.ok(t.agents[9].role === 'ST' && ['CB'].includes(t.agents[2].role), `ST ${t.agents[9].role}, CB ${t.agents[2].role}`);
  m.setTactics(0, { formation: '4-4-2' }); assert.equal(t.agents.filter((a) => a.role === 'ST').length, 2);
  const fm = make({ futsal: true, tactics: [{ formation: '2-2' }] }); assert.equal(fm.teams[0].agents.filter((a) => a.role === 'CB').length, 2);
});

test('tactics move the team: an attacking side sits higher, a high press squeezes up, width spreads it', () => {
  const m = make(); const t = m.teams[0]; m.phase = 'play';
  const avgX = () => t.agents.filter((a) => !a.isGK).reduce((s, a) => s + shapeTarget(m, t, a).x * t.attackDir, 0) / 10;
  const spread = () => { const zs = t.agents.filter((a) => !a.isGK).map((a) => shapeTarget(m, t, a).z); return Math.max(...zs) - Math.min(...zs); };
  m.ball.reset(0, 0);
  m.possessionTeam = 0;
  m.setTactics(0, { mentality: -2 }); const deep = avgX(); m.setTactics(0, { mentality: 2 }); const high = avgX();
  assert.ok(high > deep + 6, `ultra attacking ${high.toFixed(1)} vs ultra defensive ${deep.toFixed(1)}`);
  m.setTactics(0, { mentality: 0, width: 'narrow' }); const narrow = spread(); m.setTactics(0, { width: 'wide' }); const wide = spread();
  assert.ok(wide > narrow + 8, `wide ${wide.toFixed(1)} vs narrow ${narrow.toFixed(1)}`);
  m.possessionTeam = 1; m.ball.reset(t.attackDir * 25, 0);
  m.setTactics(0, { pressing: 'low' }); const low = avgX(); m.setTactics(0, { pressing: 'high' }); const press = avgX();
  assert.ok(press > low + 4, `high press line ${press.toFixed(1)} vs drop off ${low.toFixed(1)}`);
  console.log(`  mentality -2/+2: ${deep.toFixed(1)}/${high.toFixed(1)} m · width ${narrow.toFixed(1)}/${wide.toFixed(1)} m · press low/high ${low.toFixed(1)}/${press.toFixed(1)} m`);
});

test('bot sides have their own way of playing, the same every time', () => {
  const ids = new Set(TEAMS.map((t) => teamTactics(t.id, t.rating, false).formation));
  assert.ok(ids.size >= 4, `formations in use: ${[...ids].join(', ')}`);
  const a = TEAMS[3]; assert.deepEqual(teamTactics(a.id, a.rating, false), teamTactics(a.id, a.rating, false));
});

test('the drawn result is still played out whatever the tactics', () => {
  const tiers: MatchTier[] = ['loss', 'draw', 'win']; const combos: Array<[Partial<Tactics>, Partial<Tactics>]> = [
    [{ formation: '5-3-2', mentality: -2, pressing: 'low', buildUp: 'direct' }, { formation: '3-4-3', mentality: 2, pressing: 'high', width: 'wide' }],
    [{ formation: '3-4-3', mentality: 2, pressing: 'high', width: 'wide', buildUp: 'short' }, { formation: '5-3-2', mentality: -2, pressing: 'low' }],
    [{ formation: '4-2-3-1', mentality: 1 }, { formation: '4-1-2-1-2', buildUp: 'direct' }],
  ];
  tiers.forEach((tier, i) => {
    const script = generateMatchScript(new Rng(`tac${i}${tier}`), 'kickoff', tier, 2, 0.6);
    const m = make({ script, tactics: combos[i] });
    while (!m.ended && m.time < 60 * 20) m.update(1 / 60);
    const d = m.director!; const D = m.teams[0].score - m.teams[1].score;
    if (m.shootout) { const t = m.shootoutTally(); assert.equal(t[0].scored > t[1].scored ? 0 : 1, d.lo >= 1 ? 0 : 1); }
    else assert.ok(m.ended && D >= d.lo && D <= d.hi, `${tier}: ${m.teams[0].score}-${m.teams[1].score} outside ${d.lo}..${d.hi}`);
    console.log(`  ${tier} with ${combos[i][0].formation} v ${combos[i][1].formation}: ${m.teams[0].score}-${m.teams[1].score}`);
  });
});

test('corners: the box fills up, defenders mark, and the ball is whipped into it', () => {
  let headed = 0, inBox = 0; const N = 6;
  for (let k = 0; k < N; k++) {
    const m = make(); for (let i = 0; i < 60; i++) m.update(1 / 60);
    const dir = m.teams[0].attackDir; const zs = k % 2 ? 1 : -1;
    (m as any).restart('corner', 0, { x: dir * 52.1, z: zs * 33.6 });
    const gx = dir * 52.5; const box = (a: { pos: { x: number; z: number } }) => Math.abs(a.pos.x - gx) < 16.5 && Math.abs(a.pos.z) < 20.15;
    assert.ok(m.teams[0].agents.filter(box).length >= 5, 'attackers go up for it');
    assert.ok(m.teams[1].agents.filter(box).length >= 7, 'defenders crowd the box');
    const c = m.corner!; for (const [d, r] of c.marks) if (c.runs.has(r)) assert.ok(v2.dist(d.pos, r.pos) < 2, 'each runner has a marker on him');
    let kicked = false; let header = false; let landed = false; let peak = 0;
    m.on((e) => { if (e.type === 'kick' && e.agent === c.taker) kicked = true; if (e.type === 'header') header = true; });
    for (let i = 0; i < 60 * 6 && !header; i++) { m.update(1 / 60); if (kicked) peak = Math.max(peak, m.ball.y); if (kicked && peak > 3 && m.ball.y < 2.6 && !landed) { landed = true; if (box({ pos: { x: m.ball.x, z: m.ball.z } })) inBox++; } }
    assert.ok(kicked, 'the corner was taken'); if (header) headed++; if (header && !landed) inBox += box({ pos: { x: m.ball.x, z: m.ball.z } }) ? 1 : 0;
  }
  console.log(`  ${inBox}/${N} deliveries came down in the box, ${headed}/${N} met with a header`);
  assert.ok(inBox >= N / 2, `${inBox}/${N} in the box`); assert.ok(headed >= 2, `${headed}/${N} headed`);
});
