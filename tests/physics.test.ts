import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BallBody, BALL_R, collideGoal, passSpeedFor, predictLanding, predictPath, solveKick, spinVector, type GoalFrame } from '../src/game/ball';
import { SURFACES, type SurfaceId } from '../src/game/surface';

function ball(surface: SurfaceId = 'dry') { const b = new BallBody(); b.surface = SURFACES[surface]; return b; }
function rollDistance(surface: SurfaceId, v0: number) {
  const b = ball(surface); b.vx = v0; b.setRolling(); let t = 0;
  while (b.speed() > 0.05 && t < 30) { b.integrate(1 / 60); t += 1 / 60; }
  return b.x;
}

test('rolling distance depends on the surface', () => {
  const d = Object.fromEntries((['dry', 'firm', 'wet', 'snow', 'court'] as SurfaceId[]).map((s) => [s, rollDistance(s, 10)]));
  console.log('  roll distance from 10 m/s:', Object.entries(d).map(([k, v]) => `${k} ${v.toFixed(1)}m`).join(', '));
  assert.ok(d.dry > 25 && d.dry < 45, `dry ${d.dry}`);
  assert.ok(d.wet > d.dry && d.firm > d.dry, 'wet and firm pitches run faster');
  assert.ok(d.snow < d.dry * 0.7, 'snow is heavy');
  assert.ok(d.court > d.dry, 'indoor court is quick');
});

test('a dropped ball bounces lower each time and less on snow', () => {
  const heights = (s: SurfaceId) => { const b = ball(s); b.y = 3; const peaks: number[] = []; let prevVy = 0; for (let i = 0; i < 60 * 6; i++) { b.integrate(1 / 60); if (prevVy > 0 && b.vy <= 0) peaks.push(b.y); prevVy = b.vy; } return peaks; };
  const dry = heights('dry'), snow = heights('snow');
  assert.ok(dry.length >= 3 && dry[0] < 3 && dry[1] < dry[0] && dry[2] < dry[1], `dry peaks ${dry}`);
  assert.ok(snow[0] < dry[0] * 0.7, `snow ${snow[0]} vs dry ${dry[0]}`);
});

test('sidespin curls the ball in the expected direction and by a realistic amount', () => {
  const run = (side: number) => { const b = ball(); b.vx = 25; b.vy = 4; const w = spinVector(0, side, 0); b.wx = w.x; b.wy = w.y; b.wz = w.z; while (b.x < 25) b.integrate(1 / 120); return b.z; };
  const right = run(60), left = run(-60), none = run(0);
  console.log(`  25 m strike with 60 rad/s sidespin: curl right ${right.toFixed(2)} m, left ${left.toFixed(2)} m, none ${none.toFixed(2)} m`);
  assert.ok(right > 1.5 && right < 7, `right ${right}`);
  assert.ok(left < -1.5 && left > -7, `left ${left}`);
  assert.ok(Math.abs(none) < 0.01);
});

test('topspin dips, backspin floats', () => {
  // carry = distance to the first landing (the moment vertical velocity flips from down to up)
  const flight = (top: number) => { const b = ball(); b.y = 0.2; b.vx = 22; b.vy = 7; const w = spinVector(0, 0, top); b.wx = w.x; b.wy = w.y; b.wz = w.z; let prevVy = b.vy; for (let i = 0; i < 1200; i++) { b.integrate(1 / 240); if (prevVy < 0 && b.vy >= 0) return b.x; prevVy = b.vy; } return b.x; };
  const dip = flight(50), plain = flight(0), float = flight(-50);
  assert.ok(dip < plain && plain < float, `carry dip ${dip} plain ${plain} float ${float}`);
});

test('backspin checks on landing, topspin runs on', () => {
  const land = (top: number) => { const b = ball(); b.vx = 15; b.vy = 8; const w = spinVector(0, 0, top); b.wx = w.x; b.wy = w.y; b.wz = w.z; let t = 0; while (t < 6) { b.integrate(1 / 120); t += 1 / 120; } return b.x; };
  assert.ok(land(-80) < land(0) && land(0) < land(80));
});

test('posts and crossbar bounce the ball back', () => {
  const g: GoalFrame = { lineX: 52.5, side: 1, halfW: 3.66, height: 2.44, depth: 2.2 };
  const b = ball(); b.x = 45; b.y = 1.2; b.z = 3.66; b.vx = 20; b.vy = 1;
  let ev = null; for (let i = 0; i < 120 && !ev; i++) { ev = b.integrate(1 / 120, [g]); }
  assert.equal(ev, 'post'); assert.ok(b.vx < 0, 'rebounds off the post');
  const c = ball(); c.x = 51.5; c.y = 2.47; c.z = 0; c.vx = 20; c.vy = 0.3;
  let ev2 = null; for (let i = 0; i < 120 && !ev2; i++) ev2 = c.integrate(1 / 120, [g]);
  assert.equal(ev2, 'bar');
  const d = ball(); d.x = 45; d.y = 1; d.z = 0; d.vx = 25; d.vy = 1;
  for (let i = 0; i < 240; i++) d.integrate(1 / 120, [g]);
  assert.ok(d.x > 52.5 && d.x < 52.5 + 2.2, `net holds the ball (${d.x})`);
  void collideGoal;
});

test('the kick solver hits its target despite drag, curl and dip', () => {
  for (const [side, top] of [[0, 0], [45, 0], [-45, 0], [0, 30], [30, -20]]) {
    const from = { x: 0, y: BALL_R, z: 0 }, target = { x: 24, y: 1.6, z: 3 };
    const sol = solveKick(from, target, 24, side, top, SURFACES.dry);
    const b = ball(); b.x = from.x; b.y = from.y; b.z = from.z; b.vx = sol.v.x; b.vy = sol.v.y; b.vz = sol.v.z; b.wx = sol.w.x; b.wy = sol.w.y; b.wz = sol.w.z;
    let px = b.x, py = b.y, pz = b.z; while (b.x < 24) { px = b.x; py = b.y; pz = b.z; b.integrate(1 / 240); }
    const k = (24 - px) / (b.x - px); const y = py + (b.y - py) * k, z = pz + (b.z - pz) * k;
    assert.ok(Math.abs(y - 1.6) < 0.12 && Math.abs(z - 3) < 0.12, `side ${side} top ${top}: hit (${y.toFixed(2)}, ${z.toFixed(2)})`);
  }
});

test('ground pass tables land passes at the requested distance', () => {
  for (const s of ['dry', 'wet', 'snow'] as SurfaceId[]) {
    const v0 = passSpeedFor(20, SURFACES[s]); const b = ball(s); b.vx = v0; b.setRolling();
    while (b.vx > 8.5) b.integrate(1 / 120);
    assert.ok(Math.abs(b.x - 20) < 0.8, `${s}: ${b.x}`);
  }
  assert.ok(passSpeedFor(20, SURFACES.snow) > passSpeedFor(20, SURFACES.wet), 'heavier pitch needs a firmer pass');
});

test('prediction matches simulation', () => {
  const b = ball(); b.vx = 12; b.vy = 5; b.vz = 3;
  const path = predictPath(b, 2);
  for (let i = 0; i < 60; i++) b.integrate(1 / 60);
  const p = path.find((q) => Math.abs(q.t - 1) < 1e-6)!;
  assert.ok(Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) < 0.05);
});

test('the landing prediction is steady through a flight and lands where the ball does', () => {
  for (const [d, theta, side] of [[30, 0.4, 0], [45, 0.55, 20], [20, 0.3, -15], [60, 0.72, 0], [35, 0.25, 30]] as const) {
    const b = new BallBody(); b.surface = SURFACES.dry; b.x = 0; b.y = 0.11; b.z = 0;
    const speed = Math.sqrt((9.81 * d) / Math.sin(2 * theta)) * 1.2;
    const sol = solveKick({ x: 0, y: 0.11, z: 0 }, { x: d, y: 0.11, z: 0 }, speed, side, -10, SURFACES.dry, theta);
    b.vx = sol.v.x; b.vy = sol.v.y; b.vz = sol.v.z; b.wx = sol.w.x; b.wy = sol.w.y; b.wz = sol.w.z;
    let prev: { x: number; z: number } | null = null, first: { x: number; z: number } | null = null;
    for (let i = 0; i < 1200; i++) {
      const L = predictLanding(b); if (!L) break; first ??= L;
      if (prev) assert.ok(Math.hypot(L.x - prev.x, L.z - prev.z) < 0.05, 'the predicted landing spot does not jump');
      prev = L; const vy0 = b.vy; b.integrate(1 / 120); if (vy0 < 0 && b.vy >= 0) break;
    }
    assert.ok(first && Math.hypot(first.x - b.x, first.z - b.z) < 0.2, 'predicted at launch = where it lands');
  }
});
