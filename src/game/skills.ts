/** Skill moves (the right stick, FIFA style). Each move is a short keyframed performance in the frame of the player at the
 *  moment it starts (f = forward, r = to the right, metres): where the body goes and which way it turns, where the ball
 *  is carried (until the touch that releases it, after which it is free and the physics takes over), both feet, and the
 *  body's lean and crouch. The match moves the body and ball along these paths with real velocities, the animation
 *  poses the limbs from the same keys, and both blend in and out of normal running so moves flow into each other.
 *
 *  The keys are written for a move to the right (side +1); a move to the left mirrors them. */

export type SkillMove = 'feint' | 'dragback' | 'roll' | 'knock' | 'stepover' | 'heel' | 'roulette' | 'elastico' | 'rainbow';
type K1 = Array<[number, number]>; type K3 = Array<[number, number, number, number]>;
export interface SkillDef {
  label: string;
  /** 1: a single flick or hold; 2: two directions; 3: three. */
  layer: number;
  dur: number;
  /** Fraction of the move at which the ball is released (the touch). */
  release: number;
  bodyF: K1; bodyR: K1; yaw: K1;
  ballF: K1; ballR: K1; ballY?: K1;
  /** Release: direction (start frame) and pace, with an optional upward speed. */
  exit: { f: number; r: number; speed: number; up?: number };
  /** The foot on the move's side, and the other foot: [u, f, r, height above the ankle's resting height]. */
  footS: K3; footO: K3;
  roll?: K1; crouch?: K1; pitch?: K1;
}

const ease = (t: number) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
/** Smoothly interpolated keyframes. */
export function k1(keys: K1, u: number): number {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return va + (vb - va) * ease((u - a) / Math.max(1e-6, b - a)); }
  return keys[keys.length - 1][1];
}
export function k3(keys: K3, u: number): [number, number, number] {
  if (u <= keys[0][0]) return [keys[0][1], keys[0][2], keys[0][3]];
  for (let i = 1; i < keys.length; i++) if (u <= keys[i][0]) {
    const a = keys[i - 1], b = keys[i]; const e = ease((u - a[0]) / Math.max(1e-6, b[0] - a[0]));
    return [a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e, a[3] + (b[3] - a[3]) * e];
  }
  const l = keys[keys.length - 1]; return [l[1], l[2], l[3]];
}

export const SKILLS: Record<SkillMove, SkillDef> = {
  // ---- layer 1: a single flick or hold ----
  // body feint: drop the shoulder and step one way, then take the ball the other
  feint: {
    label: 'Body feint', layer: 1, dur: 0.58, release: 0.62,
    bodyF: [[0, 0], [0.45, 0.12], [1, 0.8]], bodyR: [[0, 0], [0.4, 0.2], [1, -0.45]], yaw: [[0, 0], [0.4, 0.3], [1, -0.35]],
    ballF: [[0, 0.42], [0.62, 0.6]], ballR: [[0, 0], [0.62, -0.02]],
    exit: { f: 0.8, r: -0.6, speed: 4.8 },
    footS: [[0, -0.02, 0.11, 0], [0.18, 0.08, 0.24, 0.1], [0.38, 0.16, 0.34, 0], [0.52, 0.35, 0.22, 0.06], [0.62, 0.56, 0.13, 0.03], [0.8, 0.7, -0.1, 0.08], [1, 0.85, -0.3, 0]],
    footO: [[0, -0.02, -0.11, 0], [0.55, 0, -0.12, 0], [0.75, 0.4, -0.45, 0.12], [1, 0.62, -0.58, 0]],
    roll: [[0, 0], [0.38, 0.3], [0.7, -0.25], [1, -0.1]], crouch: [[0, 0], [0.3, 0.08], [0.7, 0.06], [1, 0]],
  },
  // drag back: the sole rolls the ball back and he turns away with it
  dragback: {
    label: 'Drag back', layer: 1, dur: 0.72, release: 0.62,
    bodyF: [[0, 0], [0.5, -0.05], [1, -0.25]], bodyR: [[0, 0], [1, 0.05]], yaw: [[0, 0], [0.35, 0.2], [0.85, Math.PI], [1, Math.PI]],
    ballF: [[0, 0.42], [0.15, 0.42], [0.62, -0.3]], ballR: [[0, 0], [0.62, 0.06]],
    exit: { f: -1, r: 0.08, speed: 3.2 },
    footS: [[0, -0.02, 0.11, 0], [0.12, 0.36, 0.05, 0.17], [0.58, -0.22, 0.06, 0.17], [0.72, -0.3, 0.16, 0.05], [1, -0.36, 0.2, 0]],
    footO: [[0, -0.02, -0.11, 0], [0.6, 0, -0.1, 0], [0.85, -0.12, -0.24, 0.1], [1, -0.26, -0.1, 0]],
    roll: [[0, 0], [0.5, 0.12], [1, 0]], crouch: [[0, 0], [0.5, 0.06], [1, 0]], pitch: [[0, 0], [0.4, -0.15], [1, 0]],
  },
  // ball roll: the sole rolls the ball across the body, sideways, while he shuffles with it (held: it goes on)
  roll: {
    label: 'Ball roll', layer: 1, dur: 0.55, release: 0.9,
    bodyF: [[0, 0], [1, 0.05]], bodyR: [[0, 0], [1, 0.9]], yaw: [[0, 0], [1, 0]],
    ballF: [[0, 0.42], [0.9, 0.36]], ballR: [[0, 0], [0.9, 0.95]],
    exit: { f: 0.25, r: 1, speed: 2.2 },
    footS: [[0, -0.02, 0.11, 0], [0.3, 0, 0.4, 0.1], [0.5, 0, 0.55, 0], [0.75, 0, 0.85, 0.08], [1, 0, 1.01, 0]],
    footO: [[0, -0.02, -0.11, 0], [0.12, 0.34, -0.02, 0.17], [0.85, 0.33, 0.85, 0.17], [1, 0.08, 0.78, 0]],
    roll: [[0, 0], [0.5, 0.12], [1, 0.05]], crouch: [[0, 0], [0.3, 0.07], [1, 0.05]],
  },
  // knock-on: a big touch into space and away
  knock: {
    label: 'Knock on', layer: 1, dur: 0.34, release: 0.4,
    bodyF: [[0, 0], [1, 0.95]], bodyR: [[0, 0], [1, 0]], yaw: [[0, 0], [1, 0]],
    ballF: [[0, 0.42], [0.4, 0.62]], ballR: [[0, 0], [0.4, 0.02]],
    exit: { f: 1, r: 0, speed: 7 },
    footS: [[0, -0.02, 0.11, 0], [0.2, 0.18, 0.1, 0.1], [0.4, 0.5, 0.04, 0.05], [0.65, 0.95, 0.11, 0.12], [1, 1.2, 0.11, 0]],
    footO: [[0, -0.02, -0.11, 0], [0.5, 0.42, -0.11, 0.12], [1, 0.78, -0.11, 0]],
    pitch: [[0, 0], [0.4, 0.2], [1, 0.1]],
  },
  // ---- layer 2: two directions ----
  // stepover: the foot circles over the front of the ball and plants wide; the ball goes the other way
  stepover: {
    label: 'Stepover', layer: 2, dur: 0.82, release: 0.76,
    bodyF: [[0, 0], [0.5, 0.15], [1, 0.8]], bodyR: [[0, 0], [0.45, 0.18], [1, -0.45]], yaw: [[0, 0], [0.45, 0.25], [1, -0.35]],
    ballF: [[0, 0.42], [0.76, 0.6]], ballR: [[0, 0], [0.76, -0.02]],
    exit: { f: 0.75, r: -0.66, speed: 5.2 },
    footS: [[0, -0.02, 0.11, 0], [0.12, 0.28, -0.07, 0.12], [0.25, 0.62, 0.02, 0.2], [0.38, 0.5, 0.3, 0.1], [0.48, 0.3, 0.38, 0], [0.72, 0.3, 0.36, 0], [0.9, 0.65, 0.02, 0.1], [1, 0.85, -0.25, 0]],
    footO: [[0, -0.02, -0.11, 0], [0.6, 0.02, -0.1, 0], [0.76, 0.58, 0.07, 0.04], [0.9, 0.72, -0.3, 0.1], [1, 0.9, -0.5, 0]],
    roll: [[0, 0], [0.45, 0.32], [0.8, -0.25], [1, -0.1]], crouch: [[0, 0], [0.4, 0.08], [0.8, 0.06], [1, 0]],
  },
  // heel to heel: flicked back with one heel and on with the other, and away at pace
  heel: {
    label: 'Heel to heel', layer: 2, dur: 0.56, release: 0.52,
    bodyF: [[0, 0], [0.45, 0.12], [1, 1.0]], bodyR: [[0, 0], [1, 0.2]], yaw: [[0, 0], [0.6, 0], [1, 0.25]],
    ballF: [[0, 0.42], [0.25, 0.08], [0.52, 0.3]], ballR: [[0, 0], [0.25, 0.08], [0.52, 0.15]],
    exit: { f: 0.95, r: 0.3, speed: 6.5 },
    footS: [[0, -0.02, 0.11, 0], [0.12, 0.5, 0.05, 0.12], [0.26, 0.3, 0.04, 0.08], [0.45, 0.05, 0.12, 0], [0.8, 0.6, 0.14, 0.12], [1, 0.95, 0.2, 0]],
    footO: [[0, -0.02, -0.11, 0], [0.38, -0.06, -0.04, 0.1], [0.52, 0.18, 0.05, 0.05], [0.75, 0.6, -0.02, 0.12], [1, 0.9, 0.0, 0]],
    pitch: [[0, 0], [0.5, 0.15], [1, 0.1]], crouch: [[0, 0], [0.3, 0.05], [1, 0]],
  },
  // roulette: a full turn over the ball, dragging it across with one sole and then the other
  roulette: {
    label: 'Roulette', layer: 2, dur: 0.92, release: 0.86,
    bodyF: [[0, 0], [1, 0.12]], bodyR: [[0, 0], [0.5, 0.45], [1, 0.98]], yaw: [[0, 0], [0.45, Math.PI], [0.9, 2 * Math.PI], [1, 2 * Math.PI]],
    ballF: [[0, 0.42], [0.45, 0.4], [0.86, 0.46]], ballR: [[0, 0], [0.45, 0.45], [0.86, 0.92]],
    exit: { f: 0.6, r: 0.8, speed: 4.5 },
    footS: [[0, -0.02, 0.11, 0], [0.1, 0.4, 0.05, 0.17], [0.4, 0.38, 0.42, 0.17], [0.55, 0, 0.62, 0], [1, 0.05, 1.12, 0]],
    footO: [[0, -0.02, -0.11, 0], [0.42, 0.08, 0.28, 0.1], [0.55, 0.38, 0.5, 0.17], [0.82, 0.42, 0.85, 0.17], [1, 0.22, 1.02, 0]],
    roll: [[0, 0], [0.5, 0.1], [1, 0]], crouch: [[0, 0], [0.2, 0.08], [0.8, 0.08], [1, 0]],
  },
  // ---- layer 3: three directions ----
  // elastico: out with the outside of the foot, snapped back in with the inside, and away the other way
  elastico: {
    label: 'Elastico', layer: 3, dur: 0.62, release: 0.5,
    bodyF: [[0, 0], [0.5, 0.15], [1, 0.72]], bodyR: [[0, 0], [0.3, -0.08], [1, 0.55]], yaw: [[0, 0], [0.3, -0.15], [1, 0.4]],
    ballF: [[0, 0.42], [0.25, 0.45], [0.5, 0.52]], ballR: [[0, 0], [0.25, -0.3], [0.5, 0.22]],
    exit: { f: 0.65, r: 0.76, speed: 5.5 },
    // (the elastico is done with the foot on the far side: footO)
    footO: [[0, -0.02, -0.11, 0], [0.1, 0.4, 0.08, 0.06], [0.25, 0.45, -0.2, 0.05], [0.35, 0.47, -0.42, 0.06], [0.5, 0.52, 0.1, 0.05], [0.7, 0.42, 0.02, 0.1], [1, 0.66, 0.3, 0]],
    footS: [[0, -0.02, 0.11, 0], [0.5, 0, 0.12, 0], [0.75, 0.35, 0.45, 0.1], [1, 0.62, 0.62, 0]],
    roll: [[0, 0], [0.3, -0.2], [0.7, 0.3], [1, 0.1]], crouch: [[0, 0], [0.3, 0.08], [1, 0.02]],
  },
  // rainbow flick: rolled back up the heel and flicked over his own head, then he runs on to it
  rainbow: {
    label: 'Rainbow flick', layer: 3, dur: 0.78, release: 0.44,
    bodyF: [[0, 0], [0.3, 0], [1, 1.25]], bodyR: [[0, 0], [1, 0]], yaw: [[0, 0], [1, 0]],
    ballF: [[0, 0.42], [0.25, 0.02], [0.44, -0.16]], ballR: [[0, 0], [0.44, 0]], ballY: [[0, 0.11], [0.3, 0.13], [0.44, 0.32]],
    exit: { f: 1, r: 0, speed: 5.6, up: 6.6 },
    footS: [[0, -0.02, 0.11, 0], [0.08, 0.45, 0.04, 0.17], [0.25, 0.05, 0.04, 0.17], [0.32, -0.15, 0.08, 0.05], [0.44, -0.34, 0.04, 0.34], [0.62, 0.2, 0.11, 0.15], [1, 0.95, 0.11, 0]],
    footO: [[0, -0.02, -0.11, 0], [0.28, -0.06, -0.05, 0], [0.44, -0.12, -0.05, 0.18], [0.72, 0.6, -0.11, 0.1], [1, 1.02, -0.11, 0]],
    pitch: [[0, 0], [0.4, 0.28], [1, 0.05]],
  },
};

/** Where things are at fraction u of a move, in world space (origin, heading at the start, side). */
export function skillFrame(d: { move: SkillMove; side: number; ox: number; oz: number; hx: number; hz: number }, u: number) {
  const def = SKILLS[d.move]; const s = d.side;
  const rx = -d.hz, rz = d.hx; // the start frame's right
  const at = (f: number, r: number) => ({ x: d.ox + d.hx * f + rx * r * s, z: d.oz + d.hz * f + rz * r * s });
  const body = at(k1(def.bodyF, u), k1(def.bodyR, u));
  const ya = Math.atan2(d.hz, d.hx) + k1(def.yaw, u) * s;
  const ub = Math.min(u, def.release);
  const ball = { ...at(k1(def.ballF, ub), k1(def.ballR, ub)), y: def.ballY ? k1(def.ballY, ub) : 0.11 };
  const fs = k3(def.footS, u), fo = k3(def.footO, u);
  return {
    body, heading: { x: Math.cos(ya), z: Math.sin(ya) }, ball,
    footS: { ...at(fs[0], fs[1]), y: fs[2] }, footO: { ...at(fo[0], fo[1]), y: fo[2] },
    roll: (def.roll ? k1(def.roll, u) : 0) * s, crouch: def.crouch ? k1(def.crouch, u) : 0, pitch: def.pitch ? k1(def.pitch, u) : 0,
  };
}
/** The released ball's velocity in world space. */
export function skillExit(d: { move: SkillMove; side: number; hx: number; hz: number }) {
  const e = SKILLS[d.move].exit; const s = d.side; const rx = -d.hz, rz = d.hx;
  const l = Math.hypot(e.f, e.r) || 1; const fx = (d.hx * e.f + rx * e.r * s) / l, fz = (d.hz * e.f + rz * e.r * s) / l;
  return { x: fx * e.speed, y: e.up ?? 0, z: fz * e.speed };
}

/** Reads the skill stick (a direction relative to the player, or null when centred) into moves:
 *  a flick left/right = body feint, held = ball roll; back = drag back; forward = knock-on;
 *  forward then a side = stepover; forward then back = heel to heel; back then a side = roulette;
 *  back then forward (round either side) = rainbow; side, forward, other side = elastico. */
export type Sector = 'F' | 'B' | 'L' | 'R';
export class SkillStick {
  private seq: Sector[] = []; private t0 = 0; private holdStart = 0; private rolling = false;
  /** `rel`: the stick in the player's frame (f forward, r right), or null. Returns a move to start, if any. */
  update(rel: { f: number; r: number } | null, now: number): { move: SkillMove; side: number; hold?: boolean } | null {
    const mag = rel ? Math.hypot(rel.f, rel.r) : 0;
    if (rel && mag > 0.6) {
      const sec: Sector = Math.abs(rel.f) > Math.abs(rel.r) ? (rel.f > 0 ? 'F' : 'B') : (rel.r > 0 ? 'R' : 'L');
      if (!this.seq.length) { this.t0 = now; this.holdStart = now; }
      if (this.seq[this.seq.length - 1] !== sec) { this.seq.push(sec); this.holdStart = now; }
      // held to one side: a ball roll (repeated while held)
      if (this.seq.length === 1 && (sec === 'L' || sec === 'R') && now - this.holdStart > 0.26) { this.rolling = true; return { move: 'roll', side: sec === 'R' ? 1 : -1, hold: true }; }
      if (now - this.t0 > 1.2) { this.seq = []; } // (a stick left pushed over: no gesture)
      return null;
    }
    if (mag < 0.3 && this.seq.length) {
      const seq = this.seq; this.seq = []; const wasRolling = this.rolling; this.rolling = false;
      if (wasRolling) return null;
      return SkillStick.recognise(seq);
    }
    return null;
  }
  static recognise(seq: Sector[]): { move: SkillMove; side: number } | null {
    const side = (x: Sector) => (x === 'R' ? 1 : -1);
    const a = seq[0], z = seq[seq.length - 1];
    if (seq.length >= 3 && (a === 'L' || a === 'R') && seq[1] === 'F' && (z === 'L' || z === 'R') && z !== a) return { move: 'elastico', side: side(z) };
    if (a === 'B' && z === 'F' && seq.length >= 2) return { move: 'rainbow', side: 1 };
    if (a === 'F' && z === 'B' && seq.length >= 2) return { move: 'heel', side: seq.length === 3 && (seq[1] === 'L' || seq[1] === 'R') ? side(seq[1]) : 1 };
    if (seq.length === 2 && a === 'F' && (z === 'L' || z === 'R')) return { move: 'stepover', side: side(z) };
    if (seq.length === 2 && a === 'B' && (z === 'L' || z === 'R')) return { move: 'roulette', side: side(z) };
    if (seq.length === 1) {
      if (a === 'L' || a === 'R') return { move: 'feint', side: side(a) };
      if (a === 'B') return { move: 'dragback', side: 1 };
      return { move: 'knock', side: 1 };
    }
    return null;
  }
}
