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

/** A referee's card: rounded, glossy, with a thin white edge. */
const cardTex: Record<string, THREE.CanvasTexture> = {};
function cardTexture(kind: 'yellow' | 'red') {
  if (cardTex[kind]) return cardTex[kind];
  const c = document.createElement('canvas'); c.width = 64; c.height = 88; const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(2, 2, 60, 84, 7); g.fill();
  const grd = g.createLinearGradient(0, 0, 64, 88);
  if (kind === 'yellow') { grd.addColorStop(0, '#fff07a'); grd.addColorStop(1, '#f0b800'); } else { grd.addColorStop(0, '#ff5a5a'); grd.addColorStop(1, '#b80c18'); }
  g.fillStyle = grd; g.beginPath(); g.roundRect(5, 5, 54, 78, 5); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.moveTo(5, 5); g.lineTo(59, 5); g.lineTo(5, 50); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (cardTex[kind] = t);
}

/** A player's name tag ("F. Lastname"), drawn crisp with a dark outline; yellow, with a small yellow card in front
 *  of it, when he's booked. */
const tagTex = new Map<string, THREE.CanvasTexture>();
export function nameTagText(full: string) { const i = full.indexOf(' '); return i > 0 ? `${full[0]}. ${full.slice(i + 1)}` : full; }
function nameTagTexture(text: string, booked: boolean) {
  const key = `${text}|${booked}`; const hit = tagTex.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = 512; c.height = 64; const g = c.getContext('2d')!;
  // sleek: medium weight, a touch of tracking, no outline - just a soft shadow to lift it off the grass
  g.font = '500 32px Inter, "Segoe UI", system-ui, -apple-system, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  (g as any).letterSpacing = '0.5px';
  const tw = g.measureText(text).width; const cw = booked ? 13 : 0, gap = booked ? 8 : 0; const x0 = (512 - (tw + cw + gap)) / 2;
  g.shadowColor = 'rgba(0, 0, 0, 0.55)'; g.shadowBlur = 6; g.shadowOffsetY = 1;
  if (booked) {
    // the card: the height of the capitals, tilted a touch
    g.save(); g.translate(x0 + cw / 2, 32); g.rotate(-0.12); g.fillStyle = '#ffd21f'; g.fillRect(-cw / 2, -9.5, cw, 19); g.restore();
  }
  g.fillStyle = booked ? '#ffd21f' : '#ffffff'; g.fillText(text, x0 + cw + gap, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; tagTex.set(key, t); return t;
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

/** Pack a drawn pose (with its place on the pitch) into a flat array, and back. */
function packPose(x: number, z: number, ang: number, p: Pose): Float32Array {
  const n = p.q.length; const out = new Float32Array(6 + n * 4);
  out[0] = x; out[1] = z; out[2] = ang; out[3] = p.pelvis.x; out[4] = p.pelvis.y; out[5] = p.pelvis.z;
  for (let i = 0; i < n; i++) { const q = p.q[i]; out[6 + i * 4] = q.x; out[7 + i * 4] = q.y; out[8 + i * 4] = q.z; out[9 + i * 4] = q.w; }
  return out;
}
function unpackPose(a: Float32Array, p: Pose) {
  p.pelvis.set(a[3], a[4], a[5]);
  for (let i = 0; i < p.q.length; i++) p.q[i].set(a[6 + i * 4], a[7 + i * 4], a[8 + i * 4], a[9 + i * 4]);
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
  /** Instant replay: the last seconds of play, recorded as they're drawn (positions, poses, the ball). */
  private rec: Array<{ t: number; ball: Float32Array; agents: Array<Float32Array | null> }> = [];
  private recAgents: Agent[] = [];
  private replay: { frames: MatchView['rec']; tau: number; t1: number; goalT: number; side: number; shot: number; onEnd: () => void } | null = null;
  private poseA = new Pose(); private poseB = new Pose();
  /** Free kicks: the aim marker on the goal, and whether the third-person free-kick camera is on. */
  private aimMark: THREE.Mesh; private fkCam: object | null = null; private fkSide = 0; private penFk: { src: object; fk: any } | null = null;

  /** Booked players carry a small yellow card over their head; a card being shown pops up over the offender. */
  /** Name tags: over the player you control, and over an opponent on the ball. */
  private tags: Array<{ sprite: THREE.Sprite; key: string }> = [];
  /** The stamina bar under your player's name: a dark track and a fill coloured by how much he has left. */
  private bar: { bg: THREE.Sprite; fill: THREE.Sprite } | null = null;
  private shown: { sprite: THREE.Sprite; agent: Agent; t: number } | null = null;
  constructor(private stage: Stage, public match: Match, night: boolean) {
    const [h, a] = match.opts.teams;
    const low = stage.quality === 'low';
    const surf = match.surface;
    this.stadium = new Stadium(match.pitch, h.team, a.team, night, low, surf.weather === 'rain' || surf.weather === 'snow' ? surf.weather : surf.id === 'firm' ? 'firm' : 'none');
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
    this.stadium.turf?.tint(this.stadium.pitchMaterial.color, this.stadium.pitchMaterial.emissive);
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
    this.ballShadow.rotation.x = -Math.PI / 2; this.ballShadow.position.y = 0.034; // (above the grass tips)
    this.scene.add(this.ballShadow);
    this.reticle = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: reticleTexture(), transparent: true, premultipliedAlpha: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.reticle.rotation.x = -Math.PI / 2; this.reticle.position.y = 0.036; this.reticle.renderOrder = 2; this.reticle.visible = false;
    this.scene.add(this.reticle);
    this.aimMark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: aimTexture(), transparent: true, premultipliedAlpha: true, opacity: 0.95, depthWrite: false, depthTest: false }));
    this.aimMark.renderOrder = 3; this.aimMark.visible = false; this.aimMark.scale.set(1.1, 1.1, 1);
    this.scene.add(this.aimMark);
    this.rig = new CameraRig(stage.camera, match.pitch.length, match.pitch.width);
    this.rig.heightMul = state.settings.cameraHeight;
    this.rig.setFixed(new THREE.Vector3(0, 12, -(match.pitch.width / 2 + 9)), new THREE.Vector3(0, 0.4, -3));
    match.on((e) => {
      if (e.type === 'goal') this.stadium.cheer(1); if (e.type === 'post' || e.type === 'save') this.stadium.cheer(0.5);
      if (e.type === 'foul' && e.card) this.showCard(e.by, e.card);
    });
  }

  /** The match camera's ground basis (not the free-kick or celebration close-ups): what the minimap turns with. */
  mapBasis: { right: { x: number; z: number }; forward: { x: number; z: number } } = { right: { x: 1, z: 0 }, forward: { x: 0, z: 1 } };
  get replaying() { return !!this.replay; }

  private showCard(a: Agent, kind: 'yellow' | 'red') {
    if (this.shown) this.scene.remove(this.shown.sprite);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cardTexture(kind), transparent: true, depthTest: false, sizeAttenuation: false }));
    sp.renderOrder = 5; this.scene.add(sp); this.shown = { sprite: sp, agent: a, t: 0 };
  }
  /** Name tags over the player you control and the opponent on the ball (nobody's, when they don't have it). */
  private updateTags() {
    const m = this.match; const al = m.alpha; const cam = this.stage.camera.position;
    const who: Agent[] = [];
    if (m.humanTeam !== null && m.phase !== 'goal' && !this.cinematic) {
      if (m.controlled && !m.controlled.sentOff) who.push(m.controlled);
      const o = m.ball.owner; if (o && o.team !== m.humanTeam && !o.sentOff) who.push(o);
    }
    while (this.tags.length < who.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, sizeAttenuation: false }));
      sp.center.set(0.5, 0); sp.renderOrder = 4; sp.scale.set(0.24, 0.03, 1); this.scene.add(sp); this.tags.push({ sprite: sp, key: '' });
    }
    this.tags.forEach((tg, i) => {
      const a = who[i]; if (!a) { tg.sprite.visible = false; return; }
      const key = `${a.card.name}|${a.yellow > 0}`;
      if (tg.key !== key) { tg.key = key; tg.sprite.material.map = nameTagTexture(nameTagText(a.card.name), a.yellow > 0); tg.sprite.material.needsUpdate = true; }
      tg.sprite.position.set(a.prevPos.x + (a.pos.x - a.prevPos.x) * al, 1.98, a.prevPos.z + (a.pos.z - a.prevPos.z) * al);
      tg.sprite.visible = tg.sprite.position.distanceTo(cam) > 3.2 && !(this.shown && this.shown.agent === a);
      tg.sprite.center.set(0.5, 0);
    });
    if (!this.bar) {
      const mk = (c: number, o: number) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: c, transparent: true, opacity: o, depthTest: false, sizeAttenuation: false })); sp.renderOrder = 4; this.scene.add(sp); return sp; };
      this.bar = { bg: mk(0x0a0f1c, 0.55), fill: mk(0x3ddc84, 0.95) };
    }
    // two tags side by side on screen (you pressing the man on the ball): the one further up the screen goes on top
    if (who.length === 2 && this.tags[0].sprite.visible && this.tags[1].sprite.visible) {
      const camera = this.stage.camera; const p0 = this.tags[0].sprite.position.clone().project(camera), p1 = this.tags[1].sprite.position.clone().project(camera);
      const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1; const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
      const toNdc = 2 / (2 * Math.tan((fov * Math.PI) / 360)); // sprite scale (at unit depth) to NDC height
      const h = 0.03 * toNdc * 0.62, w = 0.24 * toNdc / aspect * 0.5; // (the text's own extent, not the canvas)
      if (Math.abs(p0.x - p1.x) < w && Math.abs(p0.y - p1.y) < h * 1.15) (p0.y > p1.y ? this.tags[0] : this.tags[1]).sprite.center.set(0.5, -0.75);
    }
    // stamina: a thin bar just under your player's name (FIFA style)
    const me = who[0] && who[0] === m.controlled ? who[0] : null; const tg0 = this.tags[0];
    const show = !!me && !!tg0 && tg0.sprite.visible;
    this.bar.bg.visible = this.bar.fill.visible = show;
    if (show && me) {
      const W = 0.055, H = 0.0032; const e = Math.max(0.02, me.energy);
      const lift = 0.0028 - tg0.sprite.center.y * 0.03; // (just under the text; follows the tag up when it's stacked)
      for (const sp of [this.bar.bg, this.bar.fill]) sp.position.copy(tg0.sprite.position);
      this.bar.bg.scale.set(W, H, 1); this.bar.bg.center.set(0.5, -lift / H);
      this.bar.fill.scale.set(W * e, H, 1); this.bar.fill.center.set(1 / (2 * e), -lift / H);
      this.bar.fill.material.color.setHex(e > 0.6 ? 0x3ddc84 : e > 0.3 ? 0xffd21f : 0xff5a4d);
    }
  }
  /** The card animation (flips up out of the referee's pocket, holds, fades). */
  private updateCards(dt: number) {
    const al = this.match.alpha;
    const at = (a: Agent) => new THREE.Vector3(a.prevPos.x + (a.pos.x - a.prevPos.x) * al, 0, a.prevPos.z + (a.pos.z - a.prevPos.z) * al);
    const c = this.shown; if (!c) return;
    c.t += dt; const t = c.t; c.sprite.visible = true;
    const pop = Math.min(1, t / 0.35); const s = (1 - Math.pow(1 - pop, 3)) * (1 + 0.25 * Math.sin(pop * Math.PI));
    const fade = t > 2.3 ? Math.max(0, 1 - (t - 2.3) / 0.5) : 1;
    c.sprite.scale.set(0.05 * s, 0.069 * s, 1); // (screen-sized: as clear from the broadcast camera as up close)
    c.sprite.material.rotation = (1 - pop) * 1.8 + Math.sin(t * 2.2) * 0.06; // spins up, then a gentle sway in the raised hand
    c.sprite.material.opacity = fade;
    c.sprite.position.copy(at(c.agent)).setY(2.4 + 0.5 * pop);
    if (c.sprite.position.distanceTo(this.stage.camera.position) < 4) c.sprite.visible = false;
    if (fade <= 0) { this.scene.remove(c.sprite); this.shown = null; }
  }

  frame(dt: number, time: number) {
    const m = this.match; const al = m.alpha;
    if (this.replay) { this.playReplay(dt, time); return; }
    const record = m.time - (this.rec.length ? this.rec[this.rec.length - 1].t : -1) >= 1 / 30 - 1e-4;
    if (record && !this.recAgents.length) this.recAgents = Array.from(this.humanoids.keys());
    const snap: Array<Float32Array | null> = [];
    for (const [a, h] of this.humanoids) {
      const x = a.prevPos.x + (a.pos.x - a.prevPos.x) * al, z = a.prevPos.z + (a.pos.z - a.prevPos.z) * al;
      const ang = lerpAngle(a.prevHeadingAngle, Math.atan2(a.heading.z, a.heading.x), al);
      h.place(x, z, Math.atan2(Math.cos(ang), Math.sin(ang)));
      if (a.motion) h.applyPose(this.pose.lerp(a.motion.prev, a.motion.pose, al));
      const sel = a === m.controlled && m.humanTeam !== null && !this.cinematic && m.phase !== 'goal';
      h.setSelected(sel, m.autopilot ? 0xf7c948 : 0x19f5a4);
      if (record) snap.push(a.motion ? packPose(x, z, ang, this.pose) : null);
    }
    const b = m.ball;
    const bx = b.px + (b.x - b.px) * al, by = b.py + (b.y - b.py) * al, bz = b.pz + (b.z - b.pz) * al;
    if (record) {
      this.rec.push({ t: m.time, ball: new Float32Array([bx, by, bz]), agents: snap });
      while (this.rec.length && this.rec[0].t < m.time - 12) this.rec.shift();
    }
    this.ball.position.set(bx, by, bz);
    // Spin the ball with its real angular velocity.
    const wl = Math.hypot(b.wx, b.wy, b.wz);
    if (wl > 0.01) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(b.wx / wl, b.wy / wl, b.wz / wl), wl * dt); this.ball.quaternion.premultiply(q); }
    this.ballShadow.position.set(bx, 0.034, bz);
    const sh = Math.max(0.3, 1 - (by - b.radius) * 0.25); this.ballShadow.scale.set(sh, sh, 1);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.35 * sh;
    this.updateReticle(dt);
    this.updateCards(dt);
    this.updateTags();

    // Camera: ball-driven broadcast framing, biased toward the direction of play of the team in possession.
    const target = new THREE.Vector3(bx, by, bz);
    const owner = b.owner;
    const playDir = owner ? m.teams[owner.team].attackDir * (owner.isGK ? 0.4 : 1) : 0;
    const lead = new THREE.Vector3(playDir, 0, 0);
    if (m.phase === 'goal') { this.goalCamT += dt; this.wasGoal = true; } else if (this.wasGoal) { this.wasGoal = false; this.goalCamT = 0; this.rig.softBlend(1.4); }
    if (m.phase === 'goal' && m.lastScorer && this.goalCamT > 0.9 && !this.cinematic) {
      // on the pitch side of the scorer (they turn to face it for the finale, with the fans behind them)
      const s = m.lastScorer; const sp = new THREE.Vector3(s.pos.x, 1.1, s.pos.z);
      const L = m.pitch.length, W = m.pitch.width; const sc = m.pitch.futsal ? 0.7 : 1;
      const inward = new THREE.Vector3(-s.pos.x * 0.35, 0, -s.pos.z).normalize(); const side = new THREE.Vector3(-inward.z, 0, inward.x);
      const cam = sp.clone().addScaledVector(inward, 4.3 * sc).addScaledVector(side, 1.3 * sc).setY(1.55);
      cam.x = THREE.MathUtils.clamp(cam.x, -L / 2 + 1, L / 2 - 1); cam.z = THREE.MathUtils.clamp(cam.z, -W / 2 + 1, W / 2 - 1);
      this.rig.moveTo(dt, cam, sp.setY(0.95), 0.6, 0.9);
    } else if (this.cinematic) this.rig.cinematic(dt, target, new THREE.Vector3(b.vx, 0, b.vz).normalize(), time);
    else if (this.freeKickCamera(dt, target)) { /* third person behind the free-kick taker */ }
    else { this.rig.endDir = m.teams[m.humanTeam ?? 0].attackDir; this.rig.update(dt, target, lead, time); this.mapBasis = groundBasis(this.stage.camera); }
    // controls follow the camera so left/right/up/down always match the screen
    m.controlBasis = groundBasis(this.stage.camera);
    this.sun.position.set(target.x - 40, 70, target.z - 50); this.sun.target.position.set(target.x, 0, target.z); this.sun.target.updateMatrixWorld();
    this.stadium.update(dt, time, this.stage.camera, m);
    this.weather.update(dt, this.stage.camera.position, time);
  }

  /** Play back the last goal: from a few seconds before it, side-on and following the ball, then (as the shot goes
   *  in) a cut to behind the goal in slow motion. `onEnd` runs when it finishes or is skipped. */
  startReplay(onEnd: () => void): boolean {
    const m = this.match; const goalT = m.lastGoalAt;
    const frames = this.rec.filter((f) => f.t >= goalT - 7 && f.t <= goalT + 1.8);
    if (frames.length < 30 || goalT < 0) return false;
    const t0 = Math.max(frames[0].t, goalT - 6);
    const gf = frames.reduce((a, f) => (Math.abs(f.t - goalT) < Math.abs(a.t - goalT) ? f : a));
    this.replay = { frames, tau: t0, t1: frames[frames.length - 1].t, goalT, side: Math.sign(gf.ball[0]) || 1, shot: -1, onEnd };
    this.reticle.visible = false; this.aimMark.visible = false;
    for (const tg of this.tags) tg.sprite.visible = false; if (this.bar) this.bar.bg.visible = this.bar.fill.visible = false; if (this.shown) this.shown.sprite.visible = false;
    return true;
  }
  /** End the replay now (skipped) and cut back to the match camera. */
  endReplay() {
    const r = this.replay; if (!r) return; this.replay = null;
    for (const h of this.humanoids.values()) h.root.visible = true;
    this.rig.snapBroadcast(new THREE.Vector3(this.match.ball.x, 0.1, this.match.ball.z));
    r.onEnd();
  }
  private playReplay(dt: number, time: number) {
    const r = this.replay!; const m = this.match;
    const rate = r.tau < r.goalT - 1.4 ? 1 : r.tau < r.goalT + 0.6 ? 0.4 : 0.75; // slow motion for the finish
    r.tau += dt * rate;
    if (r.tau >= r.t1) { this.endReplay(); return; }
    const F = r.frames; let i = 0; while (i < F.length - 2 && F[i + 1].t <= r.tau) i++;
    const A = F[i], B = F[i + 1]; const k = THREE.MathUtils.clamp((r.tau - A.t) / Math.max(1e-4, B.t - A.t), 0, 1);
    this.recAgents.forEach((a, j) => {
      const h = this.humanoids.get(a); const pa = A.agents[j], pb = B.agents[j]; if (!h) return;
      if (!pa || !pb) { h.root.visible = false; return; }
      h.root.visible = true;
      const x = pa[0] + (pb[0] - pa[0]) * k, z = pa[1] + (pb[1] - pa[1]) * k, ang = lerpAngle(pa[2], pb[2], k);
      h.place(x, z, Math.atan2(Math.cos(ang), Math.sin(ang)));
      unpackPose(pa, this.poseA); unpackPose(pb, this.poseB); h.applyPose(this.pose.lerp(this.poseA, this.poseB, k));
      h.setSelected(false, 0);
    });
    const bx = A.ball[0] + (B.ball[0] - A.ball[0]) * k, by = A.ball[1] + (B.ball[1] - A.ball[1]) * k, bz = A.ball[2] + (B.ball[2] - A.ball[2]) * k;
    const sp = Math.hypot(B.ball[0] - A.ball[0], B.ball[1] - A.ball[1], B.ball[2] - A.ball[2]) / Math.max(1e-3, B.t - A.t);
    if (sp > 0.3) this.ball.rotateOnWorldAxis(new THREE.Vector3(B.ball[2] - A.ball[2], 0, -(B.ball[0] - A.ball[0])).normalize(), (sp * dt * rate) / m.ball.radius);
    this.ball.position.set(bx, by, bz); this.ballShadow.position.set(bx, 0.034, bz);
    this.reticle.visible = false; this.aimMark.visible = false;
    // cameras: side-on and low, following the ball; then behind the goal for the finish
    const L = m.pitch.length, W = m.pitch.width; const sc = m.pitch.futsal ? 0.55 : 1;
    const ball = new THREE.Vector3(bx, by, bz);
    const shot = r.tau < r.goalT - 1.5 ? 0 : 1;
    let cam: THREE.Vector3, look: THREE.Vector3;
    if (shot === 0) { cam = new THREE.Vector3(bx - r.side * 9 * sc, 5.5 * sc + 1.5, Math.max(-W / 2 - 6, bz - 15 * sc)); look = ball.clone().setY(Math.max(0.6, by * 0.6)); }
    else { cam = new THREE.Vector3(r.side * (L / 2 + 10 * sc), 3.6 * sc + 1, THREE.MathUtils.clamp(bz * 0.35 + 3 * sc, -W / 2, W / 2)); look = ball.clone().setY(Math.max(0.8, by)); }
    if (shot !== r.shot) { r.shot = shot; this.rig.cutTo(cam, look); }
    this.rig.moveTo(dt, cam, look, 0.25, shot === 1 ? 0.7 : 0.8);
    m.controlBasis = groundBasis(this.stage.camera);
    this.stadium.update(dt, time, this.stage.camera);
    this.weather.update(dt, this.stage.camera.position, time);
  }

  /** FIFA-style free kick: the camera cuts to just behind the ball, over the taker's shoulder, looking at goal (or the way
   *  he's facing for one that can only be played in), and stays on the strike for a moment before blending back. The
   *  human's aim shows as a marker on the goal. Returns false when the broadcast camera should run. */
  private freeKickCamera(dt: number, ball: THREE.Vector3): boolean {
    const m = this.match; const lf = m.lastFreeKick;
    // a penalty is framed like a direct free kick (behind the taker, looking at goal, the aim on the goal)
    const pen = m.penalty && m.penalty.stage !== 'struck' ? m.penalty : null;
    if (pen && m.setPiece?.kind === 'penalty' && this.penFk?.src !== pen) this.penFk = { src: pen, fk: { team: pen.team, pos: { ...m.setPiece.pos }, direct: true, aim: pen.aim, dir: { x: m.teams[pen.team].attackDir, z: 0 }, taker: pen.taker } };
    const fk = m.freeKick ?? (pen && this.penFk?.src === pen ? this.penFk.fk : null);
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
