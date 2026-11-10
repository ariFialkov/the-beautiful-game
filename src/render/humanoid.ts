import * as THREE from 'three';
import type { Kit } from '@shared/teams';
import type { PlayerCard } from '@shared/types';
import { shirtBackTexture, shirtTexture } from './kits';

export type AnimState = 'idle' | 'run' | 'jockey' | 'kick' | 'tackle' | 'slide' | 'dive' | 'fallen' | 'stumble' | 'header' | 'celebrate' | 'fallen'
  | 'juggle' | 'keeperReady' | 'throw' | 'hold';

export interface AnimParams {
  state: AnimState;
  /** Run-cycle phase in radians (advance by distance travelled). */
  phase: number;
  /** 0 = standing, 1 = full sprint. */
  speed: number;
  /** Progress of a one-shot action (kick, dive, slide), 0..1. */
  action: number;
  /** Side for one-sided actions: +1 = the player's right (kicking foot, dive direction). */
  dir: number;
  /** Global time for idle breathing. */
  time: number;
  /** Frame time, for pose crossfades. */
  dt?: number;
  /** Accelerations along / across the facing (m/s²) for forward lean and banking. */
  accelFwd?: number;
  accelLat?: number;
  /** Dribbling: shorter strides, eyes on the ball. */
  carrying?: boolean;
  /** One-shot overlay on the legs while running: a dribble touch or a first-touch trap, with progress 0..1. */
  overlay?: { kind: 'touch' | 'trap'; t: number; foot: number } | null;
  /** Kick type changes the backlift and follow-through. */
  kick?: 'pass' | 'through' | 'lob' | 'shoot';
  /** Celebration variant. */
  style?: number;
}

const JOINTS = ['bpy', 'bpz', 'brx', 'bry', 'brz', 'hpy', 'hrx', 'hry', 'hrz', 'trx', 'try', 'trz', 'hdx', 'hdy',
  'aLx', 'aLy', 'aLz', 'aRx', 'aRy', 'aRz', 'fL', 'fR', 'lLx', 'lLy', 'lLz', 'lRx', 'lRy', 'lRz', 'sL', 'sR'] as const;
type Joint = typeof JOINTS[number];
type Pose = Record<Joint, number>;
const blank = (): Pose => Object.fromEntries(JOINTS.map((j) => [j, 0])) as Pose;
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

const SKIN = ['#f6d3b8', '#e8b48f', '#c98b5e', '#a66a3f', '#7a4a2b', '#4b2e1b'];
const HAIR = ['#1a1310', '#3d2314', '#6b4a2a', '#b88a4a', '#e8d9b0'];

const shared = {
  sphere: new THREE.SphereGeometry(1, 10, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
  circle: new THREE.CircleGeometry(1, 16),
  shadowMat: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
};
const matCache = new Map<string, THREE.Material>();
function lambert(color: string): THREE.MeshLambertMaterial {
  let m = matCache.get(color) as THREE.MeshLambertMaterial | undefined;
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); }
  return m;
}
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], sx: number, sy: number, sz: number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; return m;
}

/** Procedurally-built, procedurally-animated footballer. Origin at the feet, faces +Z. */
export class Humanoid {
  root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group(); private armR = new THREE.Group(); private foreL = new THREE.Group(); private foreR = new THREE.Group();
  private legL = new THREE.Group(); private legR = new THREE.Group(); private shinL = new THREE.Group(); private shinR = new THREE.Group();
  private shadow: THREE.Mesh;
  private torsoMesh: THREE.Mesh;
  readonly scale: number;
  private selectRing: THREE.Mesh;

  constructor(public card: PlayerCard, kit: Kit, kitKey: string, keeper = false) {
    const look = card.look;
    const h = look.height / 1.8; this.scale = h;
    const b = look.build;
    const skin = lambert(SKIN[look.skin % SKIN.length]);
    const hair = lambert(HAIR[look.hairColor % HAIR.length]);
    const shorts = lambert(kit.shorts), socks = lambert(kit.socks), boots = lambert('#111111'), gloves = lambert(keeper ? '#ffffff' : SKIN[look.skin % SKIN.length]);
    const front = new THREE.MeshLambertMaterial({ map: shirtTexture(kit, kitKey) });
    const back = new THREE.MeshLambertMaterial({ map: shirtBackTexture(kit, kitKey, card.number, card.shortName) });
    const sideMat = lambert(kit.primary);
    const shirtMats = [sideMat, sideMat, sideMat, sideMat, front, back];

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.95 * h;
    // torso
    this.hips.add(this.torso);
    this.torsoMesh = mesh(shared.box, shirtMats, 0.4 * b, 0.56, 0.24 * b, 0, 0.3, 0);
    this.torso.add(this.torsoMesh);
    // neck/head
    this.head.position.y = 0.62;
    this.torso.add(this.head);
    this.head.add(mesh(shared.cyl, skin, 0.05, 0.08, 0.05, 0, 0, 0));
    this.head.add(mesh(shared.sphere, skin, 0.115, 0.13, 0.12, 0, 0.14, 0));
    if (look.hair !== 0) {
      const hs = [0, 0.9, 1.05, 1.2, 1.0, 1.1][look.hair % 6];
      const hm = mesh(shared.sphere, hair, 0.12 * hs, 0.09 * hs, 0.125 * hs, 0, 0.19, -0.015);
      if (look.hair === 4) hm.scale.y = 0.15; // buzz cut
      this.head.add(hm);
    }
    // arms
    for (const [side, arm, fore] of [[-1, this.armL, this.foreL], [1, this.armR, this.foreR]] as const) {
      arm.position.set(side * 0.25 * b, 0.5, 0);
      this.torso.add(arm);
      arm.add(mesh(shared.sphere, sideMat, 0.075, 0.075, 0.075));
      arm.add(mesh(shared.cyl, sideMat, 0.055, 0.14, 0.055, 0, -0.08, 0));
      arm.add(mesh(shared.cyl, skin, 0.045, 0.16, 0.045, 0, -0.22, 0));
      fore.position.y = -0.3;
      arm.add(fore);
      fore.add(mesh(shared.cyl, skin, 0.04, 0.26, 0.04, 0, -0.13, 0));
      fore.add(mesh(shared.sphere, gloves, 0.05, 0.06, 0.05, 0, -0.28, 0));
    }
    // legs
    for (const [side, leg, shin] of [[-1, this.legL, this.shinL], [1, this.legR, this.shinR]] as const) {
      leg.position.set(side * 0.1 * b, 0, 0);
      this.hips.add(leg);
      leg.add(mesh(shared.cyl, shorts, 0.085 * b, 0.42, 0.085 * b, 0, -0.2, 0));
      shin.position.y = -0.44;
      leg.add(shin);
      shin.add(mesh(shared.cyl, socks, 0.06, 0.4, 0.06, 0, -0.2, 0));
      shin.add(mesh(shared.box, boots, 0.1, 0.07, 0.24, 0, -0.44, 0.05));
    }
    this.body.scale.setScalar(h);
    // blob shadow
    this.shadow = new THREE.Mesh(shared.circle, shared.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02; this.shadow.scale.set(0.45, 0.45, 1);
    this.root.add(this.shadow);
    // selection ring (controlled player indicator)
    this.selectRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 24), new THREE.MeshBasicMaterial({ color: 0x19f5a4, transparent: true, opacity: 0.9, depthWrite: false }));
    this.selectRing.rotation.x = -Math.PI / 2; this.selectRing.position.y = 0.03; this.selectRing.visible = false;
    this.root.add(this.selectRing);
  }

  setSelected(on: boolean, color = 0x19f5a4) { this.selectRing.visible = on; (this.selectRing.material as THREE.MeshBasicMaterial).color.setHex(color); }
  setShadowsReal(on: boolean) { this.shadow.visible = !on; this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== this.shadow && o !== this.selectRing) o.castShadow = on; }); }

  /* Pose crossfading: when the state changes, the previous pose is captured and faded out. */
  private cur: Pose = blank();
  private from: Pose = blank();
  private target: Pose = blank();
  private lastState: AnimState | null = null;
  private fade = 1; private fadeDur = 0.12;

  /** Pose all joints for the current animation, crossfading between states. */
  animate(p: AnimParams) {
    const dt = p.dt ?? 1 / 60;
    if (p.state !== this.lastState) {
      Object.assign(this.from, this.cur);
      const soft: AnimState[] = ['fallen', 'slide', 'dive', 'celebrate', 'stumble', 'hold'];
      this.fadeDur = this.lastState === null ? 0 : soft.includes(p.state) || (this.lastState && soft.includes(this.lastState)) ? 0.22 : 0.12;
      this.fade = 0; this.lastState = p.state;
    }
    this.fade = Math.min(1, this.fade + (this.fadeDur > 0 ? dt / this.fadeDur : 1));
    const t = this.target; for (const j of JOINTS) t[j] = 0;
    this.pose(t, p);
    const w = ease(this.fade);
    for (const j of JOINTS) this.cur[j] = this.from[j] + (t[j] - this.from[j]) * w;
    this.apply(this.cur);
  }

  private apply(c: Pose) {
    this.body.position.set(0, c.bpy, c.bpz); this.body.rotation.set(c.brx, c.bry, c.brz);
    this.hips.position.y = 0.95 + c.hpy; this.hips.rotation.set(c.hrx, c.hry, c.hrz);
    this.torso.rotation.set(c.trx, c.try, c.trz); this.head.rotation.set(c.hdx, c.hdy, 0);
    this.armL.rotation.set(c.aLx, c.aLy, c.aLz); this.armR.rotation.set(c.aRx, c.aRy, c.aRz);
    this.foreL.rotation.set(c.fL, 0, 0); this.foreR.rotation.set(c.fR, 0, 0);
    this.legL.rotation.set(c.lLx, c.lLy, c.lLz); this.legR.rotation.set(c.lRx, c.lRy, c.lRz);
    this.shinL.rotation.set(c.sL, 0, 0); this.shinR.rotation.set(c.sR, 0, 0);
  }

  /** Target pose for a state. Note: the "L" limbs sit on the player's right (-x when facing +z). */
  private pose(o: Pose, p: AnimParams) {
    const { phase, speed, action: t, time } = p; const dir = p.dir >= 0 ? 1 : -1;
    const s = Math.sin(phase), c = Math.cos(phase);
    const breathe = Math.sin(time * 2.2) * 0.01;
    // limb helpers by side: right = L limbs, left = R limbs
    const R = { leg: 'lLx', legY: 'lLy', legZ: 'lLz', shin: 'sL', arm: 'aLx', armZ: 'aLz', fore: 'fL' } as const;
    const Lf = { leg: 'lRx', legY: 'lRy', legZ: 'lRz', shin: 'sR', arm: 'aRx', armZ: 'aRz', fore: 'fR' } as const;
    const kickSide = dir > 0 ? R : Lf, plantSide = dir > 0 ? Lf : R;
    o.aLz = 0.12; o.aRz = -0.12; o.fL = -0.3; o.fR = -0.3;
    const lean = () => {
      o.brx += clamp((p.accelFwd ?? 0) * 0.022, -0.16, 0.2);
      o.brz += clamp((p.accelLat ?? 0) * 0.028, -0.32, 0.32);
    };
    switch (p.state) {
      case 'idle': {
        o.trx = 0.04 + breathe; o.hpy = breathe * 0.5;
        o.aLx = Math.sin(time * 1.3) * 0.05; o.aRx = -Math.sin(time * 1.1) * 0.05;
        o.hdy = Math.sin(time * 0.7) * 0.25; o.lLz = 0.04; o.lRz = -0.04;
        lean();
        break;
      }
      case 'run': {
        const carry = p.carrying ? 0.85 : 1;
        const amp = (0.4 + speed * 0.7) * carry;
        o.lLx = s * amp; o.lRx = -s * amp;
        o.sL = Math.max(0, -c) * amp * 1.35 + 0.15 * speed; o.sR = Math.max(0, c) * amp * 1.35 + 0.15 * speed;
        o.aLx = -s * amp * 0.9; o.aRx = s * amp * 0.9;
        o.fL = -0.9 - speed * 0.6; o.fR = -0.9 - speed * 0.6;
        o.trx = 0.08 + speed * 0.2 + (p.carrying ? 0.06 : 0); o.try = s * 0.09 * speed;
        o.hdx = p.carrying ? 0.28 : 0;
        o.hpy = Math.abs(c) * 0.035 * speed - 0.01 * speed; o.hry = -s * 0.12;
        lean();
        break;
      }
      case 'jockey': {
        // low, side-on, short shuffling steps
        o.hpy = -0.12; o.trx = 0.28; o.hdx = 0.15;
        o.lLx = -0.35 + s * 0.2; o.lRx = -0.35 - s * 0.2; o.sL = 0.7; o.sR = 0.7;
        o.lLz = 0.2 + Math.max(0, s) * 0.18; o.lRz = -0.2 - Math.max(0, -s) * 0.18;
        o.aLx = -0.3; o.aRx = -0.3; o.aLz = 0.45; o.aRz = -0.45; o.fL = -0.8; o.fR = -0.8;
        lean();
        break;
      }
      case 'kick': {
        // run-up plant (0..0.35), strike (0.35..0.55), follow-through
        const kind = p.kick ?? 'pass';
        const back = kind === 'shoot' ? 1.15 : kind === 'lob' ? 1.0 : 0.75;
        const through = kind === 'shoot' ? 1.4 : kind === 'lob' ? 1.25 : 0.8;
        const wind = t < 0.35 ? ease(t / 0.35) : 1 - ease(Math.min(1, (t - 0.35) / 0.25));
        const swing = t < 0.35 ? 0 : ease(Math.min(1, (t - 0.35) / 0.3));
        o[kickSide.leg] = wind * back - swing * through;
        o[kickSide.shin] = t < 0.35 ? 1.5 * ease(t / 0.35) : Math.max(0, 1.5 * (1 - swing * 1.6));
        if (kind === 'pass' || kind === 'through') o[kickSide.legY] = -dir * 0.45 * swing; // side-foot
        o[plantSide.leg] = -0.25; o[plantSide.shin] = 0.45;
        o.trx = (kind === 'lob' ? -0.05 : 0.22) - swing * (kind === 'shoot' ? 0.1 : 0.25);
        o.brz = dir * 0.12 * swing; o.try = -dir * 0.25 * (1 - swing) + dir * 0.2 * swing;
        o[kickSide.arm] = -0.4; o[plantSide.arm] = 0.5; o.aLz = 0.7; o.aRz = -0.7;
        o.hpy = -0.03;
        break;
      }
      case 'tackle': {
        // standing poke: lunge the near leg at the ball, then recover
        const lunge = t < 0.45 ? ease(t / 0.45) : 1 - ease((t - 0.45) / 0.55);
        o.trx = 0.45 * lunge; o.hpy = -0.22 * lunge;
        o[kickSide.leg] = -1.25 * lunge; o[kickSide.shin] = 0.15; o[kickSide.legY] = dir * 0.25 * lunge;
        o[plantSide.leg] = 0.55 * lunge; o[plantSide.shin] = 1.25 * lunge;
        o.aLx = -0.7 * lunge; o.aRx = 0.7 * lunge; o.aLz = 0.6; o.aRz = -0.6;
        break;
      }
      case 'slide': {
        const down = ease(Math.min(1, t / 0.18)); const up = t > 0.62 ? ease((t - 0.62) / 0.38) : 0; const k = down * (1 - up);
        o.brx = -Math.PI / 2 * 0.72 * k; o.bpy = 0.33 * k - 0.15 * k;
        o[kickSide.leg] = -1.35 * k; o[plantSide.leg] = 0.55 * k; o[plantSide.shin] = 1.45 * k; o.trx = -0.3 * k;
        o[plantSide.arm] = -1.4 * k; o[kickSide.arm] = 0.5 * k; o.aLz = 0.7 * k + 0.12; o.aRz = -1.1 * k - 0.12;
        o.hpy = -0.3 * up * (1 - up);
        break;
      }
      case 'dive': {
        const k = Math.sin(Math.min(1, t * 1.6) * Math.PI / 2); const rise = t > 0.75 ? ease((t - 0.75) / 0.25) : 0; const kk = k * (1 - rise);
        o.brz = dir * 1.35 * kk; o.bry = dir * 0.3 * kk; o.bpy = 0.35 * kk * (1 - t * 0.5);
        o.aLz = dir > 0 ? 2.8 * kk : 0.4; o.aRz = dir > 0 ? -0.4 : -2.8 * kk;
        o.lLx = -0.45 * kk; o.lRx = 0.35 * kk; o.sL = 0.6 * kk; o.trx = 0.15 * kk; o.hpy = -0.45 * kk;
        break;
      }
      case 'fallen': {
        const down = ease(Math.min(1, t / 0.2)); const up = t > 0.7 ? ease((t - 0.7) / 0.3) : 0; const k = down * (1 - up);
        o.brx = Math.PI / 2 * 0.88 * k; o.bpy = 0.24 * k; o.bpz = 0.35 * k;
        o.aLx = -2.2 * k; o.aRx = -2.0 * k; o.aLz = 0.5; o.aRz = -0.5; o.lLx = 0.2 * k; o.lRx = -0.3 * k; o.sR = 0.6 * k;
        break;
      }
      case 'stumble': {
        const k = Math.sin(Math.min(1, t) * Math.PI);
        o.brx = 0.45 * k; o.trx = 0.3 * k; o.aLx = -1.2 * k; o.aRx = -0.4 * k; o.aLz = 0.9 * k; o.aRz = -0.9 * k;
        o.lLx = -0.6 * k; o.lRx = 0.5 * k; o.sR = 1.0 * k; o.hpy = -0.15 * k;
        break;
      }
      case 'header': {
        const j = Math.sin(Math.min(1, t) * Math.PI);
        o.bpy = 0.42 * j; o.trx = t < 0.4 ? -0.35 * ease(t / 0.4) : -0.35 + 0.8 * ease(Math.min(1, (t - 0.4) / 0.25));
        o.hdx = o.trx * 0.6; o.aLx = -1.4 * j; o.aRx = -1.4 * j; o.aLz = 0.9; o.aRz = -0.9;
        o.lLx = -0.4 * j; o.lRx = 0.2 * j; o.sL = 0.9 * j; o.sR = 0.6 * j;
        break;
      }
      case 'celebrate': {
        const style = p.style ?? 0; const tt = time * 6;
        if (style === 1) {
          // aeroplane: arms out, running cycle
          const amp = 0.8; o.lLx = s * amp; o.lRx = -s * amp; o.sL = Math.max(0, -c) * 1.1; o.sR = Math.max(0, c) * 1.1;
          o.aLz = 1.5; o.aRz = -1.5; o.brz = Math.sin(time * 2) * 0.25; o.trx = 0.15; o.hdx = -0.2;
        } else if (style === 2) {
          // knee slide, arms raised
          o.bpy = -0.42; o.lLx = -1.4; o.lRx = -1.4; o.sL = 2.3; o.sR = 2.3; o.trx = -0.35; o.hdx = -0.45;
          o.aLx = -2.7; o.aRx = -2.7; o.aLz = 0.4; o.aRz = -0.4; o.fL = -0.2; o.fR = -0.2;
        } else {
          const hop = Math.abs(Math.sin(tt * 0.5));
          o.aLx = -2.6 + Math.sin(tt) * 0.3; o.aRx = -2.6 + Math.cos(tt) * 0.3; o.aLz = 0.5; o.aRz = -0.5; o.fL = -0.4; o.fR = -0.4;
          o.bpy = hop * 0.18; o.lLx = -hop * 0.4; o.lRx = -hop * 0.4; o.sL = hop * 0.8; o.sR = hop * 0.8; o.trx = -0.15; o.hdx = -0.3;
        }
        break;
      }
      case 'juggle': {
        const tj = time * 3.2; const k = Math.sin(tj);
        const up = k > 0 ? R : Lf; const other = k > 0 ? Lf : R;
        o[up.leg] = -Math.abs(k) * 1.5; o[up.shin] = Math.abs(k) * 1.1; o[other.leg] = 0.05;
        o.trx = 0.12 + Math.abs(k) * 0.08; o.hpy = -Math.abs(k) * 0.06;
        o.aLx = -0.3; o.aRx = -0.3; o.aLz = 0.5 + Math.abs(k) * 0.2; o.aRz = -0.5 - Math.abs(k) * 0.2; o.fL = -1; o.fR = -1;
        o.hdx = 0.35;
        break;
      }
      case 'keeperReady': {
        o.trx = 0.35 + breathe; o.hpy = -0.13;
        o.lLx = -0.5; o.lRx = -0.5; o.sL = 0.9; o.sR = 0.9; o.lLz = 0.3; o.lRz = -0.3;
        o.aLx = -0.6; o.aRx = -0.6; o.aLz = 0.9; o.aRz = -0.9; o.fL = -1.2; o.fR = -1.2;
        lean();
        break;
      }
      case 'hold': {
        o.trx = 0.1; o.aLx = -1.1; o.aRx = -1.1; o.aLz = -0.25; o.aRz = 0.25; o.fL = -1.3; o.fR = -1.3;
        break;
      }
      case 'throw': {
        o.aLx = -2.6 + t * 2.4; o.aRx = -2.6 + t * 2.4; o.trx = -0.3 + t * 0.6; o.lLx = 0.3; o.lRx = -0.3;
        break;
      }
    }
    // Overlays on the legs (dribble touches and traps) without breaking the run cycle.
    const ov = p.overlay;
    if (ov && (p.state === 'run' || p.state === 'idle' || p.state === 'jockey')) {
      const side = ov.foot >= 0 ? R : Lf; const k = Math.sin(Math.min(1, ov.t) * Math.PI);
      if (ov.kind === 'touch') { o[side.leg] = o[side.leg] * (1 - k) - 0.55 * k; o[side.shin] = o[side.shin] * (1 - k) + 0.25 * k; o[side.legY] = -ov.foot * 0.3 * k; }
      else { o[side.leg] = o[side.leg] * (1 - k) - 0.85 * k; o[side.shin] = 1.0 * k; o.trx += 0.08 * k; o.hdx = 0.35 * k; }
    }
  }
}

/** Height of the juggled ball for the showcase idle, matching Humanoid 'juggle'. */
export function juggleBallHeight(time: number): number { const k = Math.abs(Math.sin(time * 3.2)); return 0.35 + (1 - k) * 0.9; }
