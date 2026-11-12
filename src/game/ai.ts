import type { SkillMove } from './skills';
import { v2, type V2 } from './pitch';
import type { Agent } from './player';
import type { Match, TeamState } from './match';

const rnd = () => Math.random(); // (looked up each call, so tests can seed it)

/** Team block: the defensive line and the block's length and width follow the ball. Compact and narrow without
 *  the ball, long and wide with it. Each player keeps his line (defence, midfield, attack) and his lane. */
export function shapeTarget(m: Match, team: TeamState, a: Agent): V2 {
  const { length: L, width: W, futsal } = m.pitch;
  const dir = team.attackDir; const ball = m.ball;
  const inPoss = m.possessionTeam === team.index;
  const ownGoal = -dir * L / 2;
  const ballAdv = (ball.x - ownGoal) * dir;                       // how far up the pitch the ball is, from our goal
  const block = (inPoss ? (futsal ? 0.5 : 0.46) : (futsal ? 0.38 : 0.32)) * L;
  const behind = (inPoss ? (futsal ? 0.4 : 0.42) : (futsal ? 0.22 : 0.27)) * L;
  const line = Math.max(0.1 * L, Math.min(0.56 * L, ballAdv - behind)); // the back line's distance from our goal
  const back = futsal ? -0.45 : -0.62, front = futsal ? 0.4 : 0.4;
  const rel = Math.max(0, Math.min(1, (a.home.x - back) / (front - back)));
  const x = ownGoal + dir * (line + rel * block);
  const z = a.home.z * (W / 2) * (inPoss ? 0.86 : 0.6) + ball.z * (inPoss ? 0.2 : 0.38);
  const lim = L / 2 - 2;
  return { x: Math.max(-lim, Math.min(lim, x)), z: Math.max(-W / 2 + 1.5, Math.min(W / 2 - 1.5, z)) };
}

/** Where a receiver should take a pass: the reachable point on the ball's path that costs least, counting the time
 *  and the turn away from his run (a sprinting player keeps his stride rather than doubling back). `prefer` is the
 *  direction he wants to go (the stick, for a human). */
export function receivePoint(m: Match, a: Agent, maxY: number, prefer?: V2 | null): { p: V2; t: number } {
  const path = m.predicted(); const sp = a.maxSpeed * 0.92; const speed = a.speed();
  // the way he's facing/running: turning his back on it costs (more at pace)
  const run = prefer && v2.len(prefer) > 0.2 ? v2.norm(prefer) : speed > 3 ? v2.norm(a.vel) : a.heading;
  const k = prefer ? 1.1 : 0.6 + 0.4 * Math.min(1, speed / 5);
  let best: { p: V2; t: number } | null = null; let bc = Infinity;
  for (const q of path) {
    if (q.t < 0.08 || q.y > maxY) continue;
    const p = { x: q.x, z: q.z }; const d = v2.dist(a.pos, p);
    if (d > sp * q.t + 0.7) continue;
    const turn = run && d > 0.8 ? Math.acos(Math.max(-1, Math.min(1, v2.dot(v2.scale(v2.sub(p, a.pos), 1 / d), run)))) : 0;
    // ...and so does changing pace: a runner takes it where he can keep his speed
    const cost = q.t + turn * k + Math.abs(d / Math.max(0.1, q.t) - speed) * 0.2;
    if (cost < bc) { bc = cost; best = { p, t: q.t }; }
  }
  if (best) return best;
  const last = path[path.length - 1]; return { p: { x: last.x, z: last.z }, t: last.t };
}

/** Time for a player to reach the ball along its predicted path, and where. */
function interceptPlan(m: Match, a: Agent, maxY: number): { p: V2; t: number } {
  const b = m.ball; const path = m.predicted(); const speed = a.maxSpeed * 0.92;
  if (b.owner && !b.held) { const p = { x: b.x, z: b.z }; return { p, t: v2.dist(a.pos, p) / speed }; }
  for (const q of path) { if (q.y > maxY) continue; const d = v2.dist(a.pos, { x: q.x, z: q.z }); if (d <= speed * q.t + 0.5) return { p: { x: q.x, z: q.z }, t: Math.max(q.t, d / speed) }; }
  const last = path[path.length - 1]; const p = { x: last.x, z: last.z }; return { p, t: last.t + v2.dist(a.pos, p) / speed };
}

const lastPresser = new WeakMap<TeamState, Agent>();

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

/** How good a team-mate is as the target of a restart pass: free of a marker, a clear lane, a sensible distance. */
function restartScore(m: Match, team: TeamState, a: Agent, t: Agent, opp: Agent[]): number {
  const d = v2.dist(t.pos, a.pos); const free = Math.min(8, nearestOpponent(m, t).dist);
  const lane = laneOpen(a.pos, t.pos, opp, 2 + d * 0.06);
  const ideal = m.pitch.futsal ? 7 : 15;
  return free * 1.2 * (0.25 + 0.75 * lane) - Math.abs(d - ideal) * 0.12 + ((t.pos.x - a.pos.x) * team.attackDir) * 0.03 + (lane < 0.5 ? -4 : 0);
}

/** Set-piece taker decisions. */
function setPieceDecision(m: Match, team: TeamState, a: Agent, skill: number): boolean {
  const sp = m.setPiece; if (!sp || sp.taker !== a) return false;
  const opp = m.opponentsOf(team.index).agents;
  const { length: L, goalWidth, boxDepth } = m.pitch;
  const goal = { x: team.attackDir * L / 2, z: 0 };
  const dGoal = v2.dist(a.pos, goal);
  const corner = () => (rnd() < 0.5 ? -1 : 1) * goalWidth * (0.28 + rnd() * 0.14);
  // a goal the other side is owed is overdue: a restart in our own half goes back to the keeper, who fumbles it
  const k = team.agents.find((x) => x.isGK);
  if (m.mods.ownGoal[team.index] > 0 && k && k !== a && sp.kind !== 'penalty' && sp.kind !== 'kickoff' && (a.pos.x - goal.x) * team.attackDir < 0 && v2.dist(a.pos, k.pos) < L * 0.45 && m.phase === 'play') {
    k.ai.fumble = m.time + 4; m.startKick(a, 'pass', 0.5, v2.norm(v2.sub(k.pos, a.pos)), { targetAgent: k, botSkill: skill }); return true;
  }
  switch (sp.kind) {
    case 'penalty': {
      // a moment over the ball first, then a corner
      if (m.penalty && m.penalty.taker === a && m.time < m.penalty.aiAt) return true;
      const z = corner(); m.startKick(a, 'shoot', 0.7 + rnd() * 0.2, v2.norm(v2.sub({ x: goal.x, z }, a.pos)), { botSkill: skill, target: { x: goal.x, z, y: 0.4 + rnd() * 1.4 } }); return true;
    }
    case 'freekick': {
      // lined up like a real one: a pause over the ball, then (in range) a strike that clears the wall
      const fk = m.freeKick;
      if (fk && fk.taker === a) {
        if (m.time < fk.aiAt) return true;
        if (fk.direct && rnd() < 0.85 && m.aiFreeKick(a, skill)) return true;
      } else if (dGoal < (m.pitch.futsal ? 14 : 29) && Math.abs(a.pos.z) < 22) { const z = corner(); m.startKick(a, 'shoot', 0.75, v2.norm(v2.sub({ x: goal.x, z }, a.pos)), { finesse: true, botSkill: skill, target: { x: goal.x, z, y: 1.4 + rnd() * 0.7 } }); return true; }
      break;
    }
    case 'corner': {
      const target = bestTeammate(m, team, a, (t) => !t.isGK && Math.abs(t.pos.x - goal.x) < boxDepth + 3, (t) => t.card.attrs.physical + rnd() * 30);
      if (target && rnd() < 0.8) { m.startKick(a, m.pitch.futsal ? 'pass' : 'lob', 0.75, v2.norm(v2.sub(target.pos, a.pos)), { targetAgent: target, botSkill: skill }); return true; }
      break;
    }
    case 'throw': {
      const target = bestTeammate(m, team, a, (t) => !t.isGK && v2.dist(t.pos, a.pos) < 20, (t) => restartScore(m, team, a, t, opp) - v2.dist(t.pos, a.pos) * 0.05);
      if (target) { m.startKick(a, v2.dist(target.pos, a.pos) > 9 && !m.pitch.futsal ? 'lob' : 'pass', 0.6, v2.norm(v2.sub(target.pos, a.pos)), { targetAgent: target, botSkill: skill }); return true; }
      break;
    }
    case 'kickoff': {
      const target = bestTeammate(m, team, a, (t) => !t.isGK && v2.dist(t.pos, a.pos) < 18, (t) => -v2.dist(t.pos, a.pos));
      if (target) { m.startKick(a, 'pass', 0.5, v2.norm(v2.sub(target.pos, a.pos)), { targetAgent: target, botSkill: skill }); return true; }
      break;
    }
  }
  // Any other restart (or no better option): play it to the most available team-mate. A set-piece taker may not dribble.
  const target = bestTeammate(m, team, a, (t) => !t.isGK || sp.kind === 'goalkick', (t) => restartScore(m, team, a, t, opp));
  if (target) { const d = v2.dist(target.pos, a.pos); m.startKick(a, d > 24 && !m.pitch.futsal ? 'lob' : 'pass', 0.65, v2.norm(v2.sub(target.pos, a.pos)), { targetAgent: target, botSkill: skill }); return true; }
  m.startKick(a, m.pitch.futsal ? 'pass' : 'lob', 0.8, { x: team.attackDir, z: 0 }, { clear: true, botSkill: skill });
  void opp;
  return true;
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
  // a goal the other side is owed is overdue: a nervous back-pass to the keeper, which he lets under his foot
  const og = mods.ownGoal[team.index];
  if (og > 0 && ownGoalDist < (futsal ? L * 0.6 : 34) && ownGoalDist > (futsal ? 5 : 8) && rnd() < og) {
    const k = team.agents.find((x) => x.isGK);
    if (k) { k.ai.fumble = m.time + 4; m.startKick(a, 'pass', 0.55, v2.norm(v2.sub(k.pos, a.pos)), { targetAgent: k, botSkill: skill }); return; }
  }
  if (pressure.dist < 1.8 && ownGoalDist < (futsal ? 8 : 22) && rnd() < 0.55) {
    m.startKick(a, futsal ? 'pass' : 'lob', 0.9, v2.norm({ x: dir, z: Math.sign(a.pos.z || 1) * 0.5 }), { clear: true, botSkill: skill });
    return;
  }
  // Pushing for a goal, the attack is built quickly and cleanly (forward passes, runners, players going at the
  // defence) and finished from a good position, not hit hopefully from distance.
  // (a side pushing for a goal works it into a good position rather than hitting it from range)
  const range = push > 0 ? (mods.forced ? (futsal ? 15 : 25) : futsal ? 13 : 21) : futsal ? 15 : 27; // (overdue: a strike from the edge of the box too)
  let shoot = 0; let takeItOn = false;
  if (dGoal < range && (m.mods.goalAllowed[team.index] || dGoal > (futsal ? 7 : 11))) { // (no close-range shots that couldn't count)
    const angle = Math.abs(Math.atan2(a.pos.z, Math.abs(goal.x - a.pos.x) + 0.1));
    const lane = laneOpen(a.pos, goal, opp.filter((o) => !o.isGK), 2.2); // (the keeper is there to be beaten, not a blocker)
    shoot = (1 - dGoal / range) * (1 - angle / 1.4) * (0.35 + lane * 0.65) * (0.5 + skill * 0.6) * appetite;
    if (dGoal < range * 0.65 && lane > 0.3) shoot += 0.3;
    if (push > 0.5 && dGoal < (futsal ? 14 : 22) && lane > (futsal ? 0.15 : 0.25)) shoot = Math.max(shoot, 0.8 + (1 - dGoal / range));
    if (mods.forced && push > 0 && dGoal < range * (futsal ? 1 : 0.8)) shoot = Math.max(shoot, 0.7 + (1 - dGoal / range));
    if (pressure.dist < 1.6) shoot *= 1.3;
    // pushing for a goal and in a real shooting position (in or around the box, a sight of goal): he takes it on
    if (push > 0.3 && dGoal < (futsal ? 11 : 17) && angle < 0.9 && lane > 0.3) { shoot = Math.max(shoot, 1.3 + push); takeItOn = true; }
  }
  let bestPass: { agent: Agent; score: number; kind: 'pass' | 'through' | 'lob' } | null = null;
  for (const t of team.agents) {
    if (t === a || t.isGK) continue;
    if (m.inOffsidePosition(t)) continue; // (the flag would go up)
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
    // pushing for a goal: the ball is moved quickly into a team-mate in a shooting position (a cut-back, a ball into
    // the box, a through ball in behind) rather than carried there
    if (push > 0 && tGoal < (futsal ? 10 : 18) && tGoal < dGoal - 4 && tOpp > 2.2 && lane > 0.5) score += 0.35 + push * 0.5;
    // ...and only into a clear lane, to a man with a yard of space: the passing is clean, nothing is forced through
    if (push > 0) score -= push * ((1 - lane) * 0.9 + (tOpp < 2.5 ? 0.6 : 0));
    if (lane < 0.3 && d > 14 && !futsal) { kind = 'lob'; score += 0.15; }
    // crosses from wide areas into the box (futsal is played on the floor)
    if (!futsal && Math.abs(a.pos.z) > m.pitch.width * 0.25 && Math.abs(a.pos.x - goal.x) < (futsal ? 10 : 25) && Math.abs(t.pos.x - goal.x) < m.pitch.boxDepth + 2 && Math.abs(t.pos.z) < m.pitch.boxWidth / 2) { kind = 'lob'; score += 0.25 + push * 0.3; }
    score *= 0.6 + skill * 0.5;
    if (!bestPass || score > bestPass.score) bestPass = { agent: t, score, kind };
  }
  // a skilful dribbler closed down tries a move on the defender (away from him)
  if (!(mods.forced && push > 0) && pressure.agent && pressure.dist < (futsal ? 2.2 : 3.2) && rnd() < (futsal ? 0.08 : 0.1) * a.skill.dribble) { // (not while a goal is being forced: then it's quick and direct)
    const p = pressure.agent; const rel = { f: (p.pos.x - a.pos.x) * a.heading.x + (p.pos.z - a.pos.z) * a.heading.z, r: (p.pos.x - a.pos.x) * -a.heading.z + (p.pos.z - a.pos.z) * a.heading.x };
    const toward = rel.r >= 0 ? 1 : -1; const u = rnd();
    const pick: [SkillMove, number] = rel.f > 0.5 && u < 0.25 ? ['dragback', 1] : u < 0.5 ? ['feint', toward] : u < 0.8 ? ['stepover', toward] : ['roulette', -toward];
    if (m.startSkill(a, pick[0], pick[1])) return;
  }
  const ahead = { x: a.pos.x + dir * 6, z: a.pos.z };
  let spaceAhead = 8; for (const o of opp) spaceAhead = Math.min(spaceAhead, v2.dist(o.pos, ahead));
  const dribble = 0.5 + a.skill.dribble * 0.3 - (pressure.dist < 2.2 ? 0.4 : 0) + (spaceAhead > 5 ? 0.25 : spaceAhead < 2.5 ? -0.2 : 0) + (dGoal > 45 ? 0.05 : 0) + push * (spaceAhead > 7 ? 0.12 : -0.25);
  // (in a shooting spot while pushing, only a team-mate clearly better placed gets the ball instead)
  const better = bestPass && v2.dist(bestPass.agent.pos, goal) < dGoal - 5;
  const options: Array<[string, number]> = [['shoot', shoot], ['pass', (bestPass?.score ?? 0) * (pressure.dist < 3 ? 1.2 : 0.9) * (takeItOn && !better ? 0.35 : 1)], ['dribble', dribble]];
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
    // a clear line to the ball: the carrier's legs are not between the tackler and the ball
    const seg = v2.sub(bp, a.pos); const segL = Math.max(0.01, v2.len(seg)); const rel = v2.sub(carrier.pos, a.pos);
    const along = Math.max(0, Math.min(segL, v2.dot(rel, seg) / segL));
    const clear = v2.dist(carrier.pos, v2.add(a.pos, v2.scale(seg, along / segL))) > 0.45;
    const bias = Math.max(-1, Math.min(1, m.mods.tackleBias * (team.index === 0 ? 1 : -1)));
    const timing = Math.max(0.05, Math.min(1, skill + bias * 0.3));
    if (exposed && clear && facing && bd < 1.15 && rnd() < (2 + 5 * timing) * dt) m.tackle(a, 'tackle');
    else if (exposed && clear && facing && bd > 1.3 && bd < 2.4 && rnd() < (0.15 + 0.6 * timing) * dt && v2.dot(carrier.heading, v2.norm(v2.sub(a.pos, carrier.pos))) > -0.2) m.tackle(a, 'slide');
    else if (!exposed && bd < 0.95 && rnd() < (1 - timing) * 0.35 * dt) m.tackle(a, 'tackle'); // mistimed
  }
  return spot;
}

export function updateTeamAI(m: Match, team: TeamState, dt: number) {
  const ball = m.ball; const now = m.time;
  if (m.phase === 'kickoff' || m.phase === 'halftime' || m.phase === 'fulltime') return;
  for (const k of team.agents) if (k.isGK && m.aiDriven(k)) updateKeeper(m, team, k, dt);
  const skill = team.index === 0 ? m.mods.homeAiSkill : m.mods.botSkill;
  const opp = m.opponentsOf(team.index);
  const inPoss = m.possessionTeam === team.index;
  const sp = m.setPiece && m.setPiece.kind !== 'kickoff' && (m.phase === 'restart' || m.phase === 'play') ? m.setPiece : null;
  const carrier = sp ? sp.taker : ball.owner; // at a set piece the taker is treated as on the ball
  const ballPos: V2 = { x: ball.x, z: ball.z };
  const outfield = team.agents.filter((a) => !a.isGK);
  const ai = outfield.filter((a) => m.aiDriven(a));
  const loose = !carrier;
  const lofted = loose && ball.y > 1.2;
  const dead = m.phase === 'dead' || m.phase === 'goal';
  const futsal = m.pitch.futsal;
  const ownGoal = { x: -team.attackDir * m.pitch.length / 2, z: 0 };

  // ---- roles: one chaser for a loose ball (first to it, or the intended receiver), one presser, one cover ----
  let chaser: Agent | null = null; let chaserPlan: { p: V2; t: number } | null = null;
  // Reading a pass takes a moment: the side that didn't play it reacts after a short delay (sharper players sooner).
  const reacting = loose && ball.lastTouchTeam !== team.index && now - ball.lastTouchTime < 0.22 + (1 - skill) * 0.18;
  if (loose && !dead && !reacting) {
    const receiver = ai.find((a) => a.ai.expectBall > now && ball.lastTouchTeam === team.index);
    // a pass meant for the player the human controls is his to collect: no AI team-mate goes for it
    const humanReceiver = ball.lastTouchTeam === team.index && outfield.some((a) => !m.aiDriven(a) && a.ai.expectBall > now);
    if (receiver) { chaser = receiver; chaserPlan = receivePoint(m, receiver, lofted ? 2.3 : 1.2); }
    else if (humanReceiver) { chaser = null; chaserPlan = null; }
    else for (const a of outfield) { const plan = interceptPlan(m, a, lofted ? 2.3 : 1.2); if (!chaserPlan || plan.t < chaserPlan.t) { chaser = a; chaserPlan = plan; } }
  }
  let presser: Agent | null = null, cover: Agent | null = null;
  if (carrier && carrier.team !== team.index && !dead) {
    const byDist = outfield.slice().sort((p, q) => v2.dist(p.pos, carrier.pos) - v2.dist(q.pos, carrier.pos));
    const prev = lastPresser.get(team);
    presser = prev && byDist.includes(prev) && v2.dist(prev.pos, carrier.pos) < v2.dist(byDist[0].pos, carrier.pos) + 2.5 ? prev : byDist[0];
    lastPresser.set(team, presser);
    const goalSide = v2.add(ballPos, v2.scale(v2.norm(v2.sub(ownGoal, ballPos)), futsal ? 4 : 7));
    cover = outfield.filter((a) => a !== presser && (futsal || a.home.x < 0.1)).sort((p, q) => v2.dist(p.pos, goalSide) - v2.dist(q.pos, goalSide))[0] ?? null;
  }
  const supporters = carrier && carrier.team === team.index ? outfield.filter((a) => a !== carrier).sort((p, q) => v2.dist(p.pos, carrier.pos) - v2.dist(q.pos, carrier.pos)).slice(0, 2) : [];

  // ---- zonal marking: each opponent picked up by at most one player, only within that player's zone ----
  const marks = new Map<Agent, Agent>();
  if (!inPoss && !loose && !dead) {
    const zone = futsal ? 6 : 11;
    const pairs: Array<[number, Agent, Agent]> = [];
    for (const a of outfield) { if (a === presser || a === cover) continue; const sh = shapeTarget(m, team, a); for (const o of opp.agents) { if (o.isGK || o === carrier) continue; const d = v2.dist(o.pos, sh); if (d < zone) pairs.push([d, a, o]); } }
    pairs.sort((p, q) => p[0] - q[0]); const taken = new Set<Agent>();
    for (const [, a, o] of pairs) if (!marks.has(a) && !taken.has(o)) { marks.set(a, o); taken.add(o); }
  }

  // ---- targets ----
  const targets = new Map<Agent, { t: V2; sprint: boolean; fixed: boolean; arrive?: number }>();
  for (const a of ai) {
    if (a.busy()) continue;
    if (carrier === a && !ball.held) continue;
    const shape = shapeTarget(m, team, a);
    let t: V2 = shape; let sprint = false; let fixed = false; a.ai.mode = 'shape';
    if (dead) { targets.set(a, { t: shape, sprint: false, fixed: false }); continue; }
    let arrive: number | undefined;
    if (a === chaser && chaserPlan) { t = chaserPlan.p; sprint = true; fixed = true; a.ai.mode = a.ai.expectBall > now ? 'receive' : 'chase'; if (a.ai.mode === 'receive' && !lofted) arrive = chaserPlan.t; } // balls in the air are attacked, not waited for
    else if (a === presser && carrier && sp) { t = m.clearOfSetPiece(v2.add(ballPos, v2.scale(v2.norm(v2.sub(ownGoal, ballPos)), 1)), 0.8); fixed = true; a.ai.mode = 'shape'; }
    else if (a === presser && carrier) { t = press(m, team, a, carrier, skill, dt); sprint = a.intent.sprint; fixed = true; a.ai.mode = 'press'; }
    else if (a === cover && carrier) { const gs = v2.add(ballPos, v2.scale(v2.norm(v2.sub(ownGoal, ballPos)), futsal ? 4 : 7)); t = v2.lerp(gs, { x: gs.x, z: gs.z * 0.7 }, 0.5); sprint = v2.dist(a.pos, t) > 8; fixed = true; a.ai.mode = 'cover'; }
    else if (marks.has(a)) {
      const o = marks.get(a)!; const spot = v2.add(o.pos, v2.scale(v2.norm(v2.sub(ownGoal, o.pos)), futsal ? 1.2 : 1.8));
      t = v2.lerp(shape, spot, 0.75); const off = v2.sub(t, shape); const lim = (futsal ? 6 : 11) * 0.8; if (v2.len(off) > lim) t = v2.add(shape, v2.scale(v2.norm(off), lim)); a.ai.mode = 'mark';
    } else if (inPoss && carrier && supporters.includes(a)) {
      // offer an angle: diagonal, at a passing distance, on this player's side of the carrier
      const side = a.home.z >= carrier.home.z ? 1 : -1; const d = futsal ? 6 : 13;
      const angled = { x: carrier.pos.x + team.attackDir * d * 0.55, z: carrier.pos.z + side * d * 0.8 };
      t = v2.lerp(shape, angled, 0.65); sprint = v2.dist(a.pos, t) > 10; a.ai.mode = 'support';
    }
    if (inPoss && m.mods.pushTeam === team.index && m.mods.pushLevel > 0.4 && ['ST', 'LW', 'RW', 'CAM', 'LM', 'RM'].includes(a.role) && !fixed) { t = { x: t.x + team.attackDir * 8, z: t.z }; sprint = true; }
    if (m.setPiece?.kind === 'corner' && m.setPiece.team === team.index && a !== m.setPiece.taker && a.home.x > -0.3) { const gx = team.attackDir * (m.pitch.length / 2 - (futsal ? 4 : 8)); t = { x: gx, z: a.home.z * 6 }; }
    // a shooting free kick: the forwards and midfielders gather on the edge of the six-yard box for the rebound
    if (m.freeKick?.direct && m.freeKick.team === team.index && a !== m.freeKick.taker && a.home.x > -0.3) { const gx = team.attackDir * (m.pitch.length / 2 - (futsal ? 4 : 9)); t = { x: gx, z: a.home.z * (futsal ? 3 : 7) }; }
    targets.set(a, { t, sprint, fixed, arrive });
  }
  // ---- spacing: teammates' spots push apart so nobody stacks up on the same patch ----
  const minSpace = futsal ? 4.5 : 9;
  const list = [...targets.entries()].filter(([, v]) => !v.fixed);
  const anchors = [...outfield.filter((a) => !targets.has(a) || targets.get(a)!.fixed).map((a) => (targets.get(a)?.t ?? a.pos))];
  for (let it = 0; it < 3; it++) {
    for (let i = 0; i < list.length; i++) {
      const ti = list[i][1].t;
      for (let k = i + 1; k < list.length; k++) { const tk = list[k][1].t; const d = v2.dist(ti, tk); if (d < minSpace && d > 1e-3) { const push = v2.scale(v2.norm(v2.sub(ti, tk)), (minSpace - d) / 2); list[i][1].t = v2.add(ti, push); list[k][1].t = v2.sub(tk, push); } }
      for (const an of anchors) { const d = v2.dist(list[i][1].t, an); if (d < minSpace * 0.8 && d > 1e-3) list[i][1].t = v2.add(list[i][1].t, v2.scale(v2.norm(v2.sub(list[i][1].t, an)), minSpace * 0.8 - d)); }
    }
  }
  // ---- set pieces: the defending side keeps out of the restricted area; the taker's team-mates give him space ----
  if (sp) {
    const own = sp.team === team.index;
    const clear = sp.kind === 'throw' ? (futsal ? 3 : 4) : futsal ? 4 : 9;
    for (const [a, v] of targets) {
      if (own) { const d = v2.sub(v.t, ballPos); const dl = v2.len(d); if (dl < clear && sp.kind !== 'corner') v.t = v2.add(ballPos, v2.scale(dl > 0.1 ? v2.norm(d) : { x: team.attackDir, z: 0 }, clear)); }
      else v.t = m.clearOfSetPiece(v.t, 1.5);
      v.sprint = v.sprint && !own; void a;
    }
  }
  // ---- stay onside: runs are held on the line (the second-last defender, or the ball) until the pass is played ----
  if (!futsal && !dead && sp?.kind !== 'corner' && !m.freeKick?.direct) {
    const line = m.offsideLine(team.index) - 0.6; const dir = team.attackDir;
    for (const [, v] of targets) if (!v.fixed && v.t.x * dir > line) v.t = { x: line * dir, z: v.t.z };
  }
  // ---- carriers decide; everyone else moves to their spot (jogging unless far away) ----
  for (const a of ai) {
    a.intent.face = null; a.intent.jockey = false;
    if (a.busy()) continue;
    if (carrier === a && !ball.held) {
      if (m.phase !== 'play' || a.pendingKick) continue;
      const pressed = nearestOpponent(m, a).dist < 1.6;
      // on the goal line in front of goal: a player puts it in (shoots) rather than walking it over the line
      const gxl = team.attackDir * m.pitch.length / 2;
      // (a side that mustn't score just now doesn't take it that close: it lays it back off instead - a goal that
      // can't count can't be made to miss from a yard out without it looking wrong)
      const allowed = m.mods.goalAllowed[team.index];
      if (!allowed && Math.abs(gxl - a.pos.x) < 9 && Math.abs(a.pos.z) < m.pitch.boxWidth / 2 && !a.pendingKick) {
        const mate = team.agents.filter((t) => t !== a && !t.isGK).sort((p, q) => Math.abs(gxl - q.pos.x) - Math.abs(gxl - p.pos.x))[0];
        if (mate) { m.startKick(a, 'pass', 0.5, v2.norm(v2.sub(mate.pos, a.pos)), { targetAgent: mate, botSkill: skill }); continue; }
      }
      if (allowed && Math.abs(gxl - a.pos.x) < 3 && Math.abs(a.pos.z) < m.pitch.goalWidth / 2 + 1.5 && !a.pendingKick) {
        const z = (rnd() - 0.5) * m.pitch.goalWidth * 0.6; m.startKick(a, 'shoot', 0.6, v2.norm(v2.sub({ x: gxl, z }, a.pos)), { botSkill: skill, target: { x: gxl, z, y: 0.5 } }); continue;
      }
      if (now >= a.ai.nextDecision || (pressed && now >= a.ai.nextDecision - 0.35)) { a.ai.nextDecision = now + 0.3 + (1 - skill) * 0.3 + rnd() * 0.25; onBall(m, team, a, skill); }
      if (a.ai.mode === 'dribble' && !a.pendingKick) { const d = v2.sub(a.ai.target, a.pos); a.intent.move = v2.len(d) > 0.5 ? v2.norm(d) : { x: 0, z: 0 }; }
      continue;
    }
    const plan = targets.get(a); if (!plan) continue;
    if (dead) { const d = v2.sub(plan.t, a.pos); a.intent.move = v2.len(d) > 1 ? v2.scale(v2.norm(d), 0.5) : { x: 0, z: 0 }; a.intent.sprint = false; continue; }
    const lim = { x: m.pitch.length / 2 - 0.5, z: m.pitch.width / 2 - 0.5 };
    const target = { x: Math.max(-lim.x, Math.min(lim.x, plan.t.x)), z: Math.max(-lim.z, Math.min(lim.z, plan.t.z)) };
    const d = v2.sub(target, a.pos); const dl = v2.len(d);
    a.ai.target = target;
    if (a.ai.mode === 'press') { a.intent.move = dl > 0.3 ? v2.scale(v2.norm(d), Math.min(1, dl)) : { x: 0, z: 0 }; continue; } // press() set facing and jockey
    if (a.ai.mode === 'receive' && m.passFallsShort(a) && v2.dot(d, a.speed() > 2 ? a.vel : a.heading) < 0) {
      // the pass is dying short of him: go back for it at full speed
      a.intent.move = dl > 0.35 ? v2.norm(d) : { x: 0, z: 0 }; a.intent.sprint = dl > 2; a.intent.face = null;
      continue;
    }
    if (a.ai.mode === 'receive' && plan.arrive !== undefined) {
      // time the run to arrive with the ball (no dash there to stand and turn round); keep facing the way he's going
      const need = dl / Math.max(0.15, plan.arrive - 0.12);
      a.intent.move = dl > 0.35 ? v2.scale(v2.norm(d), Math.max(0.25, Math.min(1, need / a.maxSpeed))) : { x: 0, z: 0 };
      a.intent.sprint = need > a.maxSpeed * 0.68; a.intent.face = dl < 2.5 ? a.heading : null; // small adjustments: no turning round
      continue;
    }
    if (dl < 0.6) { a.intent.move = { x: 0, z: 0 }; a.intent.face = v2.sub(ballPos, a.pos); }
    else { a.intent.move = v2.scale(v2.norm(d), Math.min(1, dl / 3)); if (!plan.fixed && dl < 6) a.intent.face = v2.sub(ballPos, a.pos); }
    a.intent.sprint = plan.sprint || dl > (plan.fixed ? 6 : 14);
  }
}

/** What a goalkeeper can do about a shot crossing his plane at `hit` (t seconds from now), from his attributes and
 *  mode: when he can react, how fast he can launch sideways, and whether his hands can get there. Shared with the
 *  director so it only interferes with shots the keeper genuinely can't reach. */
export function keeperSavePlan(m: Match, k: Agent, hit: { t: number; y: number; z: number }) {
  const mode = m.mods.keeper[k.team];
  const handling = (k.card.attrs.diving + k.card.attrs.reflexes) / 198;
  const reaction = Math.max(0.1, Math.min(0.34, 0.25 - handling * 0.1 + (mode === 'soft' ? 0.08 : mode === 'wall' ? -0.05 : 0)));
  const speed = 2.2 + handling * 1.4 + (mode === 'wall' ? 1.6 : mode === 'soft' ? -0.6 : 0); // sideways launch speed of a dive
  const lateral = hit.z - k.pos.z;
  // reach: arms at full stretch, less for balls up near the top corner or right at the feet when far out
  const reach = (Math.abs(lateral) < 0.6 ? 0.9 : 1.15) - Math.max(0, hit.y - 1.95) * 0.7;
  const available = Math.max(0, hit.t - reaction - 0.06); // reaction plus the push-off
  const travel = Math.max(0, Math.abs(lateral) - reach);
  const reachable = hit.y < 2.5 && travel <= speed * available;
  return { reaction, speed, lateral, reach, travel, reachable, handling, mode };
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
      const opp = m.opponentsOf(team.index).agents;
      for (const t of team.agents) { if (t === k) continue; const s = restartScore(m, team, k, t, opp); if (s > bs) { bs = s; best = t; } }
      if (best) { const d = v2.dist(best.pos, k.pos); m.startKick(k, d > 26 && !futsal ? 'lob' : 'pass', 0.75, v2.norm(v2.sub(best.pos, k.pos)), { targetAgent: best, botSkill: 0.8 }); }
    }
    return;
  }
  k.keeperHold = 0;
  // A penalty: keepers commit as it's struck - the human's chosen dive, or a guess
  const pen = m.penalty;
  if (pen && pen.team !== team.index && pen.stage === 'struck' && !k.ai.penDone && m.time - pen.strikeAt < 0.5) {
    k.ai.penDone = true;
    const human = m.humanTeam === team.index;
    // (a guess is a side and a height, not the exact spot: he dives into the area a penalty usually goes, so one placed
    // right into the corner beats him even when he picks the right side, and one closer in on his side is saved)
    const g0 = human && pen.guess ? pen.guess : rnd() < 0.2 ? { z: 0, y: 1.0 } : { z: (rnd() < 0.5 ? -1 : 1) * (goalWidth / 2 - 1.4), y: 0.4 + rnd() * 1.3 };
    let g = { z: Math.max(-(goalWidth / 2 - 1.3), Math.min(goalWidth / 2 - 1.3, g0.z)), y: g0.y };
    // a kick that mustn't go in (a shootout the other side must win): he reads it and goes the right way
    if (!human && !m.mods.goalAllowed[pen.team] || (!human && m.shootout && !m.shootoutAllows(pen.team))) {
      const path = m.predicted(); const planeX = k.pos.x;
      for (let i = 1; i < path.length; i++) { const a0 = path[i - 1], b0 = path[i]; if ((b0.x - planeX) * -dir >= 0 && (a0.x - planeX) * -dir < 0) { const f = (planeX - a0.x) / (b0.x - a0.x || 1e-6); g = { z: a0.z + (b0.z - a0.z) * f, y: Math.max(0.3, a0.y + (b0.y - a0.y) * f) }; break; } }
    }
    const lat = g.z - k.pos.z;
    if (Math.abs(lat) > 0.6) {
      const side = Math.sign(lat); const yawK = Math.atan2(k.heading.x, k.heading.z); const leftZ = -Math.sin(yawK);
      k.ai.dive = { side: Math.sign(side * leftZ) || 1, worldSide: side, mode: 'normal', flight: 0.42, vel: { x: 0, z: side * Math.min(5.5, Math.max(0, Math.abs(lat) - 0.85) / 0.42) }, hands: { x: gx + dir * 0.3, y: g.y, z: g.z }, high: g.y, lat: Math.abs(lat) }; // (the body goes to an arm's length short of it: the hands do the rest)
      k.ai.diveAt = m.time + 0.02; k.ai.shotKey = ball.lastTouchTime;
    } else { k.ai.shotKey = ball.lastTouchTime; k.intent.move = { x: 0, z: 0 }; return; } // stays big in the middle
  }
  if (!pen) k.ai.penDone = false;
  // Pending dive (reaction time elapsed?)
  if (k.ai.dive && m.time >= k.ai.diveAt) {
    const d = k.ai.dive; k.ai.dive = null;
    k.startAction('dive', Math.max(1.2, d.flight + 0.9), d.side, d);
    return;
  }
  // Read the shot: where will the ball cross my plane? React after a human delay, then go as late as he can and still
  // get there, at the pace he needs (no diving the instant it's struck).
  const toward = !ball.owner && !ball.held && ball.vx * -dir > 4 && m.phase === 'play';
  const shotKey = ball.lastTouchTime;
  if (k.ai.dive && k.ai.shotKey !== shotKey) k.ai.dive = null; // deflected before he went: read it again
  if (toward && !k.ai.dive && k.ai.shotKey !== shotKey) {
    const path = m.predicted(); const planeX = k.pos.x;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if ((b.x - planeX) * -dir >= 0 && (a.x - planeX) * -dir < 0) {
        const f = (planeX - a.x) / (b.x - a.x || 1e-6);
        const t = a.t + (b.t - a.t) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
        if (t > 1.8 || Math.abs(z) > goalWidth / 2 + 0.8 || y > goalHeight + 0.5) break;
        const plan = keeperSavePlan(m, k, { t, y, z });
        const lateral = plan.lateral;
        // close to him: shuffle across and take it with the hands (the anticipation step plans the catch)
        if (Math.abs(lateral) < 0.55 && y < 1.9) { k.intent.move = { x: 0, z: Math.sign(lateral) * Math.min(1, Math.abs(lateral) * 2) }; k.intent.sprint = true; return; }
        let side = Math.sign(lateral);
        if (mode === 'soft' && rnd() < (m.mods.forced && m.mods.pushTeam !== team.index ? 0.5 : 0.3)) side = -side; // sold the wrong way
        // when to go: as late as possible (a set keeper waits), but no sooner than he can react
        const need = plan.travel / plan.speed + 0.1;
        const startIn = Math.max(plan.reaction, t - need - 0.08);
        const flight = Math.max(0.12, t - startIn);
        const travel = side === Math.sign(lateral) ? Math.max(0, Math.abs(lateral) - plan.reach * 0.75) : 1.0;
        const speed = Math.min(plan.speed, travel / flight);
        const yawK = Math.atan2(k.heading.x, k.heading.z); const leftZ = -Math.sin(yawK);
        const hz = side === Math.sign(lateral) ? z : k.pos.z + side * 1.2;
        k.ai.dive = { side: Math.sign(side * leftZ) || 1, worldSide: side, mode, flight, vel: { x: 0, z: side * speed }, hands: { x: planeX, y: Math.max(0.25, Math.min(2.4, y)), z: hz }, high: y, lat: Math.abs(hz - k.pos.z) };
        k.ai.diveAt = m.time + startIn; k.ai.shotKey = shotKey; // one decision per shot
        k.intent.move = { x: 0, z: 0 }; // set: feet planted while he reads it
        return;
      }
    }
  }
  if (k.ai.dive) { k.intent.move = { x: 0, z: 0 }; return; } // set, waiting for the moment to go
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
    // a free kick in range: set on the line, shaded to the side the wall doesn't cover
    if (m.freeKick?.direct && m.freeKick.team !== team.index) target = { x: gx + dir * 0.45, z: m.freeKick.keeperZ };
  }
  const d = v2.sub(target, k.pos); const dl = v2.len(d);
  k.intent.move = dl > 0.2 ? v2.scale(v2.norm(d), Math.min(1, dl / 1.2)) : { x: 0, z: 0 };
  k.intent.face = v2.sub(ballPos, k.pos);
  k.intent.sprint = dl > 3;
}
