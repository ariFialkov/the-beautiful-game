import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/game/match';
import { PITCH_11, v2 } from '../src/game/pitch';
import { SKILLS, SkillStick, type SkillMove } from '../src/game/skills';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

const btn = () => ({ down: false, justPressed: false, justReleased: false });
const pad = (aim = { x: 0, y: 0 }, move = { x: 0, y: 0 }) => ({ move, aim, sprint: btn(), pass: btn(), shoot: btn(), through: btn(), lob: btn(), switch: btn(), slide: btn(), finesse: btn(), shield: btn() }) as any;

/** A player on the ball facing +x, opponents out of the way; the camera's "up" is +x, "right" is +z. */
function setup() {
  const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
  const m = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: 0, script: null, durationSec: 3000, clockMinutes: 90,
    teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
  m.agents.forEach((a, i) => { a.isHuman = true; a.pos = { x: 40 + (i % 6) * 2, z: -30 + Math.floor(i / 6) * 2 }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; });
  m.phase = 'play'; m.phaseTimer = 0; m.setPiece = null;
  m.controlBasis = { right: { x: 0, z: 1 }, forward: { x: 1, z: 0 } };
  const p = m.teams[0].agents[8]; p.pos = { x: 0, z: 0 }; p.prevPos = { x: 0, z: 0 }; p.heading = { x: 1, z: 0 };
  (m as any).setControlled(p); m.ball.reset(0.42, 0); m.ball.owner = p;
  return { m, p };
}
const dir: Record<string, { x: number; y: number }> = { F: { x: 0, y: 1 }, B: { x: 0, y: -1 }, L: { x: -1, y: 0 }, R: { x: 1, y: 0 } };
/** Perform a gesture on the skill stick (each direction held a few frames), then let go. */
function gesture(m: Match, seq: string[], hold = 4) {
  for (const s of seq) for (let i = 0; i < hold; i++) m.update(1 / 60, pad(dir[s]));
  m.update(1 / 60, pad());
}

test('skill stick: gestures read as the right moves', () => {
  const cases: Array<[string[], SkillMove, number]> = [
    [['L'], 'feint', -1], [['R'], 'feint', 1], [['B'], 'dragback', 1], [['F'], 'knock', 1],
    [['F', 'R'], 'stepover', 1], [['F', 'L'], 'stepover', -1], [['F', 'B'], 'heel', 1], [['B', 'L'], 'roulette', -1],
    [['B', 'R', 'F'], 'rainbow', 1], [['R', 'F', 'L'], 'elastico', -1], [['L', 'F', 'R'], 'elastico', 1],
  ];
  for (const [seq, move, side] of cases) assert.deepEqual(SkillStick.recognise(seq as any), { move, side }, seq.join(''));
});

test('skill moves: each is performed from the stick, keeps the ball, and hands back to normal play', () => {
  const gestures: Array<[string[], SkillMove]> = [[['R'], 'feint'], [['B'], 'dragback'], [['F'], 'knock'], [['F', 'R'], 'stepover'], [['F', 'B'], 'heel'], [['B', 'L'], 'roulette'], [['R', 'F', 'L'], 'elastico'], [['B', 'R', 'F'], 'rainbow']];
  for (const [seq, move] of gestures) {
    const { m, p } = setup(); let seen: string | null = null;
    m.on((e) => { if (e.type === 'skill') seen = e.move; });
    gesture(m, seq);
    assert.equal(seen, move, `${seq.join('')} -> ${move}`);
    let maxGap = 0; const dur = SKILLS[move].dur;
    const run = move === 'knock' || move === 'rainbow' ? { x: 0, y: 1 } : { x: 0, y: 0 }; // (a knock-on or a rainbow is chased)
    for (let i = 0; i < Math.ceil(dur * 60) + 70; i++) { m.update(1 / 60, pad(undefined, run)); if (p.action?.type === 'skill' && !p.action.data.released) maxGap = Math.max(maxGap, v2.dist(p.pos, { x: m.ball.x, z: m.ball.z })); }
    assert.ok(maxGap < 1.3, `${move}: the ball stayed with him through the move (${maxGap.toFixed(2)} m)`);
    assert.notEqual(p.action?.type, 'skill', `${move}: finished`);
    const d = v2.dist(p.pos, { x: m.ball.x, z: m.ball.z });
    assert.ok(d < (move === 'knock' ? 6 : 3.5), `${move}: still on the ball afterwards (${d.toFixed(1)} m)`); // (a knock-on is pushed into space)
    console.log(`  ${SKILLS[move].label}: ball at ${d.toFixed(1)} m after, ${(m.ball.lastTouch === p) ? 'his' : 'lost'}`);
  }
});

test('ball roll: holding the stick to a side keeps rolling it across', () => {
  const { m, p } = setup(); const z0 = p.pos.z;
  for (let i = 0; i < 80; i++) m.update(1 / 60, pad(dir.R));
  m.update(1 / 60, pad());
  assert.ok(p.pos.z - z0 > 1.2, `moved across with it (${(p.pos.z - z0).toFixed(2)} m)`);
  assert.ok(v2.dist(p.pos, { x: m.ball.x, z: m.ball.z }) < 1.2, 'ball still at his feet');
});
