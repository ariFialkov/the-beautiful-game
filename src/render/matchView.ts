import * as THREE from 'three';
import type { Match } from '../game/match';
import type { Agent } from '../game/player';
import { Humanoid, setHumanoidQuality } from './humanoid';
import { Pose } from '../game/skeleton';
import { Stadium } from './stadium';
import { makeLighting, type Stage } from './scene';
import { CameraRig, groundBasis } from './camera';
import { keeperKit } from './kits';
import { WeatherFx } from './weather';
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

const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

/** Renders a Match into the shared Stage, interpolating between fixed simulation steps. */
export class MatchView {
  scene = new THREE.Scene();
  stadium: Stadium;
  rig: CameraRig;
  private humanoids = new Map<Agent, Humanoid>();
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private weather: WeatherFx;
  cinematic = false;
  private goalCamT = 0;
  private pose = new Pose();
  private wasGoal = false;

  constructor(private stage: Stage, public match: Match, night: boolean) {
    const [h, a] = match.opts.teams;
    const low = stage.quality === 'low';
    const surf = match.surface;
    this.stadium = new Stadium(match.pitch, h.team, a.team, night, low);
    this.scene.add(this.stadium.group);
    this.sun = makeLighting(this.scene, night, stage.quality === 'high', match.pitch.futsal ? 30 : 60).sun;
    // Conditions: overcast rain, snow cover, baked firm ground.
    if (surf.weather === 'rain') {
      this.stadium.pitchMaterial.color.setRGB(0.72, 0.8, 0.74); this.sun.intensity *= 0.55;
      const sky = new THREE.Color(night ? 0x0a0f18 : 0x5d6875); this.scene.background = sky; this.scene.fog = new THREE.Fog(sky, 60, 260);
    } else if (surf.weather === 'snow') {
      this.stadium.pitchMaterial.color.setRGB(0.78, 0.84, 0.82); this.stadium.pitchMaterial.emissive.setRGB(0.2, 0.22, 0.25); this.sun.intensity *= 0.7; // snow-dusted, lines still readable
      const sky = new THREE.Color(night ? 0x141a24 : 0xb9c4cf); this.scene.background = sky; this.scene.fog = new THREE.Fog(sky, 50, 240);
    } else if (surf.id === 'firm') {
      this.stadium.pitchMaterial.color.setRGB(1.08, 1.02, 0.85); this.sun.intensity *= 1.15;
    }
    this.weather = new WeatherFx(surf.weather, low);
    if (this.weather.object) this.scene.add(this.weather.object);
    setHumanoidQuality(stage.quality === 'high');
    const gkKit = [keeperKit(h.kit, a.kit), keeperKit(a.kit, h.kit)];
    for (const t of match.teams) for (const ag of t.agents) {
      const kit = ag.isGK ? gkKit[t.index] : t.setup.kit;
      const hum = new Humanoid(ag.card, kit, ag.isGK ? `${t.setup.kitKey}:gk` : t.setup.kitKey, ag.isGK);
      hum.setShadowsReal(stage.quality === 'high');
      this.scene.add(hum.root);
      this.humanoids.set(ag, hum);
    }
    this.ball = makeBallMesh(match.ball.radius);
    if (surf.weather === 'snow') (this.ball.material as THREE.MeshStandardMaterial).color.set(0xff8a3d); // orange ball in the snow
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2; this.ballShadow.position.y = 0.015;
    this.scene.add(this.ballShadow);
    this.rig = new CameraRig(stage.camera, match.pitch.length, match.pitch.width);
    this.rig.heightMul = state.settings.cameraHeight;
    this.rig.setFixed(new THREE.Vector3(0, 12, -(match.pitch.width / 2 + 9)), new THREE.Vector3(0, 0.4, -3));
    match.on((e) => { if (e.type === 'goal') this.stadium.cheer(1); if (e.type === 'post' || e.type === 'save') this.stadium.cheer(0.5); });
  }

  frame(dt: number, time: number) {
    const m = this.match; const al = m.alpha;
    for (const [a, h] of this.humanoids) {
      const x = a.prevPos.x + (a.pos.x - a.prevPos.x) * al, z = a.prevPos.z + (a.pos.z - a.prevPos.z) * al;
      const ang = lerpAngle(a.prevHeadingAngle, Math.atan2(a.heading.z, a.heading.x), al);
      h.place(x, z, Math.atan2(Math.cos(ang), Math.sin(ang)));
      if (a.motion) h.applyPose(this.pose.lerp(a.motion.prev, a.motion.pose, al));
      const sel = a === m.controlled && m.humanTeam !== null && !this.cinematic;
      h.setSelected(sel, m.autopilot ? 0xf7c948 : 0x19f5a4);
    }
    const b = m.ball;
    const bx = b.px + (b.x - b.px) * al, by = b.py + (b.y - b.py) * al, bz = b.pz + (b.z - b.pz) * al;
    this.ball.position.set(bx, by, bz);
    // Spin the ball with its real angular velocity.
    const wl = Math.hypot(b.wx, b.wy, b.wz);
    if (wl > 0.01) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(b.wx / wl, b.wy / wl, b.wz / wl), wl * dt); this.ball.quaternion.premultiply(q); }
    this.ballShadow.position.set(bx, 0.015, bz);
    const sh = Math.max(0.3, 1 - (by - b.radius) * 0.25); this.ballShadow.scale.set(sh, sh, 1);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.35 * sh;

    // Camera: ball-driven broadcast framing, biased toward the direction of play of the team in possession.
    const target = new THREE.Vector3(bx, by, bz);
    const owner = b.owner;
    const playDir = owner ? m.teams[owner.team].attackDir * (owner.isGK ? 0.4 : 1) : 0;
    const lead = new THREE.Vector3(playDir, 0, 0);
    if (m.phase === 'goal') { this.goalCamT += dt; this.wasGoal = true; } else if (this.wasGoal) { this.wasGoal = false; this.goalCamT = 0; this.rig.softBlend(1.4); }
    if (m.phase === 'goal' && m.lastScorer && this.goalCamT > 0.9 && !this.cinematic) {
      const s = m.lastScorer; const sp = new THREE.Vector3(s.pos.x, 1.2, s.pos.z);
      const cam = sp.clone().add(new THREE.Vector3(-s.heading.x * 5.5, 1.6, -s.heading.z * 5.5 - 2));
      this.rig.moveTo(dt, cam, sp, 0.9);
    } else if (this.cinematic) this.rig.cinematic(dt, target, new THREE.Vector3(b.vx, 0, b.vz).normalize(), time);
    else this.rig.update(dt, target, lead, time);
    // controls follow the camera so left/right/up/down always match the screen
    m.controlBasis = groundBasis(this.stage.camera);
    this.sun.position.set(target.x - 40, 70, target.z - 50); this.sun.target.position.set(target.x, 0, target.z); this.sun.target.updateMatrixWorld();
    this.stadium.update(dt, time);
    this.weather.update(dt, this.stage.camera.position, time);
  }

  dispose() {
    this.scene.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.geometry?.dispose(); } });
  }
}
