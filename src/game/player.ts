import type { PlayerCard } from '@shared/types';
import { v2, type V2 } from './pitch';

export type ActionType = 'kick' | 'tackle' | 'slide' | 'dive' | 'fallen' | 'throw' | 'celebrate';
export interface Action { type: ActionType; t: number; duration: number; fired: boolean; dir: number; data?: any; }

export interface Intent {
  move: V2;            // desired movement direction (unit or zero)
  sprint: boolean;
  face?: V2 | null;    // optional facing override
}

/** A footballer in the simulation (human-controlled or AI). */
export class Agent {
  pos: V2 = { x: 0, z: 0 };
  vel: V2 = { x: 0, z: 0 };
  heading: V2 = { x: 1, z: 0 };
  intent: Intent = { move: { x: 0, z: 0 }, sprint: false };
  action: Action | null = null;
  /** Seconds before this player may touch the ball again. */
  cooldown = 0;
  /** Formation base, normalised. */
  home: V2 = { x: 0, z: 0 };
  role = 'CM';
  isGK = false;
  isHuman = false;
  hasBall = false;
  animPhase = 0;
  animTime = 0;
  /** AI scratch state. */
  ai: { nextDecision: number; target: V2; mode: string; marking: Agent | null; expectBall: number } = { nextDecision: 0, target: { x: 0, z: 0 }, mode: 'shape', marking: null, expectBall: 0 };
  keeperHold = 0;
  stunned = 0;
  tackleCooldown = 0;
  readonly maxSpeed: number;
  readonly accel: number;
  readonly agility: number;

  constructor(public card: PlayerCard, public team: number, public index: number) {
    const a = card.attrs;
    this.maxSpeed = 5.6 + (a.pace / 99) * 3.0;
    this.accel = 7 + (a.physical / 99) * 4;
    this.agility = 0.5 + (a.dribbling / 99) * 0.5;
    this.isGK = card.position === 'GK';
  }

  speed() { return v2.len(this.vel); }

  startAction(type: ActionType, duration: number, dir = 1, data?: any): Action {
    this.action = { type, t: 0, duration, fired: false, dir, data };
    return this.action;
  }
  busy() { return !!this.action && this.action.type !== 'celebrate'; }
  canMove() { return !this.action || this.action.type === 'kick' || this.action.type === 'celebrate'; }

  /** Integrate movement toward the intent. */
  update(dt: number, speedMul = 1) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.stunned > 0) this.stunned -= dt;
    if (this.tackleCooldown > 0) this.tackleCooldown -= dt;
    this.animTime += dt;
    if (this.action) {
      this.action.t += dt;
      if (this.action.t >= this.action.duration) this.action = null;
    }
    const act = this.action;
    let desired: V2 = { x: 0, z: 0 };
    let maxSpeed = this.maxSpeed * speedMul * (this.intent.sprint ? 1 : 0.72);
    if (act && (act.type === 'slide' || act.type === 'dive' || act.type === 'tackle')) {
      // lunge along the stored direction, decaying
      const k = Math.max(0, 1 - act.t / act.duration);
      const lungeSpeed = act.type === 'slide' ? 8.5 : act.type === 'dive' ? 7.5 : 5.5;
      const d = act.data?.dir as V2 | undefined;
      desired = d ? v2.scale(d, lungeSpeed * k) : { x: 0, z: 0 };
      maxSpeed = lungeSpeed;
    } else if (act && (act.type === 'fallen' || act.type === 'throw')) {
      desired = { x: 0, z: 0 };
    } else if (this.stunned > 0) {
      desired = { x: 0, z: 0 };
    } else {
      const m = this.intent.move;
      const ml = v2.len(m);
      if (ml > 0.05) {
        const withBall = this.hasBall ? 0.9 : 1;
        desired = v2.scale(v2.norm(m), Math.min(1, ml) * maxSpeed * withBall);
        if (act?.type === 'kick') desired = v2.scale(desired, 0.35);
      }
    }
    // accelerate toward desired velocity
    const dv = v2.sub(desired, this.vel);
    const dl = v2.len(dv);
    const a = (dl > 0 && v2.dot(dv, this.vel) < 0 ? this.accel * 1.6 : this.accel) * dt;
    if (dl <= a) this.vel = desired; else this.vel = v2.add(this.vel, v2.scale(dv, a / dl));
    this.pos = v2.add(this.pos, v2.scale(this.vel, dt));
    // facing
    const face = this.intent.face;
    const sp = v2.len(this.vel);
    const want = face && v2.len(face) > 0.01 ? v2.norm(face) : sp > 0.5 ? v2.norm(this.vel) : null;
    if (want && !(act && act.type !== 'kick' && act.type !== 'celebrate')) {
      const cur = v2.angle(this.heading), tgt = v2.angle(want);
      let d = tgt - cur; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      const rate = (this.hasBall ? 7 + this.agility * 6 : 14) * dt;
      const step = Math.abs(d) <= rate ? d : Math.sign(d) * rate;
      this.heading = v2.fromAngle(cur + step);
    }
    this.animPhase += sp * dt * 2.6;
  }
}
