import type { MatchScript, PlayerCard } from '@shared/types';
import type { Kit, Team } from '@shared/teams';
import { Ball, BALL_R, G, passSpeedFor, passTimeFor, predictPath, solveKick, spinVector, type GoalFrame, type PathPoint, type V3 } from './ball';
import { Agent } from './player';
import { FORMATION_433, FORMATION_FUTSAL, v2, type PitchSpec, type V2 } from './pitch';
import { Director, FREE_PLAY, OVERRUN_LIMIT, type Modifiers } from './director';
import { updateTeamAI } from './ai';
import { SURFACES, type Surface, type SurfaceId } from './surface';
import type { InputManager } from '../input/input';

export interface TeamSetup { team: Team; players: PlayerCard[]; kit: Kit; kitKey: string; name: string; short: string; }
export interface MatchOptions {
  pitch: PitchSpec;
  mode: 'kickoff' | 'futsal' | 'fut';
  teams: [TeamSetup, TeamSetup];
  humanTeam: number | null;
  script: MatchScript | null;
  durationSec: number;
  clockMinutes: number;
  surface?: SurfaceId;
}
export type KickKind = 'pass' | 'through' | 'lob' | 'shoot';
export type Phase = 'kickoff' | 'play' | 'dead' | 'goal' | 'restart' | 'halftime' | 'fulltime';
export type SetPieceKind = 'kickoff' | 'throw' | 'corner' | 'goalkick' | 'freekick' | 'penalty';
export type MatchEvent =
  | { type: 'goal'; team: number; scorer: Agent | null; forced?: boolean }
  | { type: 'post'; bar: boolean } | { type: 'save'; keeper: Agent; caught: boolean } | { type: 'kickoff'; half: number } | { type: 'halftime' } | { type: 'fulltime' }
  | { type: 'out'; kind: 'throw' | 'corner' | 'goalkick' } | { type: 'kick'; kind: KickKind; power: number; agent: Agent }
  | { type: 'tackle'; success: boolean; agent: Agent } | { type: 'switch'; agent: Agent } | { type: 'touch'; agent: Agent; heavy: boolean }
  | { type: 'foul'; by: Agent; on: Agent; penalty: boolean; card: boolean } | { type: 'setpiece'; kind: SetPieceKind; team: number } | { type: 'header'; agent: Agent };

export class TeamState {
  score = 0; agents: Agent[] = []; kickoffs = 0;
  constructor(public index: number, public attackDir: 1 | -1, public setup: TeamSetup) {}
}

/** Fixed simulation step. Rendering interpolates between steps (see `alpha`). */
export const STEP = 1 / 120;

export class Match {
  ball = new Ball();
  agents: Agent[] = [];
  teams: [TeamState, TeamState];
  pitch: PitchSpec;
  surface: Surface;
  goals: GoalFrame[];
  time = 0;
  clock = 0;
  phase: Phase = 'kickoff';
  phaseTimer = 0;
  half = 1;
  possessionTeam = -1;
  controlled: Agent | null = null;
  director: Director | null = null;
  mods: Modifiers = { ...FREE_PLAY, speedMul: [1, 1], keeper: ['normal', 'normal'], goalAllowed: [true, true], shotAppetite: [1, 1] };
  teamSpeedBonus: [number, number] = [1, 1];
  charge: { kind: 'shoot' | 'pass'; t: number } | null = null;
  ended = false;
  stoppage = false;
  lastSwitch = 0;
  idleTime = 0;
  autopilot = false;
  /** Camera-relative control axes, set by the renderer each frame so stick directions match the screen. */
  controlBasis = { right: { x: -1, z: 0 }, forward: { x: 0, z: 1 } };
  setPiece: { kind: SetPieceKind; team: number; taker: Agent; pos: V2 } | null = null;
  /** Render interpolation factor between the previous and current fixed step. */
  alpha = 1;
  lastScorer: Agent | null = null;
  lastScorerTeam: number | null = null;
  private acc = 0;
  private pendingRestart: (() => void) | null = null;
  private lastConceded = 0;
  private listeners = new Set<(e: MatchEvent) => void>();
  private firstKickoff = 0;
  private paused = false;
  private pathCache: { step: number; path: PathPoint[] } | null = null;
  private stepCount = 0;

  constructor(public opts: MatchOptions) {
    this.pitch = opts.pitch;
    this.surface = SURFACES[opts.surface ?? (opts.pitch.futsal ? 'court' : 'dry')];
    this.ball.surface = this.surface;
    const { length: L, goalWidth, goalHeight, futsal } = this.pitch;
    this.goals = [1, -1].map((s) => ({ lineX: (s * L) / 2, side: s as 1 | -1, halfW: goalWidth / 2, height: goalHeight, depth: futsal ? 1.0 : 2.2 }));
    this.teams = [new TeamState(0, 1, opts.teams[0]), new TeamState(1, -1, opts.teams[1])];
    const formation = futsal ? FORMATION_FUTSAL : FORMATION_433;
    for (const t of this.teams) {
      t.setup.players.slice(0, formation.length).forEach((card, i) => {
        const a = new Agent(card, t.index, i);
        a.home = { x: formation[i].x, z: formation[i].z }; a.role = formation[i].role; a.isGK = i === 0;
        t.agents.push(a); this.agents.push(a);
      });
    }
    if (opts.script) { this.director = new Director(opts.script, this); this.mods = this.director.mods; }
    this.firstKickoff = Math.random() < 0.5 ? 0 : 1;
    this.kickoff(this.firstKickoff, true);
  }

  on(fn: (e: MatchEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e: MatchEvent) { for (const l of this.listeners) l(e); }
  get frac() { return this.clock / this.opts.durationSec; }
  get humanTeam() { return this.opts.humanTeam; }
  setPaused(p: boolean) { this.paused = p; }
  get isPaused() { return this.paused; }
  opponentsOf(team: number) { return this.teams[team === 0 ? 1 : 0]; }

  clockText(): { text: string; stoppage: boolean } {
    const mins = this.opts.clockMinutes; const f = this.frac;
    const halfLen = mins / 2;
    const shown = this.half === 1 ? Math.min(f * mins, halfLen) : Math.min(f * mins, mins);
    const m = Math.floor(shown), s = Math.floor((shown - Math.floor(shown)) * 60);
    const over = this.half === 1 ? f * mins - halfLen : f * mins - mins;
    const text = over > 0.02 ? `${this.half === 1 ? halfLen : mins}'+${Math.max(1, Math.ceil(over))}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return { text, stoppage: over > 0.02 };
  }

  /** Predicted free flight of the ball (cached per step), used by AI interception, keepers and the director. */
  predicted(): PathPoint[] {
    if (this.pathCache?.step === this.stepCount) return this.pathCache.path;
    const path = this.ball.held ? [{ t: 0, x: this.ball.x, y: this.ball.y, z: this.ball.z, vx: 0, vz: 0 }] : predictPath(this.ball, 3, 1 / 30);
    this.pathCache = { step: this.stepCount, path }; return path;
  }

  /* ------------------------------ set pieces ------------------------------ */
  kickoff(teamIdx: number, initial = false) {
    const t = this.teams[teamIdx];
    const { length: L, width: W } = this.pitch;
    this.ball.reset(0, 0);
    for (const team of this.teams) for (const a of team.agents) {
      let x = (a.home.x - 1) / 2 * (L / 2) * 0.9;
      x = Math.min(-1.5, x) * team.attackDir;
      const z = a.home.z * (W / 2) * 0.8;
      a.pos = { x, z }; a.prevPos = { x, z }; a.vel = { x: 0, z: 0 }; a.heading = { x: team.attackDir, z: 0 }; a.action = null; a.pendingKick = null; a.hasBall = false; a.cooldown = 0; a.stunned = 0;
      a.intent = { move: { x: 0, z: 0 }, sprint: false };
    }
    const taker = t.agents[t.agents.length - 1 - (this.pitch.futsal ? 0 : 1)] ?? t.agents[t.agents.length - 1];
    taker.pos = { x: -0.5 * t.attackDir, z: 0 }; taker.prevPos = { ...taker.pos };
    const helper = t.agents[t.agents.length - 1];
    if (helper !== taker) { helper.pos = { x: -1.5 * t.attackDir, z: 2.5 }; helper.prevPos = { ...helper.pos }; }
    this.setPiece = { kind: 'kickoff', team: teamIdx, taker, pos: { x: 0, z: 0 } };
    this.phase = 'kickoff'; this.phaseTimer = initial ? 2.2 : 1.6;
    this.possessionTeam = teamIdx; t.kickoffs++;
    if (this.humanTeam !== null) this.setControlled(this.humanTeam === teamIdx ? taker : this.closestToBall(this.humanTeam));
    this.emit({ type: 'kickoff', half: this.half });
  }

  private restart(kind: SetPieceKind, teamIdx: number, pos: V2, preferred?: Agent) {
    const t = this.teams[teamIdx]; const opp = this.opponentsOf(teamIdx);
    const { length: L, boxDepth, boxWidth } = this.pitch;
    this.ball.reset(pos.x, pos.z);
    let taker: Agent;
    if (kind === 'goalkick') taker = t.agents[0];
    else if (kind === 'penalty') taker = t.agents.filter((a) => !a.isGK).sort((p, q) => q.skill.shoot - p.skill.shoot)[0];
    else taker = preferred && !preferred.isGK ? preferred : t.agents.filter((a) => !a.isGK).sort((p, q) => v2.dist(p.pos, pos) - v2.dist(q.pos, pos))[0];
    for (const a of this.agents) { a.hasBall = false; a.action = null; a.pendingKick = null; a.stunned = 0; }
    // Face the ball toward goal for shots, otherwise into the pitch.
    const goalX = t.attackDir * L / 2;
    const into = kind === 'penalty' || kind === 'freekick' ? v2.norm({ x: goalX - pos.x, z: -pos.z }) : kind === 'throw' ? { x: 0, z: -Math.sign(pos.z) } : kind === 'corner' ? v2.norm({ x: -Math.sign(pos.x) * 0.4, z: -Math.sign(pos.z) }) : { x: t.attackDir, z: 0 };
    taker.pos = v2.sub(pos, v2.scale(into, kind === 'throw' ? 0.3 : 0.55)); taker.prevPos = { ...taker.pos }; taker.vel = { x: 0, z: 0 }; taker.heading = into;
    // Opponents give the ball room; penalties clear the box.
    const room = kind === 'throw' ? 2 : kind === 'goalkick' ? 0 : this.pitch.futsal ? 5 : 9.15;
    for (const a of opp.agents) {
      if (kind === 'penalty' && a.isGK) { a.pos = { x: -opp.attackDir * (L / 2 - 0.3), z: 0 }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; continue; }
      const d = v2.sub(a.pos, pos); const dl = v2.len(d);
      if (dl < room) { a.pos = v2.add(pos, v2.scale(dl > 0.1 ? v2.norm(d) : { x: -t.attackDir, z: 0 }, room)); a.prevPos = { ...a.pos }; }
    }
    if (kind === 'penalty') {
      const lineX = -opp.attackDir * L / 2; const edge = lineX + opp.attackDir * (boxDepth + 1);
      for (const a of this.agents) {
        if (a === taker || (a.isGK && a.team === opp.index)) continue;
        if (Math.abs(a.pos.x - lineX) < boxDepth + 1 && Math.abs(a.pos.z) < boxWidth / 2 + 1) { a.pos = { x: edge, z: a.pos.z }; a.prevPos = { ...a.pos }; }
      }
    }
    this.setPiece = { kind, team: teamIdx, taker, pos };
    this.phase = 'restart'; this.phaseTimer = kind === 'penalty' ? 1.8 : kind === 'goalkick' ? 1.2 : 1.0;
    this.possessionTeam = teamIdx;
    if (this.humanTeam === teamIdx && !taker.isGK) this.setControlled(taker);
    else if (this.humanTeam !== null && this.humanTeam !== teamIdx) this.setControlled(this.closestToBall(this.humanTeam));
    this.emit({ type: 'setpiece', kind, team: teamIdx });
  }

  setControlled(a: Agent | null) {
    if (this.controlled === a) return;
    if (this.controlled) this.controlled.isHuman = false;
    this.controlled = a;
    if (a) { a.isHuman = true; a.intent = { move: { x: 0, z: 0 }, sprint: false }; this.lastSwitch = this.time; this.emit({ type: 'switch', agent: a }); }
  }
  closestToBall(teamIdx: number, exclude?: Agent | null): Agent {
    const t = this.teams[teamIdx]; const bp = { x: this.ball.x, z: this.ball.z };
    return t.agents.filter((a) => !a.isGK && a !== exclude).sort((p, q) => v2.dist(p.pos, bp) - v2.dist(q.pos, bp))[0];
  }

  /* ------------------------------ main loop ------------------------------ */
  /** Advance by a frame: input is read once, then the simulation runs in fixed steps. */
  update(dt: number, input?: InputManager) {
    if (this.ended || this.paused) return;
    if (input && this.controlled && this.humanTeam !== null) this.handleHuman(input, dt);
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP && !this.ended) { this.step(STEP); this.acc -= STEP; }
    this.alpha = this.acc / STEP;
  }

  private step(h: number) {
    this.stepCount++;
    this.time += h;
    if (this.phase === 'play' || this.phase === 'restart' || this.phase === 'dead') this.clock += h;
    this.director?.update(h);

    if (this.phaseTimer > 0) {
      this.phaseTimer -= h;
      if (this.phaseTimer <= 0) {
        if (this.phase === 'kickoff' || this.phase === 'restart') { this.phase = 'play'; if (this.setPiece) this.giveControl(this.setPiece.taker); }
        else if (this.phase === 'dead') { const r = this.pendingRestart; this.pendingRestart = null; r?.(); }
        else if (this.phase === 'goal') this.kickoff(this.lastConceded);
        else if (this.phase === 'halftime') { this.half = 2; this.kickoff(this.firstKickoff === 0 ? 1 : 0); }
      }
    }
    for (const a of this.agents) a.intent.steer = null;
    for (const t of this.teams) updateTeamAI(this, t, h);
    this.applyPhaseConstraints();
    if (this.phase === 'play') { this.updatePendingKicks(); this.dribbleAssist(); }

    for (const a of this.agents) {
      const mul = this.mods.speedMul[a.team] * this.teamSpeedBonus[a.team] * (this.phase === 'goal' || this.phase === 'dead' ? 0.55 : 1);
      a.update(h, mul, this.surface.grip);
      const lim = { x: this.pitch.length / 2 + 3, z: this.pitch.width / 2 + 3 };
      a.pos.x = Math.max(-lim.x, Math.min(lim.x, a.pos.x)); a.pos.z = Math.max(-lim.z, Math.min(lim.z, a.pos.z));
    }
    this.resolveActions();
    if (this.phase === 'play') { this.updateOwnership(); this.dribble(); this.ballContacts(); }
    this.holdBall();
    this.director?.steer(h);
    const ev = this.ball.update(h, this.goals);
    if (ev === 'post' || ev === 'bar') { this.emit({ type: 'post', bar: ev === 'bar' }); if (this.ball.inFlightShot) this.ball.inFlightShot = null; }
    if (this.phase === 'play') this.checkBounds();
    this.separateAgents();
    for (const a of this.agents) a.hasBall = this.ball.owner === a;
    if (this.ball.owner) this.possessionTeam = this.ball.owner.team;
    this.updateClockPhases();
  }

  /** Kick-offs and restarts: everyone holds position, the taker waits at the ball, opponents keep their distance. */
  private applyPhaseConstraints() {
    if (this.phase === 'kickoff' || this.phase === 'halftime') { for (const a of this.agents) { a.intent.move = { x: 0, z: 0 }; a.intent.sprint = false; } return; }
    const sp = this.setPiece;
    if (!sp || (this.phase !== 'restart' && this.phase !== 'play')) return;
    if (this.phase === 'restart') { sp.taker.intent.steer = { x: 0, z: 0 }; }
    else if (sp.taker === this.ball.owner) { if (!sp.taker.pendingKick) sp.taker.intent.steer = { x: 0, z: 0 }; }
    const room = sp.kind === 'throw' ? 2 : sp.kind === 'goalkick' || sp.kind === 'kickoff' ? 0 : this.pitch.futsal ? 5 : 9.15;
    if (room > 0) for (const a of this.opponentsOf(sp.team).agents) {
      if (a.isGK && sp.kind === 'penalty') { a.intent.move = { x: 0, z: (this.ball.z * 0.2 - a.pos.z) }; continue; }
      const d = v2.sub(a.pos, sp.pos); const dl = v2.len(d);
      if (dl < room + 0.5) { a.intent.move = dl > 0.1 ? v2.norm(d) : { x: 1, z: 0 }; a.intent.sprint = false; }
    }
  }

  private updateClockPhases() {
    if (this.phase !== 'play' && this.phase !== 'restart' && this.phase !== 'dead') return;
    const f = this.frac;
    const pending = this.director ? !this.director.done : false;
    if (this.half === 1 && f >= 0.5 && this.phase === 'play') {
      const e = this.director?.pending;
      if (!e || e.t > 0.5 || f >= 0.6) {
        this.phase = 'halftime'; this.phaseTimer = 3; this.setPiece = null;
        for (const t of this.teams) t.attackDir = (t.attackDir === 1 ? -1 : 1);
        this.ball.owner = null; this.ball.held = false; this.emit({ type: 'halftime' }); this.stoppage = false; return;
      }
      this.stoppage = true;
    }
    if (this.half === 2 && f >= 1) {
      if (!pending && this.phase === 'play') { this.fullTime(); return; }
      this.stoppage = true;
      if (f >= OVERRUN_LIMIT) this.awardRemaining();
    }
  }

  private fullTime() { this.phase = 'fulltime'; this.ended = true; this.ball.owner = null; this.emit({ type: 'fulltime' }); }

  /** Failsafe: the human has stalled the match past the stoppage limit; the remaining scripted goals are awarded. */
  private awardRemaining() {
    const d = this.director!;
    while (!d.done) {
      const e = d.pending!; const team = d.teamOf(e);
      const t = this.teams[team]; t.score++; d.onGoal(team);
      this.emit({ type: 'goal', team, scorer: t.agents[t.agents.length - 1], forced: true });
    }
    this.fullTime();
  }

  /** Give a player control of a (stationary) ball, e.g. a set-piece taker. */
  private giveControl(a: Agent) {
    const b = this.ball;
    if (a.isGK && this.setPiece?.kind !== 'goalkick' && this.inOwnBox(a, b.x, b.z)) { b.held = true; }
    b.owner = a; b.lastTouch = a; b.lastTouchTeam = a.team; this.possessionTeam = a.team;
    a.ai.nextDecision = this.time + 0.35 + Math.random() * 0.3;
    this.aimUpfield(a);
  }

  /** Default carry direction for an AI player who has just won the ball: toward the opponents' goal. */
  private aimUpfield(a: Agent) {
    const gx = this.teams[a.team].attackDir * this.pitch.length / 2;
    a.ai.mode = 'dribble'; a.ai.target = { x: a.pos.x + Math.sign(gx - a.pos.x) * 6, z: a.pos.z * 0.85 };
    if (this.aiDriven(a)) a.intent.move = v2.norm(v2.sub(a.ai.target, a.pos));
  }

  /* ------------------------------ human control ------------------------------ */
  stickToWorld(x: number, y: number): V2 {
    const { right, forward } = this.controlBasis;
    return { x: right.x * x + forward.x * y, z: right.z * x + forward.z * y };
  }
  aiDriven(a: Agent) { return !a.isHuman || this.autopilot; }

  private handleHuman(input: InputManager, dt: number) {
    const me = this.controlled!; const team = this.teams[this.humanTeam!];
    const move = this.stickToWorld(input.move.x, input.move.y);
    const active = v2.len(move) > 0.1 || input.sprint.down || input.pass.down || input.shoot.down || input.through.down || input.lob.down || input.switch.down || input.slide.down;
    this.idleTime = active ? 0 : this.idleTime + dt;
    this.autopilot = this.idleTime > 2.0;
    if (this.autopilot) { this.charge = null; return; }
    me.intent.move = move; me.intent.sprint = input.sprint.down; me.intent.face = null; me.intent.jockey = false;
    if (this.phase !== 'play' && this.phase !== 'restart') return;
    const b = this.ball; const bp = { x: b.x, z: b.z };
    const dBall = v2.dist(me.pos, bp);
    // On the ball, or close enough to a loose ball to strike it first time.
    const canKick = (b.owner === me && !b.held) || (!b.owner && dBall < 2.6 && b.y < 1.4);
    const aimDir = v2.len(move) > 0.2 ? v2.norm(move) : me.heading;
    if (canKick && this.phase === 'play') {
      if (input.shoot.down) { if (!this.charge || this.charge.kind !== 'shoot') this.charge = { kind: 'shoot', t: 0 }; else this.charge.t += dt; }
      if (input.pass.down) { if (!this.charge || this.charge.kind !== 'pass') this.charge = { kind: 'pass', t: 0 }; else this.charge.t += dt; }
      if (input.shoot.justReleased && !me.busy()) { const p = Math.min(1, Math.max(0.22, this.charge?.t ?? 0.3) / 0.9); this.startKick(me, this.setPiece?.kind === 'throw' ? 'pass' : 'shoot', p, aimDir, { finesse: input.finesse.down }); this.charge = null; }
      else if (input.pass.justReleased && !me.busy()) { const p = Math.min(1, Math.max(0.2, this.charge?.t ?? 0.2) / 0.5); this.startKick(me, 'pass', p, aimDir, {}); this.charge = null; }
      else if (input.through.justPressed && !me.busy()) this.startKick(me, 'through', 0.7, aimDir, {});
      else if (input.lob.justPressed && !me.busy()) this.startKick(me, 'lob', 0.7, aimDir, {});
      if (input.shield.down && b.owner === me) { me.intent.sprint = false; me.intent.move = v2.scale(move, 0.35); me.intent.jockey = true; }
      if (!input.shoot.down && !input.pass.down) this.charge = null;
      return;
    }
    this.charge = null;
    if (this.phase !== 'play') return;
    const opponentHasIt = b.owner && b.owner.team !== me.team;
    if (input.pass.down && v2.len(move) < 0.2 && opponentHasIt) {
      // Contain: shadow the carrier goal-side, facing the ball.
      const ownGoal = { x: -team.attackDir * this.pitch.length / 2, z: 0 };
      const spot = v2.add(bp, v2.scale(v2.norm(v2.sub(ownGoal, bp)), 1.4));
      const d = v2.sub(spot, me.pos); me.intent.move = v2.len(d) > 0.3 ? v2.scale(v2.norm(d), Math.min(1, v2.len(d))) : { x: 0, z: 0 };
      me.intent.face = v2.sub(bp, me.pos); me.intent.jockey = v2.len(d) < 3;
    }
    if (input.shoot.justPressed) this.tackle(me, 'tackle');
    if (input.through.justPressed || input.slide.justPressed) this.tackle(me, 'slide');
    if (input.switch.justPressed) this.setControlled(this.closestToBall(team.index, me));
    if (this.time - this.lastSwitch > 0.7 && (!b.owner || b.owner.team !== team.index) && !me.busy()) {
      const c = this.closestToBall(team.index);
      if (c !== me && v2.dist(c.pos, bp) + 3 < dBall) this.setControlled(c);
    }
  }

  /* ------------------------------ kicking ------------------------------ */
  /** Request a kick. The player takes it as soon as the ball is in reach (approaching it if needed). */
  startKick(a: Agent, kind: KickKind, power: number, dir: V2, opts: { targetAgent?: Agent; finesse?: boolean; botSkill?: number; target?: { x: number; z: number; y?: number }; clear?: boolean }) {
    if (a.busy()) return;
    a.pendingKick = { kind, power, dir, opts, t0: this.time };
    this.charge = null;
  }

  private ballLocal(a: Agent) {
    const r = v2.sub({ x: this.ball.x, z: this.ball.z }, a.pos);
    return { f: v2.dot(r, a.heading), lat: r.x * -a.heading.z + r.z * a.heading.x, d: v2.len(r) };
  }

  private updatePendingKicks() {
    const b = this.ball;
    for (const a of this.agents) {
      const pk = a.pendingKick; if (!pk) continue;
      const mine = b.owner === a;
      if (a.legsBusy() || (b.owner && !mine) || this.time - pk.t0 > 1.4) { a.pendingKick = null; continue; }
      if (a.action?.type === 'kick') continue;
      const { f, lat, d } = this.ballLocal(a);
      const held = mine && b.held;
      const inReach = held || (f > -0.1 && f < 1.0 && Math.abs(lat) < 0.75 && b.y < 1.1 && d < 1.1);
      if (inReach) {
        // Plant and strike: the kicking foot is the one on the ball's side.
        const foot = lat >= 0 ? 1 : -1;
        const relV = Math.hypot(b.vx - a.vel.x, b.vz - a.vel.z);
        if (mine && !held && relV > 2) { b.vx = a.vel.x * 0.85; b.vz = a.vel.z * 0.85; b.setRolling(); } // set touch
        const act = a.startAction('kick', pk.kind === 'lob' || pk.kind === 'shoot' ? 0.5 : 0.4, foot, { ...pk, strike: held ? 0.2 : 0.15, held });
        a.intent.face = pk.dir;
        void act;
      } else if (d < 4 && (!mine || this.setPiece?.taker === a || d > 1.0)) {
        // step up to the ball (set pieces) or meet it (first-time strikes)
        const to = v2.sub({ x: b.x - pk.dir.x * 0.4, z: b.z - pk.dir.z * 0.4 }, a.pos);
        a.intent.steer = v2.len(to) > 0.1 ? v2.scale(v2.norm(to), Math.min(1, v2.len(to) + 0.3)) : { x: 0, z: 0 };
        a.intent.face = pk.dir;
      }
    }
  }

  private pickPassTarget(a: Agent, dir: V2, through: boolean): Agent | null {
    const t = this.teams[a.team]; let best: Agent | null = null; let bs = -Infinity;
    for (const m of t.agents) {
      if (m === a) continue;
      const d = v2.sub(m.pos, a.pos); const dist = v2.len(d); if (dist < 1.5) continue;
      const cos = v2.dot(v2.norm(d), dir);
      if (cos < 0.3) continue;
      const fwd = (m.pos.x - a.pos.x) * t.attackDir;
      const s = cos * 2.2 - dist * (through ? 0.015 : 0.03) + (through ? fwd * 0.03 : 0) - (m.isGK ? 1.5 : 0);
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  private fireKick(a: Agent, d: any) {
    const b = this.ball; const kind: KickKind = d.kind; const team = this.teams[a.team]; const dir0: V2 = d.dir;
    const human = a.isHuman && !this.autopilot; const skill = d.botSkill ?? 0.55;
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
    const throwIn = this.setPiece?.kind === 'throw' && this.setPiece.taker === a && !this.pitch.futsal; // futsal restarts with a kick-in
    const from: V3 = throwIn ? { x: b.x, y: 2.0, z: b.z } : d.held ? { x: a.pos.x + a.heading.x * 0.35, y: 1.0, z: a.pos.z + a.heading.z * 0.35 } : { x: b.x, y: b.y, z: b.z };
    const sprinting = a.speed() > a.maxSpeed * 0.75;
    let v: V3; let w: V3; let yawErr = 0, pitchErr = 0;
    if (kind === 'shoot' && !throwIn) {
      const { length: L, goalWidth: gw, goalHeight: gh } = this.pitch;
      const gx = team.attackDir * (L / 2 + 0.3);
      const power = d.power as number;
      let zHit: number;
      if (d.target) zHit = d.target.z;
      else if (dir0.x * team.attackDir > 0.15) {
        zHit = a.pos.z + (dir0.z / dir0.x) * (gx - a.pos.x);
        const edge = gw / 2 - 0.4;
        if (Math.abs(zHit) > edge) zHit = Math.sign(zHit) * (edge + (Math.abs(zHit) - edge) * (human ? 0.25 : 0.1)); // aim assist
      } else zHit = a.pos.z + dir0.z * 20;
      const push = this.mods.pushTeam === a.team ? this.mods.pushLevel : 0;
      let yHit = d.target?.y ?? (0.3 + Math.pow(power, 1.7) * 2.6 * (d.finesse ? 0.7 : 1));
      if (!human && yHit > gh - 0.3) yHit = gh - 0.3 - Math.random() * 0.8;
      const speed = (15 + power * 17) * (d.finesse ? 0.8 : 1);
      const side = d.finesse ? Math.sign((zHit - from.z) * team.attackDir || 1) * -42 * team.attackDir * Math.sign(team.attackDir) : gauss() * 4;
      const top = d.finesse ? 6 : 8 + power * 22;
      const sol = solveKick(from, { x: gx, y: Math.max(0.15, yHit), z: zHit }, speed, side, top, this.surface);
      v = sol.v; w = sol.w;
      let sigma = human ? (0.085 - a.skill.shoot * 0.06) * (0.55 + power * 0.8) * (sprinting ? 1.25 : 1) : 0.13 - skill * 0.1;
      if (this.mods.goalAllowed[a.team] && push > 0) sigma *= 1 - push * 0.85;
      yawErr = gauss() * sigma; pitchErr = gauss() * sigma * 0.6;
      b.inFlightShot = { team: a.team, target: { x: gx, y: yHit, z: zHit } };
    } else {
      const through = kind === 'through';
      const lofted = kind === 'lob' || throwIn || (d.held && kind !== 'pass');
      const target: Agent | null = d.targetAgent ?? (d.clear ? null : this.pickPassTarget(a, dir0, through));
      let aim: V2;
      if (target) {
        const base = v2.dist(target.pos, a.pos);
        const tFlight = lofted ? Math.sqrt((2 * base) / G) * 0.9 : passTimeFor(base, this.surface);
        aim = v2.add(target.pos, v2.scale(target.vel, Math.min(tFlight, 1.8) * (through ? 1 : 0.6)));
        if (through) aim = v2.add(aim, { x: team.attackDir * Math.min(8, 3 + base * 0.2), z: 0 });
        target.ai.expectBall = this.time + Math.min(3.5, tFlight + 0.9);
      } else aim = v2.add(a.pos, v2.scale(dir0, d.clear ? 45 : 12 + d.power * 16));
      const lim = { x: this.pitch.length / 2 + 2, z: this.pitch.width / 2 + 2 };
      aim = { x: Math.max(-lim.x, Math.min(lim.x, aim.x)), z: Math.max(-lim.z, Math.min(lim.z, aim.z)) };
      const dist = Math.max(2, v2.dist(aim, { x: from.x, z: from.z }));
      if (lofted) {
        const theta = throwIn ? 0.45 : d.clear ? 0.75 : 0.62;
        const crossIntoBox = target && Math.abs(aim.x - team.attackDir * this.pitch.length / 2) < this.pitch.boxDepth + 2;
        const yT = crossIntoBox ? 1.6 : BALL_R;
        const speed = Math.min(throwIn ? 15 : 31, Math.max(8, Math.sqrt((G * dist) / Math.sin(2 * theta)) * 1.12));
        const sol = solveKick(from, { x: aim.x, y: yT, z: aim.z }, speed, 0, throwIn ? 0 : -25, this.surface, theta);
        v = sol.v; w = sol.w;
      } else {
        const speed = Math.max(6, Math.min(30, passSpeedFor(dist * (through ? 1.1 : 1), this.surface) * (0.92 + d.power * 0.16)));
        const yaw = Math.atan2(aim.z - from.z, aim.x - from.x);
        v = { x: Math.cos(yaw) * speed, y: dist > 30 ? 1.2 : 0, z: Math.sin(yaw) * speed };
        w = { x: v.z / BALL_R, y: 0, z: -v.x / BALL_R };
      }
      const sigma = human ? 0.025 + (1 - a.skill.pass) * 0.03 : 0.11 - skill * 0.09;
      yawErr = gauss() * sigma * (sprinting ? 1.3 : 1); pitchErr = lofted ? gauss() * sigma * 0.5 : 0;
      b.inFlightShot = null;
    }
    // Apply strike error by rotating the launch velocity.
    const hs = Math.hypot(v.x, v.z), sp = Math.hypot(hs, v.y);
    const yaw = Math.atan2(v.z, v.x) + yawErr, pitch = Math.atan2(v.y, hs) + pitchErr;
    const nv = { x: Math.cos(yaw) * Math.cos(pitch) * sp, y: Math.sin(pitch) * sp, z: Math.sin(yaw) * Math.cos(pitch) * sp };
    if (d.held || throwIn) { b.x = from.x; b.y = from.y; b.z = from.z; }
    b.strike(nv, w, a, this.time);
    a.hasBall = false; a.cooldown = 0.3; a.pendingKick = null;
    if (this.setPiece?.taker === a) this.setPiece = null;
    this.emit({ type: 'kick', kind, power: d.power, agent: a });
  }

  /* ------------------------------ tackles & fouls ------------------------------ */
  /** Start a tackle aimed at where the ball will be. Returns false if the player is still committed to a previous one. */
  tackle(a: Agent, kind: 'tackle' | 'slide'): boolean {
    if (a.busy() || a.stunned > 0 || a.tackleCooldown > 0 || a.isGK) return false;
    const b = this.ball; const lead = kind === 'slide' ? 0.3 : 0.2;
    const tgt = { x: b.x + b.vx * lead, z: b.z + b.vz * lead };
    let dir = v2.norm(v2.sub(tgt, a.pos)); if (v2.len(dir) < 0.5) dir = a.heading;
    a.heading = dir;
    if (kind === 'slide') {
      a.startAction('slide', 1.35, 1, { dir, speed: Math.max(a.speed(), 5.5) + 2.5, slideFactor: this.surface.slide, ball: false, foul: false });
      a.tackleCooldown = 1.9;
    } else {
      a.startAction('tackle', 0.62, 1, { dir, ball: false, foul: false });
      a.tackleCooldown = 1.0;
    }
    a.pendingKick = null;
    return true;
  }

  private resolveActions() {
    const b = this.ball;
    for (const a of this.agents) {
      const act = a.action; if (!act) continue;
      if (act.type === 'kick' && !act.fired && act.t >= act.data.strike) {
        act.fired = true;
        const { d } = this.ballLocal(a);
        if ((act.data.held && b.owner === a) || (!b.held && d < 1.15 && b.y < 1.2 && (!b.owner || b.owner === a))) this.fireKick(a, act.data);
        else a.pendingKick = null; // whiffed: the ball moved away
      }
      if ((act.type === 'tackle' || act.type === 'slide') && this.phase === 'play') this.resolveTackle(a);
      if (act.type === 'dive') this.resolveDive(a);
    }
  }

  private resolveTackle(a: Agent) {
    const act = a.action!; const d = act.data; const b = this.ball;
    const slide = act.type === 'slide';
    const [t0, t1] = slide ? [0.06, 0.72] : [0.1, 0.36];
    if (act.t < t0) return;
    if (act.t > t1) { if (!d.ball && !d.foul && !d.missed) { d.missed = true; if (!slide) a.stunned = 0.35; } return; }
    const ext = slide ? 0.95 : 0.5 + 0.5 * Math.min(1, (act.t - t0) / (t1 - t0));
    const foot = v2.add(a.pos, v2.scale(d.dir, ext));
    // The ball first: a clean contact wins it.
    if (!d.ball && !b.held && b.y < 0.6 && v2.dist(foot, { x: b.x, z: b.z }) < (slide ? 0.55 : 0.42)) {
      d.ball = true;
      const prev = b.owner;
      const side = { x: -d.dir.z, z: d.dir.x }; const s = Math.random() < 0.5 ? -1 : 1;
      if (slide) {
        // A slide knocks it loose in the direction of the slide, deflected to one side.
        const speed = Math.max(3, a.speed() * 0.6 + 2.5);
        const kd = v2.norm(v2.add(d.dir, v2.scale(side, s * (0.4 + Math.random() * 0.5))));
        b.strike({ x: kd.x * speed, y: 0.4, z: kd.z * speed }, { x: 0, y: 0, z: 0 }, a, this.time);
        a.cooldown = 0.4;
      } else {
        // A standing tackle hooks the ball back toward the tackler, who comes away with it.
        const kd = v2.norm(v2.add(v2.scale(d.dir, -0.6), v2.scale(side, s * 0.8)));
        b.strike({ x: kd.x * 2.2 + a.vel.x * 0.3, y: 0, z: kd.z * 2.2 + a.vel.z * 0.3 }, { x: 0, y: 0, z: 0 }, a, this.time);
        b.setRolling(); b.owner = a; a.touchCooldown = 0.2; a.cooldown = 0;
      }
      b.inFlightShot = null;
      if (prev && prev !== a) { prev.touchCooldown = 0.5; prev.cooldown = 0.5; prev.pendingKick = null; prev.stunned = 0.3; }
      this.emit({ type: 'tackle', success: true, agent: a });
      return;
    }
    // Legs before ball: a foul. After the ball, a slide can still take the man down (no foul).
    if (d.foul) return;
    for (const o of this.opponentsOf(a.team).agents) {
      if (o.isGK && this.ball.held) continue;
      if (o.action?.type === 'fallen') continue;
      if (v2.dist(o.pos, foot) < (slide ? 0.6 : 0.4)) {
        if (d.ball) { if (slide && Math.random() < 0.5) o.startAction('fallen', 1.1, 1, { dir: v2.norm(o.vel) }); d.foul = true; return; }
        d.foul = true; this.foul(a, o, slide, d.dir);
        return;
      }
    }
  }

  private foul(by: Agent, on: Agent, slide: boolean, dir: V2) {
    on.startAction('fallen', 1.4, 1, { dir: v2.len(on.vel) > 0.5 ? v2.norm(on.vel) : dir });
    on.pendingKick = null;
    const victimTeam = this.teams[on.team]; const spot = { x: on.pos.x, z: on.pos.z };
    const { length: L, boxDepth, boxWidth } = this.pitch;
    const goalX = victimTeam.attackDir * L / 2;
    const penalty = Math.abs(spot.x - goalX) < boxDepth && Math.abs(spot.z) < boxWidth / 2;
    const fromBehind = v2.dot(dir, on.heading) > 0.5;
    const card = slide && (fromBehind || by.yellow > 0 || Math.random() < 0.3);
    if (card) by.yellow++;
    this.emit({ type: 'foul', by, on, penalty, card });
    const lim = { x: L / 2 - 1, z: this.pitch.width / 2 - 1 };
    const pos = penalty ? { x: goalX - victimTeam.attackDir * (this.pitch.futsal ? 6 : 11), z: 0 } : { x: Math.max(-lim.x, Math.min(lim.x, spot.x)), z: Math.max(-lim.z, Math.min(lim.z, spot.z)) };
    this.deadBall(1.3, () => this.restart(penalty ? 'penalty' : 'freekick', on.team, pos, on));
  }

  private deadBall(seconds: number, then: () => void) {
    this.phase = 'dead'; this.phaseTimer = seconds; this.pendingRestart = then;
    this.ball.owner = null; this.ball.inFlightShot = null; this.setPiece = null;
    for (const a of this.agents) a.pendingKick = null;
  }

  /* ------------------------------ keeper ------------------------------ */
  inOwnBox(a: Agent, x: number, z: number) {
    const { length: L, boxDepth, boxWidth } = this.pitch;
    const gx = -this.teams[a.team].attackDir * L / 2;
    return Math.abs(x - gx) < boxDepth + 0.5 && Math.abs(z) < boxWidth / 2 + 0.5;
  }

  /** Dives: the keeper's body sweeps from the feet toward outstretched hands; contact with the ball is a save. */
  private resolveDive(k: Agent) {
    const act = k.action!; const d = act.data; const b = this.ball;
    if (d.done || b.held || act.t < 0.05) return;
    const prog = Math.min(1, act.t / 0.4);
    const hands = { x: k.pos.x, y: 0.5 + (d.handY - 0.5) * prog, z: k.pos.z + d.side * (0.4 + d.reach * prog) };
    const base = { x: k.pos.x, y: 0.5, z: k.pos.z };
    // distance from ball to the body segment
    const sx = hands.x - base.x, sy = hands.y - base.y, sz = hands.z - base.z;
    const L2 = sx * sx + sy * sy + sz * sz;
    const t = Math.max(0, Math.min(1, ((b.x - base.x) * sx + (b.y - base.y) * sy + (b.z - base.z) * sz) / (L2 || 1)));
    const dist = Math.hypot(b.x - (base.x + sx * t), b.y - (base.y + sy * t), b.z - (base.z + sz * t));
    if (dist < BALL_R + 0.22 + (d.mode === 'wall' ? 0.2 : 0) && b.lastTouch !== k) { d.done = true; this.keeperContact(k, d.mode === 'wall'); }
  }

  /** Catch or parry depending on pace and handling. */
  keeperContact(k: Agent, wall: boolean) {
    const b = this.ball; const sp = b.speed3();
    const handling = (k.card.attrs.reflexes + k.card.attrs.diving) / 198;
    const catchP = sp < 13 ? 0.95 : Math.max(0.05, 0.95 - (sp - 13) / (14 + handling * 10)) + (wall ? 0.25 : 0);
    const caught = Math.random() < catchP;
    if (caught) {
      b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0; b.held = true; b.owner = k; k.keeperHold = 0;
      b.lastTouch = k; b.lastTouchTeam = k.team; b.lastTouchTime = this.time;
    } else {
      // Parry away from the goal mouth.
      const out = this.teams[k.team].attackDir;
      const lat = Math.sign(b.z - k.pos.z || (Math.random() - 0.5));
      b.strike({ x: out * (2 + Math.random() * 3), y: 2 + Math.random() * 3, z: lat * (4 + Math.random() * 5) }, { x: 0, y: 0, z: 0 }, k, this.time);
      k.cooldown = 0.5;
    }
    b.inFlightShot = null;
    this.emit({ type: 'save', keeper: k, caught });
  }

  private holdBall() {
    const b = this.ball; const k = b.owner;
    if (!b.held || !k) return;
    if (k.action?.type === 'kick' && k.action.fired) return;
    b.x = k.pos.x + k.heading.x * 0.3; b.z = k.pos.z + k.heading.z * 0.3; b.y = k.action?.type === 'dive' ? 0.4 : 1.05;
    b.vx = k.vel.x; b.vz = k.vel.z; b.vy = 0; b.wx = b.wy = b.wz = 0;
  }

  /* ------------------------------ dribbling & control ------------------------------ */
  /** Who controls the ball: the dribbler keeps it while it is near him and nobody is closer. */
  private updateOwnership() {
    const b = this.ball; const o = b.owner;
    if (!o || b.held) return;
    const d = v2.dist(o.pos, { x: b.x, z: b.z });
    if (d > 3.4 || b.y > 1.6 || o.legsBusy()) b.owner = null;
  }

  /** The direction a player wants to take the ball. */
  private dribbleDir(a: Agent): V2 | null {
    if (a.pendingKick) return a.pendingKick.dir;
    const m = a.intent.move; return v2.len(m) > 0.15 ? v2.norm(m) : null;
  }

  /** Steer the dribbler to the ball: run round it to take the next touch in the direction he wants to go. */
  private dribbleAssist() {
    const b = this.ball; const o = b.owner;
    if (!o || b.held || o.legsBusy() || o.action?.type === 'kick') return;
    if (this.setPiece?.taker === o) return;
    const want = this.dribbleDir(o);
    const { f, lat } = this.ballLocal(o);
    if (f > 0.05 && f < 0.85 && Math.abs(lat) < 0.5) return; // in touching range: keep running as intended
    const lead = 0.12;
    const bx = b.x + b.vx * lead, bz = b.z + b.vz * lead;
    const back = want ?? (b.speed() > 0.5 ? v2.norm({ x: b.vx, z: b.vz }) : o.heading);
    const spot = { x: bx - back.x * 0.35, z: bz - back.z * 0.35 };
    const to = v2.sub(spot, o.pos); const dl = v2.len(to);
    if (dl > 0.15) { const mag = Math.max(v2.len(o.intent.move), b.speed() > 1 ? 1 : 0.6); o.intent.steer = v2.scale(v2.norm(to), Math.min(1, mag)); }
  }

  /** Dribble touches: the ball is pushed ahead with each touch, further when sprinting and less precisely for weaker dribblers. */
  private dribble() {
    const b = this.ball; const o = b.owner;
    if (!o || b.held || o.legsBusy() || o.action?.type === 'kick' || o.touchCooldown > 0 || b.y > 0.45) return;
    if (this.setPiece?.taker === o) { b.vx *= 0.9; b.vz *= 0.9; return; }
    const { f, lat } = this.ballLocal(o);
    if (!(f > 0.05 && f < 0.85 && Math.abs(lat) < 0.5)) return;
    const want = this.dribbleDir(o);
    const sp = o.speed(); const frac = Math.min(1, sp / o.maxSpeed);
    if (want && !o.pendingKick) {
      const sprint = o.intent.sprint;
      const skill = o.skill.dribble;
      let knock = sprint ? 1.0 + 2.6 * frac : 0.35 + 1.0 * frac;
      knock *= 1.25 - skill * 0.5;
      if (o.intent.jockey) knock = 0.2;
      const err = (Math.random() + Math.random() - 1) * (0.03 + (1 - skill) * 0.1 + (sprint ? 0.04 : 0));
      const dir = v2.rot(want, err);
      const along = Math.max(sp * Math.max(0, v2.dot(v2.norm(o.vel.x || o.vel.z ? o.vel : dir), dir)), 0.8);
      const speed = along + knock;
      b.vx = dir.x * speed; b.vz = dir.z * speed; b.vy = 0; b.setRolling();
      o.touchCooldown = sprint ? 0.22 : 0.16;
    } else {
      // No direction: cushion and keep it close (sole trap).
      const rel = Math.hypot(b.vx - o.vel.x, b.vz - o.vel.z);
      if (rel < 0.4) return;
      b.vx = o.vel.x * 0.5; b.vz = o.vel.z * 0.5; b.setRolling();
      o.touchCooldown = 0.25;
    }
    o.lastTouchFoot = lat >= 0 ? 1 : -1;
    b.lastTouch = o; b.lastTouchTeam = o.team; b.lastTouchTime = this.time;
    if (!o.action) o.startAction('touch', 0.22, o.lastTouchFoot);
  }

  /** Loose-ball contacts: controls (first touch), headers, keeper handling and body blocks. */
  private ballContacts() {
    const b = this.ball;
    if (b.held) return;
    if (this.setPiece && b.owner === this.setPiece.taker) return;
    const bp = { x: b.x, z: b.z };
    const owner = b.owner;
    const ownerDist = owner ? v2.dist(owner.pos, bp) : Infinity;
    if (owner && ownerDist < 1.3) return; // at his feet: you have to tackle for it
    let best: Agent | null = null; let bestD = Infinity;
    for (const a of this.agents) {
      if (a === owner || (owner && a.team === owner.team)) continue;
      const fresh = b.lastTouch === a && this.time - b.lastTouchTime < 0.25;
      if (fresh) continue;
      const dh = v2.dist(a.pos, bp);
      if (dh > 2.6) continue;
      // Keepers dive separately; otherwise a goalkeeper can use his hands inside his box.
      const hands = a.isGK && this.inOwnBox(a, b.x, b.z) && !(this.setPiece);
      const act = a.action;
      const canPlay = a.cooldown <= 0 && a.stunned <= 0 && (!act || act.type === 'touch' || act.type === 'trap' || act.type === 'kick');
      // Back-pass rule: hands only for balls last played by an opponent.
      if (hands && canPlay && b.y < 2.4 && dh < 0.95 && b.lastTouchTeam !== a.team) {
        if (b.speed3() > 6 && b.lastTouchTeam !== a.team) { this.keeperContact(a, this.mods.keeper[a.team] === 'wall'); return; }
        b.vx = b.vy = b.vz = 0; b.held = true; b.owner = a; a.keeperHold = 0; b.lastTouch = a; b.lastTouchTeam = a.team; b.lastTouchTime = this.time; b.inFlightShot = null; return;
      }
      // During a scripted goal window the defending side can misread the ball (it runs under the foot, over the head).
      if (this.lapses(a)) continue;
      // Headers: ball at head height, close to the head.
      if (canPlay && !a.isGK && b.y > 1.25 && b.y < 2.45 && dh < 0.6 && b.vy < 3) { this.header(a); return; }
      // Foot/body control
      const footD = v2.dist(v2.add(a.pos, v2.scale(a.heading, 0.3)), bp);
      if (canPlay && b.y < 1.2 && footD < 0.7 && footD < bestD) { best = a; bestD = footD; continue; }
      // Body block: the ball hits a player who isn't playing it.
      if (dh < 0.32 && b.y < 1.85) this.bodyBlock(a);
    }
    if (best) this.firstTouch(best);
  }

  /** One roll per player per ball touch: does this defender switch off for this ball? (AI players only.) */
  lapses(a: Agent): boolean {
    const m = this.mods; const b = this.ball;
    if (m.defenseLapse <= 0 || m.pushTeam === null || a.team === m.pushTeam || b.lastTouchTeam !== m.pushTeam || a.isGK) return false;
    if (a.isHuman && !this.autopilot) return false;
    const key = b.lastTouchTime;
    if (a.ai.lapseKey !== key) { a.ai.lapseKey = key; a.ai.lapse = Math.random() < m.defenseLapse; }
    return a.ai.lapse;
  }

  private firstTouch(a: Agent) {
    const b = this.ball;
    const rel = Math.hypot(b.vx - a.vel.x, b.vy, b.vz - a.vel.z);
    const teamSkill = a.team === 0 ? this.mods.homeAiSkill : this.mods.botSkill;
    const skill = a.isHuman && !this.autopilot ? a.skill.control : a.skill.control * (0.7 + 0.6 * teamSkill);
    const diff = Math.max(0, rel - 7) / (9 + 16 * skill) + (b.y > 0.5 ? (b.y - 0.5) * 0.35 : 0);
    const p = Math.max(0.06, Math.min(0.99, 1.05 - diff));
    if (Math.random() < p) {
      const want = this.dribbleDir(a) ?? (v2.len(a.vel) > 0.5 ? v2.norm(a.vel) : a.heading);
      const s = 0.6 + Math.min(2.5, rel * 0.06) + v2.len(a.vel) * 0.85;
      b.vx = want.x * s; b.vz = want.z * s; b.vy = Math.min(0, b.vy * 0.2); if (b.y < 0.3) b.setRolling(); else { b.wx = b.wy = b.wz = 0; }
      b.owner = a; b.lastTouch = a; b.lastTouchTeam = a.team; b.lastTouchTime = this.time; b.inFlightShot = null;
      a.touchCooldown = 0.18; a.ai.nextDecision = this.time + 0.25 + Math.random() * 0.25;
      this.aimUpfield(a);
      if (!a.action) a.startAction('trap', 0.3, a.lastTouchFoot);
      if (this.humanTeam === a.team && !a.isHuman && !a.isGK) this.setControlled(a);
      this.emit({ type: 'touch', agent: a, heavy: false });
    } else {
      this.deflect(a, 0.45);
      this.emit({ type: 'touch', agent: a, heavy: true });
    }
  }

  private header(a: Agent) {
    const b = this.ball; const team = this.teams[a.team];
    const { length: L, goalWidth, boxDepth } = this.pitch;
    const gx = team.attackDir * L / 2;
    const attacking = Math.abs(a.pos.x - gx) < boxDepth + 4;
    a.startAction('header', 0.55, 1, { dir: a.heading });
    let v: V3;
    if (attacking) {
      const z = (Math.random() < 0.5 ? -1 : 1) * goalWidth * (0.2 + Math.random() * 0.2);
      const sol = solveKick({ x: b.x, y: b.y, z: b.z }, { x: gx + team.attackDir * 0.3, y: 0.6 + Math.random() * 1.2, z }, 13 + Math.random() * 4, 0, 0, this.surface);
      v = sol.v; b.inFlightShot = { team: a.team, target: { x: gx, y: 1, z } };
    } else {
      const away = v2.norm({ x: team.attackDir, z: Math.sign(b.z || 1) * 0.6 });
      v = { x: away.x * 11, y: 6, z: away.z * 11 }; b.inFlightShot = null;
    }
    b.strike(v, { x: 0, y: 0, z: 0 }, a, this.time); a.cooldown = 0.3;
    this.emit({ type: 'header', agent: a });
  }

  private bodyBlock(a: Agent) {
    const b = this.ball;
    const n = v2.norm({ x: b.x - a.pos.x, z: b.z - a.pos.z });
    const rvx = b.vx - a.vel.x, rvz = b.vz - a.vel.z; const vn = rvx * n.x + rvz * n.z;
    if (vn >= -0.5) return;
    b.vx -= 1.35 * vn * n.x; b.vz -= 1.35 * vn * n.z; b.vx *= 0.75; b.vz *= 0.75; b.vy = Math.abs(b.vy) * 0.4 + 0.3;
    b.wx *= 0.3; b.wy *= 0.3; b.wz *= 0.3;
    b.x = a.pos.x + n.x * 0.34; b.z = a.pos.z + n.z * 0.34;
    b.lastTouch = a; b.lastTouchTeam = a.team; b.lastTouchTime = this.time; b.inFlightShot = null; b.owner = null;
    a.cooldown = 0.15;
  }

  private deflect(a: Agent, restitution: number) {
    const b = this.ball;
    const n = v2.norm({ x: b.x - a.pos.x + (Math.random() - 0.5) * 0.6, z: b.z - a.pos.z + (Math.random() - 0.5) * 0.6 });
    const rel = Math.hypot(b.vx - a.vel.x, b.vz - a.vel.z);
    b.vx = n.x * rel * restitution + a.vel.x * 0.5; b.vz = n.z * rel * restitution + a.vel.z * 0.5; b.vy = Math.max(b.vy * 0.3, 0.6);
    b.wx = b.wy = b.wz = 0;
    b.lastTouch = a; b.lastTouchTeam = a.team; b.lastTouchTime = this.time; b.inFlightShot = null; b.owner = null;
    a.cooldown = 0.35;
  }

  /* ------------------------------ lines & goals ------------------------------ */
  private checkBounds() {
    const b = this.ball; const { length: L, width: W, goalWidth: gw, goalHeight: gh } = this.pitch;
    const r = b.radius;
    if (this.setPiece && b.owner === this.setPiece.taker) return; // ball placed for a throw/corner, not yet taken
    if (Math.abs(b.x) > L / 2 + r) {
      const side = Math.sign(b.x) as 1 | -1;
      const scoring = this.teams.find((t) => t.attackDir === side)!;
      const defending = this.opponentsOf(scoring.index);
      const crossedInFrame = Math.abs(b.z) < gw / 2 && b.y < gh;
      if (crossedInFrame) {
        if (this.director && !this.director.allowGoal(scoring.index)) {
          // Failsafe (the director steers shots away long before this): knocked back off the line.
          b.x = side * (L / 2 - r); b.vx = -side * Math.abs(b.vx) * 0.4; b.vy = Math.max(1.5, b.vy); b.wx = b.wy = b.wz = 0;
          b.inFlightShot = null; b.lastTouchTeam = defending.index; this.emit({ type: 'post', bar: false });
          return;
        }
        this.scoreGoal(scoring.index);
        return;
      }
      if (b.held) return;
      const lastAttack = b.lastTouchTeam === scoring.index;
      const zSide = Math.sign(b.z || 1);
      this.emit({ type: 'out', kind: lastAttack ? 'goalkick' : 'corner' });
      this.deadBall(1.1, () => lastAttack
        ? this.restart('goalkick', defending.index, { x: side * (L / 2 - (this.pitch.futsal ? 2.5 : 5.5)), z: zSide * (this.pitch.futsal ? 2 : 6) })
        : this.restart('corner', scoring.index, { x: side * (L / 2 - 0.4), z: zSide * (W / 2 - 0.4) }));
      return;
    }
    if (Math.abs(b.z) > W / 2 + r && !b.held) {
      const team = b.lastTouchTeam === 0 ? 1 : 0;
      const pos = { x: Math.max(-L / 2 + 1, Math.min(L / 2 - 1, b.x)), z: Math.sign(b.z) * (W / 2 - 0.15) };
      this.emit({ type: 'out', kind: 'throw' });
      this.deadBall(1.1, () => this.restart('throw', team, pos));
    }
  }

  private scoreGoal(teamIdx: number) {
    const t = this.teams[teamIdx];
    t.score++;
    this.director?.onGoal(teamIdx);
    const scorer = this.ball.lastTouch && this.ball.lastTouch.team === teamIdx ? this.ball.lastTouch : null;
    this.phase = 'goal'; this.phaseTimer = 4.6; this.lastConceded = teamIdx === 0 ? 1 : 0; this.setPiece = null;
    this.ball.owner = null; this.ball.inFlightShot = null;
    for (const a of this.agents) { a.hasBall = false; a.pendingKick = null; if (a.action?.type === 'kick') a.action = null; }
    if (scorer) { scorer.action = null; scorer.startAction('celebrate', 4.4, Math.random() < 0.5 ? 1 : -1, { style: Math.floor(Math.random() * 3) }); }
    this.lastScorer = scorer; this.lastScorerTeam = teamIdx;
    this.emit({ type: 'goal', team: teamIdx, scorer });
  }

  private separateAgents() {
    const n = this.agents.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = this.agents[i], b = this.agents[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z; const d2 = dx * dx + dz * dz;
      const min = 0.62;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2); const push = (min - d) / 2; const nx = dx / d, nz = dz / d;
        // stronger players hold their ground
        const wa = 0.5 + (b.card.attrs.physical - a.card.attrs.physical) / 200;
        a.pos.x -= nx * push * 2 * wa; a.pos.z -= nz * push * 2 * wa; b.pos.x += nx * push * 2 * (1 - wa); b.pos.z += nz * push * 2 * (1 - wa);
      }
    }
  }
}

export { spinVector };
