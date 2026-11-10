import { v2, type V2 } from './pitch';
import type { Agent } from './player';
import type { Match, TeamState } from './match';

const rnd = Math.random;

function shapeTarget(m: Match, team: TeamState, a: Agent): V2 {
  const { length: L, width: W, futsal } = m.pitch;
  const dir = team.attackDir;
  const inPoss = m.possessionTeam === team.index;
  const ball = m.ball;
  let x = a.home.x * (L / 2) * 0.88 * dir;
  let z = a.home.z * (W / 2) * 0.82;
  x += ball.x * (inPoss ? 0.42 : 0.38);
  z += ball.z * 0.3;
  x += dir * (inPoss ? (futsal ? 2.5 : 7) : (futsal ? -2 : -7));
  const lim = L / 2 - 2;
  return { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-W / 2 + 1, Math.min(W / 2 - 1, z)) };
}

/** Earliest point on the predicted ball path this player can reach, at a playable height. */
export function interceptPoint(m: Match, a: Agent, maxY = 1.2): V2 {
  const b = m.ball;
  if (b.owner && !b.held) return { x: b.x, z: b.z };
  const path = m.predicted();
  const speed = a.maxSpeed * 0.92;
  for (const p of path) {
    if (p.y > maxY) continue;
    if (v2.dist(a.pos, { x: p.x, z: p.z }) <= speed * p.t + 0.5) return { x: p.x, z: p.z };
  }
  const last = path[path.length - 1]; return { x: last.x, z: last.z };
}

function nearestOpponent(m: Match, a: Agent): { agent: Agent | null; dist: number } {
  let best: Agent | null = null; let bd = Infinity;
  for (const o of m.teams[a.team === 0 ? 1 : 0].agents) { const d = v2.dist(o.pos, a.pos); if (d < bd) { bd = d; best = o; } }
  return { agent: best, dist: bd };
}

function laneOpen(from: V2, to: V2, opponents: Agent[], tol = 1.6): number {
  const d = v2.sub(to, from); const len = v2.len(d); if (len < 0.1) return 1;
  const n = v2.scale(d, 1 / len);
  let worst = 1;
  for (const o of opponents) {
    const r = v2.sub(o.pos, from); const t = v2.dot(r, n);
    if (t < 0.2 || t > len - 0.3) continue;
    const perp = Math.abs(r.x * n.z - r.z * n.x);
    worst = Math.min(worst, Math.max(0, (perp - tol * 0.5) / tol));
  }
  return worst;
}

function bestTeammate(m: Match, team: TeamState, a: Agent, filter: (t: Agent) => boolean, score: (t: Agent) => number): Agent | null {
  let best: Agent | null = null; let bs = -Infinity;
  for (const t of team.agents) { if (t === a || !filter(t)) continue; const s = score(t); if (s > bs) { bs = s; best = t; } }
  return best;
}

/** Set-piece taker decisions. */
function setPieceDecision(m: Match, team: TeamState, a: Agent, skill: number): boolean {
  const sp = m.setPiece; if (!sp || sp.taker !== a) return false;
  const opp = m.opponentsOf(team.index).agents;
  const { length: L, goalWidth, boxDepth } = m.pitch;
  const goal = { x: team.attackDir * L / 2, z: 0 };
  const dGoal = v2.dist(a.pos, goal);
  const corner = () => (rnd() < 0.5 ? -1 : 1) * goalWidth * (0.28 + rnd() * 0.14);
  switch (sp.kind) {
    case 'penalty': { const z = corner(); m.startKick(a, 'shoot', 0.7 + rnd() * 0.2, v2.norm(v2.sub({ x: goal.x, z }, a.pos)), { botSkill: skill, target: { x: goal.x, z, y: 0.4 + rnd() * 1.4 } }); return true; }
    case 'freekick':
      if (dGoal < (m.pitch.futsal ? 14 : 29) && Math.abs(a.pos.z) < 22) { const z = corner(); m.startKick(a, 'shoot', 0.75, v2.norm(v2.sub({ x: goal.x, z }, a.pos)), { finesse: true, botSkill: skill, target: { x: goal.x, z, y: 1.4 + rnd() * 0.7 } }); return true; }
      break;
    case 'corner': {
      const target = bestTeammate(m, team, a, (t) => !t.isGK && Math.abs(t.pos.x - goal.x) < boxDepth + 3, (t) => t.card.attrs.physical + rnd() * 30);
      if (target && rnd() < 0.8) { m.startKick(a, m.pitch.futsal ? 'pass' : 'lob', 0.75, v2.norm(v2.sub(target.pos, a.pos)), { targetAgent: target, botSkill: skill }); return true; }
      break;
    }
    case 'throw': {
      const target = bestTeammate(m, team, a, (t) => !t.isGK && v2.dist(t.pos, a.pos) < 20, (t) => Math.min(8, nearestOpponent(m, t).dist) - v2.dist(t.pos, a.pos) * 0.15);
      if (target) { m.startKick(a, v2.dist(target.pos, a.pos) > 9 && !m.pitch.futsal ? 'lob' : 'pass', 0.6, v2.norm(v2.sub(target.pos, a.pos)), { targetAgent: target, botSkill: skill }); return true; }
      break;
    }
    case 'kickoff': {
      const target = bestTeammate(m, team, a, (t) => !t.isGK && v2.dist(t.pos, a.pos) < 18, (t) => -v2.dist(t.pos, a.pos));
      if (target) { m.startKick(a, 'pass', 0.5, v2.norm(v2.sub(target.pos, a.pos)), { targetAgent: target, botSkill: skill }); return true; }
      break;
    }
  }
  void opp;
  return false;
}

/** Decide and execute for the player on the ball. */
function onBall(m: Match, team: TeamState, a: Agent, skill: number) {
  if (setPieceDecision(m, team, a, skill)) return;
  const { length: L, futsal, goalWidth } = m.pitch;
  const dir = team.attackDir;
  const goal = { x: dir * L / 2, z: 0 };
  const dGoal = v2.dist(a.pos, goal);
  const opp = m.opponentsOf(team.index).agents;
  const pressure = nearestOpponent(m, a);
  const mods = m.mods;
  const appetite = mods.shotAppetite[team.index];
  const push = mods.pushTeam === team.index ? mods.pushLevel : 0;

  // Under pressure deep in our own half: get rid of it.
  const ownGoalDist = v2.dist(a.pos, { x: -goal.x, z: 0 });
  if (pressure.dist < 1.8 && ownGoalDist < (futsal ? 8 : 22) && rnd() < 0.55) {
    m.startKick(a, futsal ? 'pass' : 'lob', 0.9, v2.norm({ x: dir, z: Math.sign(a.pos.z || 1) * 0.5 }), { clear: true, botSkill: skill });
    return;
  }
  // In a forced goal window the attackers will try their luck from much further out.
  const range = mods.forced && push > 0 ? (futsal ? 28 : 42) : futsal ? 15 : 27;
  let shoot = 0;
  if (dGoal < range) {
    const angle = Math.abs(Math.atan2(a.pos.z, Math.abs(goal.x - a.pos.x) + 0.1));
    const lane = laneOpen(a.pos, goal, opp, 2.2);
    shoot = (1 - dGoal / range) * (1 - angle / 1.4) * (0.35 + lane * 0.65) * (0.5 + skill * 0.6) * appetite;
    if (dGoal < range * 0.65 && lane > 0.3) shoot += 0.3;
    if (mods.forced && push > 0) shoot = Math.max(shoot, 0.9 + (1 - dGoal / range));
    if (pressure.dist < 1.6) shoot *= 1.3;
  }
  let bestPass: { agent: Agent; score: number; kind: 'pass' | 'through' | 'lob' } | null = null;
  for (const t of team.agents) {
    if (t === a || t.isGK) continue;
    const d = v2.dist(t.pos, a.pos);
    if (d < 4 || d > (futsal ? 22 : 40)) continue;
    const forward = ((t.pos.x - a.pos.x) * dir) / d;
    const lane = laneOpen(a.pos, t.pos, opp, 1.8);
    const tOpp = nearestOpponent(m, t).dist;
    const openness = Math.min(1, tOpp / 6);
    let score = 0.25 + forward * 0.5 + lane * 0.45 + openness * 0.35 - (d > 25 ? 0.2 : 0) - (forward < -0.3 ? 0.3 : 0) - (lane < 0.35 ? 0.5 : 0);
    let kind: 'pass' | 'through' | 'lob' = 'pass';
    const tGoal = v2.dist(t.pos, goal);
    if (forward > 0.6 && tOpp > 3 && tGoal < dGoal - 6) { kind = rnd() < 0.5 ? 'through' : 'pass'; score += 0.15 + push * 0.4; }
    if (lane < 0.3 && d > 14 && !futsal) { kind = 'lob'; score += 0.35; }
    // crosses from wide areas into the box (futsal is played on the floor)
    if (!futsal && Math.abs(a.pos.z) > m.pitch.width * 0.25 && Math.abs(a.pos.x - goal.x) < (futsal ? 10 : 25) && Math.abs(t.pos.x - goal.x) < m.pitch.boxDepth + 2 && Math.abs(t.pos.z) < m.pitch.boxWidth / 2) { kind = 'lob'; score += 0.25 + push * 0.3; }
    score *= 0.6 + skill * 0.5;
    if (!bestPass || score > bestPass.score) bestPass = { agent: t, score, kind };
  }
  const ahead = { x: a.pos.x + dir * 6, z: a.pos.z };
  let spaceAhead = 8; for (const o of opp) spaceAhead = Math.min(spaceAhead, v2.dist(o.pos, ahead));
  const dribble = 0.5 + a.skill.dribble * 0.3 - (pressure.dist < 2.2 ? 0.4 : 0) + (spaceAhead > 5 ? 0.25 : spaceAhead < 2.5 ? -0.2 : 0) + (dGoal > 45 ? 0.05 : 0);
  const options: Array<[string, number]> = [['shoot', shoot], ['pass', (bestPass?.score ?? 0) * (pressure.dist < 3 ? 1.2 : 0.9)], ['dribble', dribble]];
  options.sort((x, y) => y[1] - x[1]);
  const pick = options[0][0];
  if (pick === 'shoot' && shoot > 0.25) {
    const z = (rnd() < 0.5 ? -1 : 1) * goalWidth * (0.25 + rnd() * 0.17);
    const power = 0.6 + rnd() * 0.35;
    m.startKick(a, 'shoot', power, v2.norm(v2.sub({ x: goal.x, z }, a.pos)), { finesse: dGoal > 16 && rnd() < 0.5, botSkill: skill, target: { x: goal.x, z } });
    return;
  }
  if (pick === 'pass' && bestPass && bestPass.score > 0.45) {
    m.startKick(a, bestPass.kind, 0.6, v2.norm(v2.sub(bestPass.agent.pos, a.pos)), { targetAgent: bestPass.agent, botSkill: skill });
    return;
  }
  let want = v2.norm(v2.sub({ x: goal.x, z: a.pos.z * 0.3 }, a.pos));
  if (pressure.agent && pressure.dist < 4) {
    const away = v2.norm(v2.sub(a.pos, pressure.agent.pos));
    const side = { x: -want.z, z: want.x };
    const s = v2.dot(side, away) >= 0 ? 1 : -1;
    want = v2.norm(v2.add(want, v2.scale(side, 0.9 * s)));
  }
  a.ai.target = v2.add(a.pos, v2.scale(want, 6));
  a.ai.mode = 'dribble';
  a.intent.sprint = pressure.dist > 2.5 || push > 0.3;
}

/** Defensive pressing: approach goal-side, jockey, and tackle when the ball is exposed. Poor timing gives away fouls. */
function press(m: Match, team: TeamState, a: Agent, carrier: Agent, skill: number, dt: number): V2 {
  const b = m.ball; const bp = { x: b.x, z: b.z };
  const ownGoal = { x: -team.attackDir * m.pitch.length / 2, z: 0 };
  const spot = v2.add(bp, v2.scale(v2.norm(v2.sub(ownGoal, bp)), 1.3));
  a.intent.face = v2.sub(bp, a.pos);
  const dSpot = v2.dist(a.pos, spot);
  a.intent.jockey = dSpot < 3.5;
  a.intent.sprint = dSpot > 5;
  const lapse = m.mods.pushTeam !== null && m.mods.pushTeam !== team.index ? m.mods.defenseLapse : 0;
  if (lapse > 0) { a.intent.sprint = false; if (rnd() < lapse) return v2.add(spot, v2.scale(v2.norm(v2.sub(ownGoal, bp)), 2.5 * lapse)); }
  if (!a.busy() && a.tackleCooldown <= 0 && a.stunned <= 0) {
    const bd = v2.dist(a.pos, bp); const exposed = v2.dist(carrier.pos, bp) > 0.6;
    const facing = v2.dot(a.heading, v2.norm(v2.sub(bp, a.pos))) > 0.5;
    const bias = Math.max(-1, Math.min(1, m.mods.tackleBias * (team.index === 0 ? 1 : -1)));
    const timing = Math.max(0.05, Math.min(1, skill + bias * 0.3));
    if (exposed && facing && bd < 1.15 && rnd() < (2 + 5 * timing) * dt) m.tackle(a, 'tackle');
    else if (exposed && facing && bd > 1.3 && bd < 2.4 && rnd() < (0.15 + 0.6 * timing) * dt && v2.dot(carrier.heading, v2.norm(v2.sub(a.pos, carrier.pos))) > -0.2) m.tackle(a, 'slide');
    else if (!exposed && bd < 0.95 && rnd() < (1 - timing) * 0.9 * dt) m.tackle(a, 'tackle'); // mistimed
  }
  return spot;
}

export function updateTeamAI(m: Match, team: TeamState, dt: number) {
  const ball = m.ball; const now = m.time;
  if (m.phase === 'kickoff' || m.phase === 'halftime' || m.phase === 'fulltime') return;
  const skill = team.index === 0 ? m.mods.homeAiSkill : m.mods.botSkill;
  const opp = m.opponentsOf(team.index);
  const inPoss = m.possessionTeam === team.index;
  const carrier = ball.owner;
  const ballPos: V2 = { x: ball.x, z: ball.z };
  const outfield = team.agents.filter((a) => !a.isGK && m.aiDriven(a));
  const loose = !carrier;
  // The chaser for a loose ball is whoever gets there first; otherwise the nearest presses.
  const byDist = outfield.slice().sort((p, q) => v2.dist(p.pos, ballPos) - v2.dist(q.pos, ballPos));
  const presser = byDist[0] ?? null, cover = byDist[1] ?? null;
  const supporters = carrier && carrier.team === team.index ? outfield.filter((a) => a !== carrier).sort((p, q) => v2.dist(p.pos, carrier.pos) - v2.dist(q.pos, carrier.pos)).slice(0, 2) : [];
  const dead = m.phase === 'dead' || m.phase === 'goal';
  const lofted = loose && ball.y > 1.2;

  for (const a of team.agents) {
    if (!m.aiDriven(a)) continue;
    if (a.isGK) { updateKeeper(m, team, a, dt); continue; }
    a.intent.face = null; a.intent.jockey = false;
    if (a.busy()) continue;
    if (dead) { const s = shapeTarget(m, team, a); const d = v2.sub(s, a.pos); a.intent.move = v2.len(d) > 1 ? v2.scale(v2.norm(d), 0.5) : { x: 0, z: 0 }; a.intent.sprint = false; continue; }
    if (carrier === a && !ball.held) {
      if (m.phase !== 'play' || a.pendingKick) continue;
      const pressed = nearestOpponent(m, a).dist < 1.6;
      if (now >= a.ai.nextDecision || (pressed && now >= a.ai.nextDecision - 0.35)) { a.ai.nextDecision = now + 0.3 + (1 - skill) * 0.3 + rnd() * 0.25; onBall(m, team, a, skill); }
      if (a.ai.mode === 'dribble' && !a.pendingKick) { const d = v2.sub(a.ai.target, a.pos); a.intent.move = v2.len(d) > 0.5 ? v2.norm(d) : { x: 0, z: 0 }; }
      continue;
    }
    let target: V2; let sprint = false;
    const shape = shapeTarget(m, team, a);
    if (loose && a.ai.expectBall > now && ball.lastTouchTeam === team.index) {
      target = interceptPoint(m, a, lofted ? 2.3 : 1.2); sprint = true; a.ai.mode = 'receive';
    } else if (!inPoss || loose) {
      if (a === presser) {
        if (loose) { target = interceptPoint(m, a, lofted ? 2.3 : 1.2); sprint = true; a.ai.mode = 'chase'; }
        else { target = press(m, team, a, carrier!, skill, dt); a.ai.mode = 'press'; sprint = a.intent.sprint; }
      } else if (a === cover && !loose) {
        const ownGoal = { x: -team.attackDir * m.pitch.length / 2, z: 0 };
        target = v2.add(ballPos, v2.scale(v2.norm(v2.sub(ownGoal, ballPos)), 5)); sprint = v2.dist(a.pos, target) > 6; a.ai.mode = 'cover';
      } else {
        let mark: Agent | null = null; let bd = m.pitch.futsal ? 7 : 11;
        for (const o of opp.agents) { if (o.isGK || o === carrier) continue; const d = v2.dist(o.pos, shape); if (d < bd) { bd = d; mark = o; } }
        if (mark) { const ownGoal = { x: -team.attackDir * m.pitch.length / 2, z: 0 }; target = v2.add(mark.pos, v2.scale(v2.norm(v2.sub(ownGoal, mark.pos)), 1.6)); a.ai.mode = 'mark'; }
        else { target = shape; a.ai.mode = 'shape'; }
        if (loose && v2.dist(a.pos, ballPos) < (lofted ? 14 : 9)) { target = interceptPoint(m, a, lofted ? 2.3 : 1.2); sprint = true; }
      }
    } else {
      if (supporters.includes(a)) {
        const dir = team.attackDir;
        const side = a.pos.z > carrier!.pos.z ? 1 : -1;
        target = { x: carrier!.pos.x + dir * (m.pitch.futsal ? 5 : 11), z: carrier!.pos.z + side * (m.pitch.futsal ? 5 : 9) };
        sprint = true; a.ai.mode = 'support';
      } else { target = shape; a.ai.mode = 'shape'; }
      if (m.mods.pushTeam === team.index && m.mods.pushLevel > 0.4 && ['ST', 'LW', 'RW', 'CAM', 'LM', 'RM'].includes(a.role)) { target = { x: target.x + team.attackDir * 8, z: target.z }; sprint = true; }
      // attack crosses
      if (m.setPiece?.kind === 'corner' && m.setPiece.team === team.index && a !== m.setPiece.taker) { const gx = team.attackDir * (m.pitch.length / 2 - (m.pitch.futsal ? 4 : 8)); target = { x: gx, z: (a.home.z) * 6 }; }
    }
    const lim = { x: m.pitch.length / 2 - 0.5, z: m.pitch.width / 2 - 0.5 };
    target = { x: Math.max(-lim.x, Math.min(lim.x, target.x)), z: Math.max(-lim.z, Math.min(lim.z, target.z)) };
    const d = v2.sub(target, a.pos); const dl = v2.len(d);
    a.ai.target = target;
    if (dl < 0.5) { a.intent.move = { x: 0, z: 0 }; if (!a.intent.face) a.intent.face = v2.sub(ballPos, a.pos); }
    else { a.intent.move = v2.scale(v2.norm(d), Math.min(1, dl / 2)); }
    a.intent.sprint = sprint || dl > 9;
  }
}

/** Goalkeeper: arc positioning, reading the shot from the predicted ball path, diving with reaction time, distribution. */
export function updateKeeper(m: Match, team: TeamState, k: Agent, dt: number) {
  const ball = m.ball; const { length: L, goalWidth, goalHeight, boxDepth, futsal } = m.pitch;
  const dir = team.attackDir; const gx = -dir * L / 2;
  const mode = m.mods.keeper[team.index];
  const ballPos: V2 = { x: ball.x, z: ball.z };
  k.intent.face = null; k.intent.jockey = false;
  if (k.busy()) return;
  if (m.phase === 'kickoff' || m.phase === 'goal') { k.intent.move = { x: 0, z: 0 }; return; }
  if (ball.owner === k) {
    k.intent.move = { x: 0, z: 0 }; k.keeperHold += dt;
    if (k.keeperHold > (ball.held ? 1.3 : 0.6) && !k.pendingKick && m.phase === 'play') {
      let best: Agent | null = null; let bs = -Infinity;
      for (const t of team.agents) { if (t === k) continue; const o = nearestOpponent(m, t).dist; const d = v2.dist(t.pos, k.pos); const s = Math.min(o, 10) - d * 0.1 + ((t.pos.x - k.pos.x) * dir) * 0.06; if (s > bs) { bs = s; best = t; } }
      if (best) { const d = v2.dist(best.pos, k.pos); m.startKick(k, d > 26 && !futsal ? 'lob' : 'pass', 0.75, v2.norm(v2.sub(best.pos, k.pos)), { targetAgent: best, botSkill: 0.8 }); }
    }
    return;
  }
  k.keeperHold = 0;
  // Pending dive (reaction time elapsed?)
  if (k.ai.dive && m.time >= k.ai.diveAt) {
    const d = k.ai.dive; k.ai.dive = null;
    k.startAction('dive', 1.25, d.side * dir, d);
    return;
  }
  // Read the shot: where will the ball cross my line of defence?
  const toward = !ball.owner && !ball.held && ball.vx * -dir > 4 && m.phase === 'play';
  if (toward && !k.ai.dive) {
    const path = m.predicted(); const planeX = k.pos.x;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if ((b.x - planeX) * -dir >= 0 && (a.x - planeX) * -dir < 0) {
        const f = (planeX - a.x) / (b.x - a.x || 1e-6);
        const t = a.t + (b.t - a.t) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
        if (t > 1.6 || Math.abs(z) > goalWidth / 2 + 1 || y > goalHeight + 0.6) break;
        const lateral = z - k.pos.z;
        if (Math.abs(lateral) < 0.6 && y < 1.9) { k.intent.move = { x: 0, z: Math.sign(lateral) * Math.min(1, Math.abs(lateral) * 2) }; k.intent.sprint = true; return; }
        const handling = (k.card.attrs.diving + k.card.attrs.reflexes) / 198;
        const reaction = mode === 'wall' ? 0.02 : mode === 'soft' ? 0.32 : 0.16 - handling * 0.08;
        let side = Math.sign(lateral);
        if (mode === 'soft' && rnd() < 0.35) side = -side; // sold the wrong way
        const reach = 1.0 + handling * 0.6 + (mode === 'wall' ? 0.5 : mode === 'soft' ? -0.4 : 0);
        const travel = Math.max(0, Math.abs(lateral) - reach - 0.3);
        const speed = Math.min(mode === 'wall' ? 7 : 5, Math.max(1.5, travel / Math.max(0.2, t - reaction) * 1.6));
        k.ai.dive = { side, reach, handY: Math.max(0.3, Math.min(2.3, y)), mode, vel: { x: 0, z: side * speed } };
        k.ai.diveAt = m.time + reaction;
        return;
      }
    }
  }
  let target: V2;
  const inBox = Math.abs(ball.x - gx) < boxDepth && Math.abs(ball.z) < m.pitch.boxWidth / 2;
  const looseBall = !ball.owner && ball.speed() < 9;
  const myDist = v2.dist(k.pos, ballPos);
  let closestOther = Infinity; for (const o of m.agents) if (o !== k) closestOther = Math.min(closestOther, v2.dist(o.pos, ballPos));
  if (m.setPiece?.kind === 'penalty' && m.setPiece.team !== team.index) { target = { x: gx + dir * 0.3, z: 0 }; }
  else if (looseBall && inBox && myDist < closestOther + 1 && myDist < (futsal ? 6 : 10)) { target = interceptPoint(m, k, 2.2); k.ai.mode = 'collect'; }
  else {
    const center = { x: gx + dir * 0.6, z: 0 };
    const toBall = v2.sub(ballPos, center); const dist = v2.len(toBall);
    const out = Math.min(futsal ? 2.5 : 4.5, Math.max(0.3, dist * 0.09));
    target = v2.add(center, v2.scale(v2.norm(toBall), out));
    target.z = Math.max(-goalWidth / 2 + 0.3, Math.min(goalWidth / 2 - 0.3, target.z));
    k.ai.mode = 'guard';
  }
  const d = v2.sub(target, k.pos); const dl = v2.len(d);
  k.intent.move = dl > 0.2 ? v2.scale(v2.norm(d), Math.min(1, dl / 1.2)) : { x: 0, z: 0 };
  k.intent.face = v2.sub(ballPos, k.pos);
  k.intent.sprint = dl > 3;
}
