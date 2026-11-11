import * as THREE from 'three';
import { Rng } from '../../shared/rng';
import { skillFrame } from './skills';
import { B, Body, Pose, Rig, aimRotation, twoBone, worldColliders, sideSign, type Capsule, type Side } from './skeleton';
import type { Agent } from './player';

/** Per-player movement personality, derived from the card id: no two players run quite the same. */
export interface Style { stride: number; cadence: number; armSwing: number; elbow: number; upright: number; swagger: number; toeOut: number; bounce: number; armWidth: number; scan: number; }
export function styleFor(id: string): Style {
  const r = new Rng(`style:${id}`);
  return { stride: r.range(0.92, 1.1), cadence: r.range(0.94, 1.06), armSwing: r.range(0.8, 1.2), elbow: r.range(0.85, 1.2), upright: r.range(-0.05, 0.05), swagger: r.range(0, 1), toeOut: r.range(0.05, 0.22), bounce: r.range(0.8, 1.2), armWidth: r.range(0.8, 1.3), scan: r.range(1.1, 2.2) };
}

const V = () => new THREE.Vector3();
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const ease = (t: number) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fwdOf = (yaw: number, out: THREE.Vector3) => out.set(Math.sin(yaw), 0, Math.cos(yaw));
const leftOf = (yaw: number, out: THREE.Vector3) => out.set(Math.cos(yaw), 0, -Math.sin(yaw));
const angDiff = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

class Foot {
  pos = V(); yaw = 0;       // planted ankle position (world) and foot yaw
  swing = false; from = V(); to = V(); fromYaw = 0; toYaw = 0; t = 0; dur = 0.3;
  stanceT = 0;               // seconds since landing
}
interface FootTarget { pos: THREE.Vector3; yaw: number; pitch: number; roll: number; toe: number; }
interface ArmTarget { x: number; y: number; z: number; elbow: number; ik: THREE.Vector3 | null; ikW: number; }
interface Targets {
  pelvis: THREE.Vector3; pPitch: number; pRoll: number; pYaw: number;
  sPitch: number; sRoll: number; sYaw: number; headYaw: number; headPitch: number;
  foot: Record<Side, FootTarget>; arm: Record<Side, ArmTarget>;
}
const newTargets = (): Targets => ({
  pelvis: V(), pPitch: 0, pRoll: 0, pYaw: 0, sPitch: 0, sRoll: 0, sYaw: 0, headYaw: 0, headPitch: 0,
  foot: { L: { pos: V(), yaw: 0, pitch: 0, roll: 0, toe: 0 }, R: { pos: V(), yaw: 0, pitch: 0, roll: 0, toe: 0 } },
  arm: { L: { x: 0, y: 0, z: 0, elbow: 0, ik: null, ikW: 0 }, R: { x: 0, y: 0, z: 0, elbow: 0, ik: null, ikW: 0 } },
});

/** Procedural motion for one player: a planted-foot running gait with balance, plus actions driven by IK targets.
 *  It runs inside the simulation so the colliders used for ball contact are exactly the limbs that are drawn. */
export class Motion {
  readonly body: Body; readonly rig: Rig; readonly style: Style;
  pose = new Pose(); prev = new Pose();
  private feet: Record<Side, Foot> = { L: new Foot(), R: new Foot() };
  private phase = 0; private gaitOn = false;
  private lastX = 0; private lastZ = 0; private inited = false;
  private headYaw = 0; private headPitch = 0; private scanT = 0; private time = 0;
  private bob = 0; private crouch = 0;
  private caps: Capsule[] = []; private capsDirty = true;
  private T = newTargets();
  // scratch
  private q1 = new THREE.Quaternion(); private q2 = new THREE.Quaternion(); private q3 = new THREE.Quaternion(); private qw = new THREE.Quaternion();
  private e = new THREE.Euler(); private v1 = V(); private v2 = V(); private v3 = V(); private v4 = V(); private v5 = V(); private v6 = V();
  private mid = V(); private end = V(); private pole = V();
  private sc = new THREE.Vector3(); private pp = V();

  constructor(public agent: Agent) {
    this.body = new Body(agent.card.look.height / 1.8, agent.card.look.build);
    this.rig = new Rig(this.body); this.style = styleFor(agent.card.id);
  }

  /** World capsules for the current pose. */
  colliders(): Capsule[] { if (this.capsDirty) { worldColliders(this.rig, this.caps); this.capsDirty = false; } return this.caps; }
  ankle(side: Side, out = V()) { return this.rig.pos(side === 'L' ? B.footL : B.footR, out); }
  /** The striking surface of a foot (instep, slightly ahead of the ankle). */
  footPoint(side: Side, out = V()) { return this.rig.point(side === 'L' ? B.footL : B.footR, 0, -0.05 * this.body.h, 0.07 * this.body.h, out); }
  headPoint(out = V()) { return this.rig.point(B.head, 0, 0.11 * this.body.h, 0.02, out); }
  handPoint(side: Side, out = V()) { return this.rig.point(side === 'L' ? B.handL : B.handR, 0, -0.05 * this.body.h, 0, out); }

  private idealFoot(side: Side, x: number, z: number, yaw: number, width: number, out: THREE.Vector3) {
    leftOf(yaw, this.v6); return out.set(x + this.v6.x * sideSign(side) * width, this.body.ankleHeight, z + this.v6.z * sideSign(side) * width);
  }
  private reset(x: number, z: number, yaw: number) {
    for (const s of ['L', 'R'] as Side[]) { const f = this.feet[s]; this.idealFoot(s, x, z, yaw, 0.11 * this.body.h, f.pos); f.yaw = yaw + sideSign(s) * this.style.toeOut; f.swing = false; f.stanceT = 1; }
    this.gaitOn = false; this.inited = true;
  }

  /** Advance one simulation step. `ball` is the ball position (look target); actions carry their own IK targets in `action.data`. */
  update(dt: number, ball: { x: number; y: number; z: number }) {
    const a = this.agent; const h = this.body.h; const st = this.style;
    this.prev.copy(this.pose); this.time += dt;
    const x = a.pos.x, z = a.pos.z; const yaw = Math.atan2(a.heading.x, a.heading.z);
    if (!this.inited || Math.hypot(x - this.lastX, z - this.lastZ) > 2) this.reset(x, z, yaw);
    this.lastX = x; this.lastZ = z;
    const vx = a.vel.x, vz = a.vel.z; const sp = Math.hypot(vx, vz); const sf = clamp(sp / 9, 0, 1);
    const moveYaw = sp > 0.3 ? Math.atan2(vx, vz) : yaw;
    const act = a.action; const atype = act?.type;
    const jockey = !!a.intent.jockey && sp < 4.5;
    const carrying = a.hasBall;
    const T = this.T;

    /* ---------------- gait ---------------- */
    const steps = (1.8 + 2.1 * sf) * st.cadence;        // steps per second (≈3.7 at a sprint)
    const cycleHz = steps / 2;
    const running = sp > 2.2;
    // Ground-contact fraction of the stride, from how far the body may travel over a planted foot (a leg's reach):
    // ~0.6 walking, ~0.3 jogging, ~0.17 sprinting (about a tenth of a second per contact).
    const travel = (sp < 2.2 ? 0.85 : 0.78) * h;
    const duty = clamp((travel * steps) / (2 * Math.max(0.1, sp)), 0.16, 0.62);
    if (sp > 0.35) this.gaitOn = true;
    else if (sp < 0.2 && !this.feet.L.swing && !this.feet.R.swing) this.gaitOn = false;
    const frozen = atype === 'skill' || atype === 'slide' || atype === 'dive' || atype === 'fallen' || atype === 'header' || (atype === 'celebrate' && (act!.data?.style === 2 || ((act!.data?.style === 'slide' || act!.data?.style === 'leap') && act!.data?.ft >= 0)));
    if (this.gaitOn) this.phase = (this.phase + dt * cycleHz) % 1;
    const width = (jockey ? 0.2 : atype === 'celebrate' ? 0.12 : a.isGK && sp < 1 ? 0.16 : lerp(0.11, 0.05, sf)) * h * a.card.look.build;
    const stanceDur = duty / Math.max(0.5, cycleHz);
    for (const s of ['L', 'R'] as Side[]) {
      const f = this.feet[s]; const other = this.feet[s === 'L' ? 'R' : 'L'];
      const fp = (this.phase + (s === 'R' ? 0.5 : 0)) % 1;
      if (frozen) { f.swing = false; continue; }
      if (this.gaitOn) {
        const inSwing = fp >= duty;
        if (inSwing && !f.swing) { f.swing = true; f.from.copy(f.pos); f.fromYaw = f.yaw; f.t = 0; f.dur = (1 - duty) / cycleHz; }
        if (!inSwing && f.swing) { f.swing = false; f.pos.copy(f.to); f.yaw = f.toYaw; f.stanceT = 0; }
      } else if (!f.swing && !other.swing) {
        this.idealFoot(s, x, z, yaw, width, this.v1);
        if (Math.hypot(this.v1.x - f.pos.x, this.v1.z - f.pos.z) > 0.2 * h || Math.abs(angDiff(f.yaw, yaw)) > 0.75) { f.swing = true; f.from.copy(f.pos); f.fromYaw = f.yaw; f.t = 0; f.dur = 0.26; }
      }
      if (f.swing) {
        f.t += dt;
        // time to touchdown from the live gait phase (stays right while the cadence changes)
        const remain = this.gaitOn ? (1 - fp) / Math.max(0.5, cycleHz) : Math.max(0, f.dur - f.t);
        if (this.gaitOn) f.dur = f.t + remain;
        // re-predict the landing spot so the foot goes where the body will be
        if (this.gaitOn) {
          const lead = remain + stanceDur * 0.5;
          leftOf(jockey ? yaw : moveYaw, this.v2);
          f.to.set(x + vx * lead + this.v2.x * sideSign(s) * width, this.body.ankleHeight, z + vz * lead + this.v2.z * sideSign(s) * width);
          const strafe = Math.abs(angDiff(moveYaw, yaw)) > 0.7;
          f.toYaw = (strafe ? yaw : moveYaw) + sideSign(s) * st.toeOut * (1 + st.swagger * 0.4);
        } else {
          this.idealFoot(s, x, z, yaw, width, f.to); f.toYaw = yaw + sideSign(s) * st.toeOut;
          if (f.t >= f.dur) { f.swing = false; f.pos.copy(f.to); f.yaw = f.toYaw; f.stanceT = 0; }
        }
      } else f.stanceT += dt;
    }

    /* ---------------- locomotion targets ---------------- */
    // leg "forwardness" for arm swing and pelvis twist: +1 when that leg is out in front
    const legFwd = (s: Side) => {
      const f = this.feet[s];
      if (f.swing) return lerp(-1, 1, ease(f.t / Math.max(0.05, f.dur)));
      if (!this.gaitOn) return 0;
      return lerp(1, -1, clamp(f.stanceT / Math.max(0.05, stanceDur), 0, 1));
    };
    const fL = legFwd('L'), fR = legFwd('R');
    // pelvis height, bob and crouch
    const crouchT = (0.015 + 0.05 * sf) * h + (jockey ? 0.09 * h : 0) + (a.isGK && sp < 2 ? 0.1 * h : 0) + (carrying ? 0.02 * h : 0);
    this.crouch += (crouchT - this.crouch) * Math.min(1, dt * 8);
    const bobAmp = (running ? 0.012 + 0.032 * sf : 0.014) * h * st.bounce;
    const bobWave = Math.cos(4 * Math.PI * (this.phase - duty / 2));
    const bobT = this.gaitOn ? (running ? -bobAmp * bobWave : bobAmp * bobWave) : Math.sin(this.time * 2.2) * 0.004 * h;
    this.bob += (bobT - this.bob) * Math.min(1, dt * 20);
    const stanceSide: Side = this.feet.L.swing ? 'R' : 'L';
    const sway = (this.gaitOn ? (running ? 0.008 : 0.025) * (1 + st.swagger) : Math.sin(this.time * 0.9) * 0.012 * st.swagger) * h * sideSign(stanceSide);
    T.pelvis.set(sway, this.body.pelvisHeight - this.crouch + this.bob, 0);
    const lean = 0.04 + 0.11 * sf + clamp(a.accelFwd * 0.018, -0.12, 0.16) + st.upright + (jockey ? 0.18 : 0) + (a.isGK && sp < 2 ? 0.2 : 0);
    const bank = clamp(a.accelLat * 0.03, -0.3, 0.3);
    T.pPitch = lean * 0.35; T.pRoll = bank * 0.6 + (this.gaitOn ? 0.04 * sideSign(stanceSide) * (1 - sf) : 0);
    T.pYaw = -0.14 * (0.3 + sf) * (fL - fR) * 0.5 * (this.gaitOn ? 1 : 0) + (jockey ? 0 : 0);
    T.sPitch = lean * 0.65 + (carrying ? 0.07 : 0); T.sRoll = bank * 0.5 - (this.gaitOn ? 0.03 * st.swagger * sideSign(stanceSide) : 0);
    T.sYaw = 0.2 * (0.3 + sf) * (fL - fR) * 0.5 * (this.gaitOn ? 1 : 0) * (1 + st.swagger * 0.3);
    // feet
    for (const s of ['L', 'R'] as Side[]) {
      const f = this.feet[s]; const ft = T.foot[s];
      if (f.swing && !frozen) {
        const u = clamp(f.t / Math.max(0.05, f.dur), 0, 1); const e = ease(u);
        ft.pos.lerpVectors(f.from, f.to, e);
        const lift = (this.gaitOn ? 0.045 + 0.2 * sf : 0.06) * h * st.stride;
        ft.pos.y = this.body.ankleHeight + lift * Math.sin(Math.PI * Math.min(1, u * 1.15));
        // sprinting: the heel kicks up behind before the knee drives through
        const recover = this.gaitOn ? 0.3 * sf * sf * h * st.stride : 0; const k = Math.sin(Math.PI * u) * (1 - u) * 1.6;
        fwdOf(moveYaw, this.v1); ft.pos.addScaledVector(this.v1, -recover * k); ft.pos.y += recover * 0.7 * k;
        ft.yaw = f.fromYaw + angDiff(f.fromYaw, f.toYaw) * e; ft.pitch = lerp(-0.7 * sf - 0.15, 0.25 * sf, u); ft.toe = 0;
      } else {
        ft.pos.copy(f.pos); ft.yaw = f.yaw; ft.pitch = 0; ft.toe = 0;
        if (this.gaitOn) {
          const k = clamp(f.stanceT / Math.max(0.05, stanceDur), 0, 1);
          const strike = clamp(1 - k / 0.2, 0, 1) * 0.18 * sf;          // heel strike: toe up
          const toeOff = clamp((k - 0.62) / 0.38, 0, 1) * (0.35 + sf);    // toe-off: heel up
          ft.pitch = strike - 0.75 * toeOff; ft.pos.y += 0.1 * h * toeOff; ft.toe = 0.6 * toeOff;
          fwdOf(ft.yaw, this.v1); ft.pos.addScaledVector(this.v1, 0.04 * h * toeOff);
        }
      }
      ft.roll = 0;
    }
    // arms
    const amp = (0.22 + 0.9 * sf) * st.armSwing * (this.gaitOn ? 1 : 0);
    for (const s of ['L', 'R'] as Side[]) {
      const ar = T.arm[s]; const sg = sideSign(s);
      ar.x = amp * (s === 'L' ? fL : fR) - (carrying ? 0.15 : 0);
      ar.z = sg * ((0.1 + 0.08 * sf) * st.armWidth + (carrying || jockey ? 0.3 : 0) + (a.isGK && sp < 2 ? 0.5 : 0));
      ar.y = -sg * 0.15 * sf; ar.elbow = (0.25 + 1.25 * sf) * st.elbow + (a.isGK && sp < 2 ? 0.7 : 0) + (jockey ? 0.4 : 0);
      ar.ik = null; ar.ikW = 0;
      if (!this.gaitOn && st.swagger > 0.7 && !a.isGK && atype !== 'celebrate') { ar.x = 0.25; ar.z = sg * 0.75; ar.elbow = 1.7; } // hands on hips
    }
    // head: watch the ball, keep the eyes level; dribblers glance up to scan
    this.scanT += dt;
    let lookX = ball.x, lookY = ball.y, lookZ = ball.z;
    if (carrying && (this.scanT % st.scan) > st.scan - 0.45) { fwdOf(yaw, this.v1); lookX = x + this.v1.x * 20; lookY = 1.6; lookZ = z + this.v1.z * 20; }
    const dx = lookX - x, dz = lookZ - z; const dist = Math.max(0.5, Math.hypot(dx, dz));
    const wantYaw = clamp(angDiff(yaw, Math.atan2(dx, dz)), -1.2, 1.2);
    const wantPitch = clamp(Math.atan2(1.6 * h - lookY, dist) - (T.pPitch + T.sPitch) * 0.8, -0.5, 0.75);
    this.headYaw += (wantYaw - this.headYaw) * Math.min(1, dt * 7); this.headPitch += (wantPitch - this.headPitch) * Math.min(1, dt * 7);
    T.headYaw = this.headYaw; T.headPitch = this.headPitch;

    /* ---------------- actions ---------------- */
    if (act) this.applyAction(act, T, x, z, yaw, sp, dt);
    else if (a.isGK && !a.hasBall && sp < 2) { /* ready stance handled by crouch/arms above */ }

    /* ---------------- solve ---------------- */
    this.solve(T, x, z, yaw);
  }

  private applyAction(act: NonNullable<Agent['action']>, T: Targets, x: number, z: number, yaw: number, sp: number, dt: number) {
    const h = this.body.h; const d = act.data ?? {}; const t = act.t, dur = act.duration;
    const fw = fwdOf(yaw, this.v3), lw = leftOf(yaw, this.v4);
    const fadeOut = (start: number) => 1 - ease((t - start) / Math.max(0.01, dur - start));
    const contact = d.contact as { x: number; y: number; z: number } | undefined;
    switch (act.type) {
      case 'kick': {
        if (d.keeperThrow) {
          // a keeper's throw: an underarm bowl along the floor, or an overarm sling over the top
          const k = clamp(t / Math.max(0.05, dur), 0, 1); const ts = d.strike ?? 0.2; const sw = t < ts ? ease(t / ts) : 1;
          const arm = T.arm[d.side === 'L' ? 'L' : 'R'];
          if (d.keeperThrow === 'roll') { arm.x = lerp(0.9, -1.1, sw); arm.z = sideSign(d.side === 'L' ? 'L' : 'R') * 0.2; arm.elbow = 0.25; T.pelvis.y -= 0.18 * h * Math.sin(Math.PI * k); T.sPitch = lerp(T.sPitch, 0.55, Math.sin(Math.PI * k)); }
          else { arm.x = lerp(-0.2, -3.0, sw) + (t > ts ? (t - ts) * 4 : 0); arm.z = sideSign(d.side === 'L' ? 'L' : 'R') * lerp(0.9, 0.3, sw); arm.elbow = lerp(1.6, 0.1, sw); T.sPitch = lerp(T.sPitch, lerp(-0.25, 0.3, sw), 0.8); }
          break;
        }
        const side: Side = d.side ?? 'R'; const plant: Side = side === 'L' ? 'R' : 'L';
        const dir = d.dir ? this.v1.set(d.dir.x, 0, d.dir.z).normalize() : this.v1.copy(fw);
        const left = this.v2.set(dir.z, 0, -dir.x); // left of the kick direction
        const c = contact ? this.v5.set(contact.x, contact.y, contact.z) : this.v5.set(x + fw.x * 0.5, 0.11, z + fw.z * 0.5);
        const ts = d.strike ?? 0.17; const shot = d.kind === 'shoot'; const lob = d.kind === 'lob'; const side_ = d.kind === 'pass' || d.kind === 'through';
        const w = t < 0.06 ? ease(t / 0.06) : fadeOut(ts + 0.18);
        // plant foot beside and slightly behind the ball
        const pf = T.foot[plant]; const plantPos = this.v6.copy(c).addScaledVector(dir, -0.12 * h).addScaledVector(left, sideSign(plant) * 0.23 * h); plantPos.y = this.body.ankleHeight;
        const pk = ease(t / (ts * 0.7)); pf.pos.lerp(plantPos, w * pk); pf.pos.y += Math.sin(Math.PI * clamp(t / (ts * 0.7), 0, 1)) * 0.08 * h * w;
        pf.yaw = lerp(pf.yaw, Math.atan2(dir.x, dir.z), w); pf.pitch *= 1 - w;
        // kicking foot: back-swing, strike through the ball, follow-through
        const kf = T.foot[side]; const sg = sideSign(side);
        const back = this.pp.copy(c).addScaledVector(dir, -(shot ? 0.5 : 0.32) * h).addScaledVector(left, sg * 0.08 * h); back.y = (shot ? 0.42 : lob ? 0.35 : 0.22) * h;
        const hit = V().copy(c).addScaledVector(dir, -0.1 * h).addScaledVector(left, sg * (side_ ? 0.13 : 0.03) * h); hit.y = Math.max(this.body.ankleHeight, c.y - 0.01);
        const follow = V().copy(c).addScaledVector(dir, (shot ? 0.6 : 0.32) * h); follow.y = (shot ? 0.62 : lob ? 0.55 : 0.25) * h;
        let p: THREE.Vector3;
        if (t < ts * 0.6) p = V().lerpVectors(kf.pos, back, ease(t / (ts * 0.6)));
        else if (t < ts) p = V().lerpVectors(back, hit, Math.pow((t - ts * 0.6) / (ts * 0.4), 1.6));
        else p = V().lerpVectors(hit, follow, ease((t - ts) / 0.16));
        kf.pos.lerp(p, w);
        const kyaw = Math.atan2(dir.x, dir.z) + (side_ ? sg * 1.1 : 0);
        kf.yaw = lerp(kf.yaw, kyaw, w); kf.pitch = lerp(kf.pitch, side_ ? -0.1 : -0.85, w);
        // hips open on the back-swing and close through the ball; lean over a driven ball, back for a lob
        const swing = t < ts ? ease(t / ts) : 1 - ease((t - ts) / 0.25);
        T.pYaw += w * sg * (t < ts ? 0.35 * swing : -0.3 * (1 - swing));
        T.pelvis.y -= 0.05 * h * w;
        T.sPitch = lerp(T.sPitch, lob ? -0.12 : shot ? 0.2 : 0.12, w); T.sRoll = lerp(T.sRoll, sideSign(plant) * -0.16, w);
        const pa = T.arm[plant], ka = T.arm[side];
        pa.x = lerp(pa.x, -0.5, w); pa.z = lerp(pa.z, sideSign(plant) * 1.15, w); pa.elbow = lerp(pa.elbow, 0.4, w);
        ka.x = lerp(ka.x, 0.55, w); ka.z = lerp(ka.z, sg * 0.55, w);
        break;
      }
      case 'touch': case 'trap': {
        if (!contact) break;
        const side: Side = d.side ?? 'R'; const sg = sideSign(side);
        const tc = d.tc ?? 0.09; const w = t < tc ? ease(t / tc) : 1 - ease((t - tc) / Math.max(0.05, dur - tc));
        const f = T.foot[side]; const c = this.v5.set(contact.x, contact.y, contact.z);
        const mv = sp > 0.3 ? this.v1.set(this.agent.vel.x, 0, this.agent.vel.z).normalize() : this.v1.copy(fw);
        const part = d.part ?? 'foot';
        if (part === 'hands') {
          for (const s2 of ['L', 'R'] as Side[]) { const ar = T.arm[s2]; ar.ik = V().set(c.x + lw.x * sideSign(s2) * 0.1, c.y, c.z + lw.z * sideSign(s2) * 0.1); ar.ikW = w; }
          T.sPitch = lerp(T.sPitch, c.y < 0.6 ? 0.6 : 0.15, w); T.pelvis.y -= (c.y < 0.6 ? 0.25 * h : 0) * w;
          break;
        }
        if (part === 'chest') { T.sPitch = lerp(T.sPitch, -0.35, w); T.arm.L.z += 0.8 * w; T.arm.R.z -= 0.8 * w; T.headPitch = lerp(T.headPitch, 0.5, w); break; }
        if (part === 'thigh') { const hip = this.v6.set(x, 0, z).addScaledVector(lw, sg * 0.1 * h).addScaledVector(fw, 0.28 * h); hip.y = 0.62 * h; f.pos.lerp(hip, w); f.pitch = lerp(f.pitch, -0.6, w); break; }
        // inside of the foot to the ball
        const tgt = this.v6.copy(c).addScaledVector(mv, -0.09 * h).addScaledVector(lw, sg * 0.06 * h);
        tgt.y = Math.max(this.body.ankleHeight, c.y - 0.02);
        f.pos.lerp(tgt, w); f.yaw = lerp(f.yaw, Math.atan2(mv.x, mv.z) + sg * 0.7, w); f.pitch = lerp(f.pitch, act.type === 'trap' ? 0.25 : 0, w);
        T.sPitch += 0.08 * w; T.headPitch = lerp(T.headPitch, 0.6, w * 0.6);
        break;
      }
      case 'tackle': {
        const side: Side = d.side ?? 'R'; const sg = sideSign(side);
        const lunge = t < 0.32 ? ease(t / 0.32) : fadeOut(0.42);
        const f = T.foot[side];
        const tgt = contact ? this.v5.set(contact.x, Math.max(this.body.ankleHeight, contact.y - 0.03), contact.z) : this.v5.set(x + fw.x * 0.9 * h, this.body.ankleHeight, z + fw.z * 0.9 * h);
        // reach is limited by the leg: keep the target within ~1 m of the hip
        const hip = this.v6.set(x, 0.9 * h, z); const rv = this.v2.subVectors(tgt, hip); const rl = rv.length(); if (rl > 1.05 * h) tgt.copy(hip).addScaledVector(rv, (1.05 * h) / rl);
        f.pos.lerp(tgt, lunge); f.yaw = lerp(f.yaw, yaw + sg * 0.6, lunge); f.pitch = lerp(f.pitch, 0.1, lunge);
        T.pelvis.y -= 0.2 * h * lunge; T.sPitch = lerp(T.sPitch, 0.42, lunge); T.pPitch += 0.15 * lunge;
        T.arm.L.z = lerp(T.arm.L.z, 0.9, lunge); T.arm.R.z = lerp(T.arm.R.z, -0.9, lunge); T.arm[side].x = lerp(T.arm[side].x, 0.4, lunge);
        break;
      }
      case 'slide': {
        const side: Side = d.side ?? 'R'; const sg = sideSign(side);
        const down = ease(t / 0.16); const up = t > 0.75 ? ease((t - 0.75) / Math.max(0.1, dur - 0.75)) : 0; const k = down * (1 - up);
        T.pelvis.y = lerp(T.pelvis.y, 0.24 * h, k); T.pelvis.z -= 0.15 * h * k;
        T.pPitch = lerp(T.pPitch, -0.85, k); T.sPitch = lerp(T.sPitch, 0.35, k); T.headPitch = lerp(T.headPitch, 0.3, k);
        const lead = T.foot[side], trail = T.foot[side === 'L' ? 'R' : 'L'];
        const ahead = contact && Math.hypot(contact.x - x, contact.z - z) < 1.3 * h ? this.v5.set(contact.x, this.body.ankleHeight, contact.z) : this.v5.set(x + fw.x * 0.95 * h, this.body.ankleHeight, z + fw.z * 0.95 * h);
        lead.pos.lerp(ahead, k); lead.pitch = lerp(lead.pitch, 0.3, k); lead.yaw = lerp(lead.yaw, yaw + sg * 0.4, k);
        const under = this.v6.set(x + fw.x * 0.1 * h - lw.x * sg * 0.12 * h, this.body.ankleHeight, z + fw.z * 0.1 * h - lw.z * sg * 0.12 * h);
        trail.pos.lerp(under, k); trail.pitch = lerp(trail.pitch, -0.6, k);
        const arm = T.arm[side === 'L' ? 'R' : 'L']; arm.ik = V().set(x - fw.x * 0.3 * h - lw.x * sg * 0.3 * h, 0.05, z - fw.z * 0.3 * h - lw.z * sg * 0.3 * h); arm.ikW = k;
        T.arm[side].x = lerp(T.arm[side].x, -0.8, k); T.arm[side].z = lerp(T.arm[side].z, sg * 0.9, k);
        break;
      }
      case 'skill': {
        // the move's own keys for both feet, the lean and the crouch, blended in and out of the run so moves flow
        const u = clamp(t / Math.max(0.05, dur), 0, 1); const fr = skillFrame(d, u);
        const w = Math.min(ease(t / 0.09), ease((dur - t) / 0.1));
        const sS: Side = d.side > 0 ? 'R' : 'L', sO: Side = d.side > 0 ? 'L' : 'R';
        for (const [s, fp] of [[sS, fr.footS], [sO, fr.footO]] as const) {
          const foot = this.feet[s]; const tgt = this.v6.set(fp.x, this.body.ankleHeight + fp.y, fp.z);
          foot.pos.lerp(tgt, Math.max(w, 0.35)); foot.yaw = yaw + sideSign(s) * 0.15; foot.stanceT = 0;
          T.foot[s].pos.copy(foot.pos); T.foot[s].yaw = foot.yaw; T.foot[s].pitch = fp.y > 0.14 ? -0.25 : fp.y > 0.04 ? 0.2 : 0;
        }
        T.pRoll += fr.roll * 0.55 * w; T.sRoll += fr.roll * 0.35 * w; T.pelvis.y -= fr.crouch * w; T.sPitch += fr.pitch * w; T.pPitch += 0.06 * w;
        for (const s of ['L', 'R'] as Side[]) { const ar = T.arm[s]; ar.z = lerp(ar.z, sideSign(s) * (0.5 + 0.5 * Math.abs(fr.roll)), w); ar.x = lerp(ar.x, -0.35 + 0.25 * Math.sin(this.time * 7 + (s === 'L' ? 0 : Math.PI)), w); ar.elbow = lerp(ar.elbow, 0.55, w); }
        T.headPitch = lerp(T.headPitch, 0.35, 0.6 * w); // eyes on the ball
        break;
      }
      case 'header': {
        const j = Math.sin(Math.PI * clamp(t / dur, 0, 1));
        if (d.wall) {
          // a free-kick wall jumping together: straight up, arms tucked in front, chin down
          T.pelvis.y += 0.17 * h * j;
          for (const s of ['L', 'R'] as Side[]) { const f = T.foot[s]; f.pos.set(x + lw.x * sideSign(s) * 0.1 * h, T.pelvis.y - 0.6 * h, z + lw.z * sideSign(s) * 0.1 * h); f.pitch = -0.5 * j; }
          T.arm.L.x = -0.35; T.arm.R.x = -0.35; T.arm.L.z = 0.15; T.arm.R.z = -0.15; T.arm.L.elbow = T.arm.R.elbow = 1.4; T.arm.L.ik = T.arm.R.ik = null;
          T.headPitch = lerp(T.headPitch, 0.35, 0.8);
          break;
        }
        const lift = typeof d.jump === 'number' ? d.jump * j : 0.38 * h * j; // (as high as the ball needs)
        T.pelvis.y += lift;
        for (const s of ['L', 'R'] as Side[]) { const f = T.foot[s]; f.pos.set(x - fw.x * 0.12 * h + lw.x * sideSign(s) * 0.12 * h, Math.max(this.body.ankleHeight, T.pelvis.y - 0.62 * h), z - fw.z * 0.12 * h + lw.z * sideSign(s) * 0.12 * h); f.pitch = lift > 0.05 ? -0.6 : 0; }
        const snap = t / dur < 0.4 ? -0.35 * ease(t / (dur * 0.4)) : -0.35 + 0.85 * ease((t / dur - 0.4) / 0.25);
        T.sPitch = snap; T.headPitch = lerp(T.headPitch, snap * 0.6 + 0.1, 0.8);
        T.arm.L.x = -0.7; T.arm.R.x = -0.7; T.arm.L.z = 1.0; T.arm.R.z = -1.0; T.arm.L.elbow = T.arm.R.elbow = 1.1;
        break;
      }
      case 'dive': {
        // load (a dip and a push-off step), launch (body rotates toward horizontal, rising for a high ball, arms at full
        // stretch to the ball), then land and get up
        const sideW = d.side ?? 1; // +1 = player's left
        const fl = Math.max(0.12, d.flight ?? 0.35);
        const load = clamp(t / 0.1, 0, 1); const go = ease(clamp((t - 0.06) / Math.max(0.1, fl - 0.06), 0, 1));
        const land = t > fl + 0.12 ? ease(clamp((t - fl - 0.12) / 0.3, 0, 1)) : 0;
        const up = t > fl + 0.75 ? ease(clamp((t - fl - 0.75) / Math.max(0.1, dur - fl - 0.75), 0, 1)) : 0;
        const kk = go * (1 - up);
        const ballY = (d.hands?.y ?? d.high ?? 1) as number;
        const high = clamp((ballY - 0.6) / 1.6, 0, 1); // 0 = along the ground, 1 = top corner
        const dip = Math.sin(Math.PI * load) * (1 - go);
        T.pelvis.y = lerp(T.pelvis.y, T.pelvis.y - 0.12 * h, dip);
        // the hips go to about a body-width below the ball: low dives skim the turf, high ones are a real leap
        const lat = clamp(((d.lat ?? 1.2) as number) / 1.2, 0.15, 1); // how far to the side: a ball over his head is an upright leap
        const flightY = clamp(ballY - lerp(0.75, 0.32, lat), 0.22 * h, 1.35 * h);
        T.pelvis.y = lerp(T.pelvis.y, lerp(flightY, 0.2 * h, land), kk);
        T.pelvis.x += sideW * 0.5 * h * kk * lat;
        T.pRoll = lerp(T.pRoll, -sideW * lerp(1.45, 0.85, high) * lat, kk); // flat along the ground, more upright for a high ball T.sRoll = lerp(T.sRoll, -sideW * 0.2, kk); T.sPitch = lerp(T.sPitch, 0.05, kk);
        T.headPitch = lerp(T.headPitch, -0.15, kk);
        const tgt = d.hands as { x: number; y: number; z: number } | undefined;
        for (const s2 of ['L', 'R'] as Side[]) {
          const ar = T.arm[s2];
          if (tgt) { ar.ik = V().set(tgt.x + lw.x * sideSign(s2) * 0.08, tgt.y, tgt.z + lw.z * sideSign(s2) * 0.08); ar.ikW = kk * (1 - land * 0.6); }
          else { ar.z = lerp(ar.z, sideSign(s2) * 2.6, kk); }
        }
        // the far leg drives off, the near leg trails
        for (const s2 of ['L', 'R'] as Side[]) {
          const f = T.foot[s2]; const trail = sideSign(s2) === sideW ? 0.55 : 1.0;
          f.pos.lerp(this.v6.set(x - lw.x * sideW * 0.8 * h * trail + fw.x * sideSign(s2) * 0.12, this.body.ankleHeight + lerp(0.2, 0.45, high) * h * (1 - land), z - lw.z * sideW * 0.8 * h * trail + fw.z * sideSign(s2) * 0.12), kk);
        }
        break;
      }
      case 'fallen': case 'stumble': {
        if (act.type === 'stumble') { const k = Math.sin(Math.PI * clamp(t / dur, 0, 1)); T.pPitch += 0.35 * k; T.sPitch += 0.25 * k; T.arm.L.z += 0.9 * k; T.arm.R.z -= 0.9 * k; T.arm.L.x -= 0.8 * k; T.arm.R.x -= 0.5 * k; break; }
        const down = ease(t / 0.22); const up = t > dur * 0.7 ? ease((t - dur * 0.7) / (dur * 0.3)) : 0; const k = down * (1 - up);
        T.pelvis.y = lerp(T.pelvis.y, 0.2 * h, k); T.pelvis.z += 0.2 * h * k;
        T.pPitch = lerp(T.pPitch, 1.3, k); T.sPitch = lerp(T.sPitch, 0.15, k); T.headPitch = lerp(T.headPitch, -0.5, k);
        for (const s of ['L', 'R'] as Side[]) {
          const f = T.foot[s]; f.pos.lerp(this.v6.set(x - fw.x * 0.85 * h + lw.x * sideSign(s) * 0.15, this.body.ankleHeight, z - fw.z * 0.85 * h + lw.z * sideSign(s) * 0.15), k); f.pitch = lerp(f.pitch, -1.2, k);
          const ar = T.arm[s]; ar.ik = V().set(x + fw.x * 0.55 * h + lw.x * sideSign(s) * 0.3, 0.05, z + fw.z * 0.55 * h + lw.z * sideSign(s) * 0.3); ar.ikW = k;
        }
        break;
      }
      case 'celebrate': {
        // (showcase poses pass a numbered style: a finished celebration)
        const legacy = typeof d.style === 'number';
        const role: string = d.role ?? 'scorer';
        const style: string = legacy ? ['plane', 'pump', 'slide', 'leap'][d.style % 4] : d.style ?? 'pump';
        const ft: number = legacy ? 0 : d.ft ?? -1; const u = ft >= 0 ? t - ft : -1; const tt = this.time;
        const arm = (s: Side, ax: number, az: number, el: number, k = 1) => { const ar = T.arm[s]; ar.x = lerp(ar.x, ax, k); ar.z = lerp(ar.z, sideSign(s) * az, k); ar.elbow = lerp(ar.elbow, el, k); ar.ik = null; ar.ikW = 0; };
        const main: Side = act.dir > 0 ? 'R' : 'L'; const off: Side = main === 'R' ? 'L' : 'R';
        if (role === 'scorer') {
          if (u < 0) {
            // the run away: arms already going
            if (style === 'plane') { arm('L', -0.1, 1.45, 0.08); arm('R', -0.1, 1.45, 0.08); }
            else if (style === 'leap') { arm(main, -2.75, 0.15, 0.12); T.headPitch = lerp(T.headPitch, -0.3, 0.6); }
            else if (style === 'slide') { arm('L', -1.0 + Math.sin(tt * 9) * 0.3, 0.85, 0.5); arm('R', -1.0 - Math.sin(tt * 9) * 0.3, 0.85, 0.5); T.headPitch = lerp(T.headPitch, -0.2, 0.5); }
            else { arm(main, -1.9, 0.35, 2.2); T.headPitch = lerp(T.headPitch, -0.25, 0.5); }
            break;
          }
          if (style === 'slide') {
            // down on the knees and sliding, leaning back, arms flung wide; then fists clenched, roaring
            const k = ease(u / 0.2);
            T.pelvis.y = lerp(T.pelvis.y, 0.5 * h, k); T.pelvis.z -= 0.05 * h * k;
            for (const s of ['L', 'R'] as Side[]) { const f = T.foot[s]; f.pos.lerp(this.v6.set(x - fw.x * 0.43 * h + lw.x * sideSign(s) * 0.13 * h, this.body.ankleHeight, z - fw.z * 0.43 * h + lw.z * sideSign(s) * 0.13 * h), k); f.pitch = lerp(f.pitch, -1.45, k); }
            const back = u < 1.4 ? 1 : Math.max(0.35, 1 - (u - 1.4) * 0.8);
            T.pPitch = lerp(T.pPitch, -0.25 * back, k); T.sPitch = lerp(T.sPitch, -0.55 * back, k); T.headPitch = lerp(T.headPitch, -0.55 * back, k);
            if (u < 1.4) { arm('L', -2.2, 1.05, 0.15, k); arm('R', -2.2, 1.05, 0.15, k); }
            else { const p = 0.5 + 0.5 * Math.sin((u - 1.4) * 9); arm('L', -1.35 - p * 0.3, 0.75, 2.1); arm('R', -1.35 - p * 0.3, 0.75, 2.1); T.sPitch = lerp(T.sPitch, 0.1, 0.5); }
          } else if (style === 'pump') {
            // feet planted wide, knees bent, two hard fist pumps down to the hip, then the roar with both fists clenched
            const k = ease(u / 0.15);
            T.pelvis.y -= 0.12 * h * k; T.sPitch = lerp(T.sPitch, 0.3, k); T.headPitch = lerp(T.headPitch, -0.3, k);
            const pumps = u < 1.1; const ph = (u % 0.55) / 0.55; const pull = ph < 0.35 ? ease(ph / 0.35) : 1 - ease((ph - 0.35) / 0.65);
            if (pumps) { arm(main, lerp(-2.3, -0.45, pull), 0.3, lerp(2.3, 1.5, pull)); arm(off, 0.35, 0.55, 0.6); T.sPitch += 0.15 * pull; T.pelvis.y -= 0.04 * h * pull; }
            else { const kk = ease((u - 1.1) / 0.25); arm('L', -1.25, 1.0, 2.2, kk); arm('R', -1.25, 1.0, 2.2, kk); T.sPitch = lerp(T.sPitch, -0.15, kk); T.headPitch = lerp(T.headPitch, -0.45, kk); }
          } else if (style === 'leap') {
            // a jump with a punch at the sky at the top, then arms up in a V
            const jt = 0.62; const j = u < jt ? Math.sin(Math.PI * u / jt) : 0;
            if (u < jt) {
              T.pelvis.y += 0.4 * h * j;
              for (const s of ['L', 'R'] as Side[]) { const f = T.foot[s]; f.pos.set(x - fw.x * 0.12 * h + lw.x * sideSign(s) * 0.11 * h, T.pelvis.y - (0.82 - 0.25 * j) * h, z - fw.z * 0.12 * h + lw.z * sideSign(s) * 0.11 * h); f.pitch = -0.7 * j; }
              arm(main, lerp(-1.6, -3.05, j), 0.12, lerp(2.0, 0.0, j)); arm(off, -0.9, 0.5, 1.6); T.headPitch = -0.5 * j; T.sPitch = -0.2 * j;
            } else { const kk = ease((u - jt) / 0.25); arm('L', -2.55, 0.55, 0.2, kk); arm('R', -2.55, 0.55, 0.2, kk); T.headPitch = lerp(T.headPitch, -0.45, kk); T.sPitch = lerp(T.sPitch, -0.2, kk); }
          } else {
            // the airplane run ends with both arms pointing to the sky
            const kk = ease(u / 0.35); arm('L', lerp(-0.1, -2.85, kk), lerp(1.45, 0.3, kk), 0.1); arm('R', lerp(-0.1, -2.85, kk), lerp(1.45, 0.3, kk), 0.1); T.headPitch = lerp(T.headPitch, -0.55, kk);
          }
        } else if (role === 'mate') {
          // running in with arms up, then arms round the scorer
          if (d.near) { arm('L', -1.5, -0.05, 1.05, 0.6); arm('R', -1.5, -0.05, 1.05, 0.6); T.sPitch = lerp(T.sPitch, 0.2, 0.5); T.headPitch = lerp(T.headPitch, 0.1, 0.5); }
          else if (t > (d.delay ?? 0)) { arm('L', -2.4, 0.55, 0.35); arm('R', -2.4, 0.55, 0.35); T.headPitch = lerp(T.headPitch, -0.2, 0.5); }
        } else {
          // dejected: hands on head, hands on hips, or bent over with hands on knees
          const k = ease(t / 0.6); const v = d.variant ?? 0;
          if (v === 0) { arm('L', -2.35, 1.05, 2.45, k); arm('R', -2.35, 1.05, 2.45, k); T.headPitch = lerp(T.headPitch, -0.35, k); }
          else if (v === 1) { arm('L', 0.35, 0.8, 1.75, k); arm('R', 0.35, 0.8, 1.75, k); T.headPitch = lerp(T.headPitch, 0.55, k); }
          else {
            T.pelvis.y -= 0.14 * h * k; T.pPitch = lerp(T.pPitch, 0.45, k); T.sPitch = lerp(T.sPitch, 0.45, k); T.headPitch = lerp(T.headPitch, 0.1, k);
            for (const s of ['L', 'R'] as Side[]) { const ar = T.arm[s]; ar.ik = V().set(x + fw.x * 0.28 * h + lw.x * sideSign(s) * 0.16 * h, 0.5 * h, z + fw.z * 0.28 * h + lw.z * sideSign(s) * 0.16 * h); ar.ikW = k; }
          }
        }
        break;
      }
      case 'throw': {
        const k = clamp(t / dur, 0, 1);
        for (const s of ['L', 'R'] as Side[]) { const ar = T.arm[s]; ar.x = lerp(-2.9, -1.0, ease(k)); ar.z = sideSign(s) * 0.25; ar.elbow = lerp(1.4, 0.2, ease(k)); }
        T.sPitch = lerp(-0.3, 0.25, ease(k));
        break;
      }
    }
    void dt;
  }

  /** Build the pose from targets: pelvis/spine/head by angle, legs and (optionally) arms by IK. */
  private solve(T: Targets, x: number, z: number, yaw: number) {
    const a = this.agent; const p = this.pose; const rig = this.rig; const body = this.body; const h = body.h;
    rig.setRoot(x, z, yaw);
    // keeper holding the ball: hands to the ball
    if (a.isGK && a.hasBall && a.action?.type !== 'kick' && a.action?.type !== 'dive') {
      const bx = x + Math.sin(yaw) * 0.3, bz = z + Math.cos(yaw) * 0.3; leftOf(yaw, this.v1);
      for (const s of ['L', 'R'] as Side[]) { T.arm[s].ik = V().set(bx + this.v1.x * sideSign(s) * 0.1, 1.02 * h, bz + this.v1.z * sideSign(s) * 0.1); T.arm[s].ikW = 1; }
    }
    // pelvis: keep the stance legs within reach (no hyper-extended knees)
    p.pelvis.copy(T.pelvis);
    p.q[B.pelvis].setFromEuler(this.e.set(T.pPitch, T.pYaw, T.pRoll, 'YXZ'));
    rig.fk(p, 0, 0);
    const legMax = (body.thigh + body.shin) * 0.985;
    let drop = 0;
    for (const s of ['L', 'R'] as Side[]) {
      if (this.feet[s].swing && a.action?.type !== 'kick') continue;
      const hip = this.v1.copy(body.offsets[s === 'L' ? B.thighL : B.thighR]).applyMatrix4(rig.world[B.pelvis]);
      const ft = T.foot[s].pos; const dxz = Math.hypot(hip.x - ft.x, hip.z - ft.z);
      const maxY = Math.sqrt(Math.max(0, legMax * legMax - dxz * dxz));
      const over = hip.y - ft.y - maxY; if (over > drop) drop = over;
    }
    if (drop > 0) { p.pelvis.y -= Math.min(drop, 0.35 * h); rig.fk(p, 0, 0); }
    // spine and head by angle
    const sp = [0.25, 0.35, 0.4];
    for (let i = 0; i < 3; i++) p.q[B.spine1 + i].setFromEuler(this.e.set(T.sPitch * sp[i], T.sYaw * sp[i], T.sRoll * sp[i], 'YXZ'));
    p.q[B.neck].setFromEuler(this.e.set(T.headPitch * 0.4, T.headYaw * 0.4, 0, 'YXZ'));
    p.q[B.head].setFromEuler(this.e.set(T.headPitch * 0.6, T.headYaw * 0.6, 0, 'YXZ'));
    rig.fk(p, 1, 5);
    // arms by angle (FK), then IK overrides
    for (const s of ['L', 'R'] as Side[]) {
      const L = s === 'L'; const ar = T.arm[s];
      p.q[L ? B.clavL : B.clavR].setFromEuler(this.e.set(0, 0, sideSign(s) * clamp(-ar.x, -0.6, 0.6) * 0.08, 'XYZ'));
      p.q[L ? B.armL : B.armR].setFromEuler(this.e.set(ar.x, ar.y, ar.z, 'XZY'));
      p.q[L ? B.foreL : B.foreR].setFromEuler(this.e.set(-ar.elbow, 0, 0, 'XYZ'));
      p.q[L ? B.handL : B.handR].identity();
    }
    rig.fk(p, 6, 13);
    for (const s of ['L', 'R'] as Side[]) {
      const ar = T.arm[s]; if (!ar.ik || ar.ikW <= 0.01) continue;
      const L = s === 'L'; const clav = L ? B.clavL : B.clavR, arm = L ? B.armL : B.armR, fore = L ? B.foreL : B.foreR;
      const sh = rig.pos(arm, this.v1);
      // elbows point down, back and out
      fwdOf(yaw, this.v2); leftOf(yaw, this.v3);
      this.pole.set(0, -0.6, 0).addScaledVector(this.v2, -0.5).addScaledVector(this.v3, sideSign(s) * 0.6);
      twoBone(sh, ar.ik, body.upperArm, body.foreArm, this.pole, this.mid, this.end);
      const fkElbow = rig.pos(fore, this.v4);
      this.mid.lerpVectors(fkElbow, this.mid, ar.ikW);
      const fkHand = rig.pos(L ? B.handL : B.handR, this.v5); this.end.lerpVectors(fkHand, this.end, ar.ikW);
      aimRotation(this.v6.subVectors(this.mid, sh), this.pole, this.q1);
      aimRotation(this.v6.subVectors(this.end, this.mid), this.pole, this.q2);
      rig.rot(clav, this.qw);
      p.q[arm].copy(this.qw.invert()).multiply(this.q1);
      p.q[fore].copy(this.q1.invert()).multiply(this.q2);
    }
    rig.fk(p, 6, 13);
    // legs by IK to the foot targets
    const pelvisRot = rig.rot(B.pelvis, this.q3);
    for (const s of ['L', 'R'] as Side[]) {
      const L = s === 'L'; const thigh = L ? B.thighL : B.thighR, shin = L ? B.shinL : B.shinR, foot = L ? B.footL : B.footR, toe = L ? B.toeL : B.toeR;
      const ft = T.foot[s];
      const hip = this.v1.copy(body.offsets[thigh]).applyMatrix4(rig.world[B.pelvis]);
      // knees point where the foot points, slightly outward, and forward relative to the pelvis
      fwdOf(ft.yaw, this.v2); fwdOf(yaw, this.v3);
      this.pole.copy(this.v2).add(this.v3).normalize();
      twoBone(hip, ft.pos, body.thigh, body.shin, this.pole, this.mid, this.end);
      aimRotation(this.v4.subVectors(this.mid, hip), this.pole, this.q1);   // thigh world
      aimRotation(this.v4.subVectors(this.end, this.mid), this.pole, this.q2); // shin world
      p.q[thigh].copy(this.qw.copy(pelvisRot).invert()).multiply(this.q1);
      p.q[shin].copy(this.qw.copy(this.q1).invert()).multiply(this.q2);
      this.qw.setFromEuler(this.e.set(-ft.pitch, ft.yaw, ft.roll, 'YXZ')); // foot world
      p.q[foot].copy(this.q2.invert()).multiply(this.qw);
      p.q[toe].setFromEuler(this.e.set(ft.toe, 0, 0, 'XYZ'));
    }
    rig.fk(p, 14, 21);
    this.capsDirty = true;
    void h; void this.sc;
  }
}
