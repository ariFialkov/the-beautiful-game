import * as THREE from 'three';
import type { Match } from '../game/match';
import type { Agent } from '../game/player';
import { Humanoid, type AnimParams, type AnimState } from './humanoid';
import { Stadium } from './stadium';
import { makeLighting, type Stage } from './scene';
import { CameraRig } from './camera';
import { keeperKit } from './kits';
import { state } from '../app/state';

let ballTex: THREE.CanvasTexture | null = null;
export function ballTexture(): THREE.CanvasTexture {
  if (ballTex) return ballTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f8f8f8'; ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#111';
  for (let i = 0; i < 12; i++) { const x = (i % 6) * 42 + (i >= 6 ? 21 : 0) + 10, y = i >= 6 ? 90 : 36; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) { const x = (i % 6) * 42 + (i >= 6 ? 21 : 0) + 10, y = i >= 6 ? 90 : 36; for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 24, y + Math.sin(a) * 24); ctx.stroke(); } }
  ballTex = new THREE.CanvasTexture(c); ballTex.colorSpace = THREE.SRGBColorSpace; return ballTex;
}

export function makeBallMesh(radius = 0.11): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.55, metalness: 0 }));
  m.castShadow = true; return m;
}

/** Renders a Match into the shared Stage. */
export class MatchView {
  scene = new THREE.Scene();
  stadium: Stadium;
  rig: CameraRig;
  private humanoids = new Map<Agent, Humanoid>();
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private ballQuat = new THREE.Quaternion();
  cinematic = false;
  private goalFlash = 0;

  constructor(private stage: Stage, public match: Match, night: boolean) {
    const [h, a] = match.opts.teams;
    const low = stage.quality === 'low';
    this.stadium = new Stadium(match.pitch, h.team, a.team, night, low);
    this.scene.add(this.stadium.group);
    this.sun = makeLighting(this.scene, night, stage.quality === 'high', match.pitch.futsal ? 30 : 60).sun;
    const gkKit = [keeperKit(h.kit, a.kit), keeperKit(a.kit, h.kit)];
    for (const t of match.teams) {
      for (const ag of t.agents) {
        const kit = ag.isGK ? gkKit[t.index] : t.setup.kit;
        const hum = new Humanoid(ag.card, kit, ag.isGK ? `${t.setup.kitKey}:gk` : t.setup.kitKey, ag.isGK);
        hum.setShadowsReal(stage.quality === 'high');
        this.scene.add(hum.root);
        this.humanoids.set(ag, hum);
      }
    }
    this.ball = makeBallMesh(match.ball.radius);
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2; this.ballShadow.position.y = 0.015;
    this.scene.add(this.ballShadow);
    this.rig = new CameraRig(stage.camera, match.pitch.length, match.pitch.width);
    this.rig.heightMul = state.settings.cameraHeight;
    this.rig.setFixed(new THREE.Vector3(0, 28, -(match.pitch.width / 2 + 34)), new THREE.Vector3(0, 0, 0));
    match.on((e) => { if (e.type === 'goal') { this.stadium.cheer(1); this.goalFlash = 1; this.rig.addShake(0.5); } if (e.type === 'post' || e.type === 'save') this.stadium.cheer(0.5); if (e.type === 'kick' && e.kind === 'shoot') this.rig.addShake(0.12); });
  }

  private animFor(a: Agent, m: Match): AnimParams {
    const act = a.action; let st: AnimState = 'idle'; let action = 0; let dir = 1;
    const speed = a.speed();
    if (act) {
      action = act.t / act.duration; dir = act.dir;
      switch (act.type) {
        case 'kick': st = 'kick'; break; case 'tackle': st = 'tackle'; break; case 'slide': st = 'slide'; break; case 'dive': st = 'dive'; break;
        case 'fallen': st = 'fallen'; break; case 'celebrate': st = 'celebrate'; break; case 'throw': st = 'throw'; break;
      }
    } else if (speed > 0.6) st = 'run';
    else if (a.isGK && Math.hypot(m.ball.x - a.pos.x, m.ball.z - a.pos.z) < 28 && !a.hasBall) st = 'keeperReady';
    return { state: st, phase: a.animPhase, speed: Math.min(1, speed / a.maxSpeed), action, dir, time: a.animTime };
  }

  frame(dt: number, time: number) {
    const m = this.match;
    for (const [a, h] of this.humanoids) {
      h.root.position.set(a.pos.x, 0, a.pos.z);
      h.root.rotation.y = Math.atan2(a.heading.x, a.heading.z);
      h.animate(this.animFor(a, m));
      const sel = a === m.controlled && m.humanTeam !== null && !this.cinematic;
      h.setSelected(sel, m.autopilot ? 0xf7c948 : 0x19f5a4);
    }
    const b = m.ball;
    this.ball.position.set(b.x, b.y, b.z);
    const hs = Math.hypot(b.vx, b.vz);
    if (hs > 0.05) {
      const axis = new THREE.Vector3(b.vz / hs, 0, -b.vx / hs);
      const q = new THREE.Quaternion().setFromAxisAngle(axis, (hs / b.radius) * dt);
      this.ballQuat.premultiply(q);
      this.ball.quaternion.copy(this.ballQuat);
    }
    this.ballShadow.position.set(b.x, 0.015, b.z);
    const sh = Math.max(0.3, 1 - (b.y - b.radius) * 0.25); this.ballShadow.scale.set(sh, sh, 1);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.35 * sh;
    // camera
    const target = new THREE.Vector3(b.x, b.y, b.z);
    const lead = b.owner ? new THREE.Vector3(b.owner.heading.x, 0, b.owner.heading.z) : new THREE.Vector3(b.vx, 0, b.vz).normalize();
    if (m.phase === 'goal' && m.lastScorer) {
      const s = m.lastScorer; const sp = new THREE.Vector3(s.pos.x, 1.2, s.pos.z);
      const cam = sp.clone().add(new THREE.Vector3(-s.heading.x * 5, 1.4, -s.heading.z * 5 - 2));
      this.rig.moveTo(dt, cam, sp, 3);
    } else if (this.cinematic) this.rig.cinematic(dt, target, lead, time);
    else this.rig.update(dt, target, lead, time);
    // shadow frustum follows the action
    this.sun.position.set(target.x - 40, 70, target.z - 50); this.sun.target.position.set(target.x, 0, target.z); this.sun.target.updateMatrixWorld();
    this.stadium.update(dt, time);
    if (this.goalFlash > 0) this.goalFlash -= dt;
  }

  dispose() {
    this.scene.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.geometry?.dispose(); } });
  }
}
