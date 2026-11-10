import * as THREE from 'three';
import type { Kit } from '@shared/teams';
import type { PlayerCard } from '@shared/types';
import { shirtBackTexture, shirtTexture } from './kits';

export type AnimState = 'idle' | 'run' | 'kick' | 'tackle' | 'slide' | 'dive' | 'celebrate' | 'fallen' | 'juggle' | 'keeperReady' | 'throw';

export interface AnimParams {
  state: AnimState;
  /** Run-cycle phase in radians (advance by distance travelled). */
  phase: number;
  /** 0 = standing, 1 = full sprint. */
  speed: number;
  /** Progress of a one-shot action (kick, dive, slide), 0..1. */
  action: number;
  /** -1 left, +1 right for dives/tackles. */
  dir: number;
  /** Global time for idle breathing. */
  time: number;
}

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

  /** Pose all joints for the current animation. */
  animate(p: AnimParams) {
    const { state, phase, speed, action, dir, time } = p;
    const s = Math.sin(phase), c = Math.cos(phase);
    // reset
    this.body.position.set(0, 0, 0); this.body.rotation.set(0, 0, 0);
    this.hips.rotation.set(0, 0, 0); this.torso.rotation.set(0, 0, 0); this.head.rotation.set(0, 0, 0);
    this.armL.rotation.set(0, 0, 0.12); this.armR.rotation.set(0, 0, -0.12); this.foreL.rotation.set(-0.3, 0, 0); this.foreR.rotation.set(-0.3, 0, 0);
    this.legL.rotation.set(0, 0, 0); this.legR.rotation.set(0, 0, 0); this.shinL.rotation.set(0, 0, 0); this.shinR.rotation.set(0, 0, 0);
    const breathe = Math.sin(time * 2.2) * 0.01;

    switch (state) {
      case 'idle': {
        this.torso.rotation.x = 0.04 + breathe; this.hips.position.y = 0.95 + breathe * 0.5;
        this.armL.rotation.x = Math.sin(time * 1.3) * 0.05; this.armR.rotation.x = -Math.sin(time * 1.1) * 0.05;
        this.head.rotation.y = Math.sin(time * 0.7) * 0.25;
        this.legL.rotation.z = 0.04; this.legR.rotation.z = -0.04;
        break;
      }
      case 'keeperReady': {
        this.torso.rotation.x = 0.35 + breathe; this.hips.position.y = 0.82;
        this.legL.rotation.x = -0.5; this.legR.rotation.x = -0.5; this.shinL.rotation.x = 0.9; this.shinR.rotation.x = 0.9;
        this.legL.rotation.z = 0.3; this.legR.rotation.z = -0.3;
        this.armL.rotation.set(-0.6, 0, 0.9); this.armR.rotation.set(-0.6, 0, -0.9); this.foreL.rotation.x = -1.2; this.foreR.rotation.x = -1.2;
        break;
      }
      case 'run': {
        const amp = 0.45 + speed * 0.65;
        this.legL.rotation.x = s * amp; this.legR.rotation.x = -s * amp;
        this.shinL.rotation.x = Math.max(0, -c) * amp * 1.3 + 0.15 * speed; this.shinR.rotation.x = Math.max(0, c) * amp * 1.3 + 0.15 * speed;
        this.armL.rotation.x = -s * amp * 0.9; this.armR.rotation.x = s * amp * 0.9;
        this.foreL.rotation.x = -0.9 - speed * 0.6; this.foreR.rotation.x = -0.9 - speed * 0.6;
        this.torso.rotation.x = 0.1 + speed * 0.22; this.torso.rotation.y = s * 0.08 * speed;
        this.hips.position.y = 0.95 + Math.abs(c) * 0.03 * speed;
        this.hips.rotation.y = -s * 0.12;
        break;
      }
      case 'kick': {
        // wind-up (0..0.4) then swing through (0.4..1)
        const t = action; const kickLeg = dir < 0 ? this.legL : this.legR; const kickShin = dir < 0 ? this.shinL : this.shinR;
        const plant = dir < 0 ? this.legR : this.legL;
        const wind = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6 * 1.9;
        kickLeg.rotation.x = wind * 0.9; kickShin.rotation.x = t < 0.4 ? 1.4 * (t / 0.4) : Math.max(0, 1.4 - (t - 0.4) * 5);
        plant.rotation.x = -0.25; (dir < 0 ? this.shinR : this.shinL).rotation.x = 0.4;
        this.torso.rotation.x = 0.25 - (t > 0.4 ? (t - 0.4) * 0.5 : 0); this.torso.rotation.z = dir * 0.15 * (t > 0.4 ? 1 : 0);
        this.armL.rotation.x = dir < 0 ? 0.6 : -0.6; this.armR.rotation.x = dir < 0 ? -0.6 : 0.6; this.armL.rotation.z = 0.6; this.armR.rotation.z = -0.6;
        this.hips.position.y = 0.93;
        break;
      }
      case 'throw': {
        const t = action; this.armL.rotation.x = -2.6 + t * 2.4; this.armR.rotation.x = -2.6 + t * 2.4; this.torso.rotation.x = -0.3 + t * 0.6; this.legL.rotation.x = 0.3; this.legR.rotation.x = -0.3; break;
      }
      case 'tackle': {
        const t = action; const lunge = Math.sin(t * Math.PI);
        this.torso.rotation.x = 0.6 * lunge; this.legR.rotation.x = -1.1 * lunge; this.shinR.rotation.x = 0.2; this.legL.rotation.x = 0.6 * lunge; this.shinL.rotation.x = 1.2 * lunge;
        this.armL.rotation.x = -0.8 * lunge; this.armR.rotation.x = 0.8 * lunge; this.hips.position.y = 0.95 - 0.25 * lunge;
        break;
      }
      case 'slide': {
        const t = Math.min(1, action);
        this.body.rotation.x = -Math.PI / 2 * 0.75 * Math.min(1, t * 3); this.body.position.y = 0.35 * Math.min(1, t * 3) - 0.15;
        this.legR.rotation.x = -1.3; this.legL.rotation.x = 0.6; this.shinL.rotation.x = 1.4; this.torso.rotation.x = -0.3;
        this.armL.rotation.set(-1.5, 0, 0.7); this.armR.rotation.set(0.6, 0, -1.2);
        break;
      }
      case 'dive': {
        const t = Math.min(1, action);
        const k = Math.sin(Math.min(1, t * 1.5) * Math.PI / 2);
        this.body.rotation.z = -dir * 1.35 * k; this.body.rotation.y = -dir * 0.3 * k; this.body.position.y = 0.35 * k * (1 - t * 0.6);
        this.armL.rotation.set(0, 0, 2.8 * (dir < 0 ? k : 0.3)); this.armR.rotation.set(0, 0, -2.8 * (dir > 0 ? k : 0.3));
        this.legL.rotation.x = -0.5 * k; this.legR.rotation.x = 0.4 * k; this.shinL.rotation.x = 0.6 * k; this.torso.rotation.x = 0.2 * k;
        this.hips.position.y = 0.95 - 0.5 * k;
        break;
      }
      case 'fallen': {
        this.body.rotation.x = -Math.PI / 2 * 0.9; this.body.position.y = 0.25; this.body.position.z = -0.3;
        this.armL.rotation.set(-1.2, 0, 0.5); this.armR.rotation.set(-1.2, 0, -0.5); this.legL.rotation.x = 0.2; this.legR.rotation.x = -0.1;
        break;
      }
      case 'celebrate': {
        const t = time * 6;
        this.armL.rotation.set(-2.6 + Math.sin(t) * 0.3, 0, 0.5); this.armR.rotation.set(-2.6 + Math.cos(t) * 0.3, 0, -0.5);
        this.foreL.rotation.x = -0.4; this.foreR.rotation.x = -0.4;
        const hop = Math.abs(Math.sin(t * 0.5));
        this.body.position.y = hop * 0.18; this.legL.rotation.x = -hop * 0.4; this.legR.rotation.x = -hop * 0.4; this.shinL.rotation.x = hop * 0.8; this.shinR.rotation.x = hop * 0.8;
        this.torso.rotation.x = -0.15; this.head.rotation.x = -0.3;
        break;
      }
      case 'juggle': {
        // Ball-juggling idle for menus: alternate knees with a bounce.
        const t = time * 3.2; const k = Math.sin(t);
        const up = k > 0 ? this.legR : this.legL; const other = k > 0 ? this.legL : this.legR;
        const upShin = k > 0 ? this.shinR : this.shinL;
        up.rotation.x = -Math.abs(k) * 1.5; upShin.rotation.x = Math.abs(k) * 1.1; other.rotation.x = 0.05;
        this.torso.rotation.x = 0.12 + Math.abs(k) * 0.08; this.hips.position.y = 0.95 - Math.abs(k) * 0.06;
        this.armL.rotation.set(-0.3, 0, 0.5 + Math.abs(k) * 0.2); this.armR.rotation.set(-0.3, 0, -0.5 - Math.abs(k) * 0.2); this.foreL.rotation.x = -1; this.foreR.rotation.x = -1;
        this.head.rotation.x = 0.35;
        break;
      }
    }
    this.hips.position.y *= 1; // scaled by body
  }
}

/** Height of the juggled ball for the showcase idle, matching Humanoid 'juggle'. */
export function juggleBallHeight(time: number): number { const k = Math.abs(Math.sin(time * 3.2)); return 0.35 + (1 - k) * 0.9; }
