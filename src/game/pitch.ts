export interface PitchSpec { length: number; width: number; goalWidth: number; goalHeight: number; futsal: boolean; boxDepth: number; boxWidth: number; }
export const PITCH_11: PitchSpec = { length: 105, width: 68, goalWidth: 7.32, goalHeight: 2.44, futsal: false, boxDepth: 16.5, boxWidth: 40.3 };
export const PITCH_FUTSAL: PitchSpec = { length: 42, width: 24, goalWidth: 3.6, goalHeight: 2.1, futsal: true, boxDepth: 6, boxWidth: 16 };

export interface V2 { x: number; z: number; }
export const v2 = {
  len: (a: V2) => Math.hypot(a.x, a.z),
  dist: (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z),
  sub: (a: V2, b: V2): V2 => ({ x: a.x - b.x, z: a.z - b.z }),
  add: (a: V2, b: V2): V2 => ({ x: a.x + b.x, z: a.z + b.z }),
  scale: (a: V2, s: number): V2 => ({ x: a.x * s, z: a.z * s }),
  norm: (a: V2): V2 => { const l = Math.hypot(a.x, a.z); return l > 1e-6 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 }; },
  dot: (a: V2, b: V2) => a.x * b.x + a.z * b.z,
  lerp: (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }),
  rot: (a: V2, ang: number): V2 => ({ x: a.x * Math.cos(ang) - a.z * Math.sin(ang), z: a.x * Math.sin(ang) + a.z * Math.cos(ang) }),
  angle: (a: V2) => Math.atan2(a.z, a.x),
  fromAngle: (ang: number): V2 => ({ x: Math.cos(ang), z: Math.sin(ang) }),
};

/** Formation base positions, normalised: x in [-1, 1] from own goal to opponent goal, z in [-1, 1] across the width. */
export const FORMATION_433: Array<{ role: string; x: number; z: number }> = [
  { role: 'GK', x: -0.95, z: 0 },
  { role: 'RB', x: -0.55, z: 0.72 }, { role: 'CB', x: -0.62, z: 0.25 }, { role: 'CB', x: -0.62, z: -0.25 }, { role: 'LB', x: -0.55, z: -0.72 },
  { role: 'CDM', x: -0.3, z: 0 }, { role: 'CM', x: -0.12, z: 0.35 }, { role: 'CAM', x: -0.1, z: -0.35 },
  { role: 'RW', x: 0.3, z: 0.65 }, { role: 'ST', x: 0.4, z: 0 }, { role: 'LW', x: 0.3, z: -0.65 },
];
export const FORMATION_FUTSAL: Array<{ role: string; x: number; z: number }> = [
  { role: 'GK', x: -0.9, z: 0 },
  { role: 'CB', x: -0.45, z: 0.0 }, { role: 'RM', x: -0.05, z: 0.6 }, { role: 'LM', x: -0.05, z: -0.6 }, { role: 'ST', x: 0.4, z: 0 },
];
