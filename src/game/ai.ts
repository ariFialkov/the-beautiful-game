import { v2, type V2 } from './pitch';
import { predictRoll } from './ball';
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
  // keep the back line honest: defenders never sit behind the ball much when attacking
  const lim = L / 2 - 2;
  return { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-W / 2 + 1, Math.min(W / 2 - 1, z)) };
}

/** Where should a chaser run to meet a rolling ball? Earliest reachable point along its path. */
function interceptPoint(m: Match, a: Agent): V2 {
  const b = m.ball;
  if (b.owner || b.speed() < 1.5) return { x: b.x, z: b.z };
  const speed = a.maxSpeed * 0.95;
  for (let t = 0.1; t <= 3.0; t += 0.15) {
    const p = predictRoll(b.x, b.z, b.vx, b.vz, t);
    if (v2.dist(a.pos, p) <= speed * t + 0.4) return p;
  }
  return predictRoll(b.x, b.z, b.vx, b.vz, 3.0);
}

function nearestOpponent(m: Match, a: Agent): { agent: Agent | null; dist: number } {
  let best: Agent | null = null; let bd = Infinity;
  for (const o of m.teams[a.team === 0 ? 1 : 0].agents) { const d = v2.dist(o.pos, a.pos); if (d < bd) { bd = d; best = o; } }
  return { agent: best, dist: bd };
}

function laneOpen(m: Match, from: V2, to: V2, opponents: Agent[], tol = 1.6): number {
  // 1 if no opponent is near the segment from->to, decreasing otherwise
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

/** Decide and execute for the player on the ball. */
function onBall(m: Match, team: TeamState, a: Agent, skill: number, now: number) {
  const { length: L, futsal, goalWidth } = m.pitch;
  const dir = team.attackDir;
  const goal = { x: dir * L / 2, z: 0 };
  const dGoal = v2.dist(a.pos, goal);
  const opp = m.teams[team.index === 0 ? 1 : 0].agents;
  const pressure = nearestOpponent(m, a);
  const mods = m.mods;
  const appetite = mods.shotAppetite[team.index];
  const push = mods.pushTeam === team.index ? mods.pushLevel : 0;

  // Shooting
  const range = (futsal ? 15 : 27) * (mods.forced && push > 0 ? 1.5 : 1);
  let shoot = 0;
  if (dGoal < range) {
    const angle = Math.abs(Math.atan2(a.pos.z, Math.abs(goal.x - a.pos.x) + 0.1));
    const lane = laneOpen(m, a.pos, goal, opp, 2.2);
    shoot = (1 - dGoal / range) * (1 - angle / 1.4) * (0.35 + lane * 0.65) * (0.5 + skill * 0.6) * appetite;
    if (dGoal < range * 0.65 && lane > 0.3) shoot += 0.3;
    if (mods.forced && push > 0) shoot = Math.max(shoot, 0.9 + (1 - dGoal / range));
    if (pressure.dist < 1.6) shoot *= 1.3; // under pressure: have a go
  }
  // Passing options
  let bestPass: { agent: Agent; score: number; kind: 'pass' | 'through' | 'lob' } | null = null;
  for (const t of team.agents) {
    if (t === a || t.isGK) continue;
    const d = v2.dist(t.pos, a.pos);
    if (d < 4 || d > (futsal ? 22 : 38)) continue;
    const forward = ((t.pos.x - a.pos.x) * dir) / d; // -1..1
    const lane = laneOpen(m, a.pos, t.pos, opp, 1.8);
    const tOpp = nearestOpponent(m, t).dist;
    const openness = Math.min(1, tOpp / 6);
    let score = 0.25 + forward * 0.5 + lane * 0.45 + openness * 0.35 - (d > 25 ? 0.2 : 0) - (forward < -0.3 ? 0.3 : 0) - (lane < 0.35 ? 0.5 : 0);
    let kind: 'pass' | 'through' | 'lob' = 'pass';
    const tGoal = v2.dist(t.pos, goal);
    if (forward > 0.6 && tOpp > 3 && tGoal < dGoal - 6) { kind = rnd() < 0.5 ? 'through' : 'pass'; score += 0.15 + push * 0.4; }
    if (lane < 0.3 && d > 14) { kind = 'lob'; score -= 0.1; }
    score *= 0.6 + skill * 0.5;
    if (!bestPass || score > bestPass.score) bestPass = { agent: t, score, kind };
  }
  // Dribbling appetite: carry the ball when there is space ahead
  const ahead = { x: a.pos.x + dir * 6, z: a.pos.z };
  let spaceAhead = 8; for (const o of opp) spaceAhead = Math.min(spaceAhead, v2.dist(o.pos, ahead));
  const dribble = 0.5 + (a.card.attrs.dribbling / 99) * 0.3 - (pressure.dist < 2.2 ? 0.4 : 0) + (spaceAhead > 5 ? 0.25 : spaceAhead < 2.5 ? -0.2 : 0) + (dGoal > 45 ? 0.05 : 0);
  // choose
  const options: Array<[string, number]> = [['shoot', shoot], ['pass', (bestPass?.score ?? 0) * (pressure.dist < 3 ? 1.2 : 0.9)], ['dribble', dribble]];
  options.sort((x, y) => y[1] - x[1]);
  const pick = options[0][0];
  if (pick === 'shoot' && shoot > 0.25) {
    const corner = (rnd() < 0.5 ? -1 : 1) * goalWidth * (0.25 + rnd() * 0.17);
    const power = 0.6 + rnd() * 0.35;
    m.startKick(a, 'shoot', power, v2.norm(v2.sub({ x: goal.x, z: corner }, a.pos)), { finesse: dGoal > 16 && rnd() < 0.5, botSkill: skill, target: { x: goal.x, z: corner } });
    return;
  }
  if (pick === 'pass' && bestPass && bestPass.score > 0.45) {
    m.startKick(a, bestPass.kind, 0.6, v2.norm(v2.sub(bestPass.agent.pos, a.pos)), { targetAgent: bestPass.agent, botSkill: skill });
    return;
  }
  // dribble: steer toward goal while avoiding the nearest opponent
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

export function updateTeamAI(m: Match, team: TeamState, dt: number) {
  const ball = m.ball; const now = m.time;
  const skill = team.index === 0 ? m.mods.homeAiSkill : m.mods.botSkill;
  const opp = m.teams[team.index === 0 ? 1 : 0];
  const inPoss = m.possessionTeam === team.index;
  const carrier = ball.owner;
  const ballPos: V2 = { x: ball.x, z: ball.z };
  // Who presses: closest two outfield players to the ball (sticky)
  const outfield = team.agents.filter((a) => !a.isGK && m.aiDriven(a));
  const byDist = outfield.slice().sort((p, q) => v2.dist(p.pos, ballPos) - v2.dist(q.pos, ballPos));
  const presser = byDist[0] ?? null, cover = byDist[1] ?? null;
  // Support runners when attacking
  const supporters = carrier && carrier.team === team.index ? outfield.filter((a) => a !== carrier).sort((p, q) => v2.dist(p.pos, carrier.pos) - v2.dist(q.pos, carrier.pos)).slice(0, 2) : [];

  for (const a of team.agents) {
    if (!m.aiDriven(a)) continue;
    if (a.isGK) { updateKeeper(m, team, a, dt); continue; }
    if (a.busy() && a.action?.type !== 'kick') continue;
    if (a.hasBall) {
      const pressed = nearestOpponent(m, a).dist < 1.6;
      if ((now >= a.ai.nextDecision || (pressed && now >= a.ai.nextDecision - 0.35)) && !a.action) { a.ai.nextDecision = now + 0.3 + (1 - skill) * 0.3 + rnd() * 0.25; onBall(m, team, a, skill, now); }
      if (a.ai.mode === 'dribble') { const d = v2.sub(a.ai.target, a.pos); a.intent.move = v2.len(d) > 0.5 ? v2.norm(d) : { x: 0, z: 0 }; }
      continue;
    }
    let target: V2; let sprint = false;
    const shape = shapeTarget(m, team, a);
    if (!carrier && a.ai.expectBall > now && ball.lastTouchTeam === team.index) {
      target = interceptPoint(m, a); sprint = true; a.ai.mode = 'receive';
    } else if (!inPoss || !carrier) {
      // defending / loose ball
      const loose = !carrier;
      if (a === presser) {
        if (loose) { target = interceptPoint(m, a); sprint = true; }
        else { target = v2.add(carrier!.pos, v2.scale(carrier!.heading, 0.8)); sprint = true; }
        a.ai.mode = 'press';
        // tackle when close to the carrier
        if (carrier && carrier.team !== team.index && v2.dist(a.pos, carrier.pos) < 1.6 && !a.action && a.cooldown <= 0 && a.tackleCooldown <= 0 && rnd() < (0.02 + skill * 0.05)) m.tackle(a, rnd() < 0.25 ? 'slide' : 'tackle');
      } else if (a === cover && !loose) {
        const ownGoal = { x: -team.attackDir * m.pitch.length / 2, z: 0 };
        target = v2.add(ballPos, v2.scale(v2.norm(v2.sub(ownGoal, ballPos)), 5)); sprint = v2.dist(a.pos, target) > 6; a.ai.mode = 'cover';
      } else {
        // mark the nearest opponent threat near my shape position
        let mark: Agent | null = null; let bd = m.pitch.futsal ? 7 : 11;
        for (const o of opp.agents) { if (o.isGK || o === carrier) continue; const d = v2.dist(o.pos, shape); if (d < bd) { bd = d; mark = o; } }
        if (mark) { const ownGoal = { x: -team.attackDir * m.pitch.length / 2, z: 0 }; target = v2.add(mark.pos, v2.scale(v2.norm(v2.sub(ownGoal, mark.pos)), 1.6)); a.ai.mode = 'mark'; }
        else { target = shape; a.ai.mode = 'shape'; }
        if (loose && v2.dist(a.pos, ballPos) < 9) { target = interceptPoint(m, a); sprint = true; }
      }
    } else {
      // attacking without the ball
      if (supporters.includes(a)) {
        const dir = team.attackDir;
        const side = a.pos.z > carrier.pos.z ? 1 : -1;
        target = { x: carrier.pos.x + dir * (m.pitch.futsal ? 5 : 11), z: carrier.pos.z + side * (m.pitch.futsal ? 5 : 9) };
        sprint = true; a.ai.mode = 'support';
      } else { target = shape; a.ai.mode = 'shape'; }
      // make runs when a goal is being pushed
      if (m.mods.pushTeam === team.index && m.mods.pushLevel > 0.4 && ['ST', 'LW', 'RW', 'CAM', 'LM', 'RM'].includes(a.role)) { target = { x: target.x + team.attackDir * 8, z: target.z }; sprint = true; }
    }
    const lim = { x: m.pitch.length / 2 - 0.5, z: m.pitch.width / 2 - 0.5 };
    target = { x: Math.max(-lim.x, Math.min(lim.x, target.x)), z: Math.max(-lim.z, Math.min(lim.z, target.z)) };
    const d = v2.sub(target, a.pos); const dl = v2.len(d);
    a.ai.target = target;
    if (dl < 0.6) { a.intent.move = { x: 0, z: 0 }; a.intent.face = carrier ? v2.sub(ballPos, a.pos) : null; }
    else { a.intent.move = v2.scale(v2.norm(d), Math.min(1, dl / 2)); a.intent.face = null; }
    a.intent.sprint = sprint || dl > 9;
  }
}

/** Goalkeeper: positioning on an arc, shot-stopping dives and distribution. */
export function updateKeeper(m: Match, team: TeamState, k: Agent, dt: number) {
  const ball = m.ball; const { length: L, goalWidth, boxDepth, futsal } = m.pitch;
  const dir = team.attackDir; const gx = -dir * L / 2; // own goal line x
  const mode = m.mods.keeper[team.index];
  const ballPos: V2 = { x: ball.x, z: ball.z };
  if (k.action && k.action.type !== 'kick') return;
  if (k.hasBall) {
    k.intent.move = { x: 0, z: 0 }; k.keeperHold += dt;
    if (k.keeperHold > 1.1 && !k.action) {
      // distribute to the most open teammate
      let best: Agent | null = null; let bs = -Infinity;
      for (const t of team.agents) { if (t === k) continue; const o = nearestOpponent(m, t).dist; const d = v2.dist(t.pos, k.pos); const s = Math.min(o, 10) - d * 0.12 + ((t.pos.x - k.pos.x) * dir) * 0.05; if (s > bs) { bs = s; best = t; } }
      if (best) { const d = v2.dist(best.pos, k.pos); m.startKick(k, d > 25 ? 'lob' : 'pass', 0.7, v2.norm(v2.sub(best.pos, k.pos)), { targetAgent: best, botSkill: 0.8 }); k.keeperHold = 0; }
    }
    return;
  }
  k.keeperHold = 0;
  // Shot detection: ball moving toward my goal
  const toward = (ball.vx * -dir) > 4 && !ball.owner;
  const dxLine = (gx - ball.x) * -dir; // distance along travel until the line (positive if in front)
  if (toward && dxLine > 0 && dxLine < 35) {
    const t = dxLine / Math.max(Math.abs(ball.vx), 1);
    const zAt = ball.z + ball.vz * t + 0.5 * ball.curl * ball.speed3() * 0.55 * Math.sign(-ball.vz || 1) * t * t * 0.5;
    const yAt = Math.max(0.11, ball.y + ball.vy * t - 0.5 * 9.81 * t * t);
    const onTarget = Math.abs(zAt) < goalWidth / 2 + 1.2 && yAt < m.pitch.goalHeight + 0.8;
    if (onTarget && t < 1.6 && !k.action) {
      const reach = 1.1 + (k.card.attrs.diving / 99) * 1.4;
      const dz = zAt - k.pos.z;
      const diveDir = Math.sign(dz || (Math.random() < 0.5 ? -1 : 1)) * (dir > 0 ? -1 : 1); // visual dive direction (relative to facing the ball)
      let intercept: V2 = { x: k.pos.x, z: zAt };
      let canReach = Math.abs(dz) < reach + t * 6;
      if (mode === 'wall') canReach = true;
      if (mode === 'soft') { canReach = false; intercept = { x: k.pos.x, z: k.pos.z - Math.sign(dz || 1) * 1.5 }; }
      const act = k.startAction('dive', 0.75, -diveDir, { dir: v2.norm(v2.sub(intercept, k.pos)), save: canReach, zAt, yAt, mode });
      act.data.t = t;
      return;
    }
  }
  // Rush out for loose balls in the box when I'm closest
  let target: V2;
  const inBox = Math.abs(ball.x - gx) < boxDepth && Math.abs(ball.z) < m.pitch.boxWidth / 2;
  const loose = !ball.owner && ball.speed() < 9;
  const myDist = v2.dist(k.pos, ballPos);
  let closestOther = Infinity; for (const o of m.agents) if (o !== k) closestOther = Math.min(closestOther, v2.dist(o.pos, ballPos));
  if (loose && inBox && myDist < closestOther + 1 && myDist < (futsal ? 6 : 10)) { target = ballPos; k.ai.mode = 'collect'; }
  else {
    // arc positioning between the goal centre and the ball
    const center = { x: gx + dir * 0.6, z: 0 };
    const toBall = v2.sub(ballPos, center); const dist = v2.len(toBall);
    const out = Math.min(futsal ? 2.5 : 4.5, Math.max(0.3, dist * 0.09));
    const n = v2.norm(toBall);
    target = v2.add(center, v2.scale(n, out));
    target.z = Math.max(-goalWidth / 2 + 0.3, Math.min(goalWidth / 2 - 0.3, target.z));
    k.ai.mode = 'guard';
  }
  const d = v2.sub(target, k.pos); const dl = v2.len(d);
  k.intent.move = dl > 0.25 ? v2.scale(v2.norm(d), Math.min(1, dl / 1.5)) : { x: 0, z: 0 };
  k.intent.face = v2.sub(ballPos, k.pos);
  k.intent.sprint = dl > 3;
}
