import type { Agent } from './player';
import { SURFACES, type Surface, type SurfaceId } from './surface';

/* Physical constants for a size-5 football. */
export const G = 9.81;
export const BALL_R = 0.11;
const MASS = 0.43;
const INERTIA = (2 / 3) * MASS * BALL_R * BALL_R; // thin-shelled sphere
const AIR_K = 0.5 * 1.2 * Math.PI * BALL_R * BALL_R / MASS; // 0.5·ρ·A/m
const MAGNUS_K = AIR_K * BALL_R; // lift ≈ spin parameter (rω/v), so a = K·(ω×v)
const MAX_STEP = 1 / 120;

export interface V3 { x: number; y: number; z: number; }
export type ContactEvent = 'post' | 'bar' | 'net' | null;

/** Drag coefficient with the drag crisis: a hard-struck ball is relatively slippery, a slow one draggy. */
function dragCd(speed: number): number { return speed < 12 ? 0.45 : speed > 20 ? 0.22 : 0.45 - ((speed - 12) / 8) * 0.23; }

/** Spin vector for a strike along `yaw` with sidespin (+ curls right) and topspin (+ dips, - floats/backspin), in rad/s. */
export function spinVector(yaw: number, side: number, top: number): V3 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: top * s, y: -side, z: -top * c };
}

/** Pure ball state and physics, shared by matches, free kicks, prediction and the kick solver. */
export class BallBody {
  x = 0; y = BALL_R; z = 0;
  vx = 0; vy = 0; vz = 0;
  /** Angular velocity (rad/s). Drives Magnus curve in the air and skid/roll/check on the ground. */
  wx = 0; wy = 0; wz = 0;
  radius = BALL_R;
  surface: Surface = SURFACES.dry;

  speed() { return Math.hypot(this.vx, this.vz); }
  speed3() { return Math.hypot(this.vx, this.vy, this.vz); }
  onGround() { return this.y <= this.radius + 0.005 && Math.abs(this.vy) < 0.05; }
  copyFrom(b: BallBody) { this.x = b.x; this.y = b.y; this.z = b.z; this.vx = b.vx; this.vy = b.vy; this.vz = b.vz; this.wx = b.wx; this.wy = b.wy; this.wz = b.wz; this.surface = b.surface; return this; }
  setRolling() { this.wx = this.vz / this.radius; this.wz = -this.vx / this.radius; }

  /** Advance the physics by dt seconds (sub-stepped). Returns the last goal-frame contact, if any. */
  integrate(dt: number, goals?: GoalFrame[]): ContactEvent {
    let ev: ContactEvent = null;
    // With goals in play, sub-step by distance too so a fast ball cannot tunnel through a 6 cm post.
    const n = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-9), goals ? Math.ceil((this.speed3() * dt) / 0.04) : 1); const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.step(h);
      if (goals) for (const g of goals) { const e = collideGoal(this, g, h); if (e) ev = e; }
    }
    return ev;
  }

  private step(h: number) {
    const r = this.radius, s = this.surface;
    const airborne = this.y > r + 0.005 || this.vy > 0.05;
    const sp = this.speed3();
    // aerodynamic drag
    const k = AIR_K * dragCd(sp) * sp;
    let ax = -k * this.vx, ay = -k * this.vy, az = -k * this.vz;
    if (airborne) {
      ay -= G;
      // Magnus force a = K (ω × v), capped at a lift coefficient of 0.4
      let mx = this.wy * this.vz - this.wz * this.vy, my = this.wz * this.vx - this.wx * this.vz, mz = this.wx * this.vy - this.wy * this.vx;
      const mag = Math.hypot(mx, my, mz) * MAGNUS_K, cap = AIR_K * 0.4 * sp * sp;
      const f = mag > cap && mag > 0 ? cap / mag : 1;
      ax += mx * MAGNUS_K * f; ay += my * MAGNUS_K * f; az += mz * MAGNUS_K * f;
      const decay = Math.exp(-0.08 * h); this.wx *= decay; this.wy *= decay; this.wz *= decay;
    }
    this.vx += ax * h; this.vy += ay * h; this.vz += az * h;
    this.x += this.vx * h; this.y += this.vy * h; this.z += this.vz * h;

    if (this.y <= r) {
      if (this.vy < -0.7) {
        // Bounce: restitution on the normal, friction impulse (bounded by μ·Jn) on the contact point.
        const vin = -this.vy;
        const e = s.bounce * (1 - Math.min(0.3, vin / 40));
        this.vy = e * vin;
        this.y = r + (r - this.y) * e;
        this.contactFriction(s.mu * (1 + e) * vin);
        this.wy *= 0.7;
      } else {
        this.y = r; this.vy = 0;
      }
    }
    if (this.y <= r + 1e-6 && this.vy === 0) this.ground(h);
  }

  /** Apply a tangential friction impulse of at most `maxDv` (as velocity change) toward rolling without slipping. */
  private contactFriction(maxDv: number) {
    const r = this.radius;
    const vcx = this.vx + this.wz * r, vcz = this.vz - this.wx * r;
    const vc = Math.hypot(vcx, vcz);
    if (vc < 1e-6) return;
    const dv = Math.min(maxDv, 0.4 * vc); // 0.4·vc removes all slip for a hollow sphere
    const jx = -dv * vcx / vc * MASS, jz = -dv * vcz / vc * MASS;
    this.vx += jx / MASS; this.vz += jz / MASS;
    this.wx += (-r * jz) / INERTIA; this.wz += (r * jx) / INERTIA;
  }

  private ground(h: number) {
    const r = this.radius, s = this.surface;
    const vcx = this.vx + this.wz * r, vcz = this.vz - this.wx * r;
    if (Math.hypot(vcx, vcz) > 0.03) {
      this.contactFriction(s.mu * G * h); // skidding: backspin checks, topspin kicks on
    } else {
      const hs = Math.hypot(this.vx, this.vz);
      if (hs > 0) {
        const dec = (s.rollC * G + s.rollV * hs) * h;
        if (dec >= hs) { this.vx = 0; this.vz = 0; } else { this.vx *= (hs - dec) / hs; this.vz *= (hs - dec) / hs; }
      }
      this.setRolling();
    }
    this.wy *= Math.exp(-4 * h);
  }
}

/** A goal: posts and crossbar on the goal line plus the net behind it. `side` is +1 for the goal at +x. */
export interface GoalFrame { lineX: number; side: 1 | -1; halfW: number; height: number; depth: number; }
const POST_R = 0.06;

function segPoint(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / (dx * dx + dy * dy + dz * dz)));
  return { x: ax + dx * t, y: ay + dy * t, z: az + dz * t };
}

/** Collide the ball with one goal's woodwork and net. */
export function collideGoal(b: BallBody, g: GoalFrame, h: number): ContactEvent {
  const r = b.radius; let ev: ContactEvent = null;
  // quick reject
  if (Math.abs(b.x - g.lineX) > g.depth + 1 || Math.abs(b.z) > g.halfW + 1.5 || b.y > g.height + 1) return null;
  const segs: Array<[number, number, number, number, number, number, 'post' | 'bar']> = [
    [g.lineX, 0, -g.halfW, g.lineX, g.height, -g.halfW, 'post'],
    [g.lineX, 0, g.halfW, g.lineX, g.height, g.halfW, 'post'],
    [g.lineX, g.height, -g.halfW, g.lineX, g.height, g.halfW, 'bar'],
  ];
  for (const [ax, ay, az, bx, by, bz, kind] of segs) {
    const c = segPoint(b.x, b.y, b.z, ax, ay, az, bx, by, bz);
    let nx = b.x - c.x, ny = b.y - c.y, nz = b.z - c.z; const d = Math.hypot(nx, ny, nz);
    if (d < r + POST_R && d > 1e-6) {
      nx /= d; ny /= d; nz /= d;
      b.x = c.x + nx * (r + POST_R); b.y = c.y + ny * (r + POST_R); b.z = c.z + nz * (r + POST_R);
      const vn = b.vx * nx + b.vy * ny + b.vz * nz;
      if (vn < 0) {
        b.vx -= 1.55 * vn * nx; b.vy -= 1.55 * vn * ny; b.vz -= 1.55 * vn * nz;
        b.vx *= 0.92; b.vy *= 0.92; b.vz *= 0.92; b.wx *= 0.5; b.wy *= 0.5; b.wz *= 0.5;
        if (-vn > 1.5) ev = kind;
      }
    }
  }
  const depthIn = (b.x - g.lineX) * g.side; // >0 behind the line
  if (depthIn > 0 && depthIn < g.depth + r) {
    const insideMouth = Math.abs(b.z) < g.halfW && b.y < g.height;
    if (insideMouth) {
      const damp = Math.exp(-2.5 * h); b.vx *= damp; b.vz *= damp;
      if (depthIn > g.depth - r) { b.x = g.lineX + g.side * (g.depth - r); if (b.vx * g.side > 0) { b.vx = -b.vx * 0.12; b.vz *= 0.5; b.vy *= 0.6; ev = ev ?? 'net'; } }
      if (Math.abs(b.z) > g.halfW - r) { b.z = Math.sign(b.z) * (g.halfW - r); if (b.vz * Math.sign(b.z) > 0) { b.vz = -b.vz * 0.2; b.vx *= 0.6; } }
      if (b.y > g.height - r) { b.y = g.height - r; if (b.vy > 0) b.vy = -b.vy * 0.2; }
    } else if (Math.abs(b.z) >= g.halfW && Math.abs(b.z) < g.halfW + r && b.y < g.height) {
      b.z = Math.sign(b.z) * (g.halfW + r); if (b.vz * Math.sign(b.z) < 0) { b.vz = -b.vz * 0.3; b.vx *= 0.7; } // outside of the side netting
    } else if (Math.abs(b.z) < g.halfW && b.y >= g.height && b.y < g.height + r) {
      b.y = g.height + r; if (b.vy < 0) { b.vy = Math.abs(b.vy) * 0.3; b.vx *= 0.8; } // on top of the net
    }
  }
  return ev;
}

/** The match ball: physics body plus game bookkeeping (who controls it, last touch, shots in flight). */
export class Ball extends BallBody {
  /** The player in control (dribbling, or a keeper holding it). The ball itself is always free unless `held`. */
  owner: Agent | null = null;
  /** True while a goalkeeper has it in his hands. */
  held = false;
  lastTouch: Agent | null = null;
  lastTouchTeam = -1;
  lastTouchTime = -10;
  /** Time since last strike. */
  flight = 0;
  inFlightShot: { team: number; target: V3 | null } | null = null;
  /** Previous step position, for render interpolation and line crossing. */
  px = 0; py = BALL_R; pz = 0;

  reset(x = 0, z = 0) {
    this.x = x; this.z = z; this.y = this.radius; this.vx = this.vy = this.vz = 0; this.wx = this.wy = this.wz = 0;
    this.owner = null; this.held = false; this.inFlightShot = null; this.px = x; this.py = this.y; this.pz = z;
  }

  /** Strike the ball: full 3D velocity and spin. */
  strike(v: V3, w: V3, by: Agent | null, time: number) {
    this.vx = v.x; this.vy = v.y; this.vz = v.z; this.wx = w.x; this.wy = w.y; this.wz = w.z;
    this.owner = null; this.held = false; this.flight = 0;
    if (by) { this.lastTouch = by; this.lastTouchTeam = by.team; this.lastTouchTime = time; }
    if (this.y < this.radius + 0.01 && this.vy > 0) this.y = this.radius + 0.01;
  }

  update(dt: number, goals?: GoalFrame[]): ContactEvent {
    this.px = this.x; this.py = this.y; this.pz = this.z;
    if (this.held) return null;
    this.flight += dt;
    return this.integrate(dt, goals);
  }
}

/* ------------------------------ prediction ------------------------------ */
export interface PathPoint { t: number; x: number; y: number; z: number; vx: number; vz: number; }
const scratch = new BallBody();
/** Simulate the ball forward (ignoring players and goals), sampling every `step` seconds. */
export function predictPath(b: BallBody, duration = 3, step = 1 / 30): PathPoint[] {
  const s = scratch.copyFrom(b); const out: PathPoint[] = [{ t: 0, x: s.x, y: s.y, z: s.z, vx: s.vx, vz: s.vz }];
  for (let t = step; t <= duration + 1e-9; t += step) { s.integrate(step); out.push({ t, x: s.x, y: s.y, z: s.z, vx: s.vx, vz: s.vz }); if (s.speed3() < 0.05 && s.y <= s.radius + 0.001) break; }
  return out;
}

/* ------------------------------ ground pass tables ------------------------------ */
const ARRIVE = 4.5;
const passTables = new Map<SurfaceId, Array<{ v0: number; dist: number; time: number }>>();
function passTable(surface: Surface) {
  let t = passTables.get(surface.id);
  if (t) return t;
  t = [];
  const b = new BallBody(); b.surface = surface;
  for (let v0 = 5; v0 <= 32; v0 += 0.5) {
    b.x = 0; b.y = BALL_R; b.z = 0; b.vx = v0; b.vy = 0; b.vz = 0; b.setRolling(); b.wy = 0;
    let time = 0; while (b.vx > ARRIVE && time < 8) { b.integrate(1 / 60); time += 1 / 60; }
    t.push({ v0, dist: b.x, time });
  }
  passTables.set(surface.id, t); return t;
}
function passLookup(dist: number, surface: Surface) {
  const tab = passTable(surface);
  for (let i = 1; i < tab.length; i++) if (tab[i].dist >= dist) { const a = tab[i - 1], c = tab[i]; const k = (dist - a.dist) / Math.max(1e-6, c.dist - a.dist); return { v0: a.v0 + (c.v0 - a.v0) * k, time: a.time + (c.time - a.time) * k }; }
  const last = tab[tab.length - 1]; return { v0: last.v0, time: last.time * dist / Math.max(1, last.dist) };
}
/** Launch speed for a ground pass that arrives `dist` metres away still rolling firmly, on this surface. */
export function passSpeedFor(dist: number, surface: Surface = SURFACES.dry): number { return passLookup(dist, surface).v0; }
export function passTimeFor(dist: number, surface: Surface = SURFACES.dry): number { return passLookup(dist, surface).time; }

/* ------------------------------ kick solver ------------------------------ */
export interface KickSolution { v: V3; w: V3; yaw: number; pitch: number; time: number; }

/** Find the launch direction that sends a ball struck at `speed` with the given side/top spin through `target`
 *  (a point in space, reached when the ball has travelled the horizontal distance to it). Accounts for drag, Magnus and spin.
 *  Pitch is found by bisection on a monotonic error (a ball that lands short counts as "too low"); `pitchHint` >= 0.5
 *  asks for the high, lofted arc instead of the direct one. */
export function solveKick(from: V3, target: V3, speed: number, side: number, top: number, surface: Surface, pitchHint?: number): KickSolution {
  const dx = target.x - from.x, dz = target.z - from.z; const D = Math.max(0.5, Math.hypot(dx, dz));
  const yaw0 = Math.atan2(dz, dx); const fx = Math.cos(yaw0), fz = Math.sin(yaw0);
  const b = new BallBody(); b.surface = surface;
  const sim = (yaw: number, pitch: number) => {
    const w = spinVector(yaw, side, top);
    b.x = from.x; b.y = Math.max(BALL_R, from.y); b.z = from.z;
    b.vx = Math.cos(yaw) * Math.cos(pitch) * speed; b.vz = Math.sin(yaw) * Math.cos(pitch) * speed; b.vy = Math.sin(pitch) * speed;
    b.wx = w.x; b.wy = w.y; b.wz = w.z;
    let t = 0, px = b.x, py = b.y, pz = b.z, prog = 0, prevVy = b.vy;
    while (t < 6) {
      px = b.x; py = b.y; pz = b.z; prevVy = b.vy;
      b.integrate(1 / 120); t += 1 / 120;
      prog = (b.x - from.x) * fx + (b.z - from.z) * fz;
      if (prog >= D) break;
      // landed (first bounce) before reaching the target plane: too low, by how far it fell short
      if (prevVy < 0 && b.vy >= 0 && t > 0.05 && target.y > BALL_R + 0.05) return { errH: -(D - prog) * 0.2 - 0.5, lat: 0, t };
      if (b.speed3() < 0.3) return { errH: -(D - prog) * 0.2 - 0.5, lat: 0, t };
    }
    const p0 = (px - from.x) * fx + (pz - from.z) * fz; const k = prog > p0 ? Math.max(0, Math.min(1, (D - p0) / (prog - p0))) : 1;
    const cx = px + (b.x - px) * k, cy = py + (b.y - py) * k, cz = pz + (b.z - pz) * k;
    return { errH: prog >= D ? cy - target.y : -(D - prog) * 0.2 - 0.5, lat: -(cx - from.x) * fz + (cz - from.z) * fx, t };
  };
  const high = (pitchHint ?? 0) >= 0.5;
  let lo = high ? 0.55 : -0.25, hi = high ? 1.25 : 0.75;
  let yaw = yaw0, pitch = pitchHint ?? 0.2, time = 0;
  for (let outer = 0; outer < 4; outer++) {
    // bisection on pitch for the current yaw
    let a = lo, c = hi; let ea = sim(yaw, a).errH, ec = sim(yaw, c).errH;
    if (Math.sign(ea) === Math.sign(ec)) pitch = Math.abs(ea) < Math.abs(ec) ? a : c;
    else {
      for (let i = 0; i < 18; i++) { const mid = (a + c) / 2; const em = sim(yaw, mid).errH; if (Math.sign(em) === Math.sign(ea)) { a = mid; ea = em; } else { c = mid; ec = em; } }
      pitch = (a + c) / 2;
    }
    const r = sim(yaw, pitch); time = r.t;
    if (Math.abs(r.lat) < 0.02) break;
    yaw -= Math.atan2(r.lat, D);
  }
  const w = spinVector(yaw, side, top);
  return { v: { x: Math.cos(yaw) * Math.cos(pitch) * speed, y: Math.sin(pitch) * speed, z: Math.sin(yaw) * Math.cos(pitch) * speed }, w, yaw, pitch, time };
}
