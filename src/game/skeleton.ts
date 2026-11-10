import * as THREE from 'three';

/** Bone indices. The character faces +Z, up is +Y; "L" is the player's own left (+X). */
export const B = {
  pelvis: 0, spine1: 1, spine2: 2, chest: 3, neck: 4, head: 5,
  clavL: 6, armL: 7, foreL: 8, handL: 9, clavR: 10, armR: 11, foreR: 12, handR: 13,
  thighL: 14, shinL: 15, footL: 16, toeL: 17, thighR: 18, shinR: 19, footR: 20, toeR: 21,
} as const;
export const BONES = 22;
export const PARENT = [-1, 0, 1, 2, 3, 4, 3, 6, 7, 8, 3, 10, 11, 12, 0, 14, 15, 16, 0, 18, 19, 20];
export type Side = 'L' | 'R';
export const sideSign = (s: Side) => (s === 'L' ? 1 : -1);

export type Part = 'foot' | 'shin' | 'thigh' | 'torso' | 'head' | 'arm' | 'hand';
export interface ColliderDef { bone: number; a: [number, number, number]; b: [number, number, number]; r: number; part: Part; side?: Side; }

/** Body proportions for one player (metres). */
export class Body {
  readonly offsets: THREE.Vector3[];
  readonly thigh: number; readonly shin: number; readonly upperArm: number; readonly foreArm: number;
  readonly pelvisHeight: number; readonly ankleHeight: number; readonly hipHalf: number;
  readonly colliders: ColliderDef[];
  constructor(public h: number, public b: number) {
    const o = (x: number, y: number, z: number) => new THREE.Vector3(x * h, y * h, z * h);
    this.pelvisHeight = 1.0 * h; this.ankleHeight = 0.08 * h; this.hipHalf = 0.092 * h * b;
    this.thigh = 0.44 * h; this.shin = 0.43 * h; this.upperArm = 0.285 * h; this.foreArm = 0.255 * h;
    const off: THREE.Vector3[] = [];
    off[B.pelvis] = o(0, 1.0, 0);
    off[B.spine1] = o(0, 0.1, 0); off[B.spine2] = o(0, 0.13, 0); off[B.chest] = o(0, 0.14, 0); off[B.neck] = o(0, 0.18, 0); off[B.head] = o(0, 0.09, 0);
    for (const [s, clav, arm, fore, hand] of [[1, B.clavL, B.armL, B.foreL, B.handL], [-1, B.clavR, B.armR, B.foreR, B.handR]] as const) {
      off[clav] = o(0.035 * s, 0.13, -0.01); off[arm] = o(0.155 * b * s, 0, 0); off[fore] = o(0, -0.285, 0); off[hand] = o(0, -0.255, 0);
    }
    for (const [s, thigh, shin, foot, toe] of [[1, B.thighL, B.shinL, B.footL, B.toeL], [-1, B.thighR, B.shinR, B.footR, B.toeR]] as const) {
      off[thigh] = o(0.092 * b * s, -0.05, 0); off[shin] = o(0, -0.44, 0); off[foot] = o(0, -0.43, 0); off[toe] = o(0, -0.06, 0.15);
    }
    this.offsets = off;
    const c = (bone: number, a: [number, number, number], bb: [number, number, number], r: number, part: Part, side?: Side): ColliderDef => ({ bone, a: [a[0] * h, a[1] * h, a[2] * h], b: [bb[0] * h, bb[1] * h, bb[2] * h], r: r * h, part, side });
    this.colliders = [
      c(B.pelvis, [-0.09 * b, -0.02, 0], [0.09 * b, -0.02, 0], 0.115, 'torso'),
      c(B.spine1, [0, 0, 0], [0, 0.14, 0], 0.13, 'torso'),
      c(B.chest, [0, -0.05, 0], [0, 0.16, 0], 0.15, 'torso'),
      c(B.head, [0, 0.07, 0.01], [0, 0.15, 0.01], 0.105, 'head'),
      ...(['L', 'R'] as Side[]).flatMap((s) => {
        const L = s === 'L';
        return [
          c(L ? B.armL : B.armR, [0, 0, 0], [0, -0.285, 0], 0.05, 'arm', s),
          c(L ? B.foreL : B.foreR, [0, 0, 0], [0, -0.255, 0], 0.042, 'arm', s),
          c(L ? B.handL : B.handR, [0, -0.01, 0], [0, -0.09, 0.01], 0.05, 'hand', s),
          c(L ? B.thighL : B.thighR, [0, 0, 0], [0, -0.44, 0], 0.085, 'thigh', s),
          c(L ? B.shinL : B.shinR, [0, 0, 0], [0, -0.43, 0], 0.058, 'shin', s),
          c(L ? B.footL : B.footR, [0, -0.04, -0.05], [0, -0.06, 0.15], 0.052, 'foot', s),
        ];
      }),
    ];
  }
}

/** A pose: local bone rotations plus the pelvis position in the root (ground, facing) frame. */
export class Pose {
  q: THREE.Quaternion[] = Array.from({ length: BONES }, () => new THREE.Quaternion());
  pelvis = new THREE.Vector3();
  copy(p: Pose) { for (let i = 0; i < BONES; i++) this.q[i].copy(p.q[i]); this.pelvis.copy(p.pelvis); return this; }
  lerp(a: Pose, b: Pose, t: number) { for (let i = 0; i < BONES; i++) this.q[i].slerpQuaternions(a.q[i], b.q[i], t); this.pelvis.lerpVectors(a.pelvis, b.pelvis, t); return this; }
}

const _m = new THREE.Matrix4(); const _s = new THREE.Vector3(1, 1, 1);

/** World matrices for a pose. */
export class Rig {
  world: THREE.Matrix4[] = Array.from({ length: BONES }, () => new THREE.Matrix4());
  root = new THREE.Matrix4();
  constructor(public body: Body) {}
  setRoot(x: number, z: number, yaw: number) { this.root.makeRotationY(yaw).setPosition(x, 0, z); }
  /** Forward kinematics for bones [from, to] (parents must already be up to date). */
  fk(pose: Pose, from = 0, to = BONES - 1) {
    for (let i = from; i <= to; i++) {
      const p = PARENT[i];
      if (p < 0) { _m.compose(pose.pelvis, pose.q[i], _s); this.world[i].multiplyMatrices(this.root, _m); }
      else { _m.compose(this.body.offsets[i], pose.q[i], _s); this.world[i].multiplyMatrices(this.world[p], _m); }
    }
  }
  pos(i: number, out = new THREE.Vector3()) { return out.setFromMatrixPosition(this.world[i]); }
  rot(i: number, out = new THREE.Quaternion()) { const s = new THREE.Vector3(), p = new THREE.Vector3(); this.world[i].decompose(p, out, s); return out; }
  /** World-space point from a bone-local point. */
  point(i: number, x: number, y: number, z: number, out = new THREE.Vector3()) { return out.set(x, y, z).applyMatrix4(this.world[i]); }
}

/** World capsule set for ball and body contact. */
export interface Capsule { ax: number; ay: number; az: number; bx: number; by: number; bz: number; r: number; part: Part; side?: Side; }
export function worldColliders(rig: Rig, out: Capsule[] = []): Capsule[] {
  const defs = rig.body.colliders; const v = new THREE.Vector3();
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]; const c = out[i] ?? (out[i] = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0, part: d.part, side: d.side });
    v.set(d.a[0], d.a[1], d.a[2]).applyMatrix4(rig.world[d.bone]); c.ax = v.x; c.ay = v.y; c.az = v.z;
    v.set(d.b[0], d.b[1], d.b[2]).applyMatrix4(rig.world[d.bone]); c.bx = v.x; c.by = v.y; c.bz = v.z;
    c.r = d.r; c.part = d.part; c.side = d.side;
  }
  out.length = defs.length; return out;
}

/** Closest distance from a point to a capsule's axis segment, and that closest point. */
export function pointSegment(px: number, py: number, pz: number, c: Capsule) {
  const dx = c.bx - c.ax, dy = c.by - c.ay, dz = c.bz - c.az; const L2 = dx * dx + dy * dy + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - c.ax) * dx + (py - c.ay) * dy + (pz - c.az) * dz) / L2)) : 0;
  const cx = c.ax + dx * t, cy = c.ay + dy * t, cz = c.az + dz * t;
  return { d: Math.hypot(px - cx, py - cy, pz - cz), cx, cy, cz };
}

/** Distance between two capsule axis segments (approximate, sampled) for limb-on-limb contact. */
export function segmentSegment(a: Capsule, b: Capsule): number {
  let best = Infinity;
  for (let i = 0; i <= 4; i++) { const t = i / 4; const px = a.ax + (a.bx - a.ax) * t, py = a.ay + (a.by - a.ay) * t, pz = a.az + (a.bz - a.az) * t; best = Math.min(best, pointSegment(px, py, pz, b).d); }
  for (let i = 0; i <= 4; i++) { const t = i / 4; const px = b.ax + (b.bx - b.ax) * t, py = b.ay + (b.by - b.ay) * t, pz = b.az + (b.bz - b.az) * t; best = Math.min(best, pointSegment(px, py, pz, a).d); }
  return best;
}

/* ------------------------------ IK helpers ------------------------------ */
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _mb = new THREE.Matrix4(), _dir = new THREE.Vector3(), _bend = new THREE.Vector3();
/** World rotation whose -Y axis points along `dir` and +Z axis leans toward `pole`. */
export function aimRotation(dir: THREE.Vector3, pole: THREE.Vector3, out: THREE.Quaternion) {
  _y.copy(dir).normalize().negate();
  _z.copy(pole).addScaledVector(_y, -pole.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize(); _x.crossVectors(_y, _z).normalize(); _z.crossVectors(_x, _y);
  _mb.makeBasis(_x, _y, _z); return out.setFromRotationMatrix(_mb);
}

/** Two-bone IK: from root A toward target T with segment lengths l1, l2, bending toward `pole`.
 *  Returns the middle joint (knee/elbow) and the reachable end point. */
export function twoBone(A: THREE.Vector3, T: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outMid: THREE.Vector3, outEnd: THREE.Vector3) {
  const dir = _dir.subVectors(T, A); let d = dir.length();
  if (d < 1e-5) { dir.set(0, -1, 0); d = 1e-5; }
  dir.divideScalar(d);
  const maxD = (l1 + l2) * 0.999, minD = Math.abs(l1 - l2) + 0.01;
  d = Math.max(minD, Math.min(maxD, d));
  const a = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const bend = _bend.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(dir, -dir.z);
  bend.normalize();
  outMid.copy(A).addScaledVector(dir, l1 * a).addScaledVector(bend, l1 * Math.sqrt(Math.max(0, 1 - a * a)));
  outEnd.copy(A).addScaledVector(dir, d);
}
