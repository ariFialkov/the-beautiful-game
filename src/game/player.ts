import type { PlayerCard } from '@shared/types';
import { v2, type V2 } from './pitch';
import type { Motion } from './motion';

export type ActionType = 'kick' | 'tackle' | 'slide' | 'dive' | 'fallen' | 'stumble' | 'throw' | 'celebrate' | 'touch' | 'trap' | 'header';
export interface Action { type: ActionType; t: number; duration: number; fired: boolean; dir: number; data?: any; }

/** Actions that take over the player's legs (no free running, no new decisions). */
const BLOCKING: ReadonlySet<ActionType> = new Set(['tackle', 'slide', 'dive', 'fallen', 'stumble', 'throw', 'header']);

export interface Intent {
  move: V2;            // desired movement direction, length 0..1
  sprint: boolean;
  face?: V2 | null;    // face this way while moving (jockeying, setting up a kick)
  jockey?: boolean;    // defensive side-step: short quick steps, capped speed
  /** Per-step steering override (dribble assist, stepping up to a kick). Cleared every step; `move` keeps the player's wish. */
  steer?: V2 | null;
  /** Per-step sprint boost (e.g. recovering a loose touch); cleared every step, doesn't change the player's own wish. */
  boost?: boolean;
}

export interface PendingKick { kind: 'pass' | 'through' | 'lob' | 'shoot'; power: number; dir: V2; opts: any; t0: number; }

/** A footballer: momentum-based movement (acceleration, braking and cornering limits) plus actions. */
export class Agent {
  pos: V2 = { x: 0, z: 0 };
  vel: V2 = { x: 0, z: 0 };
  heading: V2 = { x: 1, z: 0 };
  /** Previous fixed-step state, for render interpolation. */
  prevPos: V2 = { x: 0, z: 0 };
  prevHeadingAngle = 0;
  intent: Intent = { move: { x: 0, z: 0 }, sprint: false };
  action: Action | null = null;
  pendingKick: PendingKick | null = null;
  /** Seconds before this player can touch the ball again (after kicks, heavy touches, being tackled). */
  cooldown = 0;
  /** Seconds before the next dribble touch. */
  touchCooldown = 0;
  /** Seconds before another tackle can start: committing to a tackle has a price, so mashing does nothing. */
  tackleCooldown = 0;
  stunned = 0;
  home: V2 = { x: 0, z: 0 };
  role = 'CM';
  isGK = false;
  isHuman = false;
  hasBall = false;
  animPhase = 0;
  animTime = 0;
  /** Smoothed accelerations along / across the heading (m/s²) and turn rate (rad/s), used for body lean. */
  accelFwd = 0; accelLat = 0; turnRate = 0;
  lastTouchFoot = 1;
  yellow = 0;
  ai: { nextDecision: number; target: V2; mode: string; marking: Agent | null; expectBall: number; diveAt: number; dive: any; shotKey: number; lapseKey: number; lapse: boolean } = { nextDecision: 0, target: { x: 0, z: 0 }, mode: 'shape', marking: null, expectBall: 0, diveAt: 0, dive: null, shotKey: -1, lapseKey: -1, lapse: false };
  keeperHold = 0;
  /** Skeleton and procedural animation (assigned by the match). */
  motion?: Motion;
  readonly maxSpeed: number;
  readonly accel: number;
  readonly agility: number;
  readonly skill: { dribble: number; pass: number; shoot: number; defend: number; control: number };

  constructor(public card: PlayerCard, public team: number, public index: number) {
    const a = card.attrs;
    this.maxSpeed = 5.8 + (a.pace / 99) * 3.0;          // 7.1 .. 8.8 m/s
    this.accel = 6.5 + (a.physical / 99) * 2.5 + (a.pace / 99) * 2;
    this.agility = 0.5 + (a.dribbling / 99) * 0.5;
    this.isGK = card.position === 'GK';
    this.skill = { dribble: a.dribbling / 99, pass: a.passing / 99, shoot: a.shooting / 99, defend: a.defending / 99, control: (a.dribbling * 0.6 + a.passing * 0.4) / 99 };
  }

  speed() { return v2.len(this.vel); }
  startAction(type: ActionType, duration: number, dir = 1, data?: any): Action {
    this.action = { type, t: 0, duration, fired: false, dir, data };
    return this.action;
  }
  /** Busy = cannot start new actions or make on-ball decisions. */
  busy() { return !!this.action && (BLOCKING.has(this.action.type) || this.action.type === 'kick'); }
  legsBusy() { return !!this.action && BLOCKING.has(this.action.type); }

  update(dt: number, speedMul = 1, grip = 1) {
    this.prevPos = { x: this.pos.x, z: this.pos.z }; this.prevHeadingAngle = Math.atan2(this.heading.z, this.heading.x);
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.touchCooldown > 0) this.touchCooldown -= dt;
    if (this.tackleCooldown > 0) this.tackleCooldown -= dt;
    if (this.stunned > 0) this.stunned -= dt;
    this.animTime += dt;
    if (this.action) { this.action.t += dt; if (this.action.t >= this.action.duration) this.action = null; }
    const act = this.action;
    const before = { x: this.vel.x, z: this.vel.z };
    const sp = this.speed();

    if (act && BLOCKING.has(act.type)) {
      // Committed movement: lunges and slides carry their own momentum and decay with friction.
      const d = act.data?.dir as V2 | undefined;
      if (act.type === 'slide' && d) {
        const slideT = 0.75;
        if (act.t < slideT) { const s = act.data.speed as number; const v = Math.max(0, s - (7.5 / (act.data.slideFactor ?? 1)) * act.t); this.vel = v2.scale(d, v); }
        else this.vel = v2.scale(this.vel, Math.exp(-10 * dt));
      } else if (act.type === 'tackle' && d) {
        const lunge = act.t < 0.3 ? 4.2 : Math.max(0, 4.2 - (act.t - 0.3) * 16);
        this.vel = v2.lerp(this.vel, v2.scale(d, Math.max(lunge, 0)), 1 - Math.exp(-12 * dt));
      } else if (act.type === 'dive' && act.data?.vel) {
        // carried at full launch speed until the ball arrives, then the landing bleeds it off
        const fl = act.data.flight ?? 0.3; const k = act.t < fl ? 1 : Math.max(0, 1 - (act.t - fl) / 0.3); this.vel = v2.scale(act.data.vel, k);
      } else if (act.type === 'header' && act.data?.contact && !act.data.done && !act.data.wall) {
        // rising to meet it: the body carries toward where the ball will be at the moment of contact
        const c = act.data.contact as { x: number; z: number }; const rem = Math.max(0.06, (act.data.tc ?? 0.2) - act.t);
        let want = { x: (c.x - this.pos.x) / rem, z: (c.z - this.pos.z) / rem }; const l = v2.len(want); if (l > 6) want = v2.scale(want, 6 / l);
        this.vel = v2.lerp(this.vel, want, 1 - Math.exp(-14 * dt));
      } else if (act.type === 'stumble') {
        this.vel = v2.scale(this.vel, Math.exp(-3 * dt));
      } else {
        this.vel = v2.scale(this.vel, Math.exp(-(act.type === 'header' ? 2 : 8) * dt));
      }
    } else if (act?.type === 'celebrate' && act.data?.slideV) {
      // a knee slide: carried on by its own momentum along the turf, slowing to a stop
      const v0 = act.data.slideV as V2; const s0 = v2.len(v0); const u = act.t - act.data.ft;
      this.vel = v2.scale(v0, Math.max(0, s0 - 4.2 * u) / Math.max(0.01, s0));
    } else {
      // Free running: accelerate toward the intended velocity with separate limits for speeding up,
      // braking and cornering, so sharp turns at pace need a plant and a slow-down.
      const m = this.intent.steer ?? this.intent.move; const ml = Math.min(1, v2.len(m));
      let top = this.maxSpeed * speedMul * (this.intent.sprint || this.intent.boost ? 1 : 0.7);
      if (this.hasBall) top *= 0.93;
      if (this.intent.jockey) top = Math.min(top, 3.4);
      if (act?.type === 'kick') top *= 0.45;
      if (this.stunned > 0) top *= 0.3;
      const desired = ml > 0.05 ? v2.scale(v2.norm(m), ml * top) : { x: 0, z: 0 };
      const dv = v2.sub(desired, this.vel);
      if (sp > 0.3) {
        const t = v2.scale(this.vel, 1 / sp);
        const dvt = v2.dot(dv, t); const dvn = v2.sub(dv, v2.scale(t, dvt));
        const maxUp = grip * this.accel * (1 - 0.55 * Math.min(1, sp / this.maxSpeed));
        const maxBrake = grip * 12;
        const maxLat = grip * (9 + this.agility * 5) * (this.intent.jockey ? 1.4 : 1);
        const at = Math.max(-maxBrake * dt, Math.min(maxUp * dt, dvt));
        const nl = v2.len(dvn); const an = nl > maxLat * dt ? v2.scale(dvn, (maxLat * dt) / nl) : dvn;
        this.vel = v2.add(this.vel, v2.add(v2.scale(t, at), an));
      } else {
        const l = v2.len(dv); const lim = grip * this.accel * dt;
        this.vel = l > lim ? v2.add(this.vel, v2.scale(dv, lim / l)) : desired;
      }
    }
    this.pos = v2.add(this.pos, v2.scale(this.vel, dt));

    // Facing: follow the run, or a requested facing; turn rate drops with speed.
    const face = this.intent.face;
    const nsp = this.speed();
    const want = act && BLOCKING.has(act.type) ? null : face && v2.len(face) > 0.01 ? v2.norm(face) : nsp > 0.4 ? v2.norm(this.vel) : null;
    const cur = Math.atan2(this.heading.z, this.heading.x);
    if (want) {
      let d = Math.atan2(want.z, want.x) - cur; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      const rate = ((10 + this.agility * 8) / (1 + 0.22 * nsp)) * dt;
      const step = Math.abs(d) <= rate ? d : Math.sign(d) * rate;
      this.heading = v2.fromAngle(cur + step);
      this.turnRate += (step / dt - this.turnRate) * Math.min(1, dt * 10);
    } else this.turnRate *= Math.exp(-8 * dt);

    // Smoothed accelerations for body lean.
    const acc = v2.scale(v2.sub(this.vel, before), 1 / dt);
    const h = this.heading; const right = { x: -h.z, z: h.x };
    const k = Math.min(1, dt * 8);
    this.accelFwd += (v2.dot(acc, h) - this.accelFwd) * k;
    this.accelLat += (v2.dot(acc, right) - this.accelLat) * k;
    this.animPhase += nsp * dt * (this.intent.jockey ? 3.4 : 2.6);
  }
}
