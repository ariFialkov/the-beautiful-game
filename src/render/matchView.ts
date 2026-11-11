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

/** Landing marker texture: a thin ring with four short ticks and a small centre dot, no outline (drawn once, large,
 *  so it stays crisp). */
let reticleTex: THREE.CanvasTexture | null = null;
function reticleTexture(): THREE.CanvasTexture {
  if (reticleTex) return reticleTex;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineCap = 'round';
  g.lineWidth = 9; g.beginPath(); g.arc(128, 128, 76, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 10;
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); g.lineTo(128 + Math.cos(a) * 116, 128 + Math.sin(a) * 116); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(128, 128, 8, 0, Math.PI * 2); g.fill();
  reticleTex = new THREE.CanvasTexture(c); reticleTex.anisotropy = 4; reticleTex.premultiplyAlpha = true; return reticleTex; // (no dark fringe)
}

/** Free-kick aim marker: a bold gold ring and dot with a soft shadow, readable against the white net at 30 m. */
let aimTex: THREE.CanvasTexture | null = null;
function aimTexture(): THREE.CanvasTexture {
  if (aimTex) return aimTex;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 14;
  g.strokeStyle = '#ffd23f'; g.fillStyle = '#ffd23f'; g.lineWidth = 20;
  g.beginPath(); g.arc(128, 128, 82, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(128, 128, 20, 0, Math.PI * 2); g.fill();
  aimTex = new THREE.CanvasTexture(c); aimTex.anisotropy = 4; aimTex.premultiplyAlpha = true; return aimTex;
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
  /** FIFA-style landing marker for a ball in the air: sits where it will come down and grows as it drops. */
  private reticle: THREE.Mesh;
  private reticleAlpha = 0; private highBall = -1; private reticleKey = -1; private reticleScale = 1.3;
  /** Free kicks: the aim marker on the goal, and whether the third-person free-kick camera is on. */
  private aimMark: THREE.Mesh; private fkCam: object | null = null; private fkSide = 0;

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
    this.reticle = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: reticleTexture(), transparent: true, premultipliedAlpha: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.reticle.rotation.x = -Math.PI / 2; this.reticle.position.y = 0.025; this.reticle.renderOrder = 2; this.reticle.visible = false;
    this.scene.add(this.reticle);
    this.aimMark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: aimTexture(), transparent: true, premultipliedAlpha: true, opacity: 0.95, depthWrite: false, depthTest: false }));
    this.aimMark.renderOrder = 3; this.aimMark.visible = false; this.aimMark.scale.set(1.1, 1.1, 1);
    this.scene.add(this.aimMark);
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
    this.updateReticle(dt);

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
    else if (this.freeKickCamera(dt, target)) { /* third person behind the free-kick taker */ }
    else { this.rig.endDir = m.teams[m.humanTeam ?? 0].attackDir; this.rig.update(dt, target, lead, time); }
    // controls follow the camera so left/right/up/down always match the screen
    m.controlBasis = groundBasis(this.stage.camera);
    this.sun.position.set(target.x - 40, 70, target.z - 50); this.sun.target.position.set(target.x, 0, target.z); this.sun.target.updateMatrixWorld();
    this.stadium.update(dt, time);
    this.weather.update(dt, this.stage.camera.position, time);
  }

  /** FIFA-style free kick: the camera cuts to just behind the ball, over the taker's shoulder, looking at goal (or the way
   *  he's facing for one that can only be played in), and stays on the strike for a moment before blending back. The
   *  human's aim shows as a marker on the goal. Returns false when the broadcast camera should run. */
  private freeKickCamera(dt: number, ball: THREE.Vector3): boolean {
    const m = this.match; const fk = m.freeKick; const lf = m.lastFreeKick;
    const mine = (t: number) => m.humanTeam === t;
    const live = fk && m.humanTeam !== null && (fk.direct || mine(fk.team)) && (m.phase === 'restart' || m.phase === 'play') ? fk : null;
    const follow = !live && this.fkCam && lf && m.time - lf.at < 0.8 && m.phase === 'play';
    const human = live && live.taker === m.controlled && !m.autopilot;
    this.aimMark.visible = !!(human && live.direct);
    if (!live && !follow) {
      if (this.fkCam) { this.fkCam = null; this.rig.softBlend(1.4); }
      return false;
    }
    const L = m.pitch.length; const pos = live ? live.pos : lf!.pos; const team = live ? live.team : lf!.team;
    const gx = m.teams[team].attackDir * L / 2;
    const direct = live ? live.direct : lf!.direct;
    const fwd = direct ? new THREE.Vector3(gx - pos.x, 0, -pos.z).normalize() : new THREE.Vector3((live ? live.dir : lf!.dir).x, 0, (live ? live.dir : lf!.dir).z).normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const futsal = m.pitch.futsal;
    // over the shoulder on the side away from the taker's run-up, so he doesn't block the goal
    const tk = live && this.fkCam !== live ? live.taker.pos : null; if (tk) this.fkSide = 0; const lat = tk ? (tk.x - pos.x) * side.x + (tk.z - pos.z) * side.z : 0;
    const cam = new THREE.Vector3(pos.x, 0, pos.z).addScaledVector(fwd, futsal ? -4.5 : -6.2).addScaledVector(side, this.fkSide || (this.fkSide = lat > 0.2 ? -1.1 : 1.1)).setY(futsal ? 2.1 : 2.6);
    const look = direct ? new THREE.Vector3(gx, 1.0, (live ? live.aim.z : 0) * 0.35) : new THREE.Vector3(pos.x, 0.3, pos.z).addScaledVector(fwd, 22);
    if (follow) look.lerp(ball, 0.5); // after the strike: follow the ball
    if (live && this.fkCam !== live) { this.fkCam = live; this.rig.cutTo(cam, look); } // a new free kick: cut to it
    this.rig.moveTo(dt, cam, look, follow ? 0.45 : 0.3, direct ? 0.74 : 1);
    if (human && live.direct) {
      this.aimMark.position.set(gx + Math.sign(gx) * 0.05, live.aim.y, live.aim.z);
      this.aimMark.lookAt(this.stage.camera.position);
    }
    return true;
  }

  /** Where (and how soon) a ball in the air will land, from a full simulation of its flight; the marker glides to
   *  it (snapping only for a new kick) and grows as the ball comes down. */
  private updateReticle(dt: number) {
    const m = this.match; const b = m.ball;
    let land = !b.owner && !b.held && m.phase === 'play' && (b.y > 0.7 || b.vy > 2.5) ? m.landing() : null;
    // a ball that has gone high is marked until it comes down (skimming balls don't need it)
    if (land && land.apex >= 1.4) this.highBall = b.lastTouchTime;
    if (land && this.highBall !== b.lastTouchTime) land = null;
    const want = land ? 1 : 0;
    this.reticleAlpha += (want - this.reticleAlpha) * Math.min(1, dt * (want ? 10 : 6));
    if (land) {
      const p = this.reticle.position; const fresh = this.reticleKey !== b.lastTouchTime || this.reticleAlpha < 0.05;
      const jump = Math.hypot(land.x - p.x, land.z - p.z);
      if (fresh || jump > 6) { p.x = land.x; p.z = land.z; } else { const k = 1 - Math.exp(-dt * 14); p.x += (land.x - p.x) * k; p.z += (land.z - p.z) * k; }
      this.reticleKey = b.lastTouchTime;
      const s = 1.3 + 1.0 * (1 - Math.min(1, land.t / 1.8)); // smaller while the ball is high and far off, growing as it drops
      this.reticleScale += (s - this.reticleScale) * Math.min(1, dt * 10);
      this.reticle.scale.set(this.reticleScale, this.reticleScale, 1);
    }
    (this.reticle.material as THREE.MeshBasicMaterial).opacity = this.reticleAlpha * 0.85; this.reticle.visible = this.reticleAlpha > 0.02;
  }

  dispose() {
    this.scene.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.geometry?.dispose(); } });
  }
}
