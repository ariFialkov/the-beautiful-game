import type { Agent } from './player';

const G = 9.81;

/** Rolling model used for pass weighting and intercept prediction (must mirror Ball.update ground friction). */
export function rollStep(speed: number, dt: number): number { return Math.max(0, speed - Math.min(speed, (2.2 + speed * 0.18) * dt + speed * 0.004 * speed * dt * 4)); }

const passTable: Array<{ v0: number; dist: number; time: number }> = [];
for (let v0 = 6; v0 <= 32; v0 += 0.5) {
  let v = v0, d = 0, t = 0; const dt = 1 / 60;
  while (v > 5.5 && d < 200) { d += v * dt; v = rollStep(v, dt); t += dt; }
  passTable.push({ v0, dist: d, time: t });
}
/** Initial ground-pass speed so the ball arrives `dist` metres away still rolling at ~5.5 m/s, and the time it takes. */
export function passSpeedFor(dist: number): number { return passLookup(dist).v0; }
export function passTimeFor(dist: number): number { return passLookup(dist).time; }
function passLookup(dist: number): { v0: number; time: number } {
  for (let i = 1; i < passTable.length; i++) {
    if (passTable[i].dist >= dist) { const a = passTable[i - 1], b = passTable[i]; const t = (dist - a.dist) / Math.max(1e-6, b.dist - a.dist); return { v0: a.v0 + (b.v0 - a.v0) * t, time: a.time + (b.time - a.time) * t }; }
  }
  const last = passTable[passTable.length - 1]; return { v0: last.v0, time: last.time * dist / last.dist };
}
/** Predict where a free rolling ball will be after `t` seconds (ground only). */
export function predictRoll(x: number, z: number, vx: number, vz: number, t: number): { x: number; z: number } {
  let sp = Math.hypot(vx, vz); if (sp < 1e-3) return { x, z };
  const nx = vx / sp, nz = vz / sp; let d = 0; const dt = 1 / 30;
  for (let e = 0; e < t; e += dt) { d += sp * dt; sp = rollStep(sp, dt); if (sp <= 0) break; }
  return { x: x + nx * d, z: z + nz * d };
}

export class Ball {
  x = 0; y = 0.11; z = 0;
  vx = 0; vy = 0; vz = 0;
  /** Sideways curl (Magnus): positive bends to the right of travel. */
  curl = 0;
  spin = 0; // visual roll
  owner: Agent | null = null;
  lastTouch: Agent | null = null;
  lastTouchTeam = -1;
  radius = 0.11;
  /** Time since last kick, used by the director to recognise shots in flight. */
  flight = 0;
  inFlightShot: { team: number; target: { x: number; y: number; z: number } | null } | null = null;

  reset(x = 0, z = 0) { this.x = x; this.z = z; this.y = this.radius; this.vx = this.vy = this.vz = 0; this.curl = 0; this.owner = null; this.inFlightShot = null; }
  speed() { return Math.hypot(this.vx, this.vz); }
  speed3() { return Math.hypot(this.vx, this.vy, this.vz); }

  kick(vx: number, vy: number, vz: number, by: Agent, curl = 0) {
    this.vx = vx; this.vy = vy; this.vz = vz; this.curl = curl; this.owner = null; this.lastTouch = by; this.lastTouchTeam = by.team; this.flight = 0;
    if (this.y < this.radius + 0.01) this.y = this.radius + 0.01;
  }

  update(dt: number) {
    if (this.owner) { this.flight = 0; return; }
    this.flight += dt;
    const sp = this.speed3();
    const airborne = this.y > this.radius + 0.02;
    // gravity + quadratic drag
    this.vy -= G * dt;
    const drag = (airborne ? 0.0085 : 0.004) * sp;
    this.vx -= this.vx * drag * dt * 4; this.vz -= this.vz * drag * dt * 4; if (airborne) this.vy -= this.vy * drag * dt * 4;
    // Magnus curl: accelerate perpendicular to horizontal velocity
    if (Math.abs(this.curl) > 1e-4 && sp > 3) {
      const hs = Math.hypot(this.vx, this.vz) || 1;
      const px = -this.vz / hs, pz = this.vx / hs;
      const a = this.curl * sp * 0.55;
      this.vx += px * a * dt; this.vz += pz * a * dt;
      this.curl *= Math.exp(-0.5 * dt);
    }
    if (!airborne) {
      // rolling resistance
      const hs = Math.hypot(this.vx, this.vz);
      if (hs > 0) { const dec = Math.min(hs, (2.2 + hs * 0.18) * dt); this.vx -= (this.vx / hs) * dec; this.vz -= (this.vz / hs) * dec; }
      if (Math.abs(this.vy) < 0.8 && this.y <= this.radius + 0.02) { this.vy = 0; this.y = this.radius; }
    }
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    if (this.y < this.radius) {
      this.y = this.radius;
      if (this.vy < -0.5) { this.vy = -this.vy * 0.55; this.vx *= 0.85; this.vz *= 0.85; this.curl *= 0.6; } else this.vy = 0;
    }
    this.spin += Math.hypot(this.vx, this.vz) / this.radius * dt;
  }
}
