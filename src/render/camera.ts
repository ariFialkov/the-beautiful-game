import * as THREE from 'three';

/** Camera-relative ground axes: stick right maps to `right`, stick up maps to `forward` (both unit vectors on the pitch). */
export function groundBasis(camera: THREE.Camera): { right: { x: number; z: number }; forward: { x: number; z: number } } {
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  let fx = d.x, fz = d.z; const l = Math.hypot(fx, fz);
  if (l < 1e-4) { fx = 0; fz = 1; } else { fx /= l; fz /= l; }
  return { forward: { x: fx, z: fz }, right: { x: -fz, z: fx } };
}

/** Critically damped spring toward a target (Game Programming Gems 4 / Unity SmoothDamp). No overshoot, continuous velocity. */
export function smoothDamp(cur: number, target: number, state: { v: number }, smoothTime: number, maxSpeed: number, dt: number): number {
  const st = Math.max(1e-4, smoothTime); const omega = 2 / st; const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let change = cur - target; const orig = target;
  const maxChange = maxSpeed * st; change = Math.max(-maxChange, Math.min(maxChange, change));
  const tgt = cur - change;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * exp;
  let out = tgt + (change + temp) * exp;
  if ((orig - cur > 0) === (out > orig)) { out = orig; state.v = (out - orig) / dt; }
  return out;
}
class Damp3 {
  vx = { v: 0 }; vy = { v: 0 }; vz = { v: 0 };
  step(cur: THREE.Vector3, target: THREE.Vector3, smoothTime: number, maxSpeed: number, dt: number) {
    cur.set(smoothDamp(cur.x, target.x, this.vx, smoothTime, maxSpeed, dt), smoothDamp(cur.y, target.y, this.vy, smoothTime, maxSpeed, dt), smoothDamp(cur.z, target.z, this.vz, smoothTime, maxSpeed, dt));
  }
  reset() { this.vx.v = this.vy.v = this.vz.v = 0; }
}

export type CamMode = 'broadcast' | 'low' | 'behindGoal' | 'drone' | 'closeup' | 'freekick' | 'showcase';
/** The match camera the player picks: Tele (tight broadcast, the default), High broadcast, Ball cam, End-to-end. */
export type CamStyle = 'tele' | 'high' | 'ball' | 'end';
export const CAM_STYLES: Array<{ id: CamStyle; label: string }> = [{ id: 'tele', label: 'Tele' }, { id: 'high', label: 'High Broadcast' }, { id: 'ball', label: 'Ball Cam' }, { id: 'end', label: 'End-to-End' }];

/** Broadcast camera in the style of EA FC's "Tele Broadcast": tracks a smoothed focus point driven by the ball,
 *  shifted toward the direction of play of the team in possession, with no shake and long blends between shots. */
export class CameraRig {
  mode: CamMode = 'broadcast';
  style: CamStyle = 'tele';
  /** End-to-end camera: the direction the player's team attacks (the camera sits behind them). */
  endDir = 1;
  heightMul = 1;
  private pos = new THREE.Vector3(0, 30, -60);
  private look = new THREE.Vector3();
  private posDamp = new Damp3(); private lookDamp = new Damp3();
  private focusX = 0; private focusZ = 0; private fvx = { v: 0 }; private fvz = { v: 0 };
  private bias = 0; private biasV = { v: 0 };
  private lookY = 0.4; private lookYV = { v: 0 };
  private ballVx = 0; private ballVy = 0; private prevTarget: THREE.Vector3 | null = null;
  /** Seconds of extra-soft blending left after a change of shot. */
  private blend = 0;
  private urgency = 0;
  private cutTime = 0; private cutSide = 1;
  /** Zoom relative to the base field of view (1 = none) and its smoothing state. */
  private zoom = 1; private zoomV = { v: 0 }; private ballSpeed = 0; private refDist = 42;
  private readonly fov0: number;
  constructor(private camera: THREE.PerspectiveCamera, public pitchLength: number, public pitchWidth: number) { this.fov0 = camera.fov; }
  private get baseFov(): number { return (this.camera.userData.baseFov as number | undefined) ?? this.fov0; }

  snap() { this.camera.position.copy(this.pos); this.camera.lookAt(this.look); }
  /** Kept for API compatibility: the broadcast camera never shakes. */
  addShake(_v: number) {}
  /** Start a soft blend (e.g. coming back from a celebration close-up). */
  softBlend(seconds = 1.2) { this.blend = Math.max(this.blend, seconds); }

  /** Where the match camera wants to be for the current smoothed focus, for the chosen style. */
  private broadcastPose(outPos: THREE.Vector3, outLook: THREE.Vector3) {
    const L = this.pitchLength, W = this.pitchWidth; const scale = L / 105; const h = this.heightMul;
    const fx = this.focusX, fz = this.focusZ;
    // Narrow (portrait) screens: pull back and up so enough of the pitch's length is in view.
    const wide = this.camera.aspect < 1.2 ? 1 + (1.2 - this.camera.aspect) * 0.9 : 1;
    const small = scale < 0.6 ? 1 : 0; // futsal court: a little further back and up so quick high balls stay in shot
    if (this.style === 'end') {
      // End-to-end: behind the player's team, looking up the pitch the way they attack, sliding across with the ball.
      const d = this.endDir; const back = (20 + 6 * h) * (0.45 + 0.55 * scale);
      const x = THREE.MathUtils.clamp(fx - d * back, -L / 2 - 10 * scale, L / 2 + 10 * scale);
      const over = Math.max(0, Math.abs(x) - L / 2); // behind the goal line: rise over the end stand
      outPos.set(x, ((10 + 4 * h) * (0.5 + 0.5 * scale) + over * 0.6) * wide, fz * 0.7);
      outLook.set(fx + d * 6 * scale, this.lookY, fz * 0.92);
      this.refDist = 0; return;
    }
    const base = (W / 2 + 7 * scale) * (0.6 + 0.4 * h) + small * 3;
    const far = Math.max(0, fz) / (W / 2), near = Math.max(0, -fz) / (W / 2);
    if (this.style === 'ball') {
      // Ball cam: low and close on the near side, following the ball across the pitch.
      const back = base * 0.62;
      // never closer than ~15 m to the play (near-touchline play would otherwise be right under the lens)
      const cz = Math.min(-(back + (wide - 1) * 10 * scale) + fz * 0.45, fz - 15 * (0.4 + 0.6 * scale));
      outPos.set(fx * 0.97, (6.5 * h * (0.55 + 0.45 * scale) + small) * wide, cz);
      outLook.set(fx, this.lookY, THREE.MathUtils.clamp(fz * 0.9 - 1.5 * scale, -W / 2, W / 2));
      this.refDist = 0; return;
    }
    const high = this.style === 'high';
    const back = base * (high ? 1.12 : 1) + (high ? 4 * scale : 0);
    // Dolly with play across the pitch: well in toward the far touchline (and a little higher, to see between the
    // players), only slightly back for the near side (the near stand's roof is behind).
    const dolly = (far * W * 0.24 - near * W * 0.07) * (high ? 0.6 : 1);
    const lift = far * 3 * scale;
    const y0 = (high ? 21 : 11.5) * h * (0.5 + 0.5 * scale) + small * 1.5;
    outPos.set(fx * 0.95, (y0 + lift) * wide, -(back + (wide - 1) * 14 * scale) + dolly);
    // distance to centre-pitch play for this screen shape: the zoom is relative to it
    this.refDist = Math.hypot(back + (wide - 1) * 14 * scale, y0 * wide - 0.5);
    outLook.set(fx, this.lookY, THREE.MathUtils.clamp(fz * (high ? 0.8 : 0.72) - 3 * scale, -W / 2, W / 2));
  }

  /** target = ball position; lead.x = direction of play of the team in possession (-1..1, 0 when loose). */
  update(dt: number, target: THREE.Vector3, lead: THREE.Vector3, time: number) {
    if (dt <= 0) return;
    const L = this.pitchLength; const scale = L / 105;
    // Ball velocity along the pitch, estimated from the target and smoothed (no sudden look-ahead swings).
    if (this.prevTarget) {
      const jump = target.distanceTo(this.prevTarget); const tele = jump > 8 + 40 * dt; // (a slow frame is not a teleport)
      const vx = tele ? 0 : (target.x - this.prevTarget.x) / dt; // ignore teleports (restarts)
      if (tele) this.blend = Math.max(this.blend, 1.6); // ball placed for a restart: glide over, don't lunge
      this.ballVx += (vx - this.ballVx) * (1 - Math.exp(-dt / 0.35));
      const vy = tele ? 0 : (target.y - this.prevTarget.y) / dt; this.ballVy += (vy - this.ballVy) * (1 - Math.exp(-dt / 0.15));
      const spd = tele ? 0 : jump / dt; this.ballSpeed += (spd - this.ballSpeed) * (1 - Math.exp(-dt / 0.5));
    } else { this.focusX = target.x; this.focusZ = target.z; }
    this.prevTarget = (this.prevTarget ?? new THREE.Vector3()).copy(target);

    if (this.mode === 'broadcast') {
      // Direction of play: drift ahead of the ball for the attacking side, slowly so turnovers don't whip the camera.
      this.bias = smoothDamp(this.bias, THREE.MathUtils.clamp(lead.x, -1, 1) * 7 * scale, this.biasV, 1.4, 10, dt);
      const lookAhead = THREE.MathUtils.clamp(this.ballVx * 0.25, -4 * scale, 4 * scale);
      const tx = THREE.MathUtils.clamp(target.x + this.bias + lookAhead, -L / 2 + 9 * scale, L / 2 - 9 * scale);
      const big = scale >= 0.6; // (11-a-side: the quicker high-ball tracking below; the small court is calm enough without it)
      // Edge guard: if the ball is drifting toward the edge of the frame (fast long balls, narrow phone screens), catch up quicker.
      const ndc = target.clone().project(this.camera);
      const edge = Math.max(Math.abs(ndc.x), Math.abs(ndc.y) * 0.9);
      const e0 = this.style === 'ball' || this.style === 'end' ? 0.45 : this.style === 'tele' ? 0.5 : 0.55; // the closer cameras react sooner
      const want = edge > e0 && this.blend < 0.6 ? Math.min(1, (edge - e0) / 0.35) : 0;
      this.urgency += (want - this.urgency) * (1 - Math.exp(-dt / 0.25)); // eased, so the catch-up never snaps
      // Narrow (portrait) screens see less of the pitch, so track tighter.
      const narrow = THREE.MathUtils.clamp(this.camera.aspect / 1.78, 0.6, 1) * (this.style === 'ball' ? 0.6 : this.style === 'end' ? 0.68 : 1);
      const glide = 0.7 * Math.min(1, this.blend / 1.2); // slower focus while gliding to a restart
      this.focusX = smoothDamp(this.focusX, tx, this.fvx, (0.8 - 0.45 * this.urgency) * narrow + glide, Math.max(22 * scale, 14) * (1 + (big ? 0.5 : 0) * this.urgency), dt);
      this.focusZ = smoothDamp(this.focusZ, target.z, this.fvz, (1.1 - 0.6 * this.urgency) * narrow * (0.6 + 0.4 * scale) + glide, Math.max(16 * scale, 9) * (1 + (big ? 0.6 : 0) * this.urgency), dt);
      // Tilt up for high balls; a closer (futsal) camera has to tilt more, and faster when the ball nears the frame edge.
      // (the low Ball Cam has to look up much further for a ball in the air)
      const lowCam = this.style === 'ball' || this.style === 'end';
      const tilt = this.style === 'ball' ? 0.7 : this.style === 'end' ? 0.5 : Math.min(0.6, 0.25 / Math.max(0.4, scale));
      this.lookY = smoothDamp(this.lookY, 0.4 + Math.min(lowCam ? 14 : 13, Math.max(0, target.y - 1 + (big ? Math.max(0, this.ballVy) * 0.35 : 0))) * tilt, this.lookYV, ((lowCam ? 0.45 : 0.8) - (lowCam ? 0.25 : 0.5) * this.urgency) * (big && this.ballVy < -3 ? 0.6 : 1), 16, dt); // (quicker back down for a dropping ball)
      const p = new THREE.Vector3(), l = new THREE.Vector3(); this.broadcastPose(p, l);
      // Zoom: keep play on the far side as readable as near-side play (narrower field of view the further the
      // action is from the camera), and ease out a touch for long, fast balls and when the ball nears the frame edge.
      // Tele sits tighter than a plain broadcast camera; End-to-end and Ball cam keep a fixed framing.
      const ref = this.refDist;
      const dist = Math.hypot(p.y - 0.5, p.z - this.focusZ);
      const fast = THREE.MathUtils.clamp((this.ballSpeed - 12) / 18, 0, 1);
      const styleZoom = this.style === 'tele' ? 0.82 : this.style === 'ball' ? 0.95 : 1;
      const byDist = ref > 0 ? THREE.MathUtils.clamp(Math.pow(ref / dist, this.style === 'high' ? 0.6 : 1.0), 0.66, 1.12) : 1;
      // widen for balls high in the air (most for the close cameras; Tele a little, as it's zoomed in)
      const high = this.style === 'high' ? 0 : THREE.MathUtils.clamp((target.y - (this.style === 'tele' ? 4 : 2)) * (this.style === 'ball' ? 0.07 : this.style === 'end' ? 0.05 : 0.045), 0, this.style === 'ball' ? 0.7 : this.style === 'end' ? 0.45 : 0.5);
      const zoomWant = styleZoom * byDist * (1 + 0.1 * fast + (high > 0 || this.style === 'ball' || this.style === 'end' ? 0.25 : 0.08) * this.urgency + high);
      this.zoomTo(zoomWant, dt, 0.9);
      this.apply(p, l, dt);
      return;
    }
    // Other shots (used by the highlight tape): computed targets, same smoothing.
    const W = this.pitchWidth; const p = new THREE.Vector3(), l = new THREE.Vector3();
    switch (this.mode) {
      case 'low': p.set(target.x - 6, 3.5, -(W / 2 + 6)); l.set(target.x, 1.2, target.z); break;
      case 'behindGoal': p.set(this.cutSide * (L / 2 + 16), 9, 0); l.set(target.x, 1, target.z); break;
      case 'drone': { const a = time * 0.12; p.set(Math.cos(a) * (L * 0.55), 32 + Math.sin(time * 0.3) * 4, Math.sin(a) * (W * 0.9)); l.set(target.x * 0.5, 0, target.z * 0.5); break; }
      case 'closeup': { const d = new THREE.Vector3(-lead.x, 0, -lead.z); if (d.lengthSq() < 0.01) d.set(0, 0, -1); d.normalize(); p.copy(target).addScaledVector(d, 7).setY(2.4); l.copy(target).setY(1.2); break; }
      default: return;
    }
    this.zoomTo(1, dt, 0.6);
    this.apply(p, l, dt);
  }

  /** Ease the field of view toward base × factor. */
  private zoomTo(factor: number, dt: number, smoothTime: number) {
    this.zoom = smoothDamp(this.zoom, factor, this.zoomV, smoothTime + 0.6 * Math.min(1, this.blend / 1.2), 0.6, dt);
    const fov = this.baseFov * this.zoom;
    if (Math.abs(this.camera.fov - fov) > 1e-3) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  private apply(p: THREE.Vector3, l: THREE.Vector3, dt: number) {
    this.blend = Math.max(0, this.blend - dt);
    const soft = 0.9 * Math.min(1, this.blend / 1.2); // tapers continuously to zero: no step change in smoothing
    this.posDamp.step(this.pos, p, 0.16 + soft, 80, dt);
    this.lookDamp.step(this.look, l, 0.1 + soft, 80, dt);
    this.camera.position.copy(this.pos); this.camera.lookAt(this.look);
  }

  /** Cinematic cut scheduler for the highlight tape (hard cuts between shots, smooth within them). */
  cinematic(dt: number, target: THREE.Vector3, lead: THREE.Vector3, time: number) {
    this.cutTime -= dt;
    if (this.cutTime <= 0) {
      const modes: CamMode[] = ['broadcast', 'low', 'behindGoal', 'drone', 'closeup', 'low', 'broadcast'];
      this.mode = modes[Math.floor(Math.random() * modes.length)];
      this.cutSide = target.x > 0 ? 1 : -1;
      this.cutTime = 4 + Math.random() * 5;
      this.posDamp.reset(); this.lookDamp.reset();
      // hard cut: jump straight to the new framing
      const save = { pos: this.pos.clone() };
      this.update(1 / 60, target, lead, time);
      if (this.mode === 'broadcast') { const p = new THREE.Vector3(), l = new THREE.Vector3(); this.broadcastPose(p, l); this.pos.copy(p); this.look.copy(l); }
      else { this.pos.copy(this.camera.position); }
      void save;
    }
    this.update(dt, target, lead, time);
  }

  setFixed(pos: THREE.Vector3, look: THREE.Vector3) { this.pos.copy(pos); this.look.copy(look); this.posDamp.reset(); this.lookDamp.reset(); this.camera.position.copy(pos); this.camera.lookAt(look); }

  /** Frame a specific shot (celebrations, set pieces) with soft critically damped motion. */
  /** Cut straight to a shot (no glide), e.g. the free-kick camera behind the taker. */
  cutTo(pos: THREE.Vector3, look: THREE.Vector3) {
    this.pos.copy(pos); this.look.copy(look); this.posDamp.reset(); this.lookDamp.reset(); this.snap();
  }
  moveTo(dt: number, pos: THREE.Vector3, look: THREE.Vector3, smoothTime = 0.8, zoom = 1) {
    this.zoomTo(zoom, dt, 0.6);
    this.posDamp.step(this.pos, pos, smoothTime, 40, dt);
    this.lookDamp.step(this.look, look, smoothTime * 0.8, 40, dt);
    this.camera.position.copy(this.pos); this.camera.lookAt(this.look);
    // keep the broadcast focus tracking so the return is seamless
    this.focusX += (look.x - this.focusX) * Math.min(1, dt * 0.5);
    this.blend = 1.2;
  }
}
