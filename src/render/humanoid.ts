import * as THREE from 'three';
import type { Kit } from '@shared/teams';
import type { PlayerCard } from '@shared/types';
import { shirtWrapTexture } from './kits';
import { B, BONES, Body, Pose, type Side } from '../game/skeleton';
import { Motion } from '../game/motion';
import { Agent } from '../game/player';

const SKIN = ['#f6d3b8', '#e8b48f', '#c98b5e', '#a66a3f', '#7a4a2b', '#4b2e1b'];
const HAIR = ['#1a1310', '#3d2314', '#6b4a2a', '#b88a4a', '#e8d9b0'];

let highQuality = true;
/** Lambert on low-end devices, physically based shading otherwise. */
export function setHumanoidQuality(high: boolean) { highQuality = high; }
const matCache = new Map<string, THREE.Material>();
function mat(color: string, map?: THREE.Texture): THREE.Material {
  const key = `${highQuality}:${color}:${map?.uuid ?? ''}`;
  let m = matCache.get(key);
  if (!m) { m = highQuality ? new THREE.MeshStandardMaterial({ color, map, roughness: 0.78, metalness: 0 }) : new THREE.MeshLambertMaterial({ color, map }); matCache.set(key, m); }
  return m;
}
const geo = {
  sphere: new THREE.SphereGeometry(1, 14, 10),
  capsule: new THREE.CapsuleGeometry(1, 1, 4, 10),
};
const cylCache = new Map<string, THREE.CylinderGeometry>();
function cyl(rt: number, rb: number, hgt: number, open = false) {
  const k = `${rt.toFixed(3)}:${rb.toFixed(3)}:${hgt.toFixed(3)}:${open}`;
  let g = cylCache.get(k); if (!g) { g = new THREE.CylinderGeometry(rt, rb, hgt, 18, 1, open); cylCache.set(k, g); } return g;
}
function capsule(r: number, len: number, m: THREE.Material, y: number, extra?: (o: THREE.Mesh) => void) {
  const o = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m); o.position.y = y; o.castShadow = true; extra?.(o); return o;
}

/** A footballer drawn on the shared skeleton: rounded limbs, a shaped torso wearing the kit, boots and hands.
 *  In matches the pose comes from the simulation's Motion; elsewhere an internal puppet Motion drives it. */
export class Humanoid {
  root = new THREE.Group();
  readonly bones: THREE.Object3D[] = [];
  readonly body: Body;
  readonly scale: number;
  private shadow: THREE.Mesh;
  private selectRing: THREE.Mesh;
  private puppetAgent: Agent | null = null;
  private puppet: Motion | null = null;
  private lastPuppetPos = new THREE.Vector3(); private puppetInit = false; private juggleT = 0; private juggleSide: Side = 'R';

  constructor(public card: PlayerCard, kit: Kit, kitKey: string, public keeper = false) {
    const look = card.look; const h = look.height / 1.8; const b = look.build; this.scale = h;
    this.body = new Body(h, b);
    const skin = mat(SKIN[look.skin % SKIN.length]); const hair = mat(HAIR[look.hairColor % HAIR.length]);
    const shirtPlain = mat('#ffffff', shirtWrapTexture(kit, kitKey, null, ''));
    const shirtNum = mat('#ffffff', shirtWrapTexture(kit, kitKey, card.number, card.shortName));
    const sleeve = mat(kit.primary); const shorts = mat(kit.shorts); const socks = mat(kit.socks);
    const boot = mat(['#111111', '#f2f2f2', '#ff4d6d', '#19f5a4', '#f7c948'][(card.number + look.hair) % 5]);
    const sole = mat('#222222'); const glove = mat(keeper ? '#f4f4f4' : SKIN[look.skin % SKIN.length]);
    for (let i = 0; i < BONES; i++) { const g = new THREE.Group(); g.position.copy(this.body.offsets[i]); this.bones.push(g); }
    const PARENT = [-1, 0, 1, 2, 3, 4, 3, 6, 7, 8, 3, 10, 11, 12, 0, 14, 15, 16, 0, 18, 19, 20];
    this.root.add(this.bones[0]); for (let i = 1; i < BONES; i++) this.bones[PARENT[i]].add(this.bones[i]);
    const add = (bone: number, m: THREE.Object3D) => { m.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; }); this.bones[bone].add(m); };
    const torso = (rt: number, rb: number, hgt: number, y: number, depth: number, m: THREE.Material) => { const o = new THREE.Mesh(cyl(rt * h * b, rb * h * b, hgt * h), m); o.position.y = y * h; o.scale.z = depth; return o; };
    // hips / shorts
    add(B.pelvis, (() => { const o = new THREE.Mesh(geo.capsule, shorts); o.scale.set(0.125 * h * b, 0.09 * h * b, 0.1 * h); o.rotation.z = Math.PI / 2; o.position.y = -0.03 * h; return o; })());
    // torso in three overlapping sections so the spine can bend
    add(B.spine1, torso(0.14, 0.13, 0.17, 0.07, 0.74, shirtPlain));
    add(B.spine2, torso(0.155, 0.14, 0.16, 0.07, 0.72, shirtPlain));
    add(B.chest, torso(0.18, 0.155, 0.22, 0.07, 0.68, shirtNum));
    add(B.chest, (() => { const o = new THREE.Mesh(geo.sphere, sleeve); o.scale.set(0.17 * h * b, 0.05 * h, 0.1 * h); o.position.y = 0.18 * h; return o; })()); // shoulder line
    // neck and head
    add(B.neck, (() => { const o = new THREE.Mesh(cyl(0.05 * h, 0.058 * h, 0.12 * h), skin); o.position.y = 0.04 * h; return o; })());
    const head = new THREE.Group(); head.position.y = 0.11 * h;
    const skull = new THREE.Mesh(geo.sphere, skin); skull.scale.set(0.098 * h, 0.12 * h, 0.108 * h); head.add(skull);
    const nose = new THREE.Mesh(geo.sphere, skin); nose.scale.set(0.018 * h, 0.03 * h, 0.03 * h); nose.position.set(0, -0.005 * h, 0.105 * h); head.add(nose);
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(geo.sphere, skin); ear.scale.set(0.015 * h, 0.03 * h, 0.022 * h); ear.position.set(s * 0.098 * h, 0, -0.005 * h); head.add(ear); }
    if (look.hair !== 0) {
      const hs = [0, 0.9, 1.05, 1.18, 1.0, 1.1][look.hair % 6];
      const cap = new THREE.Mesh(geo.sphere, hair); cap.scale.set(0.104 * hs * h, (look.hair === 4 ? 0.05 : 0.085 * hs) * h, 0.115 * hs * h); cap.position.set(0, 0.045 * h, -0.012 * h); head.add(cap);
    }
    add(B.head, head);
    // arms
    for (const [arm, fore, hand] of [[B.armL, B.foreL, B.handL], [B.armR, B.foreR, B.handR]] as const) {
      add(arm, (() => { const o = new THREE.Mesh(geo.sphere, sleeve); o.scale.setScalar(0.064 * h); return o; })());
      add(arm, (() => { const o = new THREE.Mesh(cyl(0.064 * h, 0.056 * h, 0.15 * h), keeper ? sleeve : sleeve); o.position.y = -0.07 * h; return o; })());
      add(arm, capsule(0.046 * h, 0.17 * h, keeper ? sleeve : skin, -0.19 * h));
      add(fore, capsule(0.041 * h, 0.18 * h, keeper ? sleeve : skin, -0.12 * h, (o) => { o.scale.x = 1.08; }));
      add(hand, (() => { const o = new THREE.Mesh(geo.sphere, glove); o.scale.set(0.045 * h * (keeper ? 1.35 : 1), 0.07 * h * (keeper ? 1.25 : 1), 0.028 * h * (keeper ? 1.4 : 1)); o.position.y = -0.055 * h; return o; })());
    }
    // legs
    for (const [thigh, shin, foot] of [[B.thighL, B.shinL, B.footL], [B.thighR, B.shinR, B.footR]] as const) {
      add(thigh, (() => { const o = new THREE.Mesh(cyl(0.098 * h * b, 0.088 * h * b, 0.22 * h), shorts); o.position.y = -0.08 * h; return o; })());
      add(thigh, capsule(0.075 * h * b, 0.24 * h, skin, -0.3 * h));
      add(shin, capsule(0.058 * h, 0.06 * h, skin, -0.02 * h));
      add(shin, (() => { const o = new THREE.Mesh(cyl(0.062 * h, 0.046 * h, 0.34 * h), socks); o.position.y = -0.22 * h; o.scale.z = 1.1; return o; })());
      add(foot, (() => { const g = new THREE.Group();
        const upper = new THREE.Mesh(geo.capsule, boot); upper.scale.set(0.045 * h, 0.085 * h, 0.04 * h); upper.rotation.x = Math.PI / 2; upper.position.set(0, -0.035 * h, 0.05 * h); g.add(upper);
        const s = new THREE.Mesh(geo.capsule, sole); s.scale.set(0.047 * h, 0.092 * h, 0.015 * h); s.rotation.x = Math.PI / 2; s.position.set(0, -0.07 * h, 0.05 * h); g.add(s);
        return g; })());
    }
    // blob shadow and selection ring live on the root (not on the bones)
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = 0.02; this.shadow.scale.set(0.42, 0.42, 1); this.root.add(this.shadow);
    this.selectRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 28), new THREE.MeshBasicMaterial({ color: 0x19f5a4, transparent: true, opacity: 0.9, depthWrite: false }));
    this.selectRing.rotation.x = -Math.PI / 2; this.selectRing.position.y = 0.03; this.selectRing.visible = false; this.root.add(this.selectRing);
    // the rest pose until the first update
    this.applyPose(new Pose().copy((() => { const p = new Pose(); p.pelvis.copy(this.body.offsets[B.pelvis]); return p; })()));
  }

  setSelected(on: boolean, color = 0x19f5a4) { this.selectRing.visible = on; (this.selectRing.material as THREE.MeshBasicMaterial).color.setHex(color); }
  setShadowsReal(on: boolean) { this.shadow.visible = !on; this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== this.shadow && o !== this.selectRing) o.castShadow = on; }); }
  place(x: number, z: number, yaw: number) { this.root.position.set(x, this.root.position.y, z); this.root.rotation.y = yaw; }

  /** Apply a pose (local bone rotations, pelvis offset in the root frame). */
  applyPose(p: Pose) {
    for (let i = 0; i < BONES; i++) this.bones[i].quaternion.copy(p.q[i]);
    this.bones[B.pelvis].position.copy(p.pelvis);
  }

  /** Drive the figure outside a match (menus, free kicks) with the same motion system. Position the root first. */
  puppetUpdate(dt: number, prm: PuppetParams) {
    if (!this.puppet) { this.puppetAgent = new Agent(this.card, 0, 0); this.puppetAgent.isGK = this.keeper; this.puppet = new Motion(this.puppetAgent); }
    const a = this.puppetAgent!; const m = this.puppet;
    const pos = this.root.position; const yaw = this.root.rotation.y;
    if (!this.puppetInit) { this.lastPuppetPos.copy(pos); this.puppetInit = true; }
    const d = Math.max(1e-4, dt);
    a.vel = { x: (pos.x - this.lastPuppetPos.x) / d, z: (pos.z - this.lastPuppetPos.z) / d };
    if (Math.hypot(a.vel.x, a.vel.z) > 15) a.vel = { x: 0, z: 0 };
    this.lastPuppetPos.copy(pos);
    a.pos = { x: pos.x, z: pos.z }; a.heading = { x: Math.sin(yaw), z: Math.cos(yaw) };
    a.isGK = this.keeper || prm.state === 'keeperReady'; a.intent.jockey = false; a.hasBall = !!prm.holding;
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
    let ball = prm.ball ?? { x: pos.x + fwd.x * 6, y: 0.5, z: pos.z + fwd.z * 6 };
    switch (prm.state) {
      case 'kick': a.action = { type: 'kick', t: prm.t ?? 0, duration: prm.duration ?? 0.5, fired: true, dir: 1, data: { side: prm.side ?? 'R', dir: prm.dir ?? fwd, contact: prm.contact, kind: prm.kind ?? 'shoot', strike: prm.strike ?? 0.15 } }; break;
      case 'dive': a.action = { type: 'dive', t: prm.t ?? 0, duration: prm.duration ?? 1.25, fired: true, dir: 1, data: { side: prm.diveSide ?? 1, hands: prm.hands } }; break;
      case 'celebrate': a.action = { type: 'celebrate', t: prm.t ?? 1, duration: 99, fired: true, dir: 1, data: { style: prm.style ?? 0 } }; break;
      case 'juggle': {
        // keepy-uppies: alternate feet, the boot meets the ball at the bottom of each bounce
        this.juggleT += dt; const P = JUGGLE_PERIOD; const tc = 0.12;
        const ph = (prm.time ?? this.juggleT) % P;
        const bx = pos.x + fwd.x * 0.36, bz = pos.z + fwd.z * 0.36;
        ball = { x: bx, y: juggleBallHeight(prm.time ?? this.juggleT) * this.scale, z: bz };
        if (!a.action && ph > P - tc - 0.01) { this.juggleSide = this.juggleSide === 'L' ? 'R' : 'L'; a.action = { type: 'touch', t: ph - (P - tc), duration: 0.3, fired: true, dir: 1, data: { side: this.juggleSide, contact: { x: bx, y: 0.32 * this.scale, z: bz }, tc } }; }
        if (a.action) { a.action.t += dt; if (a.action.t > a.action.duration) a.action = null; }
        m.update(dt, ball); this.applyPose(m.pose); return;
      }
      default: a.action = null;
    }
    m.update(dt, ball);
    this.applyPose(m.pose);
  }
}

export interface PuppetParams {
  state: 'idle' | 'run' | 'kick' | 'dive' | 'keeperReady' | 'juggle' | 'celebrate';
  ball?: { x: number; y: number; z: number }; contact?: { x: number; y: number; z: number };
  t?: number; duration?: number; strike?: number; kind?: 'pass' | 'shoot' | 'lob' | 'through'; side?: Side; dir?: { x: number; z: number };
  diveSide?: number; hands?: { x: number; y: number; z: number }; style?: number; time?: number; holding?: boolean;
}

const JUGGLE_PERIOD = 0.62;
/** Height (metres, for a 1.8 m player) of the juggled ball; lowest at the touch, matching the puppet's rhythm. */
export function juggleBallHeight(time: number): number { const ph = (time % JUGGLE_PERIOD) / JUGGLE_PERIOD; return 0.32 + 0.75 * Math.sin(Math.PI * ph); }
