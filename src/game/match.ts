import type { MatchScript, PlayerCard } from '@shared/types';
import type { Kit, Team } from '@shared/teams';
import { Ball, BallBody, BALL_R, G, passForTime, passSpeedFor, passTimeFor, predictLanding, predictPath, predictRest, solveKick, spinVector, type GoalFrame, type PathPoint, type V3 } from './ball';
import { Agent } from './player';
import { FORMATION_433, FORMATION_FUTSAL, v2, type PitchSpec, type V2 } from './pitch';
import { Director, FREE_PLAY, OVERRUN_LIMIT, type Modifiers } from './director';
import { updateTeamAI, interceptPoint, receivePoint } from './ai';
import { SURFACES, type Surface, type SurfaceId } from './surface';
import { Motion } from './motion';
import { SKILLS, SkillStick, skillExit, skillFrame, type SkillMove } from './skills';
import { pointSegment, segmentSegment, type Capsule, type Side } from './skeleton';
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
/** Controller settings: how much the game helps passes and shots, and when it switches player for you. */
export interface ControlPrefs { pass: 'assisted' | 'semi'; shot: 'assisted' | 'semi'; switching: 'auto' | 'air' | 'manual'; }

export type CelebStyle = 'slide' | 'pump' | 'leap' | 'plane';
export type SetPieceKind = 'kickoff' | 'throw' | 'corner' | 'goalkick' | 'freekick' | 'penalty';
/** An in-match free kick, set up FIFA style: a wall sized by the danger, the keeper shading off it, and the taker
 *  lining it up (an aim point on the goal for a shooting chance, a direction for one that can only be played in). */
export interface FreeKick {
  team: number; taker: Agent; pos: V2;
  /** Close and central enough to shoot from. */
  direct: boolean;
  wall: Agent[]; wallSpots: V2[];
  /** The side of the goal the wall covers (the near post): +1 / -1 in z. */
  nearSide: number;
  /** Direct: where on the goal plane the taker is aiming (z across, y up). */
  aim: { z: number; y: number };
  /** Indirect: the direction the taker is facing to play it. */
  dir: V2;
  /** -1..1: + bends to the taker's right. */
  curl: number;
  /** Where the defending keeper stands. */
  keeperZ: number;
  /** When a bot taker strikes it. */
  aiAt: number;
}
export type MatchEvent =
  | { type: 'goal'; team: number; scorer: Agent | null; forced?: boolean; ownGoal?: Agent }
  | { type: 'post'; bar: boolean } | { type: 'save'; keeper: Agent; caught: boolean } | { type: 'kickoff'; half: number } | { type: 'halftime' } | { type: 'fulltime' } | { type: 'overtime'; size: number }
  | { type: 'out'; kind: 'throw' | 'corner' | 'goalkick' } | { type: 'kick'; kind: KickKind; power: number; agent: Agent }
  | { type: 'tackle'; success: boolean; agent: Agent } | { type: 'switch'; agent: Agent } | { type: 'touch'; agent: Agent; heavy: boolean }
  | { type: 'foul'; by: Agent; on: Agent; penalty: boolean; card: 'yellow' | 'red' | null; secondYellow?: boolean } | { type: 'setpiece'; kind: SetPieceKind; team: number } | { type: 'header'; agent: Agent } | { type: 'skill'; agent: Agent; move: SkillMove } | { type: 'penaltyTiming'; result: 'green' | 'good' | 'poor' } | { type: 'offside'; agent: Agent }
  | { type: 'addedTime'; half: number; minutes: number } | { type: 'extratime' } | { type: 'shootout'; first: number }
  | { type: 'shootoutKick'; team: number; scored: boolean; taker: Agent } | { type: 'shootoutEnd'; winner: number; home: number; away: number };

export class TeamState {
  score = 0; agents: Agent[] = []; kickoffs = 0;
  /** Players sent off. */
  reds = 0;
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
  /** The human's last pass and its intended receiver, who is helped to the ball (the ball itself flies untouched). */
  passAssist: { passer: Agent; receiver: Agent; aim: V2; until: number; lofted: boolean; spot: V2 | null; run: V2 | null } | null = null;
  /** The controlled player is being steered by the receive assist this step (his first touch then takes it on, or settles it). */
  private receiveAssisting = false;
  /** The human's stick this frame (world space). */
  private stick: V2 = { x: 0, z: 0 };
  private restartAt = 0;
  half = 1;
  possessionTeam = -1;
  controlled: Agent | null = null;
  director: Director | null = null;
  mods: Modifiers = { ...FREE_PLAY, speedMul: [1, 1], keeper: ['normal', 'normal'], goalAllowed: [true, true], shotAppetite: [1, 1], ownGoal: [0, 0] };
  teamSpeedBonus: [number, number] = [1, 1];
  charge: { kind: 'shoot' | 'pass' | 'lob' | 'fk' | 'through' | 'pen'; t: number; low?: boolean } | null = null;
  /** A penalty (FIFA style): aim cursor on the goal (springs back to the middle), power, the timed second press, and
   *  the defending keeper's chosen dive. Null otherwise. */
  penalty: { team: number; taker: Agent; aim: { z: number; y: number }; stage: 'aim' | 'runup' | 'struck'; power: number; releasedAt: number; pressAt: number; strikeAt: number;
    guess: { z: number; y: number } | null; aiAt: number; result?: 'green' | 'good' | 'poor' } | null = null;
  /** The free kick being lined up (null otherwise); cleared the moment it is taken. */
  freeKick: FreeKick | null = null;
  /** When the last free kick was struck, and from where (the renderer follows it with the free-kick camera briefly). */
  lastFreeKick: { at: number; team: number; direct: boolean; dir: V2; pos: V2 } | null = null;
  /** Futsal sudden-death overtime (null until it starts): 3v3, then 2v2 after 15 s, then 1v1 after 30 s. */
  overtime: { start: number; size: number; at: number } | null = null;
  /** Players sent off the court as overtime shrinks the teams: they walk to the touchline and watch. */
  benched: Agent[] = [];
  /** The human's controller settings (set by the match screen). */
  controls: ControlPrefs = { pass: 'assisted', shot: 'assisted', switching: 'auto' };
  /** A quick tap of shoot waits a moment for a second press (double tap, then hold = low driven shot). */
  private shotTap: { at: number; power: number; finesse: boolean } | null = null;
  ended = false;
  stoppage = false;
  /** Added time announced for each half (in match minutes; -1 until the board goes up). */
  added: [number, number] = [-1, -1];
  /** Extra time (when the result is still open at the end of the 90): from/to, as fractions of regulation. */
  extraTime: { start: number; end: number } | null = null;
  /** A penalty shootout: the scripted winner, who kicks first, every kick so far, the order of takers, and the kick
   *  being taken (its result is recorded once: in, saved, wide, or the time for it is up). */
  shootout: { winner: number; first: number; kicks: Array<{ team: number; scored: boolean }>; order: [Agent[], Agent[]]; live: { team: number; taker: Agent; struck: number } | null; done: boolean } | null = null;
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
        a.motion = new Motion(a);
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

  clockText(): { text: string; stoppage: boolean; board?: number } {
    if (this.shootout) return { text: 'PENS', stoppage: true };
    if (this.extraTime) {
      const mins = this.opts.clockMinutes; const shown = Math.min(this.frac * mins, mins + 30 * (mins / 90) * 1);
      const m = Math.floor(shown), s = Math.floor((shown - m) * 60);
      return { text: `${m}:${String(s).padStart(2, '0')}`, stoppage: true };
    }
    if (this.overtime) { const el = Math.max(0, this.clock - this.overtime.start); return { text: `SD ${this.overtime.size}v${this.overtime.size} ${Math.floor(el / 60)}:${String(Math.floor(el % 60)).padStart(2, '0')}`, stoppage: true }; }
    const mins = this.opts.clockMinutes; const f = this.frac;
    const halfLen = mins / 2;
    const shown = this.half === 1 ? Math.min(f * mins, halfLen) : Math.min(f * mins, mins);
    const m = Math.floor(shown), s = Math.floor((shown - Math.floor(shown)) * 60);
    const over = this.half === 1 ? f * mins - halfLen : f * mins - mins;
    const text = over > 0.02 ? `${this.half === 1 ? halfLen : mins}'+${Math.max(1, Math.ceil(over))}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const board = this.added[this.half - 1]; // (the fourth official's board, once it's gone up)
    return { text, stoppage: over > 0.02, board: board >= 0 && over > -0.02 ? board : undefined };
  }

  /** Where a ball in the air will first come down (cached per step): for the landing marker. */
  landing(): { x: number; z: number; t: number; apex: number } | null {
    if (this.landCache?.step === this.stepCount) return this.landCache.land;
    const land = this.ball.held || this.ball.owner ? null : predictLanding(this.ball);
    this.landCache = { step: this.stepCount, land }; return land;
  }
  private landCache: { step: number; land: { x: number; z: number; t: number; apex: number } | null } | null = null;

  /** Predicted free flight of the ball (cached per step), used by AI interception, keepers and the director. */
  predicted(): PathPoint[] {
    if (this.pathCache?.step === this.stepCount) return this.pathCache.path;
    const path = this.ball.held ? [{ t: 0, x: this.ball.x, y: this.ball.y, z: this.ball.z, vx: 0, vz: 0 }] : predictPath(this.ball, 3, 1 / 30);
    this.pathCache = { step: this.stepCount, path }; return path;
  }

  /* ------------------------------ set pieces ------------------------------ */
  kickoff(teamIdx: number, initial = false) {
    const t = this.teams[teamIdx]; this.celebration = null;
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
    this.kickoffHelper = helper !== taker ? helper : null;
    // the other side starts outside the centre circle, in its own half
    const R = this.centreCircle + 0.4;
    for (const a of this.opponentsOf(teamIdx).agents) {
      const d = Math.hypot(a.pos.x, a.pos.z);
      if (d < R) { const k = d > 0.5 ? R / d : 1; a.pos = d > 0.5 ? { x: a.pos.x * k, z: a.pos.z * k } : { x: -this.opponentsOf(teamIdx).attackDir * R, z: 0 }; a.prevPos = { ...a.pos }; }
    }
    this.setPiece = { kind: 'kickoff', team: teamIdx, taker, pos: { x: 0, z: 0 } };
    this.phase = 'kickoff'; this.phaseTimer = initial ? 1.8 : 1.2; this.kickoffAt = this.time;
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
    else if (kind === 'penalty') taker = preferred && this.shootout ? preferred : t.agents.filter((a) => !a.isGK).sort((p, q) => q.skill.shoot - p.skill.shoot)[0];
    else if (kind === 'freekick' && this.freeKickDanger(teamIdx, pos).direct) taker = t.agents.filter((a) => !a.isGK).sort((p, q) => q.skill.shoot - p.skill.shoot)[0]; // the dead-ball specialist
    else taker = preferred && !preferred.isGK ? preferred : t.agents.filter((a) => !a.isGK).sort((p, q) => v2.dist(p.pos, pos) - v2.dist(q.pos, pos))[0];
    for (const a of this.agents) { a.hasBall = false; a.action = null; a.pendingKick = null; a.stunned = 0; }
    this.freeKick = null;
    // Face the ball toward goal for shots, otherwise into the pitch.
    const goalX = t.attackDir * L / 2;
    const into = kind === 'penalty' || kind === 'freekick' ? v2.norm({ x: goalX - pos.x, z: -pos.z }) : kind === 'throw' ? { x: 0, z: -Math.sign(pos.z) } : kind === 'corner' ? v2.norm({ x: -Math.sign(pos.x) * 0.4, z: -Math.sign(pos.z) }) : { x: t.attackDir, z: 0 };
    taker.pos = v2.sub(pos, v2.scale(into, kind === 'throw' ? 0.3 : 0.55)); taker.prevPos = { ...taker.pos }; taker.vel = { x: 0, z: 0 }; taker.heading = into;
    // Opponents give the ball room: they jog out of the restricted zone during the restart phase (see applyPhaseConstraints).
    if (kind === 'penalty') for (const a of opp.agents) if (a.isGK) { a.pos = { x: -opp.attackDir * (L / 2 - 0.3), z: 0 }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; }
    if (kind === 'penalty') {
      const lineX = -opp.attackDir * L / 2; const edge = lineX + opp.attackDir * (boxDepth + 1);
      for (const a of this.agents) {
        if (a === taker || (a.isGK && a.team === opp.index)) continue;
        if (Math.abs(a.pos.x - lineX) < boxDepth + 1 && Math.abs(a.pos.z) < boxWidth / 2 + 1) { a.pos = { x: edge, z: a.pos.z }; a.prevPos = { ...a.pos }; }
      }
    }
    this.setPiece = { kind, team: teamIdx, taker, pos };
    if (kind === 'freekick') this.setupFreeKick(teamIdx, pos, taker);
    this.penalty = null;
    if (kind === 'penalty') {
      // a run-up: the taker stands a few strides back, a little to one side
      const side = Math.random() < 0.5 ? 1 : -1; taker.pos = v2.add(pos, v2.add(v2.scale(into, -2.3), { x: -into.z * side * 0.8, z: into.x * side * 0.8 })); taker.prevPos = { ...taker.pos }; taker.heading = into;
      this.penalty = { team: teamIdx, taker, aim: { z: 0, y: 1.0 }, stage: 'aim', power: 0, releasedAt: -1, pressAt: -1, strikeAt: -1, guess: null, aiAt: this.time + 2.6 };
    }
    this.phase = 'restart'; this.phaseTimer = kind === 'penalty' ? 1.8 : kind === 'goalkick' ? 1.2 : 1.0; this.restartAt = this.time;
    this.possessionTeam = teamIdx;
    if (this.humanTeam === teamIdx && (!taker.isGK || kind === 'goalkick')) this.setControlled(taker); // (goal kicks too: you take them with the keeper)
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
    const wall = this.freeKick?.wall ?? [];
    const pool = t.agents.filter((a) => !a.isGK && a !== exclude && !wall.includes(a));
    return (pool.length ? pool : t.agents.filter((a) => !a.isGK && a !== exclude)).sort((p, q) => v2.dist(p.pos, bp) - v2.dist(q.pos, bp))[0];
  }

  /* ------------------------------ free kicks ------------------------------ */
  /** How dangerous a free kick is: a shooting chance (direct) or not, and how many players the defending side puts in
   *  the wall (a full five close in and central, fewer further out or at an angle, none for one that can only be passed). */
  freeKickDanger(teamIdx: number, pos: V2): { direct: boolean; wall: number } {
    const t = this.teams[teamIdx]; const { length: L, goalWidth: gw, futsal } = this.pitch;
    const gx = t.attackDir * L / 2; const dx = Math.abs(gx - pos.x); const dist = Math.hypot(dx, pos.z);
    const ang = Math.atan2(Math.max(0, Math.abs(pos.z) - gw / 2), dx); // how far outside the line of the posts
    const k = futsal ? 0.45 : 1;
    const direct = dist < 33 * k && dx > 5 * k && ang < 0.9;
    let wall = 0;
    if (direct) { wall = futsal ? (dist < 11 ? 3 : 2) : dist < 21 ? 5 : dist < 25 ? 4 : dist < 29 ? 3 : 2; if (ang > 0.45) wall = Math.max(1, wall - 2); }
    else if (dist < 40 * k && dx < 30 * k) wall = futsal ? 1 : 2; // a crossing position: a short wall
    return { direct, wall };
  }

  private setupFreeKick(teamIdx: number, pos: V2, taker: Agent) {
    const t = this.teams[teamIdx]; const opp = this.opponentsOf(teamIdx);
    const { length: L, goalWidth: gw } = this.pitch;
    const { direct, wall: n } = this.freeKickDanger(teamIdx, pos);
    const gx = t.attackDir * L / 2;
    const s = pos.z > 0.4 ? 1 : pos.z < -0.4 ? -1 : Math.random() < 0.5 ? 1 : -1; // the near post
    // The wall: its end man lines up just outside the near post at the full distance; the rest stand shoulder to shoulder
    // across toward the far post.
    const room = this.setPieceRoom('freekick') + 0.15;
    const toGoal = v2.norm({ x: gx - pos.x, z: -pos.z });
    let perp = { x: -toGoal.z, z: toGoal.x }; if (perp.z * -s < 0) perp = v2.scale(perp, -1);
    const edge = v2.add(pos, v2.scale(v2.norm({ x: gx - pos.x, z: s * (gw / 2 + 0.3) - pos.z }), room));
    const spots: V2[] = [];
    for (let i = 0; i < n; i++) { const p = v2.add(edge, v2.scale(perp, 0.6 * i)); spots.push(v2.add(pos, v2.scale(v2.norm(v2.sub(p, pos)), room))); }
    const centre = spots.length ? v2.scale(spots.reduce((a, b) => v2.add(a, b), { x: 0, z: 0 }), 1 / spots.length) : pos;
    const humanDefends = this.humanTeam === opp.index;
    const cands = opp.agents.filter((a) => !a.isGK && !(humanDefends && a === this.controlled)).sort((p, q) => v2.dist(p.pos, centre) - v2.dist(q.pos, centre));
    const wall = cands.slice(0, n);
    // they're placed in the wall straight away (the camera cuts to the taker meanwhile)
    wall.forEach((a, i) => {
      a.pos = { ...spots[i] }; a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; a.heading = v2.norm(v2.sub(pos, a.pos)); a.action = null;
    });
    // a run-up for a shot: the taker stands a couple of strides back, off to one side
    if (direct) {
      const side = Math.random() < 0.5 ? 1 : -1; const back = v2.add(v2.scale(toGoal, -1.7), v2.scale({ x: -toGoal.z, z: toGoal.x }, side * 0.9));
      taker.pos = v2.add(pos, back); taker.prevPos = { ...taker.pos }; taker.heading = toGoal;
    }
    this.freeKick = {
      team: teamIdx, taker, pos: { ...pos }, direct, wall, wallSpots: spots, nearSide: s,
      aim: { z: -s * (gw / 2 - 0.9), y: 1.7 }, dir: toGoal, curl: 0,
      keeperZ: direct ? -s * gw * (n >= 3 ? 0.13 : 0.06) : 0,
      aiAt: this.time + (direct ? 2.5 : 1.6),
    };
  }

  /** Where the taker is aiming: at the aim point on the goal (direct), or the chosen direction. */
  freeKickAimDir(fk: FreeKick): V2 {
    if (!fk.direct) return fk.dir;
    const gx = this.teams[fk.team].attackDir * this.pitch.length / 2;
    return v2.norm({ x: gx - fk.pos.x, z: fk.aim.z - fk.pos.z });
  }

  /** Strike a free kick at a point on the goal plane: power sets the pace, curl bends it (around or over the wall). */
  takeFreeKickShot(a: Agent, power: number, z: number, y: number, curl: number, botSkill?: number) {
    const gx = this.teams[a.team].attackDir * (this.pitch.length / 2 + 0.2);
    const dir = v2.norm({ x: gx - this.ball.x, z: z - this.ball.z });
    this.startKick(a, 'shoot', power, dir, { fk: { z, y, curl, speed: this.freeKickSpeed(power) }, botSkill });
  }

  /** Free-kick pace for a power (a futsal court is small: slower, so it can get up and down again). */
  freeKickSpeed(power: number) { return this.pitch.futsal ? 11 + power * 13 : 16 + power * 15; }

  /** Simulate a free-kick strike: does it clear the wall (over it, or bent round it), and where does it cross the goal line? */
  freeKickFlight(fk: FreeKick, v: V3, w: V3, margin = 0): { clears: boolean; z: number; y: number } {
    const bb = new BallBody(); bb.surface = this.surface;
    bb.x = this.ball.x; bb.y = BALL_R; bb.z = this.ball.z; bb.vx = v.x; bb.vy = v.y; bb.vz = v.z; bb.wx = w.x; bb.wy = w.y; bb.wz = w.z;
    const gx = this.teams[fk.team].attackDir * this.pitch.length / 2;
    const toGoal = v2.norm({ x: gx - fk.pos.x, z: -fk.pos.z }); const perp = { x: -toGoal.z, z: toGoal.x };
    let lo = Infinity, hi = -Infinity, wd = 0;
    for (const p of fk.wallSpots) { const r = v2.sub(p, fk.pos); const l = v2.dot(r, perp); lo = Math.min(lo, l); hi = Math.max(hi, l); wd = v2.dot(r, toGoal); }
    let clears = fk.wallSpots.length === 0, passedWall = clears;
    for (let t = 0; t < 4; t += 1 / 120) {
      const px = bb.x; bb.integrate(1 / 120);
      const r = { x: bb.x - fk.pos.x, z: bb.z - fk.pos.z };
      if (!passedWall && v2.dot(r, toGoal) >= wd) { passedWall = true; const l = v2.dot(r, perp); clears = bb.y > (this.pitch.futsal ? 2.3 : 2.45) + margin || l < lo - 0.45 - margin * 2 || l > hi + 0.45 + margin * 2; }
      if ((bb.x - gx) * Math.sign(gx) >= 0 && (px - gx) * Math.sign(gx) < 0) return { clears, z: bb.z, y: bb.y };
    }
    return { clears, z: 99, y: 99 };
  }

  /** A bot's direct free kick: over or round the wall into a corner, chosen from strikes that actually clear it. */
  aiFreeKick(a: Agent, skill: number): boolean {
    const fk = this.freeKick!; const { goalWidth: gw, goalHeight: gh } = this.pitch; const s = fk.nearSide;
    const gx = this.teams[a.team].attackDir * (this.pitch.length / 2 + 0.2); const from = { x: this.ball.x, y: BALL_R, z: this.ball.z };
    let pick: { z: number; y: number; curl: number; power: number } | null = null;
    for (let i = 0; i < 28 && !pick; i++) {
      const far = Math.random() < 0.7; // usually the keeper's far side, now and then over the wall to the near post
      const z = (far ? -s : s) * (gw / 2 - 0.5 - Math.random() * 0.6), y = far ? 0.9 + Math.random() * 1.3 : 1.8 + Math.random() * 0.4;
      const curl = (Math.random() < 0.8 ? 1 : -1) * Math.sign(-s * (this.teams[a.team].attackDir) || 1) * (0.3 + Math.random() * 0.7) * (far ? 1 : -1);
      const power = 0.4 + Math.random() * 0.45;
      const sol = solveKick(from, { x: gx, y, z }, this.freeKickSpeed(power), curl * 55, 8, this.surface);
      const f = this.freeKickFlight(fk, sol.v, sol.w, 0.2); // (room for the strike's error)
      if (f.clears && Math.abs(f.z) < gw / 2 - 0.25 && f.y < gh - 0.15 && f.y > 0.15) pick = { z, y, curl, power };
    }
    if (!pick) return false; // no way past the wall: play it short instead
    this.takeFreeKickShot(a, pick.power, pick.z, pick.y, pick.curl, skill);
    return true;
  }

  /** The human lining up a free kick: the stick moves the aim (on the goal for a shooting chance, otherwise the direction),
   *  LB / RB (Q / E, or R) set the curl, shoot is held for power and released to strike; pass, through ball and cross
   *  play it short. */
  private freeKickInput(input: InputManager, dt: number) {
    const fk = this.freeKick!; const me = fk.taker; const b = this.ball; const { goalWidth: gw, goalHeight: gh } = this.pitch;
    me.intent.move = { x: 0, z: 0 }; me.intent.sprint = false; me.intent.jockey = false;
    if (input.switch.down || input.touchCurl < 0) fk.curl = Math.max(-1, fk.curl - dt * 1.8);
    else if (input.finesse.down || input.slide.down || input.touchCurl > 0) fk.curl = Math.min(1, fk.curl + dt * 1.8);
    const st = input.move; const held = Math.hypot(st.x, st.y) > 0.2;
    if (fk.direct) {
      const r = this.stickToWorld(1, 0); const sz = Math.abs(r.z) > 0.3 ? Math.sign(r.z) : this.teams[fk.team].attackDir; // screen right, across the goal
      fk.aim.z = Math.max(-(gw / 2 + 1.5), Math.min(gw / 2 + 1.5, fk.aim.z + st.x * sz * 3.0 * dt));
      fk.aim.y = Math.max(0.15, Math.min(gh + 1.0, fk.aim.y + st.y * 2.2 * dt));
    } else if (held) {
      const w = v2.norm(this.stickToWorld(st.x, st.y));
      fk.dir = v2.norm(v2.add(fk.dir, v2.scale(v2.sub(w, fk.dir), 1 - Math.exp(-dt * 5))));
    }
    const aim = this.freeKickAimDir(fk); me.intent.face = aim;
    if (this.phase !== 'play' || b.owner !== me || me.busy() || me.pendingKick) { if (!me.pendingKick) this.charge = null; return; }
    if (input.shoot.down) { if (!this.charge || this.charge.kind !== 'fk') this.charge = { kind: 'fk', t: 0 }; else this.charge.t += dt; }
    if (input.pass.down) { if (!this.charge || this.charge.kind !== 'pass') this.charge = { kind: 'pass', t: 0 }; else this.charge.t += dt; }
    if (input.lob.down) { if (!this.charge || this.charge.kind !== 'lob') this.charge = { kind: 'lob', t: 0 }; else this.charge.t += dt; }
    // the direction for a short one: the stick if it's held (indirect: the chosen direction), else where he's aiming
    const passDir = !fk.direct ? fk.dir : held ? v2.norm(this.stickToWorld(st.x, st.y)) : aim;
    const c = this.charge;
    if (c?.kind === 'fk' && (input.shoot.justReleased || c.t >= 1.15)) {
      const p = Math.max(0.12, Math.min(1, c.t / 1.0)); this.charge = null;
      if (fk.direct) this.takeFreeKickShot(me, p, fk.aim.z, fk.aim.y, fk.curl);
      else this.startKick(me, 'shoot', p, aim, {});
    } else if (input.pass.justReleased) { const p = Math.min(1, Math.max(0.2, c?.t ?? 0.2) / 0.5); this.startKick(me, 'pass', p, passDir, { targetAgent: this.pickPassTarget(me, passDir, false, false, p) ?? undefined }); this.charge = null; }
    else if (input.through.justPressed) this.startKick(me, 'through', 0.7, passDir, { targetAgent: this.pickPassTarget(me, passDir, true) ?? undefined });
    else if (input.lob.justReleased) { const p = Math.min(1, Math.max(0.15, c?.t ?? 0.15) / 0.7); this.startKick(me, 'lob', p, passDir, { targetAgent: this.pickPassTarget(me, passDir, false, true, p) ?? undefined }); this.charge = null; }
    if (!input.shoot.down && !input.pass.down && !input.lob.down && !input.shoot.justReleased) this.charge = null;
  }

  /* ------------------------------ main loop ------------------------------ */
  /** Advance by a frame: input is read once, then the simulation runs in fixed steps. */
  update(dt: number, input?: InputManager) {
    if (this.ended || this.paused) return;
    // your keeper in possession (a catch, a back pass, a goal kick): you take him over
    if (this.humanTeam !== null && (this.phase === 'play' || this.phase === 'restart')) {
      const gk = this.teams[this.humanTeam].agents.find((a) => a.isGK);
      if (gk && this.ball.owner === gk && this.controlled !== gk) this.setControlled(gk);
    }
    if (input && this.controlled && this.humanTeam !== null) this.handleHuman(input, dt);
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP && !this.ended) { this.step(STEP); this.acc -= STEP; }
    this.alpha = this.acc / STEP;
  }

  private step(h: number) {
    this.stepCount++;
    if (this.freeKick && (this.setPiece?.kind !== 'freekick' || this.setPiece.taker !== this.freeKick.taker)) this.freeKick = null;
    if (this.penalty && ((this.penalty.stage === 'struck' && this.time - this.penalty.strikeAt > 2.5) || this.phase === 'kickoff' || (this.phase === 'dead' && this.penalty.stage !== 'struck'))) this.penalty = null;
    this.time += h;
    if (this.phase === 'play' || this.phase === 'restart' || this.phase === 'dead') this.clock += h;
    this.director?.update(h);

    if (this.phaseTimer > 0) {
      this.phaseTimer -= h;
      if (this.phaseTimer <= 0) {
        if (this.phase === 'restart' && !this.restartClear()) this.phaseTimer = STEP; // wait for the opponents to retreat
        else if (this.phase === 'kickoff' || this.phase === 'restart') { this.phase = 'play'; if (this.setPiece) this.giveControl(this.setPiece.taker); }
        else if (this.phase === 'dead') { const r = this.pendingRestart; this.pendingRestart = null; r?.(); }
        else if (this.phase === 'goal') { if (this.overtime) this.fullTime(); else this.kickoff(this.lastConceded); } // golden goal
        else if (this.phase === 'halftime') { if (this.extraTime) this.kickoff(this.firstKickoff); else { this.half = 2; this.kickoff(this.firstKickoff === 0 ? 1 : 0); } }
      }
    }
    for (const a of this.agents) { a.intent.steer = null; a.intent.boost = false; }
    for (const t of this.teams) updateTeamAI(this, t, h);
    if (this.shootout) this.shootoutPositions();
    this.applyPhaseConstraints();
    if (this.phase === 'goal') this.applyCelebration();
    if (this.phase === 'play') { this.updatePendingKicks(); this.dribbleAssist(); this.scheduleTouch(); this.anticipate(); }

    this.driveSkills(h);
    for (const a of this.agents) {
      const mul = this.mods.speedMul[a.team] * this.teamSpeedBonus[a.team] * (this.phase === 'dead' || (this.phase === 'goal' && !this.celebration) ? 0.55 : 1);
      a.update(h, mul, this.surface.grip);
      const lim = { x: this.pitch.length / 2 + 3, z: this.pitch.width / 2 + 3 };
      a.pos.x = Math.max(-lim.x, Math.min(lim.x, a.pos.x)); a.pos.z = Math.max(-lim.z, Math.min(lim.z, a.pos.z));
    }
    // Animate every body (IK targets track the ball), then resolve contacts against those limbs.
    this.updateActionTargets();
    const ballPos = { x: this.ball.x, y: this.ball.y, z: this.ball.z };
    for (const a of this.agents) a.motion!.update(h, ballPos);
    if (this.phase === 'play' || this.phase === 'restart') { const sc = 330 / Math.max(60, this.opts.durationSec); for (const a of this.agents) a.tire(h, sc); } // (stamina: a full match's worth whatever its real length)
    for (const a of this.benched) { // sent off for sudden death: walk to the touchline and stand watching
      const d = v2.sub(a.ai.target, a.pos); const l = v2.len(d);
      a.intent.move = l > 0.4 ? v2.scale(v2.norm(d), Math.min(1, l / 2) * 0.8) : { x: 0, z: 0 }; a.intent.sprint = false; a.intent.steer = null;
      a.intent.face = l <= 0.4 ? v2.sub(ballPos, a.pos) : null; a.update(h, 1, this.surface.grip); a.motion!.update(h, ballPos);
    }
    this.resolveActions();
    if (this.phase === 'play') { this.updateOwnership(); this.collideBodies(); }
    this.holdBall();
    this.director?.steer(h);
    this.skillBall(h);
    this.expirePassAssist();
    const ev = this.ball.update(h, this.goals);
    if (ev === 'post' || ev === 'bar') { this.emit({ type: 'post', bar: ev === 'bar' }); if (this.ball.inFlightShot) this.ball.inFlightShot = null; }
    if (this.shootout) this.watchShootout();
    if (this.phase === 'play') this.checkOffside();
    if (this.phase === 'play') this.checkBounds();
    this.separateAgents();
    for (const a of this.agents) a.hasBall = this.ball.owner === a;
    if (this.ball.owner) this.possessionTeam = this.ball.owner.team;
    this.updateClockPhases();
  }

  /** The centre circle's radius (kick-offs). */
  get centreCircle() { return this.pitch.futsal ? 3 : 9.15; }
  private kickoffHelper: Agent | null = null;
  private kickoffAt = 0;

  /** Radius opponents must keep from the ball at a set piece. */
  setPieceRoom(kind: SetPieceKind): number {
    const f = this.pitch.futsal;
    switch (kind) { case 'kickoff': return 0; case 'throw': return f ? 4 : 3; case 'goalkick': return f ? 5 : 12; default: return f ? 5 : 9.15; }
  }
  /** Is a point inside the area the defending side must vacate (ball radius, plus the box for goal kicks and penalties)? */
  inSetPieceZone(p: V2, margin = 0): boolean { return v2.dist(this.clearOfSetPiece(p, margin), p) > 1e-3; }
  /** The nearest point to p outside that area. */
  clearOfSetPiece(p: V2, margin = 0): V2 {
    const sp = this.setPiece; if (!sp) return p;
    let q = { ...p };
    const box = sp.kind === 'goalkick' || sp.kind === 'penalty';
    for (let it = 0; it < 3; it++) {
      const r = this.setPieceRoom(sp.kind) + margin; const d = v2.sub(q, sp.pos); const dl = v2.len(d);
      if (r > 0 && dl < r) {
        const t = this.teams[sp.team]; const out = dl > 0.1 ? v2.norm(d) : { x: -t.attackDir * (sp.kind === 'goalkick' ? -1 : 1), z: 0 };
        q = v2.add(sp.pos, v2.scale(out, r));
        // near a touchline or the corner flag the radial way out leaves the pitch: slide round the circle back onto it
        const lx = this.pitch.length / 2 - 0.5, lz = this.pitch.width / 2 - 0.5;
        if (Math.abs(q.z) > lz) { const z = Math.sign(q.z) * lz; const h = Math.sqrt(Math.max(0, r * r - (z - sp.pos.z) ** 2)); const c = [sp.pos.x + h, sp.pos.x - h].filter((x) => Math.abs(x) <= lx); q = { x: c.length ? c.reduce((a, b) => (Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a)) : q.x, z }; }
        if (Math.abs(q.x) > lx) { const x = Math.sign(q.x) * lx; const h = Math.sqrt(Math.max(0, r * r - (x - sp.pos.x) ** 2)); const c = [sp.pos.z + h, sp.pos.z - h].filter((z) => Math.abs(z) <= lz); q = { x, z: c.length ? c.reduce((a, b) => (Math.abs(b - p.z) < Math.abs(a - p.z) ? b : a)) : q.z }; }
      }
      if (box) {
        const { length: L, boxDepth, boxWidth } = this.pitch;
        const dir = sp.kind === 'goalkick' ? this.teams[sp.team].attackDir : -this.teams[sp.team].attackDir; // pointing out of the box
        const lineX = -dir * L / 2; const depth = (q.x - lineX) * dir; const m = margin + (sp.kind === 'goalkick' ? 1 : 0.5);
        if (depth < boxDepth + m && Math.abs(q.z) < boxWidth / 2 + m) {
          const front = boxDepth + m - depth, side = boxWidth / 2 + m - Math.abs(q.z);
          if (front <= side) q = { x: lineX + dir * (boxDepth + m), z: q.z }; else q = { x: q.x, z: Math.sign(q.z || 1) * (boxWidth / 2 + m) };
        }
      }
    }
    return q;
  }
  /** Everyone who must be clear of the ball at this restart is. Stragglers are moved after a few seconds. */
  private restartClear(): boolean {
    const sp = this.setPiece; if (!sp) return true;
    const late = this.time - this.restartAt > 3.2;
    let clear = true;
    for (const a of this.agents) {
      if (a === sp.taker || (sp.kind === 'penalty' && a.isGK && a.team !== sp.team)) continue;
      if (a.team === sp.team && sp.kind !== 'penalty') continue;
      if (this.freeKick?.wall.includes(a)) continue;
      if (!this.inSetPieceZone(a.pos, -0.3)) continue;
      if (late) { a.pos = this.clearOfSetPiece(a.pos, 0.2); a.prevPos = { ...a.pos }; a.vel = { x: 0, z: 0 }; } else clear = false;
    }
    return clear;
  }

  /** Kick-offs and restarts: everyone holds position, the taker waits at the ball, opponents keep their distance. */
  private applyPhaseConstraints() {
    if (this.phase === 'kickoff' || this.phase === 'halftime') { for (const a of this.agents) { a.intent.move = { x: 0, z: 0 }; a.intent.sprint = false; } return; }
    const sp = this.setPiece;
    if (!sp || (this.phase !== 'restart' && this.phase !== 'play')) return;
    if (this.phase === 'restart') { sp.taker.intent.steer = { x: 0, z: 0 }; }
    else if (sp.taker === this.ball.owner) { if (!sp.taker.pendingKick) sp.taker.intent.steer = { x: 0, z: 0 }; }
    if (sp.kind === 'kickoff') {
      // nobody moves (and the other side stays out of the circle) until the ball is played
      for (const a of this.agents) {
        if (a === sp.taker || a === this.kickoffHelper || a.isGK) continue;
        a.intent.move = { x: 0, z: 0 }; a.intent.sprint = false; a.intent.steer = null; a.intent.face = v2.sub({ x: this.ball.x, z: this.ball.z }, a.pos);
      }
      return;
    }
    const fk = this.freeKick;
    if (fk) fk.wall.forEach((a, i) => {
      // the wall holds its line, facing the ball, until it's struck
      if (a.busy()) return;
      const d = v2.sub(fk.wallSpots[i], a.pos); const l = v2.len(d);
      a.intent.move = l > 0.12 ? v2.scale(v2.norm(d), Math.min(1, l * 1.5)) : { x: 0, z: 0 }; a.intent.sprint = false; a.intent.steer = null; a.intent.jockey = false;
      a.intent.face = v2.sub({ x: this.ball.x, z: this.ball.z }, a.pos);
    });
    for (const a of this.agents) {
      if (a === sp.taker || fk?.wall.includes(a)) continue;
      if (sp.kind === 'penalty' && a.isGK && a.team !== sp.team) { a.intent.move = { x: 0, z: (this.ball.z * 0.2 - a.pos.z) }; continue; }
      if (a.team === sp.team && sp.kind !== 'penalty') continue;
      // Anyone inside the restricted area heads straight out of it (and may not walk back in until the ball is played).
      if (this.inSetPieceZone(a.pos, 0.6)) {
        const out = v2.sub(this.clearOfSetPiece(a.pos, 1.2), a.pos); const ol = v2.len(out);
        const inward = a.intent.move ? v2.dot(a.intent.move, out) < 0.2 * v2.len(a.intent.move) * ol : true;
        if (this.phase === 'restart' || inward || this.inSetPieceZone(a.pos, 0)) { a.intent.move = ol > 0.05 ? v2.norm(out) : { x: 0, z: 0 }; a.intent.sprint = ol > 5; a.intent.face = v2.sub({ x: this.ball.x, z: this.ball.z }, a.pos); }
      }
    }
  }

  private updateClockPhases() {
    if (this.phase !== 'play' && this.phase !== 'restart' && this.phase !== 'dead') return;
    if (this.shootout) return;
    const f = this.frac;
    const pending = this.director ? !this.director.done : false;
    const perMin = 1 / this.opts.clockMinutes;
    if (this.half === 1 && f >= 0.5 && this.phase === 'play') {
      // the board goes up: a minute or three (one more if an attack is building), and the half ends once they're played -
      // or a moment later if a move is still on
      if (this.added[0] < 0) { this.added[0] = 1 + Math.floor(Math.random() * (this.pitch.futsal ? 2 : 3)) + (this.director?.pushing ? 1 : 0); this.emit({ type: 'addedTime', half: 1, minutes: this.added[0] }); }
      const end = 0.5 + this.added[0] * perMin;
      if (f >= end && (!this.director?.pushing || f >= end + 1.5 * perMin)) {
        this.phase = 'halftime'; this.phaseTimer = 3; this.setPiece = null;
        for (const t of this.teams) t.attackDir = (t.attackDir === 1 ? -1 : 1);
        this.ball.owner = null; this.ball.held = false; for (const a of this.agents) a.energy = Math.min(1, a.energy + 0.15); this.emit({ type: 'halftime' }); this.stoppage = false; return; // (a breather at the break)
      }
      this.stoppage = true;
    }
    if (this.overtime) {
      // sudden death: shrink the teams as it goes on; the scripted golden goal ends it (failsafe if it stalls)
      const el = this.clock - this.overtime.start; const size = el < 15 ? 3 : el < 30 ? 2 : 1;
      if (size < this.overtime.size && this.phase === 'play') this.shrinkTo(size);
      // a golden goal that won't come: level, it goes to penalties (anything else, the failsafe)
      if (pending && el > this.overtime.at + 30 && this.phase === 'play') { if (this.level()) this.startShootout(); else this.awardRemaining(); }
      return;
    }
    if (this.extraTime) {
      // extra time: still open and level late on, both defences shut up shop (no late goals) and it goes to penalties
      const et = this.extraTime; const lock = this.level() && this.needsWinner() && f >= et.end - 6 * perMin;
      if (this.director) this.director.locked = lock;
      if (f >= et.end && this.phase === 'play') {
        if (this.director) this.director.locked = false;
        if (!this.director || this.director.inRange()) this.fullTime();
        else if (this.level() && this.needsWinner()) this.startShootout();
        else this.awardRemaining();
      }
      return;
    }
    if (this.half === 2 && f >= 1) {
      // the board: two to five minutes (one more if the result is still open), played in full; then it's over - or, if
      // the result is still open, extra time (sudden death in futsal)
      if (this.added[1] < 0) { this.added[1] = this.pitch.futsal ? 1 + Math.floor(Math.random() * 2) + (pending ? 1 : 0) : Math.min(6, 2 + Math.floor(Math.random() * 4) + (pending ? 1 : 0)); this.emit({ type: 'addedTime', half: 2, minutes: this.added[1] }); }
      this.stoppage = true;
      if (f >= 1 + this.added[1] * perMin && this.phase === 'play') {
        const ot = this.opts.script?.overtime;
        if (ot && this.pitch.futsal && this.level()) { this.startOvertime(ot); return; }
        if (!this.director || this.director.inRange()) { this.fullTime(); return; }
        // level and the result needs a winner: extra time. Anything else (a goal still owed either way) plays on a little
        // longer, as referees do, and goes to extra time if that makes it level - the failsafe only as a last resort
        if (this.level() && this.needsWinner()) { this.unresolved(); return; }
        if (f >= OVERRUN_LIMIT) this.awardRemaining();
      }
    }
  }
  private level() { return this.teams[0].score === this.teams[1].score; }
  /** The drawn result needs a winner (it's a win or a defeat, not a draw). */
  private needsWinner() { const d = this.director; return !!d && (d.lo >= 1 || d.hi <= -1); }
  /** Full time and the result isn't there yet: extra time (sudden death in futsal), never a goal out of nowhere. */
  private unresolved() {
    const d = this.director!;
    if (this.pitch.futsal) {
      if (this.level() && this.needsWinner()) { this.startOvertime({ side: d.lo >= 1 ? 'home' : 'away', at: 6 + Math.random() * 22 }); return; }
      this.awardRemaining(); return; // (rare: futsal has no extra time)
    }
    const perMin = 1 / this.opts.clockMinutes;
    this.extraTime = { start: this.frac, end: this.frac + 30 * perMin }; this.stoppage = false;
    this.phase = 'halftime'; this.phaseTimer = 3; this.setPiece = null; this.ball.owner = null; this.ball.held = false;
    for (const a of this.agents) a.energy = Math.min(1, a.energy + 0.08);
    this.emit({ type: 'extratime' });
  }

  /* ------------------------------ penalty shootout ------------------------------ */
  private startShootout() {
    const d = this.director; const need = d?.neededGoals() ?? [];
    const winner = need.length ? need[0] : d && d.hi <= -1 ? 1 : d && d.lo >= 1 ? 0 : Math.random() < 0.5 ? 0 : 1;
    const order = this.teams.map((t) => [...t.agents.filter((a) => !a.isGK).sort((p, q) => q.skill.shoot - p.skill.shoot), ...t.agents.filter((a) => a.isGK)]) as [Agent[], Agent[]];
    const first = Math.random() < 0.5 ? 0 : 1;
    this.shootout = { winner, first, kicks: [], order, live: null, done: false };
    if (this.director) this.director.locked = false;
    this.stoppage = false; this.setPiece = null; this.penalty = null; this.ball.owner = null; this.ball.held = false;
    this.emit({ type: 'shootout', first });
    this.deadBall(2.6, () => this.nextShootoutKick());
  }
  /** Goals and kicks taken so far, per team. */
  shootoutTally() {
    const so = this.shootout!; const t = [{ taken: 0, scored: 0 }, { taken: 0, scored: 0 }];
    for (const k of so.kicks) { t[k.team].taken++; if (k.scored) t[k.team].scored++; }
    return t;
  }
  /** Is the shootout decided? (Five each, then sudden death round by round.) */
  private shootoutWinner(): number | null {
    const t = this.shootoutTally();
    for (const a of [0, 1]) { const b = 1 - a; if (t[a].taken <= 5 && t[b].taken <= 5 && t[a].scored > t[b].scored + (5 - t[b].taken)) return a; }
    if (t[0].taken === t[1].taken && t[0].taken >= 5 && t[0].scored !== t[1].scored) return t[0].scored > t[1].scored ? 0 : 1;
    return null;
  }
  /** The rig: the side meant to lose only scores if that still leaves the scripted winner able to win it. */
  shootoutAllows(team: number): boolean {
    const so = this.shootout; if (!so || team === so.winner) return true;
    const t = this.shootoutTally(); const W = t[so.winner], L = t[team]; const ls = L.scored + 1, lt = L.taken + 1;
    if (lt <= 5 && W.taken <= 5) return !(ls > W.scored + (5 - W.taken)) && !(W.taken === 5 && lt === 5 && ls > W.scored);
    return W.taken >= lt ? ls <= W.scored : ls <= W.scored + 1; // (sudden death)
  }
  private nextShootoutKick() {
    const so = this.shootout!; const w = this.shootoutWinner();
    if (w !== null) { const t = this.shootoutTally(); so.done = true; this.emit({ type: 'shootoutEnd', winner: w, home: t[0].scored, away: t[1].scored }); this.fullTime(); return; }
    const team = so.kicks.length % 2 === 0 ? so.first : 1 - so.first;
    const n = so.kicks.filter((k) => k.team === team).length; const list = so.order[team]; const taker = list[n % list.length];
    // every kick at the same end: the kicking side attacks it
    this.teams[team].attackDir = 1; this.teams[1 - team].attackDir = -1;
    const L = this.pitch.length; this.restart('penalty', team, { x: L / 2 - (this.pitch.futsal ? 6 : 11), z: 0 }, taker);
    so.live = { team, taker, struck: -1 };
  }
  /** Everyone not in this kick waits: outfield players arm in arm on the halfway line, the other keeper by the box. */
  private shootoutPositions() {
    const so = this.shootout!; const live = so.live; const pen = this.penalty; const { length: L, boxDepth, boxWidth } = this.pitch;
    const kickTeam = live?.team ?? -1; let i = [0, 0];
    for (const a of this.agents) {
      if (live && a === live.taker && !(pen && pen.stage === 'struck')) continue;
      if (a.isGK && kickTeam >= 0 && a.team !== kickTeam) continue; // (the keeper facing the kick)
      const spot = a.isGK ? { x: L / 2 - boxDepth - 2, z: (boxWidth / 2 + 3) * (a.team === 0 ? 1 : -1) } : { x: (a.team === 0 ? -1.2 : 1.2), z: (i[a.team]++ - 4.5) * 1.1 };
      const d = v2.sub(spot, a.pos); const l = v2.len(d);
      a.intent.move = l > 0.4 ? v2.scale(v2.norm(d), Math.min(1, l / 3) * 0.7) : { x: 0, z: 0 }; a.intent.sprint = false; a.intent.steer = null; a.intent.jockey = false;
      a.intent.face = l <= 0.4 ? { x: 1, z: 0 } : null;
    }
  }
  private recordShootoutKick(scored: boolean) {
    const so = this.shootout!; const live = so.live; if (!live) return;
    so.live = null; so.kicks.push({ team: live.team, scored });
    this.emit({ type: 'shootoutKick', team: live.team, scored, taker: live.taker });
    this.deadBall(1.8, () => this.nextShootoutKick());
  }
  /** Watching the kick: in, or saved/missed (held, out, or its moment has passed - no rebounds in a shootout). */
  private watchShootout() {
    const so = this.shootout; if (!so?.live || this.phase !== 'play') return;
    const pen = this.penalty;
    if (so.live.struck < 0) { if (pen && pen.stage === 'struck' && pen.taker === so.live.taker) so.live.struck = this.time; else return; }
    const b = this.ball; const keeper = this.opponentsOf(so.live.team).agents.find((a) => a.isGK);
    if ((b.held && b.owner === keeper) || this.time - so.live.struck > 1.7 || (b.speed() < 0.4 && this.time - so.live.struck > 0.6)) this.recordShootoutKick(false);
  }

  /** Level after regulation (futsal): sudden death, starting 3v3; the golden goal is now the director's next event. */
  private startOvertime(ot: { side: 'home' | 'away'; at: number }) {
    this.overtime = { start: this.clock, size: 4, at: ot.at }; this.stoppage = false;
    this.director?.startOvertime(ot.side === 'home' ? 0 : 1, (this.clock + ot.at) / this.opts.durationSec);
    this.shrinkTo(3);
    this.kickoff(this.firstKickoff);
  }

  /** Take players off until each side has `size` outfield players (+ keeper): those furthest from the ball go, never the
   *  player you control or whoever has the ball. */
  private shrinkTo(size: number) {
    if (!this.overtime) return;
    const bp = { x: this.ball.x, z: this.ball.z }; const W = this.pitch.width;
    for (const t of this.teams) {
      let outfield = t.agents.filter((a) => !a.isGK);
      while (outfield.length > size) {
        const cands = outfield.filter((a) => a !== this.controlled && a !== this.ball.owner && a !== this.setPiece?.taker);
        const a = (cands.length ? cands : outfield).slice().sort((p, q) => v2.dist(q.pos, bp) - v2.dist(p.pos, bp))[0];
        t.agents = t.agents.filter((x) => x !== a); this.agents = this.agents.filter((x) => x !== a);
        a.action = null; a.pendingKick = null; a.hasBall = false; a.isHuman = false;
        const k = this.benched.filter((x) => x.team === t.index).length;
        a.ai.target = { x: (t.index === 0 ? -1 : 1) * (2.5 + k * 1.3), z: W / 2 + 1.4 }; // the bench, far touchline
        this.benched.push(a);
        outfield = t.agents.filter((x) => !x.isGK);
      }
    }
    this.overtime.size = size;
    this.emit({ type: 'overtime', size });
  }

  private fullTime() { this.phase = 'fulltime'; this.ended = true; this.ball.owner = null; this.emit({ type: 'fulltime' }); }

  /** Failsafe: the human has stalled the match past the stoppage limit; the remaining scripted goals are awarded. */
  private awardRemaining() {
    const d = this.director!;
    for (const team of d.neededGoals()) {
      const t = this.teams[team]; t.score++; d.onGoal(team);
      this.emit({ type: 'goal', team, scorer: t.agents[t.agents.length - 1], forced: true });
    }
    // level after the regulation goals: sudden death is still played (it has its own failsafe)
    const ot = this.opts.script?.overtime;
    if (ot && !this.overtime && this.pitch.futsal && this.teams[0].score === this.teams[1].score) { this.startOvertime(ot); return; }
    this.fullTime();
  }

  /** Give a player control of a (stationary) ball, e.g. a set-piece taker. */
  private giveControl(a: Agent) {
    const b = this.ball;
    b.held = a.isGK && this.setPiece?.kind !== 'goalkick' && this.inOwnBox(a, b.x, b.z);
    b.owner = a; b.lastTouch = a; b.lastTouchTeam = a.team; this.possessionTeam = a.team;
    a.ai.nextDecision = this.time + (this.setPiece?.kind === 'kickoff' ? 0.1 : 0.35 + Math.random() * 0.3);
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
    this.autopilot = this.idleTime > (this.freeKick?.taker === me ? 20 : 2.0); // a free kick can be lined up at leisure
    if (this.autopilot) { this.charge = null; this.shotTap = null; return; }
    if (this.shotTap && this.time - this.shotTap.at > 0.6) this.shotTap = null;
    me.intent.move = move; me.intent.sprint = input.sprint.down; me.intent.face = null; me.intent.jockey = false; this.stick = move;
    // Kick-off: the taker can play it as soon as the whistle has gone (no waiting for a timer)
    if (this.phase === 'kickoff' && this.setPiece?.kind === 'kickoff' && this.setPiece.taker === me && this.time - this.kickoffAt > 0.45
      && (input.pass.down || input.shoot.down || input.lob.down || input.through.justPressed)) { this.phase = 'play'; this.phaseTimer = 0; this.giveControl(me); }
    if (this.phase !== 'play' && this.phase !== 'restart') return;
    if (this.freeKick?.taker === me) { this.freeKickInput(input, dt); return; }
    if (this.penalty) { if (this.penaltyInput(input, dt, me)) return; }
    if (this.shootout) { me.intent.move = { x: 0, z: 0 }; return; } // (in a shootout you take your kicks and pick your keeper's dive; nothing else)
    const b = this.ball; const bp = { x: b.x, z: b.z };
    // Receive assist: a pass is on its way to you. With the stick neutral, or still held the way the pass was aimed,
    // you come to meet it; a new direction on the stick takes over.
    const pa = this.passAssist; this.receiveAssisting = false;
    // An underhit pass: once he can see it won't reach where he's running, the receiver turns and comes back to meet it
    // (whatever the stick says), rather than running on while it dies behind him.
    const stickAway = pa !== null && v2.len(move) > 0.2 && v2.dot(v2.norm(move), pa.aim) <= 0.5; // the stick isn't along the pass
    const rpRescue = stickAway && pa && !b.owner ? receivePoint(this, me, pa.lofted ? 2.3 : 1.5, move) : null;
    const stickWins = rpRescue !== null && !(v2.dist(rpRescue.p, me.pos) > 0.5 && v2.dot(v2.norm(v2.sub(rpRescue.p, me.pos)), v2.norm(move)) > 0.35);
    if (!b.owner && pa && pa.receiver === me && b.lastTouch === pa.passer && this.time - b.lastTouchTime > 0.3 && stickWins && this.passFallsShort(me)) {
      const meet = interceptPoint(this, me, pa.lofted ? 2.3 : 1.5); const to = v2.sub(meet, me.pos);
      me.intent.move = v2.len(to) > 0.3 ? v2.norm(to) : { x: 0, z: 0 }; me.intent.sprint = v2.len(to) > 2; me.intent.face = null;
      this.receiveAssisting = true;
    } else if (!b.owner && b.lastTouchTeam === me.team && (me.ai.expectBall > this.time || pa?.receiver === me)) {
      const stillAiming = pa !== null && pa.receiver === me && v2.len(move) > 0.2 && v2.dot(v2.norm(move), pa.aim) > 0.5;
      // running on with the stick: the reception point is chosen along his run, and he's helped onto it unless the
      // stick points well away from it
      const held = v2.len(move) > 0.2 && !stillAiming;
      const runDir = pa && pa.receiver === me && pa.run ? pa.run : null;
      const rp = pa?.lofted ? (() => { const p = interceptPoint(this, me, 2.3); return { p, t: 0 }; })() : receivePoint(this, me, 1.5, held ? move : runDir);
      const onLine = held && v2.dist(rp.p, me.pos) > 0.5 && v2.dot(v2.norm(v2.sub(rp.p, me.pos)), v2.norm(move)) > 0.35;
      if (v2.len(move) < 0.2 || stillAiming || onLine) {
        // a through ball is run onto (to the spot it was played into); anything else is met
        // a dying pass is met, at pace, wherever it has got to (no waiting at the spot for it to creep in)
        const dying = pa?.receiver === me && this.time - b.lastTouchTime > 0.3 && this.passFallsShort(me);
        const through = !dying && pa && pa.receiver === me && pa.spot && pa.run;
        // through ball: get to the spot (easing off if early), and run on once the ball is nearly there
        const ballNear = through && v2.dist(bp, me.pos) < 4 + v2.len(me.vel) * 0.3;
        const toSpot = through && !ballNear;
        // through balls: run for the spot where the ball will actually be (the point of its real path nearest the planned
        // one), and if early keep jogging on along the line so the ball catches him in stride
        let spot = pa?.spot ?? null;
        if (toSpot && spot) { let bd = Infinity; for (const q of this.predicted()) { if (q.y > 1.2) continue; const d = Math.hypot(q.x - spot.x, q.z - spot.z); if (d < bd) { bd = d; spot = { x: q.x, z: q.z }; } } }
        const atSpot = toSpot && v2.dist(me.pos, spot!) < 2 && !this.passFallsShort(me);
        let meet = dying ? interceptPoint(this, me, pa?.lofted ? 2.3 : 1.5) : toSpot ? (atSpot ? v2.add(me.pos, v2.scale(pa!.run!, 3)) : spot!) : rp.p;
        { const lx = this.pitch.length / 2 - 1, lz = this.pitch.width / 2 - 1; meet = { x: Math.max(-lx, Math.min(lx, meet.x)), z: Math.max(-lz, Math.min(lz, meet.z)) }; } // (never runs off the pitch for it)
        const to = v2.sub(meet, me.pos); const tl = v2.len(to);
        const attack = !!pa?.lofted; // a cross is attacked, not waited for
        const ease = dying ? 1 : toSpot ? (atSpot ? 0.45 : Math.max(0.45, Math.min(1, tl / 2.5))) : attack ? 1 : Math.max(0.25, Math.min(1, tl / Math.max(0.15, rp.t - 0.12) / me.maxSpeed));
        if (tl > 0.3) { me.intent.move = v2.scale(v2.norm(to), ease); me.intent.sprint = dying ? tl > 2 : toSpot ? tl > 3 : ease > 0.68; if (tl < 2.5) me.intent.face = me.heading; } else { me.intent.move = { x: 0, z: 0 }; me.intent.face = pa?.run ?? null; }
        this.receiveAssisting = true;
      }
    }
    const dBall = v2.dist(me.pos, bp);
    if (me.isGK) {
      // done with it: control goes back to an outfield player
      if (b.owner !== me && this.setPiece?.taker !== me && !(pa?.receiver === me) && !(b.lastTouchTeam === me.team && me.ai.expectBall > this.time) && !me.pendingKick && !(me.action?.type === 'kick' && !me.action.fired)) { this.setControlled(this.closestToBall(me.team)); return; }
      if (b.owner === me && b.held && this.phase === 'play') { this.keeperInput(input, dt, move); return; }
    }
    // On the ball, or close enough to a loose ball to strike it first time.
    const canKick = (b.owner === me && !b.held) || (!b.owner && dBall < 2.6 && b.y < 1.4);
    const aimDir = v2.len(move) > 0.2 ? v2.norm(move) : me.heading;
    // First time (FIFA style): a pass on its way to you can be played on before it arrives - press pass, through ball,
    // cross or shoot early and it's queued, then struck first time the moment the ball gets there (one-twos, one-timers).
    const incoming = !b.owner && b.lastTouchTeam === me.team && b.lastTouch !== me && (pa?.receiver === me || me.ai.expectBall > this.time);
    const q = this.queued;
    if (q) {
      if (q.agent !== me || this.time - q.at > 3 || (b.owner && b.owner !== me) || b.lastTouchTeam !== me.team || this.phase !== 'play') this.queued = null;
      else if (!me.busy() && !me.pendingKick) {
        const closing = ((me.pos.x - b.x) * b.vx + (me.pos.z - b.z) * b.vz) / Math.max(0.1, dBall);
        const eta = b.owner === me ? 0 : closing > 0.5 ? dBall / closing : Infinity;
        if (b.owner === me || dBall < 2.4 || eta < 0.5) {
          this.queued = null;
          // a ball arriving above waist height is headed (or volleyed, a little lower) - the press decides what with it
          const arr = this.ballAt(Math.max(0, Math.min(eta, 1.5)));
          if (b.owner !== me && arr.y > 1.25) this.headerIntent = { agent: me, q, until: this.time + 1.5 };
          else this.playQueued(me, q);
          return;
        }
      }
    }
    // double tap (pass or through ball): the pass just asked for becomes a bounce pass (played with a hop over legs)
    if ((input.pass.justPressed || input.through.justPressed) && this.phase === 'play' && this.makeBounce(me, input.pass.justPressed ? 'pass' : 'through')) {
      if (input.pass.justPressed) this.swallowPass = true; else this.swallowThrough = true; this.charge = null; return;
    }
    if (this.swallowPass) { if (!input.pass.down) this.swallowPass = false; this.charge = null; if (incoming || canKick) return; }
    if (this.swallowThrough) { if (!input.through.down) this.swallowThrough = false; this.charge = null; if (incoming || canKick) return; }
    const lobMod = !!input.loft?.down; // LB / L1 (Q), or the touch Loft toggle
    if (incoming && !canKick && this.phase === 'play') {
      if (input.shoot.down) { if (!this.charge || this.charge.kind !== 'shoot') this.charge = { kind: 'shoot', t: 0 }; else this.charge.t += dt; }
      if (input.pass.down) { if (!this.charge || this.charge.kind !== 'pass') this.charge = { kind: 'pass', t: 0 }; else this.charge.t += dt; }
      if (input.lob.down) { if (!this.charge || this.charge.kind !== 'lob') this.charge = { kind: 'lob', t: 0 }; else this.charge.t += dt; }
      if (input.through.down) { if (!this.charge || this.charge.kind !== 'through') this.charge = { kind: 'through', t: 0 }; else this.charge.t += dt; }
      const c = this.charge; const at = this.time;
      if (input.shoot.justReleased) this.queued = { agent: me, kind: 'shoot', power: Math.min(1, Math.max(0.22, c?.t ?? 0.3) / 0.9), dir: aimDir, finesse: input.finesse.down && !lobMod, chip: lobMod, at };
      else if (input.pass.justReleased) this.queued = { agent: me, kind: 'pass', power: Math.min(1, Math.max(0.2, c?.t ?? 0.2) / 0.5), dir: aimDir, driven: input.finesse.down, at };
      else if (input.through.justReleased) this.queued = { agent: me, kind: 'through', power: Math.min(1, Math.max(0.15, c?.t ?? 0.15) / 0.6), dir: aimDir, lofted: lobMod, at };
      else if (input.lob.justReleased) this.queued = { agent: me, kind: 'lob', power: Math.min(1, Math.max(0.15, c?.t ?? 0.15) / 0.7), dir: aimDir, at };
      // a press arriving just as he's already rising to a header still decides it
      const ha = me.action; if (this.queued && ha?.type === 'header' && !ha.data?.done) { ha.data.intent = this.queued; ha.data.control = false; this.queued = null; }
      if (!input.shoot.down && !input.pass.down && !input.lob.down && !input.through.down) this.charge = null;
      return; // (no tackling your own team-mate's pass)
    }
    // the skill stick (right stick / arrow keys / a swipe): read relative to where he's facing
    if (b.owner === me && !b.held && this.phase === 'play') {
      const ra = input.aim ?? { x: 0, y: 0 }; const w = Math.hypot(ra.x, ra.y) > 0.05 ? this.stickToWorld(ra.x, ra.y) : null;
      const rel = w ? { f: w.x * me.heading.x + w.z * me.heading.z, r: w.x * -me.heading.z + w.z * me.heading.x } : null;
      const sk = this.skillStick.update(rel, this.time);
      if (sk) {
        const act = me.action;
        const chain = act?.type === 'skill' && act.data.move === 'roll' && sk.move === 'roll' && act.data.side === sk.side && act.t / act.duration > 0.75;
        if (chain || !me.busy()) { this.startSkill(me, sk.move, sk.side); this.charge = null; return; }
      }
      if (me.action?.type === 'skill') return; // (mid-move)
    }
    if (canKick && this.phase === 'play') {
      // Shooting (FIFA style): hold and release for a power shot; hold finesse (RB/R1) for a curled finesse shot;
      // tap shoot twice and hold the second press for a low driven shot.
      if (input.shoot.justPressed && this.shotTap && this.time - this.shotTap.at < 0.3) { this.shotTap = null; this.charge = { kind: 'shoot', t: 0, low: true }; }
      else if (input.shoot.down) { if (!this.charge || this.charge.kind !== 'shoot') this.charge = { kind: 'shoot', t: 0 }; else this.charge.t += dt; }
      if (input.pass.down) { if (!this.charge || this.charge.kind !== 'pass') this.charge = { kind: 'pass', t: 0 }; else this.charge.t += dt; }
      if (input.lob.down) { if (!this.charge || this.charge.kind !== 'lob') this.charge = { kind: 'lob', t: 0 }; else this.charge.t += dt; }
      if (input.through.down) { if (!this.charge || this.charge.kind !== 'through') this.charge = { kind: 'through', t: 0 }; else this.charge.t += dt; }
      const throwIn = this.setPiece?.kind === 'throw';
      if (input.shoot.justReleased && !me.busy()) {
        const held = this.charge?.t ?? 0.3; const low = !!this.charge?.low; const p = Math.min(1, Math.max(0.22, held) / 0.9);
        if (me.isGK) { this.startKick(me, 'lob', p, aimDir, { punt: true, targetAgent: this.pickPassTarget(me, aimDir, false, true, p) ?? undefined }); this.shotTap = null; } // the keeper boots it
        else if (lobMod && !throwIn) { this.startKick(me, 'shoot', p, aimDir, { chip: true }); this.shotTap = null; } // LB + shoot: a chip
        else if (!low && !throwIn && held < 0.16) this.shotTap = { at: this.time, power: p, finesse: input.finesse.down }; // maybe the first of a double tap
        else { this.startKick(me, throwIn ? 'pass' : 'shoot', p, aimDir, { finesse: input.finesse.down && !low, low, neutral: v2.len(move) < 0.2 }); this.shotTap = null; }
        this.charge = null;
      }
      else if (this.shotTap && !input.shoot.down && this.time - this.shotTap.at >= 0.3 && !me.busy()) { const t = this.shotTap; this.shotTap = null; this.startKick(me, 'shoot', t.power, aimDir, { finesse: t.finesse || input.finesse.down, neutral: v2.len(move) < 0.2 }); }
      // the receiver is locked in on release: whoever is best placed in the direction of the stick
      // (RB + pass: a driven pass, fizzed along the floor)
      else if (input.pass.justReleased && !me.busy()) { const p = Math.min(1, Math.max(0.2, this.charge?.t ?? 0.2) / 0.5); this.startKick(me, 'pass', p, aimDir, { targetAgent: this.pickPassTarget(me, aimDir, false, false, p) ?? undefined, driven: input.finesse.down }); this.charge = null; }
      // (LB + through ball: lofted over the top into the runner's path)
      else if (input.through.justReleased && !me.busy()) { const p = Math.min(1, Math.max(0.15, this.charge?.t ?? 0.15) / 0.6); this.startKick(me, 'through', p, aimDir, { targetAgent: this.pickPassTarget(me, aimDir, true, lobMod, p) ?? undefined, lofted: lobMod }); this.charge = null; }
      else if (input.lob.justReleased && !me.busy()) { const p = Math.min(1, Math.max(0.15, this.charge?.t ?? 0.15) / 0.7); this.startKick(me, 'lob', p, aimDir, { targetAgent: this.pickPassTarget(me, aimDir, false, true, p) ?? undefined }); this.charge = null; }
      if (input.shield.down && b.owner === me) { me.intent.sprint = false; me.intent.move = v2.scale(move, 0.35); me.intent.jockey = true; }
      if (!input.shoot.down && !input.pass.down && !input.lob.down && !input.through.down) this.charge = null;
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
    if (input.lob.justPressed || input.slide.justPressed) this.tackle(me, 'slide'); // cross button slides when defending
    if (input.switch.justPressed) this.setControlled(this.closestToBall(team.index, me));
    // Auto switching: to whoever is clearly closer to the ball (Auto), only for balls in the air (Air balls), or never (Manual).
    const sw = this.controls.switching;
    const ourPass = !b.owner && b.lastTouchTeam === team.index && (this.passAssist !== null || this.time - b.lastTouchTime < 1.5); // our own pass on its way
    if (sw !== 'manual' && !ourPass && this.time - this.lastSwitch > 0.7 && (!b.owner || b.owner.team !== team.index) && !me.busy() && (sw === 'auto' || (!b.owner && b.y > 1.5))) {
      const c = this.closestToBall(team.index);
      if (c !== me && v2.dist(c.pos, bp) + 3 < dBall) this.setControlled(c);
    }
  }

  /** The keeper with the ball in his hands: walk with it (inside the box), then roll it out (pass), throw it overarm
   *  (cross), drop-kick it upfield (shoot, held for distance) or drop it at his feet to play it (through ball). */
  private keeperInput(input: InputManager, dt: number, move: V2) {
    const me = this.controlled!; const b = this.ball;
    const aimDir = v2.len(move) > 0.2 ? v2.norm(move) : me.heading;
    const ahead = v2.add(me.pos, v2.scale(move, 1.2));
    me.intent.move = this.inOwnBox(me, ahead.x, ahead.z) ? v2.scale(move, 0.85) : { x: 0, z: 0 }; me.intent.sprint = false;
    if (me.busy() || me.pendingKick) return;
    for (const k of ['pass', 'lob', 'shoot'] as const) if ((input as any)[k].down) { if (!this.charge || this.charge.kind !== k) this.charge = { kind: k, t: 0 }; else this.charge.t += dt; }
    const c = this.charge;
    if (input.pass.justReleased) { const p = Math.min(1, Math.max(0.2, c?.t ?? 0.2) / 0.5); this.startKick(me, 'pass', p, aimDir, { targetAgent: this.pickPassTarget(me, aimDir, false, false, p) ?? undefined, keeperThrow: 'roll' }); this.charge = null; }
    else if (input.lob.justReleased) { const p = Math.min(1, Math.max(0.15, c?.t ?? 0.15) / 0.7); this.startKick(me, 'lob', p, aimDir, { targetAgent: this.pickPassTarget(me, aimDir, false, true, 0.3 + p * 0.4) ?? undefined, keeperThrow: 'overarm' }); this.charge = null; }
    else if (input.shoot.justReleased) { const p = Math.min(1, Math.max(0.25, c?.t ?? 0.3) / 0.9); this.startKick(me, 'lob', p, aimDir, { targetAgent: this.pickPassTarget(me, aimDir, false, true, p) ?? undefined, punt: true }); this.charge = null; }
    else if (input.through.justPressed) {
      // drop it at his feet
      b.held = false; b.x = me.pos.x + me.heading.x * 0.45; b.z = me.pos.z + me.heading.z * 0.45; b.y = 0.6; b.vx = me.vel.x; b.vz = me.vel.z; b.vy = 0;
      b.lastTouch = me; b.lastTouchTeam = me.team; b.lastTouchTime = this.time;
    }
    if (!input.pass.down && !input.lob.down && !input.shoot.down) this.charge = null;
  }

  /* ------------------------------ skill moves ------------------------------ */
  private skillStick = new SkillStick();
  /** Start a skill move with the ball at his feet (see skills.ts). */
  startSkill(a: Agent, move: SkillMove, side: number): boolean {
    const b = this.ball;
    if (b.owner !== a || b.held || this.phase !== 'play' || v2.dist(a.pos, { x: b.x, z: b.z }) > 1.4) return false;
    const def = SKILLS[move]; a.pendingKick = null; a.action = null;
    const act = a.startAction('skill', def.dur, side, { move, side, ox: a.pos.x, oz: a.pos.z, hx: a.heading.x, hz: a.heading.z, released: false, vel: { ...a.vel } });
    // where the ball really is vs where the move expects it: eased out over the start, never snapped
    const k0 = skillFrame(act.data, 0).ball; act.data.bdx = b.x - k0.x; act.data.bdz = b.z - k0.z;
    this.emit({ type: 'skill', agent: a, move });
    return true;
  }
  /** Move bodies through their skill moves (with real velocities, so everything else sees them move). */
  private driveSkills(h: number) {
    for (const a of this.agents) {
      const act = a.action; if (act?.type !== 'skill') continue;
      const d = act.data; const u = Math.min(1, (act.t + h) / act.duration);
      const fr = skillFrame(d, u);
      d.vel = { x: (fr.body.x - a.pos.x) / h, z: (fr.body.z - a.pos.z) / h };
      a.heading = fr.heading; a.intent.steer = null; a.intent.move = { x: 0, z: 0 };
    }
  }
  /** Carry the ball through a skill move, then release it with the move's touch. */
  private skillBall(h: number) {
    const b = this.ball;
    for (const a of this.agents) {
      const act = a.action; if (act?.type !== 'skill') continue;
      const d = act.data; if (d.released) continue;
      if (b.owner !== a || b.held) { d.released = true; continue; } // (lost it: tackled)
      const def = SKILLS[d.move as SkillMove]; const u = Math.min(1, (act.t + h) / act.duration);
      if (u >= def.release) {
        const v = skillExit(d); b.vx = v.x; b.vy = v.y; b.vz = v.z; b.wx = v.z / BALL_R; b.wy = 0; b.wz = -v.x / BALL_R; if (!v.y) b.setRolling();
        b.lastTouch = a; b.lastTouchTeam = a.team; b.lastTouchTime = this.time; a.touchCooldown = 0.2; d.released = true;
        continue;
      }
      const t = skillFrame(d, u).ball; const fade = 1 - Math.min(1, u / 0.22); const e = fade * fade * (3 - 2 * fade);
      t.x += (d.bdx ?? 0) * e; t.z += (d.bdz ?? 0) * e;
      b.vx = (t.x - b.x) / h; b.vz = (t.z - b.z) / h; b.vy = (t.y - b.y) / h + 9.81 * h * 0.5;
      b.wx = b.vz / BALL_R; b.wy = 0; b.wz = -b.vx / BALL_R;
    }
  }

  /** Penalties, FIFA style. Taking one: the stick moves an aim cursor on the goal that springs back to the middle when
   *  let go; hold shoot for power and release to start the run-up; press shoot again just as he's about to strike it -
   *  green timing is accurate, early or late isn't (and no press is worst). Facing one: hold the stick the way you want
   *  the keeper to dive (up for high, down for low), or leave it to stay big in the middle. Returns true if it used the input. */
  private penaltyInput(input: InputManager, dt: number, me: Agent): boolean {
    const pen = this.penalty!; const { goalWidth: gw, goalHeight: gh } = this.pitch;
    const r = this.stickToWorld(1, 0); const sz = Math.abs(r.z) > 0.3 ? Math.sign(r.z) : this.teams[pen.team].attackDir; // screen right, across the goal
    const st = input.move;
    if (pen.team !== this.humanTeam) {
      // defending: the dive (decided by where the stick is held when the ball is struck)
      pen.guess = Math.hypot(st.x, st.y) < 0.3 ? { z: 0, y: 1.0 } : { z: -this.teams[pen.team].attackDir * 0 + st.x * sz * (gw / 2 - 0.3), y: Math.max(0.3, Math.min(2.0, 1.0 + st.y * 0.9)) };
      return false;
    }
    if (pen.taker !== me || pen.stage === 'struck') return false;
    me.intent.move = { x: 0, z: 0 }; me.intent.sprint = false;
    // the cursor: pulled to where the stick points, and back to the middle when it's let go
    const tz = st.x * sz * (gw / 2 + 0.6), ty = 1.0 + st.y * (gh / 2 + 0.3);
    const k = 1 - Math.exp(-dt * 7); pen.aim.z += (tz - pen.aim.z) * k; pen.aim.y += (ty - pen.aim.y) * k;
    if (pen.stage === 'aim') {
      if (this.phase !== 'play' || this.ball.owner !== me) return true;
      if (input.shoot.down) { if (!this.charge || this.charge.kind !== 'pen') this.charge = { kind: 'pen', t: 0 }; else this.charge.t += dt; }
      if (input.shoot.justReleased && this.charge?.kind === 'pen') {
        pen.power = Math.max(0.15, Math.min(1, this.charge.t / 1.0)); pen.stage = 'runup'; pen.releasedAt = this.time; this.charge = null;
        const gx = this.teams[pen.team].attackDir * this.pitch.length / 2;
        this.startKick(me, 'shoot', pen.power, v2.norm({ x: gx - this.ball.x, z: pen.aim.z - this.ball.z }), { pen: true });
      }
      return true;
    }
    // the run-up: the second press, timed to the strike
    if (input.shoot.justPressed && pen.pressAt < 0) pen.pressAt = this.time;
    return true;
  }
  /** For the HUD: how far through the run-up (0..1) and where the green zone is. */
  penaltyTiming(): { progress: number; green: [number, number] } | null {
    const pen = this.penalty; if (!pen || pen.stage !== 'runup') return null;
    const act = pen.taker.action; const strikeAt = act?.type === 'kick' ? this.time - act.t + (act.data.strike ?? 0.2) : pen.releasedAt + 0.7;
    const total = Math.max(0.2, strikeAt - pen.releasedAt);
    return { progress: Math.min(1, (this.time - pen.releasedAt) / total), green: [Math.max(0, (total - 0.13) / total), Math.min(1, (total - 0.01) / total)] };
  }

  /** A first-time pass or shot queued while the ball was on its way. */
  queued: { agent: Agent; kind: KickKind; power: number; dir: V2; finesse?: boolean; chip?: boolean; driven?: boolean; lofted?: boolean; bounce?: boolean; at: number } | null = null;
  /** A queued action for a ball arriving at head height: the header (at goal, or on to a team-mate) it becomes. */
  headerIntent: { agent: Agent; q: NonNullable<Match['queued']>; until: number } | null = null;
  /** The release of a double-tapped pass is swallowed (the first tap's pass has become a bounce pass). */
  private swallowPass = false; private swallowThrough = false;
  private playQueued(me: Agent, q: NonNullable<Match['queued']>) {
    // the receiver is picked now, from where everyone is at the moment of the strike
    const opts = q.kind === 'shoot' ? { finesse: q.finesse, chip: q.chip }
      : { targetAgent: this.pickPassTarget(me, q.dir, q.kind === 'through', q.kind === 'lob' || !!q.lofted, q.power) ?? undefined, driven: q.driven, lofted: q.lofted, bounce: q.bounce };
    this.startKick(me, q.kind, q.power, q.dir, opts);
  }
  /** Double tap: turn the pass (or through ball) just asked for - not yet struck - into a bounce pass. */
  private makeBounce(me: Agent, kind: 'pass' | 'through'): boolean {
    const act = me.action;
    if (act?.type === 'kick' && !act.fired && act.data?.kind === kind && act.t < (act.data.strike ?? 0)) { act.data.bounce = true; return true; }
    const pk = me.pendingKick;
    if (pk && pk.kind === kind && this.time - pk.t0 < 0.35) { pk.opts.bounce = true; return true; }
    const q = this.queued;
    if (q && q.agent === me && q.kind === kind && this.time - q.at < 0.35) { q.bounce = true; return true; }
    return false;
  }

  /* ------------------------------ kicking ------------------------------ */
  /** Request a kick. The player takes it as soon as the ball is in reach (approaching it if needed). */
  startKick(a: Agent, kind: KickKind, power: number, dir: V2, opts: { targetAgent?: Agent; finesse?: boolean; low?: boolean; botSkill?: number; target?: { x: number; z: number; y?: number }; clear?: boolean; fk?: { z: number; y: number; curl: number; speed: number }; chip?: boolean; driven?: boolean; lofted?: boolean; bounce?: boolean; keeperThrow?: 'roll' | 'overarm'; punt?: boolean; neutral?: boolean; pen?: boolean }) {
    if (a.busy()) return;
    if (a === this.controlled) this.shotTap = null;
    a.pendingKick = { kind, power, dir, opts, t0: this.time };
    this.charge = null;
  }

  /** A ball struck to arrive at `to` with a given shape (launch angle `theta`): the pace that gives it, through the air
   *  with drag and spin, is searched for. */
  private shapedKick(from: V3, to: V3, theta: number, spin: number): { v: V3; w: V3; time: number } {
    const yaw = Math.atan2(to.z - from.z, to.x - from.x); const D = Math.max(1, Math.hypot(to.x - from.x, to.z - from.z));
    const w = spinVector(yaw, 0, spin); const s = new BallBody(); s.surface = this.surface;
    const fly = (sp: number): { y: number; t: number } => {
      s.x = from.x; s.y = Math.max(BALL_R, from.y); s.z = from.z; s.wx = w.x; s.wy = w.y; s.wz = w.z;
      s.vx = Math.cos(yaw) * Math.cos(theta) * sp; s.vz = Math.sin(yaw) * Math.cos(theta) * sp; s.vy = Math.sin(theta) * sp;
      let t = 0, pd = 0, py = s.y;
      while (t < 6) {
        const pvy = s.vy; py = s.y; s.integrate(1 / 120); t += 1 / 120;
        const d = Math.hypot(s.x - from.x, s.z - from.z);
        if (d >= D) { const k = (D - pd) / Math.max(1e-6, d - pd); return { y: py + (s.y - py) * k, t }; }
        if (pvy < 0 && s.vy >= 0 && t > 0.05) return { y: -1 - (D - d), t }; // came down short
        pd = d;
      }
      return { y: -99, t };
    };
    let lo = 2, hi = 42; let r = fly(hi);
    for (let it = 0; it < 20; it++) { const mid = (lo + hi) / 2; r = fly(mid); if (r.y < to.y) lo = mid; else hi = mid; }
    const sp = (lo + hi) / 2; r = fly(sp);
    return { v: { x: Math.cos(yaw) * Math.cos(theta) * sp, y: Math.sin(theta) * sp, z: Math.sin(yaw) * Math.cos(theta) * sp }, w, time: r.t };
  }

  /** A bounce pass from `from` to `aim`: struck low (about 10 degrees) with topspin, weighted so that after skipping it
   *  reaches the spot still at foot height and moving. Found by trying launch speeds on a copy of the ball. */
  private bouncePass(from: V3, aim: V2): { v: V3; w: V3 } {
    const s = new BallBody(); s.surface = this.surface; const yaw = Math.atan2(aim.z - from.z, aim.x - from.x); const D = Math.hypot(aim.x - from.x, aim.z - from.z);
    const pitch = 0.22; let best: { v: V3; w: V3; err: number } | null = null;
    for (let sp = 7; sp <= 32; sp += 0.75) {
      const v = { x: Math.cos(yaw) * Math.cos(pitch) * sp, y: Math.sin(pitch) * sp, z: Math.sin(yaw) * Math.cos(pitch) * sp }; const w = spinVector(yaw, 0, 9);
      s.x = from.x; s.y = Math.max(BALL_R, from.y); s.z = from.z; s.vx = v.x; s.vy = v.y; s.vz = v.z; s.wx = w.x; s.wy = w.y; s.wz = w.z;
      const path = predictPath(s, 3, 1 / 60); let reached = false;
      for (const p of path) { if (Math.hypot(p.x - from.x, p.z - from.z) >= D) { reached = true; const hv = Math.hypot(p.vx, p.vz); const err = (p.y > 0.7 ? p.y : 0) + Math.max(0, 5 - hv) * 0.3; if (!best || err < best.err) best = { v, w, err }; break; } }
      if (reached && best && best.err < 0.05) break;
    }
    return best ?? { v: { x: Math.cos(yaw) * 12, y: 2, z: Math.sin(yaw) * 12 }, w: { x: 0, y: 0, z: 0 } };
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
      const held = mine && b.held;
      const throwing = a.throwHold; // (a throw-in: the full wind-up and heave)
      const strike = throwing ? 0.42 : held ? 0.2 : pk.kind === 'shoot' ? 0.2 : pk.kind === 'lob' ? 0.18 : a === this.controlled && !this.autopilot ? 0.16 : 0.13;
      // where the ball and the player will be at the moment of the strike
      const c = this.ballAt(strike);
      // (a taker stepping up to a placed ball strikes it from where he actually is, not where his run-up would carry him)
      const placed = mine && this.setPiece?.taker === a && b.speed() < 0.3;
      const ap = placed ? v2.add(a.pos, v2.scale(a.vel, strike * 0.2)) : v2.add(a.pos, v2.scale(a.vel, strike * 0.6));
      const r = v2.sub({ x: c.x, z: c.z }, ap);
      const f = v2.dot(r, a.heading), lat = r.x * -a.heading.z + r.z * a.heading.x, d = v2.len(r);
      const inReach = held || throwing || (f > -0.05 && f < 0.95 && Math.abs(lat) < 0.6 && c.y < (pk.kind === 'shoot' ? 1.25 : 1.0) && d < 1.0);
      if (inReach) {
        const side: Side = lat >= 0 ? 'R' : 'L'; // strike with the foot on the ball's side
        const relV = Math.hypot(b.vx - a.vel.x, b.vz - a.vel.z);
        if (mine && !held && relV > 2.5) { b.vx = a.vel.x * 0.9 + (b.vx - a.vel.x) * 0.3; b.vz = a.vel.z * 0.9 + (b.vz - a.vel.z) * 0.3; b.setRolling(); } // set touch
        a.startAction('kick', strike + 0.32, side === 'R' ? 1 : -1, { ...pk.opts, ...pk, strike, held, side, dir: pk.dir, contact: { x: c.x, y: c.y, z: c.z }, throwIn: throwing });
        a.intent.face = pk.dir;
      } else if (d < 4 && (!mine || this.setPiece?.taker === a || d > 1.0)) {
        // step up to the ball (set pieces) or meet it (first-time strikes)
        const to = v2.sub({ x: c.x - pk.dir.x * 0.45, z: c.z - pk.dir.z * 0.45 }, a.pos);
        a.intent.steer = v2.len(to) > 0.1 ? v2.scale(v2.norm(to), Math.min(1, v2.len(to) + 0.3)) : { x: 0, z: 0 };
        a.intent.face = pk.dir;
      }
    }
  }

  /** Where the ball will be in `t` seconds: carried at the dribbler's pace, or along its predicted flight. */
  ballAt(t: number): V3 {
    const b = this.ball;
    if (b.held && b.owner) return { x: b.x, y: b.y, z: b.z };
    if (t <= 0) return { x: b.x, y: b.y, z: b.z };
    const path = this.predicted();
    for (let i = 1; i < path.length; i++) if (path[i].t >= t) { const p = path[i - 1], q = path[i]; const k = (t - p.t) / (q.t - p.t || 1); return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k }; }
    const l = path[path.length - 1]; return { x: l.x, y: l.y, z: l.z };
  }

  /** Pass assistance: the team-mate the stick is pointing at. The angle off the aim dominates; among players at
   *  similar angles, nearer, unmarked players with a clear lane win. Through balls judge the angle to the space the
   *  runner is heading for; crosses favour players in the box. Beyond ~55° off (45° for lofted balls) there is no target
   *  and the ball goes into space. */
  pickPassTarget(a: Agent, dir: V2, through: boolean, lofted = false, power?: number): Agent | null {
    const t = this.teams[a.team]; const opp = this.opponentsOf(a.team).agents; let best: Agent | null = null; let bs = -Infinity;
    const L = this.pitch.length;
    for (const m of t.agents) {
      if (m === a) continue;
      const fut = through ? this.throughPlan(a, m, dir).spot : v2.add(m.pos, v2.scale(m.vel, 0.4));
      const d = v2.sub(fut, a.pos); const dist = v2.len(d); if (dist < 3) continue;
      // aiming at the player or at where he is going both count
      const angTo = (p: V2) => { const q = v2.sub(p, a.pos); const l = v2.len(q); return l < 0.1 ? Math.PI : Math.acos(Math.max(-1, Math.min(1, v2.dot(v2.scale(q, 1 / l), dir)))); };
      const ang = Math.min(angTo(m.pos), angTo(fut));
      const semi = this.controls.pass === 'semi' && a === this.controlled; // semi-assisted: much closer to where you aim
      if (ang > (semi ? 0.45 : lofted ? 0.8 : 0.95)) continue;
      const fwd = (m.pos.x - a.pos.x) * t.attackDir;
      let marked = 8; for (const o of opp) marked = Math.min(marked, v2.dist(o.pos, fut));
      let lane = 1;
      if (!lofted) for (const o of opp) { const r = v2.sub(o.pos, a.pos); const along = v2.dot(r, d) / dist; if (along < 0.5 || along > dist - 0.5) continue; const perp = Math.abs(r.x * d.z - r.z * d.x) / dist; lane = Math.min(lane, Math.max(0, (perp - 0.6) / 1.6)); }
      const inBox = Math.abs(m.pos.x - t.attackDir * L / 2) < this.pitch.boxDepth && Math.abs(m.pos.z) < this.pitch.boxWidth / 2;
      // the power bar says how far: it picks between team-mates at similar angles
      // the power bar says how far: it picks between team-mates at similar angles (a harder cross finds the further man)
      const depth = power === undefined ? 0 : through ? Math.abs(dist - (8 + 36 * power)) * 0.035 : lofted ? Math.abs(dist - (10 + 45 * power)) * 0.04 : Math.abs(dist - (4 + 34 * power)) * 0.025;
      const s = -ang * (semi ? 8 : 4.5) - depth - dist * (lofted ? 0.006 : through ? 0.01 : 0.02) - (through ? Math.max(0, dist - 32) * 0.06 : 0) + Math.min(marked, 6) * 0.06 + lane * 0.4
        + (through ? Math.max(0, fwd) * 0.02 : 0) + (lofted && inBox ? 0.5 : 0) - (m.isGK ? (ang < 0.35 && !lofted && !through ? 0.1 : 2) : 0); // (the keeper: the 12th man, when you aim at him)
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  /** Through ball into a runner's path. Candidate spots ahead of him (a fan of angles around his line to goal, bent
   *  toward the aim, at several lead lengths) are scored on who gets there first, whether the lane is open, and how
   *  kindly the ball arrives; the ball is then weighted to reach the best spot as he does. */
  throughPlan(a: Agent, m: Agent, aim: V2): { spot: V2; speed: number; time: number; run: V2 } {
    const team = this.teams[a.team]; const fwd = { x: team.attackDir, z: 0 };
    let base = v2.norm(v2.add(fwd, v2.scale(aim, 0.5)));
    if (m.speed() > 3 && v2.dot(v2.norm(m.vel), fwd) > 0.2) base = v2.norm(v2.add(base, v2.norm(m.vel)));
    const from = { x: this.ball.x, z: this.ball.z }; const vs = m.maxSpeed * 0.95; // a runner chasing a through ball sprints
    const lim = { x: this.pitch.length / 2 - 2, z: this.pitch.width / 2 - 2 };
    const opp = this.opponentsOf(a.team).agents;
    const baseAng = Math.atan2(base.z, base.x);
    let best: { spot: V2; speed: number; time: number; run: V2; score: number } | null = null;
    for (const da of [0, -0.3, 0.3, -0.6, 0.6]) {
      const run = { x: Math.cos(baseAng + da), z: Math.sin(baseAng + da) };
      for (const L of [5, 8, 11, 14]) {
        const p = v2.add(m.pos, v2.scale(run, L)); const spot = { x: Math.max(-lim.x, Math.min(lim.x, p.x)), z: Math.max(-lim.z, Math.min(lim.z, p.z)) };
        const along = v2.dot(m.vel, v2.norm(v2.sub(spot, m.pos))); // already running that way: no reaction or wind-up
        const tRun = (along > 4 ? 0.1 : 0.4) + v2.dist(m.pos, spot) / vs + Math.max(0, 6 - Math.max(0, along)) * 0.08;
        // the ball gets there a moment before him (played into space, he runs onto it), still rolling
        const D = v2.dist(spot, from); let plan = passForTime(D, Math.max(0.35, tRun - 0.4), this.surface);
        // never a crawler: still rolling firmly at the spot (if that's quicker than his run, it's there early and rolls on into his path)
        if (plan.arrive < 5) plan = { v0: passSpeedFor(D, this.surface, 5), time: passTimeFor(D, this.surface, 5), arrive: 5 };
        const tArrive = Math.max(tRun, plan.time);
        // the race: can any defender get to the spot, or across the ball's line, first?
        let margin = 3; const u = v2.scale(v2.sub(spot, from), 1 / Math.max(0.1, D)); const avg = D / Math.max(0.3, plan.time);
        for (const o of opp) {
          const os = o.maxSpeed * 0.9;
          margin = Math.min(margin, v2.dist(o.pos, spot) / os + 0.3 - tArrive);
          const r = v2.sub(o.pos, from); const along = v2.dot(r, u);
          if (along > 1 && along < D - 1) { const perp = Math.abs(r.x * u.z - r.z * u.x); margin = Math.min(margin, Math.max(0, perp - 0.8) / os + 0.3 - along / avg); }
        }
        // (well into his path: a longer lead is preferred when the race allows it)
        const score = Math.min(margin, 1.5) * 2 - Math.abs(plan.arrive - 6) * 0.15 - Math.max(0, D - 32) * 0.08 + L * 0.03 - Math.abs(da) * 0.8 + v2.dot(v2.sub(spot, m.pos), fwd) * 0.03 - (spot.x !== p.x || spot.z !== p.z ? 1 : 0);
        if (!best || score > best.score) best = { spot, speed: plan.v0, time: plan.time, run, score };
      }
    }
    return best!;
  }

  /** Will this pass stop short of where its receiver is heading? (Its predicted roll comes to rest behind him.) */
  passFallsShort(r: Agent): boolean {
    // once he has seen it won't get there, he has seen it (no dithering): latched until the ball is next touched
    const key = this.ball.lastTouchTime;
    if (this.shortLatch.get(r) === key) return true;
    const short = this.passFallsShortNow(r);
    if (short) this.shortLatch.set(r, key);
    return short;
  }
  private shortLatch = new WeakMap<Agent, number>();
  private passFallsShortNow(r: Agent): boolean {
    if (this.restCache?.step !== this.stepCount) this.restCache = { step: this.stepCount, rest: predictRest(this.ball) };
    const end = this.restCache.rest; const pa = this.passAssist;
    const heading = pa?.receiver === r && pa.run ? pa.run : r.speed() > 2 ? v2.norm(r.vel) : r.heading;
    const rel = v2.sub({ x: end.x, z: end.z }, r.pos);
    if (v2.len(rel) > 1.5 && v2.dot(rel, heading) < -0.5) return true; // it comes to rest behind where he's going
    // ...or it's a slow ball he's already ahead of: waiting for it to creep up to him looks wrong, so he meets it
    const b = this.ball; const sp = Math.hypot(b.vx, b.vz);
    if (sp > 0.2) { const ahead = ((r.pos.x - b.x) * b.vx + (r.pos.z - b.z) * b.vz) / sp; if (ahead > 2.5 && (sp < 4 || ahead / sp > 1.5)) return true; }
    // ...or he's running on and it will never catch him: at the pace he's going, the ball stays behind him for its
    // whole predicted roll and ends up slower than him (a through ball that's lost its legs). He sees it and checks back.
    const rs = v2.len(r.vel);
    if (rs > 2 && b.y < 1.2) {
      const u = v2.scale(r.vel, 1 / rs); let catches = false;
      for (const q of this.predicted()) { const lead = (q.x - r.pos.x - r.vel.x * q.t) * u.x + (q.z - r.pos.z - r.vel.z * q.t) * u.z; if (lead > -0.8) { catches = true; break; } }
      const last = this.predicted().at(-1);
      if (!catches && last && last.vx * u.x + last.vz * u.z < rs + 0.3) return true;
    }
    // ...or his run is taking him off the pitch before it gets there
    const { length: L, width: W } = this.pitch;
    if (rs > 1.5 && ((Math.abs(r.pos.x) > L / 2 - 2 && r.vel.x * r.pos.x > 0) || (Math.abs(r.pos.z) > W / 2 - 2 && r.vel.z * r.pos.z > 0)) && v2.dist(r.pos, { x: b.x, z: b.z }) > 2.5) return true;
    return false;
  }
  private restCache: { step: number; rest: { x: number; z: number; t: number } } | null = null;

  /** The pass is over once someone has the ball, anyone else touches it, or it has had its time. */
  private expirePassAssist() {
    const pa = this.passAssist; const b = this.ball;
    if (pa && (b.owner || b.lastTouch !== pa.passer || this.time > pa.until || this.phase !== 'play' || (b.speed() < 0.3 && this.time - b.lastTouchTime > 1))) this.passAssist = null;
  }

  private fireKick(a: Agent, d: any) {
    const b = this.ball; const kind: KickKind = d.kind; const team = this.teams[a.team]; const dir0: V2 = d.dir;
    const human = a.isHuman && !this.autopilot; const skill = d.botSkill ?? 0.55;
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
    const throwIn = this.setPiece?.kind === 'throw' && this.setPiece.taker === a && !this.pitch.futsal; // futsal restarts with a kick-in
    const from: V3 = throwIn ? { x: b.x, y: Math.max(1.6, b.y), z: b.z } : d.keeperThrow === 'overarm' ? { x: a.pos.x + a.heading.x * 0.3, y: 2.1, z: a.pos.z + a.heading.z * 0.3 }
      : d.keeperThrow === 'roll' ? { x: a.pos.x + a.heading.x * 0.5, y: 0.25, z: a.pos.z + a.heading.z * 0.5 } : d.held ? { x: a.pos.x + a.heading.x * 0.35, y: d.punt ? 0.55 : 1.0, z: a.pos.z + a.heading.z * 0.35 } : { x: b.x, y: b.y, z: b.z };
    const sprinting = a.speed() > a.maxSpeed * 0.75;
    let v: V3; let w: V3; let yawErr = 0, pitchErr = 0;
    if (kind === 'shoot' && d.pen && this.penalty) {
      // a penalty: struck at the cursor; the timing of the second press decides how true it goes
      const pen = this.penalty; const gx = team.attackDir * (this.pitch.length / 2 + 0.2); const { goalHeight: gh2 } = this.pitch;
      const diff = pen.pressAt < 0 ? 9 : pen.pressAt - (this.time - 0.06);
      pen.result = Math.abs(diff) < 0.07 ? 'green' : Math.abs(diff) < 0.17 ? 'good' : 'poor';
      const speed = 17 + d.power * 13; const tz = pen.aim.z, ty = Math.max(0.15, Math.min(gh2 + 0.8, pen.aim.y));
      const sol = solveKick(from, { x: gx, y: ty, z: tz }, speed, 0, 4, this.surface); v = sol.v; w = sol.w;
      const sigma = (0.018 + d.power * 0.012) * (1.25 - a.skill.shoot * 0.5) * (pen.result === 'green' ? 0.25 : pen.result === 'good' ? 1 : 2.4);
      yawErr = gauss() * sigma; pitchErr = gauss() * sigma * 0.5 + Math.max(0, d.power - 0.85) * 0.35 + (pen.result === 'poor' ? Math.abs(gauss()) * 0.03 : 0);
      b.inFlightShot = { team: a.team, target: { x: gx, y: ty, z: tz } };
      pen.stage = 'struck'; pen.strikeAt = this.time;
      this.emit({ type: 'penaltyTiming', result: pen.result });
    } else if (kind === 'shoot' && d.fk) {
      // A free kick: struck at the aim point with the chosen pace and curl (the solver finds the launch; the error grows
      // with power and curl, and an overhit one rises over the bar).
      const f = d.fk as { z: number; y: number; curl: number; speed: number };
      const gx = team.attackDir * (this.pitch.length / 2 + 0.2);
      const sol = solveKick(from, { x: gx, y: Math.max(0.15, f.y), z: f.z }, f.speed, f.curl * 55, 8, this.surface);
      v = sol.v; w = sol.w;
      const over = Math.max(0, d.power - 0.82) / 0.18;
      const sigma = human ? (0.012 + d.power * 0.02 + Math.abs(f.curl) * 0.01) * (1.3 - a.skill.shoot * 0.6) : 0.045 - skill * 0.03;
      yawErr = gauss() * sigma; pitchErr = gauss() * sigma * 0.6 + (human ? over * 0.03 : 0);
      b.inFlightShot = { team: a.team, target: { x: gx, y: f.y, z: f.z } };
    } else if (kind === 'shoot' && !throwIn) {
      // Three strikes (FIFA style): a clean, driven power shot (default); a curled finesse shot (finesse held), bending
      // in from outside the post; and a low driven shot (double tap) that skims along the turf.
      const { length: L, goalWidth: gw, goalHeight: gh } = this.pitch;
      const gx = team.attackDir * (L / 2 + 0.3);
      const power = d.power as number;
      const style: 'power' | 'finesse' | 'low' | 'chip' = d.chip ? 'chip' : d.finesse ? 'finesse' : d.low ? 'low' : 'power';
      let zHit: number;
      // in front of goal (inside ~20 m) a shot anywhere near the goal is kept on target: a sitter is a sitter
      const toGoalDir = v2.norm({ x: gx - a.pos.x, z: -a.pos.z }); const close = Math.hypot(gx - a.pos.x, a.pos.z) < 20;
      const gkA = this.opponentsOf(a.team).agents.find((k) => k.isGK); const kp = gkA ? gkA.pos : { x: gx, z: 0 };
      // the corner on a side of the keeper, and the corner with the widest angle past him from where the shot is struck
      const cornerOn = (sg: number) => sg * (gw / 2 - 0.45);
      const angPast = (tz: number) => { const t = v2.norm({ x: gx - from.x, z: tz - from.z }), k = v2.norm({ x: kp.x - from.x, z: kp.z - from.z }); return Math.acos(Math.max(-1, Math.min(1, v2.dot(t, k)))); };
      const sideOf = (tz: number) => { const t = { x: gx - from.x, z: tz - from.z }, k = { x: kp.x - from.x, z: kp.z - from.z }; return Math.sign(k.x * t.z - k.z * t.x) || 1; };
      const bestCorner = angPast(cornerOn(1)) > angPast(cornerOn(-1)) ? cornerOn(1) : cornerOn(-1);
      if (d.target) zHit = d.target.z;
      else if (human && close && d.neutral) zHit = bestCorner; // (no stick: the corner with the most room past the keeper)
      else if (dir0.x * team.attackDir > 0.15 || (human && close && v2.dot(dir0, toGoalDir) > 0.25)) {
        zHit = dir0.x * team.attackDir > 0.05 ? a.pos.z + (dir0.z / dir0.x) * (gx - a.pos.x) : Math.sign(dir0.z || 1) * gw;
        const edge = gw / 2 - (style === 'finesse' ? 0.55 : 0.4);
        if (Math.abs(zHit) > edge) zHit = Math.sign(zHit) * (edge + (Math.abs(zHit) - edge) * (human ? (close ? 0 : this.controls.shot === 'semi' ? 0.7 : 0.25) : 0.1)); // aim assist (less on semi)
        if (style === 'finesse' && human && Math.abs(zHit) < edge) zHit = Math.sign(zHit || 1) * Math.min(edge, Math.abs(zHit) + gw * 0.18); // finesse: toward the corner
        if (human) {
          // assisted placement (FIFA style): the stick says which side of the keeper; the shot is drawn toward that corner
          const sideAim = sideOf(zHit); const corner = [cornerOn(1), cornerOn(-1)].find((c) => sideOf(c) === sideAim) ?? bestCorner;
          const pull = this.controls.shot === 'semi' ? (close ? 0.3 : 0.15) : close ? 0.65 : 0.35;
          zHit += (corner - zHit) * pull;
        }
      } else zHit = a.pos.z + dir0.z * 20;
      const push = this.mods.pushTeam === a.team ? this.mods.pushLevel : 0;
      let yHit = d.target?.y ?? (style === 'low' ? 0.2 + power * 0.25 : style === 'finesse' ? 0.6 + power * 0.8 : 0.35 + power * 1.05);
      if (!human && yHit > gh - 0.3) yHit = gh - 0.3 - Math.random() * 0.8;
      // A side being pushed for a goal picks its spot well: the corner away from the keeper (the side the shot was
      // already going, if that's open), low or just under the bar, and strikes it cleanly. Decided now; the flight is free.
      const assist = this.director?.shotAssist(a.team) ?? 0;
      if (assist > 0 && (dir0.x * team.attackDir > 0.2 || !human)) {
        const keeper = this.opponentsOf(a.team).agents.find((k) => k.isGK);
        const kz = keeper ? keeper.pos.z : 0; const open = Math.sign(zHit - kz) || (kz > 0 ? -1 : 1);
        const side = Math.abs(zHit - kz) > 1.2 && Math.abs(zHit) < gw / 2 ? Math.sign(zHit) || open : open;
        const corner = side * (gw / 2 - 0.4);
        zHit += (corner - zHit) * assist; if (assist > 0.6) yHit = Math.random() < 0.6 ? 0.35 : gh - 0.5;
      }
      const speed = style === 'low' ? 19 + power * 11 : style === 'finesse' ? 20 + power * 7 : 21 + power * 12;
      // curl for the finesse shot: back in toward the goal, against the run if he's cutting across, else from outside the post
      const toGoal = v2.norm({ x: gx - from.x, z: zHit - from.z }); const left = { x: -toGoal.z, z: toGoal.x };
      let side = gauss() * (style === 'power' ? 1.5 : 1);
      if (style === 'finesse') {
        const lat = a.vel.z; const want = Math.abs(lat) > 2 ? -Math.sign(lat) : -Math.sign(zHit || 1); // lateral (z) direction to bend toward
        side = Math.sign(left.z * want || 1) * (22 + power * 12);
      } else if (!human && d.finesse) side = Math.sign(left.z * -Math.sign(zHit || 1) || 1) * 35;
      const top = style === 'low' ? 10 + power * 12 : style === 'finesse' ? 4 : 2 + power * 5;
      if (style === 'chip') {
        // a chip: scooped up over the keeper with backspin, dropping under the bar (more power = further, and too much
        // sails over)
        const sol = this.shapedKick(from, { x: gx, y: 1.0, z: zHit }, 0.82, -14);
        v = sol.v; w = sol.w; if (power > 0.6) { const k = 1 + (power - 0.6) * 0.18; v = { x: v.x * k, y: v.y * k, z: v.z * k }; }
        yHit = 1.0;
      } else if (style === 'low' && !d.target) {
        // low driven: struck flat with topspin so it skims and skids along the turf rather than arcing to a height
        const yaw = Math.atan2(zHit - from.z, gx - from.x); const pitch = 0.035 + (1 - power) * 0.03 - Math.max(0, from.y - BALL_R) * 0.05;
        v = { x: Math.cos(yaw) * Math.cos(pitch) * speed, y: Math.sin(pitch) * speed, z: Math.sin(yaw) * Math.cos(pitch) * speed };
        w = spinVector(yaw, side, top);
      } else {
        const sol = solveKick(from, { x: gx, y: Math.max(0.12, yHit), z: zHit }, speed, side, top, this.surface);
        v = sol.v; w = sol.w;
      }
      let sigma = human ? (0.075 - a.skill.shoot * 0.05) * (0.55 + power * 0.7) * (sprinting ? 1.2 : 1) * (style === 'finesse' ? 0.85 : 1) * (this.controls.shot === 'semi' ? 1.3 : 1) : 0.13 - skill * 0.1;
      if (this.mods.goalAllowed[a.team] && push > 0) sigma *= 1 - push * 0.85;
      if (assist > 0) sigma *= 1 - 0.9 * assist;
      // a clean strike: the error is mostly in direction, very little in height (no skied shots from a good contact)
      yawErr = gauss() * sigma; pitchErr = gauss() * sigma * (human ? (style === 'low' ? 0.15 : style === 'chip' ? 0.2 : 0.3) : 0.6);
      b.inFlightShot = { team: a.team, target: { x: gx, y: yHit, z: zHit } };
    } else {
      const through = kind === 'through';
      const loftThrough = through && !!d.lofted; // LB + through: over the top
      const lofted = kind === 'lob' || throwIn || (d.held && kind !== 'pass') || loftThrough;
      const target: Agent | null = d.targetAgent ?? (d.clear ? null : this.pickPassTarget(a, dir0, through, lofted));
      d.inAir = lofted;
      d.passTarget = target;
      let aim: V2; let tFlight = 1;
      // Ground passes to a team-mate: the power bar sets how firmly it arrives (a soft 5 m/s to a zipped 12 m/s);
      // it always reaches him. (Quantised so the pass tables are shared.)
      const semi = human && this.controls.pass === 'semi';
      // (firm by default; a driven pass - RB - fizzes in at 13-18 m/s)
      const arrive = human && !through && !lofted && (d.targetAgent || !d.clear) ? Math.round(((semi ? 1 + 12 * d.power : d.driven ? 15 + 5 * d.power : 7.5 + 7.5 * d.power)) * 2) / 2 : 8.5;
      let throughSpeed = 0;
      if (target && through) { const tp = this.throughPlan(a, target, dir0); aim = tp.spot; tFlight = tp.time; throughSpeed = loftThrough ? 0 : tp.speed; d.spot = tp.spot; d.run = tp.run; target.ai.expectBall = this.time + Math.min(4, tFlight + 1.4); }
      else if (target) {
        // lead the receiver: iterate the meeting point against the ball's travel time
        aim = target.pos;
        for (let k = 0; k < 5; k++) {
          const dd = v2.dist(aim, { x: from.x, z: from.z });
          tFlight = lofted ? Math.sqrt((2 * Math.max(4, dd)) / G) * 1.15 : passTimeFor(dd * (through ? 1.1 : 1), this.surface, arrive);
          aim = v2.add(target.pos, v2.scale(target.vel, Math.min(tFlight, 2.2) * (through || target.speed() > 2.5 ? 1 : 0.75)));
          if (through) aim = v2.add(aim, { x: team.attackDir * Math.min(8, 3 + dd * 0.15), z: 0 });
        }
        target.ai.expectBall = this.time + Math.min(3.5, tFlight + 0.9);
      } else aim = v2.add(a.pos, v2.scale(dir0, d.clear ? 45 : d.punt ? 32 + d.power * 33 : d.keeperThrow === 'overarm' ? 18 + d.power * 16 : human ? (lofted ? 22 + d.power * 18 : d.driven ? 20 + d.power * 30 : 8 + d.power * 40) : 12 + d.power * 16));
      const lim = { x: this.pitch.length / 2 + 2, z: this.pitch.width / 2 + 2 };
      aim = { x: Math.max(-lim.x, Math.min(lim.x, aim.x)), z: Math.max(-lim.z, Math.min(lim.z, aim.z)) };
      const dist = Math.max(2, v2.dist(aim, { x: from.x, z: from.z }));
      if (lofted) {
        const crossIntoBox = target && Math.abs(aim.x - team.attackDir * this.pitch.length / 2) < this.pitch.boxDepth + 2;
        // Crosses and lofted passes are driven: flatter and faster the more power (the longer the button is held).
        // crosses are driven (flatter, harder with power); a lofted pass to feet is floated so it can be brought down
        // the button decides the shape: a tap floats it in high, a long hold drives it in flat and hard
        const theta = throwIn ? 0.45 : d.keeperThrow ? 0.22 + 0.12 * (1 - d.power) : d.punt ? 0.62 - 0.12 * d.power : d.clear ? 0.72 : loftThrough ? 0.6 : crossIntoBox ? 0.66 - 0.38 * d.power : 0.78 - 0.42 * d.power;
        const yT = crossIntoBox ? 1.3 : throwIn || d.clear ? BALL_R : 0.35; d.cross = !!crossIntoBox; // (to feet: it lands there, not bounces there)
        // the landing spot follows the stick a little (within a couple of metres of the team-mate)
        const nudge = (p: V2) => { if (!human || !target || loftThrough) return p; const dd = v2.dist(p, { x: from.x, z: from.z }); const sp = v2.add({ x: from.x, z: from.z }, v2.scale(dir0, dd)); const off = v2.scale(v2.sub(sp, p), 0.2); const l = v2.len(off); return l > 2.2 ? v2.add(p, v2.scale(off, 2.2 / l)) : v2.add(p, off); };
        const solve = (p: V2) => {
          const dd = Math.max(2, v2.dist(p, { x: from.x, z: from.z })); const spin = throwIn ? 0 : -18 + 12 * d.power;
          const vac = Math.sqrt((G * dd) / Math.sin(2 * theta));
          if (throwIn || d.clear) return solveKick(from, { x: p.x, y: yT, z: p.z }, Math.min(throwIn ? 15 : 33, Math.max(9, vac * 1.15)), 0, spin, this.surface, theta);
          return this.shapedKick(from, { x: p.x, y: yT, z: p.z }, theta, spin);
        };
        let sol = solve(aim);
        if (target && !throwIn && !loftThrough) {
          // re-lead the receiver with the real flight time of this trajectory
          const lead = v2.add(target.pos, v2.scale(target.vel, Math.min(sol.time, 2.2) * (target.speed() > 2.5 ? 1 : 0.75)));
          aim = nudge({ x: Math.max(-lim.x, Math.min(lim.x, lead.x)), z: Math.max(-lim.z, Math.min(lim.z, lead.z)) });
          sol = solve(aim); tFlight = sol.time; target.ai.expectBall = this.time + Math.min(3.5, tFlight + 0.9);
        } else if (loftThrough && target) { tFlight = sol.time; target.ai.expectBall = this.time + Math.min(4, tFlight + 1.4); }
        v = sol.v; w = sol.w;
      } else {
        // Human passes: the power bar sets the pace (a soft pass still reaches its man, a full one fizzes across the pitch).
        const needed = passSpeedFor(dist * (through ? 1.1 : 1), this.surface, arrive);
        // Passes to a team-mate are weighted for him (the bar sets the arrival pace, above). Into space the pace is the
        // power bar alone.
        const speed = throughSpeed > 0 ? throughSpeed * (human ? 0.97 + 0.1 * d.power : 1) : human
          ? (target ? Math.max(6, Math.min(31, needed)) : 6 + d.power * 25)
          : Math.max(6, Math.min(30, needed * (0.92 + d.power * 0.16)));
        const yaw = Math.atan2(aim.z - from.z, aim.x - from.x);
        if (d.bounce) {
          // the bounce pass (double tap): clipped low so it hops over legs and skips on to its man
          const bs = this.bouncePass(from, aim); v = bs.v; w = bs.w;
        } else if (d.driven && (dist > 26 || needed > 27)) {
          // a long driven pass: struck low and hard so it skims through the air (never above about a metre) and gets
          // there quickly at knee height - a rolling ball would die long before. The flattest launch whose pace stays
          // realistic, then the receiver led with its real flight time.
          let sol = null as null | { v: V3; w: V3; time: number };
          // (it lands about 60% of the way and skids on with its topspin, like a real driven ball off the turf)
          const skim = (p: V2) => { const q = { x: from.x + (p.x - from.x) * 0.6, y: 0.14, z: from.z + (p.z - from.z) * 0.6 }; for (let th = 0.04; th <= 0.24; th += 0.02) { const s2 = this.shapedKick(from, q, th, 12); if (Math.hypot(s2.v.x, s2.v.y, s2.v.z) <= 33 || th > 0.23) return { ...s2, time: s2.time * 1.5 }; } return this.shapedKick(from, q, 0.24, 12); };
          sol = skim(aim);
          if (target) { const lead = v2.add(target.pos, v2.scale(target.vel, Math.min(sol.time, 2) * (target.speed() > 2.5 ? 1 : 0.75))); aim = { x: Math.max(-lim.x, Math.min(lim.x, lead.x)), z: Math.max(-lim.z, Math.min(lim.z, lead.z)) }; sol = skim(aim); target.ai.expectBall = this.time + Math.min(3, sol.time + 0.8); }
          v = sol.v; w = sol.w; tFlight = sol.time;
        } else {
          v = { x: Math.cos(yaw) * speed, y: dist > 30 ? 1.2 : 0, z: Math.sin(yaw) * speed };
          w = { x: v.z / BALL_R, y: 0, z: -v.x / BALL_R };
        }
      }
      // a clean strike: assisted passing is a touch more accurate (the trajectory is solved for the receiver's run)
      const sigma = (human ? (semi ? 0.025 + (1 - a.skill.pass) * 0.03 : 0.016 + (1 - a.skill.pass) * 0.022) : 0.11 - skill * 0.09) * (d.driven ? 1.35 : 1);
      yawErr = gauss() * sigma * (sprinting ? 1.3 : 1); pitchErr = lofted ? gauss() * sigma * 0.5 : 0;
      b.inFlightShot = null; d.flight = tFlight;
    }
    // Apply strike error by rotating the launch velocity.
    const hs = Math.hypot(v.x, v.z), sp = Math.hypot(hs, v.y);
    const yaw = Math.atan2(v.z, v.x) + yawErr, pitch = Math.atan2(v.y, hs) + pitchErr;
    const nv = { x: Math.cos(yaw) * Math.cos(pitch) * sp, y: Math.sin(pitch) * sp, z: Math.sin(yaw) * Math.cos(pitch) * sp };
    if (d.held || throwIn) { b.x = from.x; b.y = from.y; b.z = from.z; b.held = false; }
    b.strike(nv, w, a, this.time);
    // the human takes over the intended receiver straight away (FIFA-style pass switching)
    if (human && kind !== 'shoot' && d.passTarget && this.humanTeam === a.team) {
      this.setControlled(d.passTarget);
      this.passAssist = { passer: a, receiver: d.passTarget, aim: dir0, until: this.time + 8 /* lives until someone touches it or it stops */, lofted: !!d.inAir && !throwIn, spot: d.spot ?? null, run: d.run ?? null };
    }
    a.hasBall = false; a.cooldown = 0.3; a.pendingKick = null;
    const fk = this.freeKick;
    if (fk && fk.taker === a) {
      if (kind === 'shoot') for (const p of fk.wall) if (!p.busy()) p.startAction('header', 0.62, 1, { wall: true, done: true }); // the wall jumps
      this.lastFreeKick = { at: this.time, team: fk.team, direct: fk.direct, dir: this.freeKickAimDir(fk), pos: fk.pos };
      this.freeKick = null;
    }
    // (no offside from a throw-in, goal kick or corner)
    this.markOffside(a, kind, throwIn || (this.setPiece?.taker === a && (this.setPiece.kind === 'goalkick' || this.setPiece.kind === 'corner' || this.setPiece.kind === 'throw')));
    if (this.setPiece?.taker === a) this.setPiece = null;
    if (this.penalty && this.penalty.taker === a) {
      this.penalty.stage = 'struck'; if (this.penalty.strikeAt < 0) this.penalty.strikeAt = this.time;
      this.lastFreeKick = { at: this.time, team: a.team, direct: true, dir: dir0, pos: { x: from.x, z: from.z } }; // (the camera stays on the kick a moment)
    }
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
    const lat = (tgt.x - a.pos.x) * -dir.z + (tgt.z - a.pos.z) * dir.x; const side: Side = lat >= 0 ? 'R' : 'L';
    const contact = { x: tgt.x, y: b.y, z: tgt.z };
    if (kind === 'slide') {
      a.startAction('slide', 1.35, 1, { dir, side, contact, speed: Math.max(a.speed(), 5.5) + 2.5, slideFactor: this.surface.slide, ball: false, foul: false });
      a.tackleCooldown = 1.9;
    } else {
      a.startAction('tackle', 0.62, 1, { dir, side, contact, ball: false, foul: false });
      a.tackleCooldown = 1.0;
    }
    a.pendingKick = null;
    return true;
  }

  /** Keep each action's IK target on the ball (where it will be at the planned contact moment). */
  private updateActionTargets() {
    for (const a of this.agents) {
      const act = a.action; if (!act || !act.data) continue; const d = act.data;
      switch (act.type) {
        case 'kick': if (!act.fired) { d.contact = d.held ? { x: this.ball.x, y: this.ball.y, z: this.ball.z } : this.ballAt(Math.max(0, d.strike - act.t)); } break;
        case 'touch': case 'trap': case 'header': if (!d.done && d.contact) d.contact = this.ballAt(Math.max(0, d.tc - act.t)); break;
        case 'tackle': case 'slide': if (!d.ball) { const c = this.ballAt(0.08); if (Math.hypot(c.x - a.pos.x, c.z - a.pos.z) < 2.2) d.contact = c; } break;
      }
    }
  }

  private resolveActions() {
    const b = this.ball;
    for (const a of this.agents) {
      const act = a.action; if (!act) continue; const d = act.data ?? {};
      const m = a.motion!;
      if (act.type === 'kick' && !act.fired && act.t >= d.strike - 0.03) {
        // The kick lands when the boot reaches the ball (a short assist window covers small misses).
        const fp = m.footPoint(d.side);
        const dist = Math.hypot(fp.x - b.x, fp.y - b.y, fp.z - b.z);
        const owns = !b.owner || b.owner === a;
        if ((d.held || d.throwIn) && b.owner === a && act.t >= d.strike) { act.fired = true; this.fireKick(a, d); }
        else if (owns && !b.held && dist < BALL_R + 0.12) { act.fired = true; this.fireKick(a, d); }
        else if (act.t > d.strike + 0.06) { act.fired = true; if (owns && !b.held && dist < 0.5) this.fireKick(a, d); else a.pendingKick = null; }
      }
      // (a ball in the keeper's hands is his: a planned touch on it is off)
      if ((act.type === 'touch' || act.type === 'trap' || act.type === 'header') && !d.done && b.held && b.owner !== a) d.done = true;
      if ((act.type === 'touch' || act.type === 'trap' || act.type === 'header') && !d.done && d.contact && act.t >= d.tc - 0.04) {
        const pt = act.type === 'header' ? m.headPoint() : d.part === 'hands' ? m.handPoint('L').lerp(m.handPoint('R'), 0.5) : d.part === 'thigh' ? m.rig.pos(d.side === 'L' ? 15 : 19) : d.part === 'chest' ? m.rig.point(3, 0, 0.1, 0.12) : m.footPoint(d.side);
        const dist = Math.hypot(pt.x - b.x, pt.y - b.y, pt.z - b.z);
        const reach = act.type === 'header' ? 0.22 : d.part === 'hands' ? 0.2 : 0.13;
        const late = act.t > d.tc + 0.07;
        if (dist < BALL_R + reach || (late && dist < 0.45)) {
          d.done = true;
          if (act.type === 'touch') this.applyTouch(a, d.side);
          else if (act.type === 'header') this.doHeader(a);
          else if (d.part === 'hands') this.keeperHands(a);
          else this.firstTouch(a);
        } else if (late) d.done = true; // missed it
      }
      if ((act.type === 'tackle' || act.type === 'slide') && this.phase === 'play') this.resolveTackle(a);
      if (act.type === 'dive') this.resolveDive(a);
    }
  }

  private legCaps(a: Agent, side?: Side): Capsule[] {
    return a.motion!.colliders().filter((c) => (c.part === 'foot' || c.part === 'shin' || c.part === 'thigh') && (!side || c.side === side));
  }

  private resolveTackle(a: Agent) {
    const act = a.action!; const d = act.data; const b = this.ball;
    const slide = act.type === 'slide';
    const [t0, t1] = slide ? [0.06, 0.72] : [0.1, 0.4];
    if (act.t < t0) return;
    if (act.t > t1) { if (!d.ball && !d.foul && !d.missed) { d.missed = true; if (!slide) a.stunned = 0.35; } return; }
    const leading = this.legCaps(a, d.side).filter((c) => c.part !== 'thigh' || slide);
    // The ball first: a clean contact with the boot (or shin) wins it.
    const hitBall = !d.ball && !b.held && leading.some((c) => pointSegment(b.x, b.y, b.z, c).d < c.r + BALL_R + 0.02);
    if (hitBall) {
      d.ball = true;
      const prev = b.owner;
      const side = { x: -d.dir.z, z: d.dir.x }; const s = Math.random() < 0.5 ? -1 : 1;
      if (slide) {
        const speed = Math.max(3, a.speed() * 0.6 + 2.5);
        const kd = v2.norm(v2.add(d.dir, v2.scale(side, s * (0.4 + Math.random() * 0.5))));
        b.strike({ x: kd.x * speed, y: 0.4, z: kd.z * speed }, { x: 0, y: 0, z: 0 }, a, this.time);
        a.cooldown = 0.4;
      } else {
        const kd = v2.norm(v2.add(v2.scale(d.dir, -0.6), v2.scale(side, s * 0.8)));
        b.strike({ x: kd.x * 2.2 + a.vel.x * 0.3, y: 0, z: kd.z * 2.2 + a.vel.z * 0.3 }, { x: 0, y: 0, z: 0 }, a, this.time);
        b.setRolling(); b.owner = a; a.touchCooldown = 0.2; a.cooldown = 0;
      }
      b.inFlightShot = null;
      if (prev && prev !== a) { prev.touchCooldown = 0.5; prev.cooldown = 0.5; prev.pendingKick = null; prev.stunned = 0.3; }
      this.emit({ type: 'tackle', success: true, agent: a });
      return;
    }
    // Legs before ball: the extended tackling boot (and lower shin) genuinely hits an opponent's lower leg.
    // Brushing legs while standing side by side is not a foul. After the ball, a slide can still take the man (no foul).
    if (d.foul || act.t < (slide ? 0.12 : 0.15)) return;
    const strikers = this.legCaps(a, d.side).filter((c) => c.part === 'foot' || c.part === 'shin').map((c) => c.part === 'shin' ? { ...c, ax: (c.ax + c.bx) / 2, ay: (c.ay + c.by) / 2, az: (c.az + c.bz) / 2 } : c);
    for (const o of this.opponentsOf(a.team).agents) {
      if (o.isGK && this.ball.held) continue;
      if (o.action?.type === 'fallen') continue;
      if (v2.dist(o.pos, a.pos) > 2.6) continue;
      const theirs = this.legCaps(o).filter((c) => c.part !== 'thigh');
      const contact = strikers.some((c) => theirs.some((t) => segmentSegment(c, t) < (c.r + t.r) * 0.8));
      if (contact) {
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
    // the last man (nobody but the keeper between the attacker and goal) bringing someone down through on goal
    const defenders = this.teams[by.team].agents.filter((a) => !a.isGK && a !== by);
    const lastMan = defenders.every((d) => (d.pos.x - on.pos.x) * victimTeam.attackDir < 0) && Math.abs(on.pos.x - goalX) < L * 0.4;
    let card: 'yellow' | 'red' | null = null; let secondYellow = false;
    if (slide && lastMan && (fromBehind || Math.random() < 0.6)) card = 'red';
    else if (slide && fromBehind && Math.random() < 0.08) card = 'red'; // (reckless)
    else if ((slide && (fromBehind || Math.random() < 0.3)) || (!slide && fromBehind && Math.random() < 0.15)) { card = 'yellow'; by.yellow++; if (by.yellow >= 2) { card = 'red'; secondYellow = true; } }
    if (card === 'red' && by.isGK) { card = 'yellow'; secondYellow = false; } // (keepers aren't sent off here: no spare keeper)
    this.emit({ type: 'foul', by, on, penalty, card, secondYellow });
    if (card === 'red') this.sendOff(by);
    const lim = { x: L / 2 - 1, z: this.pitch.width / 2 - 1 };
    const pos = penalty ? { x: goalX - victimTeam.attackDir * (this.pitch.futsal ? 6 : 11), z: 0 } : { x: Math.max(-lim.x, Math.min(lim.x, spot.x)), z: Math.max(-lim.z, Math.min(lim.z, spot.z)) };
    this.deadBall(1.3, () => this.restart(penalty ? 'penalty' : 'freekick', on.team, pos, on));
  }

  /* ------------------------------ offside ------------------------------ */
  /** Team-mates of a passer who were offside when the ball was played (judged at that moment, as the assistant does). */
  offsideWatch: { passer: Agent; at: number; marks: Set<Agent> } | null = null;
  /** How far up the pitch (along `team`'s attack) the offside line is: the second-last opponent, or the ball if further. */
  offsideLine(teamIdx: number): number {
    const dir = this.teams[teamIdx].attackDir;
    const xs = this.opponentsOf(teamIdx).agents.map((o) => o.pos.x * dir).sort((p, q) => q - p);
    return Math.max(0, xs.length > 1 ? xs[1] : xs[0] ?? 0, this.ball.x * dir);
  }
  inOffsidePosition(a: Agent): boolean {
    if (this.pitch.futsal || a.isGK) return false;
    return a.pos.x * this.teams[a.team].attackDir > this.offsideLine(a.team) + 0.15;
  }
  private markOffside(a: Agent, kind: KickKind, exempt: boolean) {
    this.offsideWatch = null;
    if (this.pitch.futsal || kind === 'shoot' || exempt) return;
    const marks = new Set(this.teams[a.team].agents.filter((t) => t !== a && this.inOffsidePosition(t)));
    if (marks.size) this.offsideWatch = { passer: a, at: this.time, marks };
  }
  /** The flag goes up when a player who was offside when it was played is the next to touch the ball. */
  private checkOffside() {
    const w = this.offsideWatch; if (!w) return;
    const b = this.ball;
    if (this.phase !== 'play' || this.time - w.at > 8) { this.offsideWatch = null; return; }
    if (b.lastTouchTime <= w.at + 1e-6 || b.lastTouch === w.passer) return;
    this.offsideWatch = null;
    const who = b.lastTouch;
    if (!who || !w.marks.has(who)) return;
    this.emit({ type: 'offside', agent: who });
    const lim = { x: this.pitch.length / 2 - 1, z: this.pitch.width / 2 - 1 };
    const pos = { x: Math.max(-lim.x, Math.min(lim.x, who.pos.x)), z: Math.max(-lim.z, Math.min(lim.z, who.pos.z)) };
    b.vx *= 0.3; b.vz *= 0.3;
    this.deadBall(1.2, () => this.restart('freekick', 1 - who.team, pos));
  }

  /* ------------------------------ own goals ------------------------------ */
  /** A defender's touch in his own box that goes into his own net - only while the director has the other side owed an
   *  overdue goal (`mods.ownGoal`), or a keeper fumbling a back-pass (`sure`). The touch itself is real (it leaves his
   *  boot, head or shin toward the far side of the goal from his keeper, who is wrong-footed); nothing is done in flight. */
  private ownGoalTouch(a: Agent, sure = false): boolean {
    const p = this.mods.ownGoal[a.team]; if (!sure && !(p > 0)) return false;
    if (a === this.controlled && !this.autopilot) return false; // (the player you control never puts it in his own net for you)
    if (this.phase !== 'play') return false;
    const { length: L, goalWidth, boxDepth, boxWidth } = this.pitch; const b = this.ball;
    const dir = this.teams[a.team].attackDir; const gx = -dir * L / 2;
    if (Math.abs(b.x - gx) > boxDepth + 2 || Math.abs(b.z) > boxWidth / 2 + 2 || Math.abs(b.x - gx) < 0.6) return false;
    if (!sure && Math.random() >= p) return false;
    const k = this.teams[a.team].agents.find((x) => x.isGK);
    const kz = k ? k.pos.z : 0; const side = Math.abs(kz) > 0.4 ? -Math.sign(kz) : (Math.random() < 0.5 ? -1 : 1);
    const target = { x: gx - dir * 0.4, y: 0.25 + Math.random() * 0.8, z: side * (goalWidth / 2 - 0.55 - Math.random() * 0.6) };
    const d = Math.hypot(target.x - b.x, target.z - b.z);
    const vin = b.speed3(); // (a deflection keeps the ball's own pace, more or less: it isn't struck)
    const sol = solveKick({ x: b.x, y: b.y, z: b.z }, target, Math.max(7, Math.min(16, vin * 0.55 + 3 + d * 0.3)), 0, 0, this.surface);
    b.strike(sol.v, { x: 0, y: 0, z: 0 }, a, this.time); if (b.y < 0.3 && sol.v.y < 1) b.setRolling();
    b.inFlightShot = { team: 1 - a.team, target: { x: gx, y: target.y, z: target.z } };
    a.cooldown = Math.max(a.cooldown, 0.4); a.stunned = Math.max(a.stunned, 0.4); a.pendingKick = null; a.ai.fumble = 0;
    if (k) { k.ai.dive = null; k.ai.shotKey = b.lastTouchTime; k.stunned = Math.max(k.stunned, 0.6 + d / 14); if (k !== a && k.action?.type !== 'fallen') k.action = null; }
    this.emit({ type: 'touch', agent: a, heavy: true });
    return true;
  }

  /** Sent off: he walks off to the touchline and his side plays on a man down. */
  private sendOff(a: Agent) {
    const t = this.teams[a.team]; t.reds++;
    t.agents = t.agents.filter((x) => x !== a); this.agents = this.agents.filter((x) => x !== a);
    a.action = null; a.pendingKick = null; a.hasBall = false; a.isHuman = false; a.sentOff = true;
    if (this.ball.owner === a) { this.ball.owner = null; this.ball.held = false; }
    a.ai.target = { x: Math.max(-this.pitch.length / 2 + 2, Math.min(this.pitch.length / 2 - 2, a.pos.x)), z: Math.sign(a.pos.z || 1) * (this.pitch.width / 2 + 2.5) };
    this.benched.push(a);
    if (this.controlled === a) { this.controlled = null; this.setControlled(this.closestToBall(a.team)); }
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
    if (d.done || b.held || act.t < 0.04 || b.lastTouch === k && this.time - b.lastTouchTime < 0.3) return;
    // a save is exactly a contact: the ball meets his hands, arms, body, head or a trailing leg (no margin added)
    const hitPart = k.motion!.colliders().find((c) => pointSegment(b.x, b.y, b.z, c).d < c.r + BALL_R);
    if (hitPart) { d.done = true; this.keeperContact(k, d.mode === 'wall', hitPart.part !== 'hand' && hitPart.part !== 'arm'); }
  }

  /** A keeper's hands meet a ball he went to collect. */
  private keeperHands(k: Agent) {
    const b = this.ball;
    if (b.lastTouchTeam !== k.team && this.ownGoalTouch(k)) return; // (it squirms through his hands)
    if (b.speed3() > 7 && b.lastTouchTeam !== k.team) { this.keeperContact(k, this.mods.keeper[k.team] === 'wall'); return; }
    b.vx = b.vy = b.vz = 0; b.wx = b.wy = b.wz = 0; b.held = true; b.owner = k; k.keeperHold = 0;
    b.lastTouch = k; b.lastTouchTeam = k.team; b.lastTouchTime = this.time; b.inFlightShot = null;
    this.emit({ type: 'save', keeper: k, caught: true });
  }

  /** Catch or parry depending on pace and handling. */
  keeperContact(k: Agent, wall: boolean, blocked = false) {
    const b = this.ball; const sp = b.speed3();
    if (!wall && this.ownGoalTouch(k)) { this.emit({ type: 'save', keeper: k, caught: false }); return; } // (spilled in)
    const handling = (k.card.attrs.reflexes + k.card.attrs.diving) / 198;
    // body/leg blocks are parried; hands hold what they can: slower shots, and better keepers hold harder ones
    const catchP = blocked ? 0 : sp < 13 ? 0.95 : Math.max(0.05, 0.95 - (sp - 13) / (14 + handling * 10)) + (wall ? 0.25 : 0);
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
    const b = this.ball;
    // a throw-in: the ball is in the thrower's hands, behind his head, until he lets it go
    const sp = this.setPiece; const thrower = sp?.kind === 'throw' && !this.pitch.futsal ? sp.taker : null;
    for (const a of this.agents) a.throwHold = a === thrower && !(a.action?.type === 'kick' && a.action.fired) && (this.phase === 'restart' || b.owner === a);
    if (thrower?.throwHold) {
      const m = thrower.motion!; const l = m.handPoint('L'), r = m.handPoint('R');
      b.x = (l.x + r.x) / 2; b.y = Math.max(BALL_R, (l.y + r.y) / 2 + 0.06); b.z = (l.z + r.z) / 2; b.vx = thrower.vel.x; b.vz = thrower.vel.z; b.vy = 0; b.wx = b.wy = b.wz = 0;
      b.px = b.x; b.py = b.y; b.pz = b.z;
      return;
    }
    const k = b.owner;
    // only a keeper holds the ball in his hands: anyone else who ends up with a 'held' ball has it at his feet
    if (b.held && (!k || !k.isGK)) { b.held = false; if (k) { b.x = k.pos.x + k.heading.x * 0.45; b.z = k.pos.z + k.heading.z * 0.45; b.y = BALL_R; b.vx = k.vel.x; b.vz = k.vel.z; b.vy = 0; b.px = b.x; b.py = b.y; b.pz = b.z; } }
    if (!b.held || !k) return;
    if (k.action?.type === 'kick' && k.action.fired) return;
    b.x = k.pos.x + k.heading.x * 0.3; b.z = k.pos.z + k.heading.z * 0.3; b.y = k.action?.type === 'dive' ? 0.4 : 1.05;
    b.vx = k.vel.x; b.vz = k.vel.z; b.vy = 0; b.wx = b.wy = b.wz = 0;
  }

  /* ------------------------------ dribbling & control ------------------------------ */
  /** Who controls the ball: the dribbler keeps it while it is near him and nobody is closer. */
  private updateOwnership() {
    const b = this.ball; const o = b.owner;
    if (!o || b.held || o.throwHold) return; // (a throw-in is held up in the hands)
    const d = v2.dist(o.pos, { x: b.x, z: b.z });
    if (d > 3.4 || (b.y > 1.6 && o.action?.type !== 'skill') || (o.legsBusy() && o.action?.type !== 'skill')) b.owner = null;
  }

  /** The direction a player wants to take the ball. */
  // (where a player is going: his run, or his facing when he's still)
  private dirOf(a: Agent): V2 { return a.speed() > 1 ? v2.norm(a.vel) : a.heading; }
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
    const lead = 0.12;
    const bx = b.x + b.vx * lead, bz = b.z + b.vz * lead;
    const back = want ?? (b.speed() > 0.5 ? v2.norm({ x: b.vx, z: b.vz }) : o.heading);
    const spot = { x: bx - back.x * 0.38, z: bz - back.z * 0.38 };
    const to = v2.sub(spot, o.pos); const dl = v2.len(to);
    // Move WITH the ball: its velocity plus a firm pull onto his spot behind it, so he arrives there in step with it
    // rather than running through it (and stops with it when the stick is let go).
    // (stick let go: he eases up and stops with it)
    let vd = want ? v2.add({ x: b.vx, z: b.vz }, v2.scale(to, 4.5)) : v2.add({ x: b.vx * 0.5, z: b.vz * 0.5 }, v2.scale(to, 3));
    const mul = this.mods.speedMul[o.team] * this.teamSpeedBonus[o.team];
    const cap = o.maxSpeed * mul * 0.93 * (o.intent.sprint || dl > 0.9 ? 1 : 0.78);
    if (v2.len(vd) > cap) vd = v2.scale(v2.norm(vd), cap);
    const boost = v2.len(vd) > o.maxSpeed * mul * 0.93 * 0.7;
    const top = o.maxSpeed * mul * 0.93 * (o.intent.sprint || boost ? 1 : 0.7);
    o.intent.boost = boost; o.intent.steer = v2.len(vd) > 0.05 ? v2.scale(v2.norm(vd), Math.min(1, v2.len(vd) / top)) : { x: 0, z: 0 };
    // nearly round the ball: open the body to the way he wants to take it
    if (want && dl < 1.2) o.intent.face = want;
  }

  /** Dribbling: when the ball will be in front of the feet, plan a touch so the inside of the boot meets it. */
  private scheduleTouch() {
    const b = this.ball; const o = b.owner;
    if (!o || b.held || o.legsBusy() || b.y > 0.45 || o.pendingKick) return;
    if (this.setPiece?.taker === o) { b.vx *= 0.9; b.vz *= 0.9; return; }
    // (an ordinary touch already on its way can still be turned into a cut, below)
    const pendingTouch = o.action?.type === 'touch' && !o.action.data?.cut; // (or one finishing its follow-through)
    if ((o.action && !pendingTouch) || (o.touchCooldown > 0 && !pendingTouch)) return;
    const tc = 0.09;
    const c = this.ballAt(tc); const ap = v2.add(o.pos, v2.scale(o.vel, tc));
    const r = v2.sub({ x: c.x, z: c.z }, ap); const f = v2.dot(r, o.heading), lat = r.x * -o.heading.z + r.z * o.heading.x;
    // a sharp change of direction: he plants and takes it the new way at once (inside or outside of the foot)
    const want0 = this.dribbleDir(o); const moving = Math.hypot(b.vx, b.vz) > 0.8 ? v2.norm({ x: b.vx, z: b.vz }) : o.heading;
    const cutting = !!want0 && v2.dot(want0, moving) < 0.75 && v2.len(r) < 1.0 && f > -0.25;
    if (pendingTouch && !cutting) return;
    // under his feet (after a sharp turn): a quick touch out in front, the way he wants to go
    if (!cutting && !o.action && o.touchCooldown <= 0 && v2.len(r) < 0.3) {
      const side: Side = lat >= 0 ? 'R' : 'L';
      o.startAction('touch', 0.2, side === 'R' ? 1 : -1, { side, tc: 0.05, contact: this.ballAt(0.05), done: false, out: true }); o.touchCooldown = 0.12; return;
    }
    if (cutting) {
      const side: Side = lat >= 0 ? 'R' : 'L';
      o.startAction('touch', 0.2, side === 'R' ? 1 : -1, { side, tc: 0.05, contact: this.ballAt(0.05), done: false, cut: true });
      o.touchCooldown = 0.1; o.agileT = 0.28; return;
    }
    if (!(f > 0.12 && f < 0.75 && Math.abs(lat) < 0.42)) return;
    // only touch it again once it has stopped running away from the feet
    const away = (b.vx - o.vel.x) * o.heading.x + (b.vz - o.vel.z) * o.heading.z;
    if (away > 0.35) return;
    const want = this.dribbleDir(o);
    const rel = Math.hypot(b.vx - o.vel.x, b.vz - o.vel.z);
    if (!want && rel < 0.4 && b.speed() < 0.4) return; // already under control (a still ball at his feet)
    // alternate feet, but use the foot on the ball's side when it is clearly to one side
    const side: Side = Math.abs(lat) > 0.12 ? (lat > 0 ? 'R' : 'L') : (o.lastTouchFoot > 0 ? 'L' : 'R');
    o.startAction('touch', 0.24, side === 'R' ? 1 : -1, { side, tc, contact: c, done: false });
    o.touchCooldown = 0.12;
  }

  /** The dribble touch itself: pushed ahead, further when sprinting and less precisely for weaker dribblers. */
  private applyTouch(o: Agent, side: Side) {
    const b = this.ball;
    if (b.owner !== o) return;
    const want = this.dribbleDir(o);
    const sp = o.speed(); const frac = Math.min(1, sp / o.maxSpeed);
    if (want) {
      const sprint = o.intent.sprint; const skill = o.skill.dribble;
      const cutTouch = v2.dot(this.dirOf(o), want) < 0.75; // (taking it a new way: short and controlled)
      let knock = cutTouch ? 0.15 : sprint ? 0.45 + 0.9 * frac : 0.1 + 0.35 * frac;
      if (o.action?.data?.out) knock += 1.3; // (out from under his feet, back in front of him)
      knock *= 1.25 - skill * 0.5;
      if (o.intent.jockey) knock = 0.15;
      const err = (Math.random() + Math.random() - 1) * (0.03 + (1 - skill) * 0.1 + (sprint ? 0.04 : 0));
      // a hard cut at pace is taken slightly with the run and bent round (he can't stop dead), not dead square
      const run = this.dirOf(o); const sharp = v2.dot(run, want) < 0.3 && o.speed() > 3;
      const dir = v2.rot(sharp ? v2.norm(v2.add(want, v2.scale(run, 0.45 * Math.min(1, o.speed() / 7)))) : want, err);
      const along = Math.max(sp * Math.max(0, v2.dot(v2.norm(o.vel.x || o.vel.z ? o.vel : dir), dir)), 0.8);
      // weight the touch for the speed he is heading for, so he doesn't run over his own ball when accelerating
      const intended = o.maxSpeed * (sprint ? 1 : 0.7) * 0.93 * Math.min(1, v2.len(o.intent.move)) * 0.85;
      const speed = cutTouch ? Math.max(1.8, Math.min(intended * 0.6, Math.max(along, sp * 0.5) + 1)) + knock : Math.max(along, Math.min(intended, along + 1.2)) + knock;
      b.vx = dir.x * speed; b.vz = dir.z * speed; b.vy = 0; b.setRolling();
      o.touchCooldown = sprint ? 0.18 : 0.12;
      if (cutTouch) o.agileT = Math.max(o.agileT, 0.25);
    } else {
      b.vx = o.vel.x * 0.5; b.vz = o.vel.z * 0.5; b.setRolling(); // sole trap: keep it close
      o.touchCooldown = 0.22;
    }
    o.lastTouchFoot = side === 'R' ? 1 : -1;
    b.lastTouch = o; b.lastTouchTeam = o.team; b.lastTouchTime = this.time;
  }

  /** Receiving and intercepting: when the ball will come within reach, reach a foot, thigh, chest (or the head, or a
   *  keeper's hands) to the point where it will arrive. The contact itself happens when that limb meets the ball. */
  private anticipate() {
    const b = this.ball;
    if (b.held) return;
    if (this.setPiece && b.owner === this.setPiece.taker) return;
    const owner = b.owner; const bp = { x: b.x, z: b.z };
    if (owner && v2.dist(owner.pos, bp) < 1.3) return; // at his feet: you have to tackle for it
    const path = this.predicted();
    for (const a of this.agents) {
      if (a === owner || (owner && a.team === owner.team)) continue;
      if (a.action || a.cooldown > 0 || a.stunned > 0 || a.pendingKick) continue;
      if (b.lastTouch === a && this.time - b.lastTouchTime < 0.25) continue;
      if (v2.dist(a.pos, bp) > 7) continue;
      if (this.lapses(a)) continue;
      // a team-mate lets a pass meant for someone else run through to him
      if (!owner && b.lastTouchTeam === a.team && b.lastTouch !== a && this.time - b.lastTouchTime < 3.5) {
        const meantFor = this.passAssist?.receiver ?? this.teams[a.team].agents.find((x) => x !== a && x.ai.expectBall > this.time);
        if (meantFor && meantFor !== a) continue;
      }
      const hands = a.isGK && this.inOwnBox(a, b.x, b.z) && !this.setPiece && b.lastTouchTeam !== a.team;
      // the intended receiver of a pass stretches for it (pass assistance)
      const meant = (this.passAssist?.receiver === a) || (a.ai.expectBall > this.time && b.lastTouchTeam === a.team);
      // ...while an opponent needs a moment to react, and a fast ball is harder to cut out
      const opponent = b.lastTouchTeam !== a.team && !a.isGK;
      // (against a side being pushed for a goal, defenders read its passes a beat late and reach less for them: the
      // ball zips through the lines - the passing is what makes the goal)
      const outplayed = opponent && this.mods.pushTeam === b.lastTouchTeam ? this.mods.pushLevel : 0;
      if (opponent && this.time - b.lastTouchTime < 0.16 + 0.3 * outplayed && v2.dist(a.pos, bp) > 2) continue;
      const rf = meant ? 1.5 : opponent ? Math.max(0.7, Math.min(1, 1.25 - b.speed() / 40)) * (1 - 0.4 * outplayed) : 1;
      // scan the next 0.35 s of flight (with sub-samples) for the first point inside the reach envelope
      let plan: { t: number; x: number; y: number; z: number; part: string } | null = null;
      for (let i = 1; i < path.length && !plan; i++) {
        const p0 = path[i - 1], p1 = path[i]; if (p0.t > 0.35) break;
        for (let k = 1; k <= 4; k++) {
          const u = k / 4; const t = p0.t + (p1.t - p0.t) * u; if (t < 0.05) continue;
          const x = p0.x + (p1.x - p0.x) * u, y = p0.y + (p1.y - p0.y) * u, z = p0.z + (p1.z - p0.z) * u;
          const ax = a.pos.x + a.vel.x * t, az = a.pos.z + a.vel.z * t;
          const dh = Math.hypot(x - ax, z - az);
          if (hands && y < 2.4 && dh < 0.95) { plan = { t, x, y, z, part: 'hands' }; break; }
          if (!a.isGK && y >= 1.35 && y < 2.45 && dh < 0.55 * rf) { plan = { t, x, y, z, part: 'head' }; break; }
          if (y < 1.45 && dh < 0.8 * rf) { plan = { t, x, y, z, part: y < 0.55 ? 'foot' : y < 1.0 ? 'thigh' : 'chest' }; break; }
        }
      }
      if (!plan) continue;
      const lat = (plan.x - a.pos.x) * -a.heading.z + (plan.z - a.pos.z) * a.heading.x; const side: Side = lat >= 0 ? 'R' : 'L';
      const contact = { x: plan.x, y: plan.y, z: plan.z };
      // On your side, a ball in the air from your own team (a cross, a pass, a shot that's lost its legs) or dropping in
      // the attacking third is yours to play: control moves to whoever meets it, and he only heads or volleys it if
      // you press for it (nothing is finished for you).
      const goalX = this.teams[a.team].attackDir * this.pitch.length / 2;
      const yours = this.humanTeam === a.team && !this.autopilot && !a.isGK && ((plan.y > 0.55 && (b.lastTouchTeam === a.team || Math.abs(plan.x - goalX) < 30)) || b.inFlightShot?.team === a.team);
      if (yours && a !== this.controlled) {
        const prev = this.controlled; this.setControlled(a);
        if (this.queued && this.queued.agent === prev) this.queued.agent = a;
        if (this.headerIntent && this.headerIntent.agent === prev) this.headerIntent.agent = a;
      }
      if (plan.part === 'head') {
        // the player you control only heads it where you said (shoot: at goal, pass: on to a team-mate); with nothing
        // pressed he cushions it down to his feet
        const ctl = a === this.controlled && !this.autopilot;
        const hi = ctl && this.headerIntent?.agent === a && this.time < this.headerIntent.until ? this.headerIntent
          : ctl && this.queued?.agent === a && this.time - this.queued.at < 3 ? { q: this.queued } : null;
        // jump just as high as the ball needs, peaking at the moment of contact
        const jump = Math.max(0, Math.min(0.7, plan.y - a.motion!.headPoint().y + 0.04));
        a.startAction('header', Math.max(0.3, plan.t * 2), 1, { contact, tc: plan.t, done: false, jump, intent: hi?.q ?? null, control: ctl && !hi && (b.lastTouchTeam === a.team || yours) });
        if (hi) { this.headerIntent = null; if (this.queued === hi.q) this.queued = null; }
      }
      else a.startAction('trap', plan.t + 0.22, side === 'R' ? 1 : -1, { side, contact, tc: plan.t, part: plan.part, done: false });
    }
  }

  /** Unplanned contacts: the ball rebounds off whichever limb it hits (shins, thighs, torso, arms, heads). */
  private collideBodies() {
    const b = this.ball;
    if (b.held) return;
    for (const a of this.agents) {
      if (Math.hypot(a.pos.x - b.x, a.pos.z - b.z) > 1.8 || b.y > 2.6) continue;
      if (b.lastTouch === a && this.time - b.lastTouchTime < 0.2) continue;
      const act = a.action;
      if (act && act.data && !act.data.done && !act.fired && ['kick', 'touch', 'trap', 'header', 'dive', 'tackle', 'slide'].includes(act.type)) continue; // a planned contact owns it
      const dribbling = b.owner === a;
      if (dribbling && act?.type === 'skill' && !act.data?.released) continue; // (the move has the ball)
      for (const c of a.motion!.colliders()) {
        if (dribbling && (c.part === 'foot' || c.part === 'shin' || (b.y < 0.35 && c.part !== 'arm' && c.part !== 'hand'))) continue; // the dribbler's own touches handle his legs
        const q = pointSegment(b.x, b.y, b.z, c);
        const minD = c.r + BALL_R;
        if (q.d >= minD || q.d < 1e-6) continue;
        const nx = (b.x - q.cx) / q.d, ny = (b.y - q.cy) / q.d, nz = (b.z - q.cz) / q.d;
        b.x = q.cx + nx * minD; b.y = Math.max(BALL_R, q.cy + ny * minD); b.z = q.cz + nz * minD;
        const rvx = b.vx - a.vel.x, rvy = b.vy, rvz = b.vz - a.vel.z; const vn = rvx * nx + rvy * ny + rvz * nz;
        // A pass meeting its intended receiver's leg or body before he'd shaped to take it is still his first touch
        // (no pinball rebound off a team-mate running onto it).
        const meant = !b.owner && b.lastTouchTeam === a.team && b.lastTouch !== a && (a.ai.expectBall > this.time || this.passAssist?.receiver === a);
        if (vn < 0 && meant && c.part !== 'head' && c.part !== 'arm' && c.part !== 'hand' && !a.isGK && a.stunned <= 0) { this.firstTouch(a); break; }
        if (vn < 0) {
          const e = c.part === 'foot' ? 0.55 : c.part === 'head' ? 0.5 : c.part === 'shin' ? 0.45 : c.part === 'thigh' ? 0.4 : 0.3;
          b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny; b.vz -= (1 + e) * vn * nz;
          b.vx = a.vel.x + (b.vx - a.vel.x) * 0.9; b.vz = a.vel.z + (b.vz - a.vel.z) * 0.9;
          b.wx *= 0.4; b.wy *= 0.4; b.wz *= 0.4;
          if (!dribbling) { b.lastTouch = a; b.lastTouchTeam = a.team; b.lastTouchTime = this.time; b.inFlightShot = null; if (b.owner && b.owner !== a) b.owner = null; }
          if (-vn > 3) this.emit({ type: 'touch', agent: a, heavy: true });
        }
        break;
      }
    }
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

  /** Receiving: the first touch. It goes where the player is heading, and keeps his stride if he's running that way
   *  (a soft touch to settle it when he has to turn). A difficult ball (fast, bouncing, at pace) can be a heavy touch,
   *  a few metres ahead of him, but only a really hard one comes off him like a rebound. */
  private firstTouch(a: Agent) {
    const b = this.ball;
    if (b.held && b.owner !== a) return;
    if (this.ownGoalTouch(a, a.isGK && (a.ai.fumble ?? 0) > this.time)) return;
    const rel = Math.hypot(b.vx - a.vel.x, b.vy * 0.5, b.vz - a.vel.z);
    const teamSkill = a.team === 0 ? this.mods.homeAiSkill : this.mods.botSkill;
    const skill = a.isHuman && !this.autopilot ? a.skill.control : a.skill.control * (0.7 + 0.6 * teamSkill);
    if (rel > 27 + skill * 6 && Math.random() < 0.6) { this.deflect(a, 0.3); this.emit({ type: 'touch', agent: a, heavy: true }); return; }
    const want = this.touchDirection(a);
    const spd = v2.len(a.vel); const along = Math.max(0, v2.dot(want, a.vel));
    // in stride: the ball goes on just ahead of him at his pace; turning: a soft touch he can turn onto
    // (coming short, against the ball's direction, or back toward his own goal, he cushions it instead)
    const up = { x: this.teams[a.team].attackDir, z: 0 }; const bsp = Math.hypot(b.vx, b.vz);
    const against = bsp > 1 && (want.x * b.vx + want.z * b.vz) / bsp < -0.3;
    let s = along > 2 && !against && v2.dot(want, up) > -0.25 ? 0.4 + along * 0.95 : 1.1 + spd * 0.25;
    const sprinting = spd > a.maxSpeed * 0.75;
    const heavyP = Math.max(0, Math.min(0.35, (rel - 12) / (34 + 24 * skill) + (b.y > 0.6 ? (b.y - 0.6) * 0.15 : 0) + (sprinting ? 0.05 : 0)));
    let dir = want; const heavy = Math.random() < heavyP;
    if (heavy) { s += 0.6 + Math.random() * 0.8; const e = (Math.random() - 0.5) * 0.5; dir = { x: want.x * Math.cos(e) - want.z * Math.sin(e), z: want.x * Math.sin(e) + want.z * Math.cos(e) }; }
    b.vx = dir.x * s; b.vz = dir.z * s; b.vy = Math.min(0, b.vy * 0.2); if (b.y < 0.3) b.setRolling(); else { b.wx = b.wy = b.wz = 0; }
    b.owner = heavy ? null : a; b.lastTouch = a; b.lastTouchTeam = a.team; b.lastTouchTime = this.time; b.inFlightShot = null;
    a.touchCooldown = heavy ? 0.3 : 0.18; a.ai.nextDecision = this.time + 0.25 + Math.random() * 0.25;
    // a side pushing for a goal plays at tempo: a touch to set it, then straight on with it (the shot, or the next pass)
    if (this.mods.pushTeam === a.team && this.mods.pushLevel > 0.3 && !heavy) a.ai.nextDecision = this.time + 0.1 + Math.random() * 0.1;
    // carry on the way the touch went (the next decision comes shortly)
    a.ai.mode = 'dribble'; a.ai.target = v2.add(a.pos, v2.scale(dir, 6)); a.ai.expectBall = 0;
    if (this.aiDriven(a)) { a.intent.move = dir; a.intent.face = null; }
    if (this.humanTeam === a.team && !a.isHuman && !a.isGK) this.setControlled(a);
    this.emit({ type: 'touch', agent: a, heavy });
  }

  /** Which way a receiver takes his first touch: the stick if the player is steering him; otherwise on along his run
   *  if he's running, or into the most open space upfield (never needlessly back toward his own goal). */
  private touchDirection(a: Agent): V2 {
    // the player's stick decides, if it's held (assisted or not)
    if (a === this.controlled && !this.autopilot && v2.len(this.stick) > 0.2) return v2.norm(this.stick);
    const pa = this.passAssist; if (pa?.run && pa.receiver === a) return pa.run;
    const team = this.teams[a.team]; const up = { x: team.attackDir, z: 0 };
    const spd = v2.len(a.vel); const runDir = spd > 2 ? v2.norm(a.vel) : a.heading;
    const opp = this.opponentsOf(a.team).agents;
    const cands: V2[] = [runDir, up, v2.norm({ x: up.x, z: 0.7 }), v2.norm({ x: up.x, z: -0.7 }), { x: 0, z: 1 }, { x: 0, z: -1 }];
    let best = runDir; let bs = -Infinity;
    for (const c of cands) {
      const probe = v2.add(a.pos, v2.scale(c, 3.5));
      let space = 6; for (const o of opp) space = Math.min(space, v2.dist(o.pos, probe));
      const turn = Math.acos(Math.max(-1, Math.min(1, v2.dot(c, runDir))));
      const lim = { x: this.pitch.length / 2 - 1.5, z: this.pitch.width / 2 - 1.5 };
      const out = Math.abs(probe.x) > lim.x || Math.abs(probe.z) > lim.z ? 4 : 0;
      const score = space * 0.5 + v2.dot(c, up) * 0.8 - turn * (0.4 + 0.25 * Math.min(spd, 8)) - out;
      if (score > bs) { bs = score; best = c; }
    }
    return best;
  }

  /** The head meets the ball: attackers in range go for goal, everyone else clears it. */
  private doHeader(a: Agent) {
    const b = this.ball; const team = this.teams[a.team];
    if (this.ownGoalTouch(a)) { this.emit({ type: 'header', agent: a }); return; }
    const { length: L, goalWidth, goalHeight, boxDepth } = this.pitch;
    const gx = team.attackDir * L / 2;
    const attacking = Math.abs(a.pos.x - gx) < boxDepth + 4;
    const hd = a.action?.data ?? {};
    let v: V3;
    if (hd.control) {
      // cushioned down to his feet
      v = { x: a.heading.x * 1.3 + a.vel.x * 0.5, y: 1.1, z: a.heading.z * 1.3 + a.vel.z * 0.5 }; b.inFlightShot = null;
      b.strike(v, { x: 0, y: 0, z: 0 }, a, this.time); a.cooldown = 0.15; this.emit({ type: 'header', agent: a }); return;
    }
    if (hd.intent) {
      const q = hd.intent as NonNullable<Match['queued']>;
      const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
      if (q.kind === 'shoot') {
        // a header at goal where the stick points, the press setting how hard (and a downward header bounces up nicely)
        let z = q.dir.x * team.attackDir > 0.15 ? a.pos.z + (q.dir.z / q.dir.x) * (gx - a.pos.x) : Math.sign(q.dir.z || 1) * goalWidth * 0.3;
        z = Math.max(-goalWidth / 2 + 0.3, Math.min(goalWidth / 2 - 0.3, z));
        const assist = this.director?.shotAssist(a.team) ?? 0;
        if (assist > 0) { const k = this.opponentsOf(a.team).agents.find((x) => x.isGK); const kz = k ? k.pos.z : 0; z += ((Math.sign(z - kz) || 1) * (goalWidth / 2 - 0.4) - z) * assist; }
        const sol = solveKick({ x: b.x, y: b.y, z: b.z }, { x: gx + team.attackDir * 0.3, y: Math.min(goalHeight - 0.4, 0.35 + (1 - q.power) * 0.9), z }, 10 + q.power * 9, 0, 0, this.surface);
        const err = gauss() * 0.06 * (1.35 - a.skill.shoot * 0.7) * (1 - 0.8 * assist); const c = Math.cos(err), sn = Math.sin(err);
        v = { x: sol.v.x * c - sol.v.z * sn, y: sol.v.y, z: sol.v.z * c + sol.v.x * sn }; b.inFlightShot = { team: a.team, target: { x: gx, y: 1, z } };
      } else {
        // a header on to a team-mate in the direction pressed
        const mate = this.pickPassTarget(a, q.dir, false, true);
        const to = mate ? v2.add(mate.pos, v2.scale(mate.vel, 0.6)) : v2.add({ x: b.x, z: b.z }, v2.scale(q.dir, 10));
        const dd = Math.max(3, v2.dist(to, { x: b.x, z: b.z })); const sol = solveKick({ x: b.x, y: b.y, z: b.z }, { x: to.x, y: BALL_R, z: to.z }, Math.min(16, 6 + dd * 0.45), 0, 0, this.surface, 0.5);
        v = sol.v; b.inFlightShot = null;
        if (mate) { mate.ai.expectBall = this.time + 2; if (this.humanTeam === a.team) { this.setControlled(mate); this.passAssist = { passer: a, receiver: mate, aim: q.dir, until: this.time + 6, lofted: true, spot: null, run: null }; } }
      }
      b.strike(v, { x: 0, y: 0, z: 0 }, a, this.time); a.cooldown = 0.3; this.emit({ type: 'header', agent: a }); return;
    }
    if (attacking) {
      const z = (Math.random() < 0.5 ? -1 : 1) * goalWidth * (0.2 + Math.random() * 0.2);
      const sol = solveKick({ x: b.x, y: b.y, z: b.z }, { x: gx + team.attackDir * 0.3, y: 0.6 + Math.random() * 1.2, z }, 13 + Math.random() * 4, 0, 0, this.surface);
      v = sol.v; b.inFlightShot = { team: a.team, target: { x: gx, y: 1, z } };
    } else {
      const mate = this.pickPassTarget(a, a.heading, false);
      const aim = mate && v2.dist(mate.pos, a.pos) < 18 ? v2.norm(v2.sub(mate.pos, a.pos)) : v2.norm({ x: team.attackDir, z: Math.sign(b.z || 1) * 0.6 });
      v = { x: aim.x * 10.5, y: 5.5, z: aim.z * 10.5 }; b.inFlightShot = null;
    }
    b.strike(v, { x: 0, y: 0, z: 0 }, a, this.time); a.cooldown = 0.3;
    this.emit({ type: 'header', agent: a });
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
          if (b.owner) { b.owner.stunned = Math.max(b.owner.stunned, 0.6); b.owner = null; b.held = false; } // (a dribble into the net: it runs away from him)
          b.x = side * (L / 2 - r); b.vx = -side * Math.max(2, Math.abs(b.vx) * 0.4); b.vy = Math.max(1.5, b.vy); b.wx = b.wy = b.wz = 0;
          b.inFlightShot = null; b.lastTouchTeam = defending.index; this.emit({ type: 'post', bar: false });
          return;
        }
        if (this.shootout) { if (this.shootout.live) this.recordShootoutKick(true); else { this.ball.vx = this.ball.vz = 0; } return; } // (a shootout goal counts in the shootout)
        this.scoreGoal(scoring.index);
        return;
      }
      if (this.shootout) { if (this.shootout.live) this.recordShootoutKick(false); else { this.ball.vx = this.ball.vz = 0; } return; }
      if (b.held) return;
      const lastAttack = b.lastTouchTeam === scoring.index;
      const zSide = Math.sign(b.z || 1);
      this.emit({ type: 'out', kind: lastAttack ? 'goalkick' : 'corner' });
      this.deadBall(1.1, () => lastAttack
        ? this.restart('goalkick', defending.index, { x: side * (L / 2 - (this.pitch.futsal ? 2.5 : 5.5)), z: zSide * (this.pitch.futsal ? 2 : 6) })
        : this.restart('corner', scoring.index, { x: side * (L / 2 - 0.4), z: zSide * (W / 2 - 0.4) }));
      return;
    }
    if (this.shootout && Math.abs(b.z) > W / 2 + r) { if (this.shootout.live) this.recordShootoutKick(false); return; }
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
    const og = this.ball.lastTouch && this.ball.lastTouch.team !== teamIdx && this.time - this.ball.lastTouchTime < 4 ? this.ball.lastTouch : undefined;
    this.phase = 'goal'; this.phaseTimer = 4.6; this.lastConceded = teamIdx === 0 ? 1 : 0; this.setPiece = null;
    this.ball.owner = null; this.ball.inFlightShot = null;
    for (const a of this.agents) { a.hasBall = false; a.pendingKick = null; if (a.action?.type === 'kick') a.action = null; }
    this.startCelebration(teamIdx, scorer);
    this.lastScorer = scorer; this.lastScorerTeam = teamIdx; this.lastGoalAt = this.time;
    this.emit({ type: 'goal', team: teamIdx, scorer, ownGoal: og });
  }

  /** The goal celebration: the scorer wheels away toward the corner and finishes with a knee slide, a fist pump, a
   *  jumping punch or an airplane run; team-mates chase after and mob them; the other side slumps. */
  celebration: { team: number; scorer: Agent | null; style: CelebStyle; spot: V2; t0: number } | null = null;
  lastGoalAt = -99;
  private startCelebration(team: number, scorer: Agent | null) {
    const { length: L, width: W } = this.pitch; const sc = this.pitch.futsal ? 0.45 : 1;
    const styles: CelebStyle[] = ['slide', 'pump', 'leap', 'plane'];
    let spot: V2 = { x: 0, z: 0 }; let style: CelebStyle = 'pump';
    if (scorer) {
      // off toward the nearer corner flag at that end (in front of the fans), not too far
      const end = this.teams[team].attackDir * L / 2; const zs = Math.sign(scorer.pos.z || (Math.random() - 0.5));
      const corner = { x: end - Math.sign(end) * 5 * sc, z: zs * (W / 2 - 3 * sc) };
      const to = v2.sub(corner, scorer.pos); const d = v2.len(to);
      spot = d > 22 * sc ? v2.add(scorer.pos, v2.scale(v2.norm(to), 22 * sc)) : corner;
      style = styles[Math.floor(Math.random() * styles.length)];
      if (style === 'slide' && v2.dist(spot, scorer.pos) < 7 * sc) style = 'pump'; // a knee slide needs a run-up
      scorer.action = null; scorer.pendingKick = null;
      scorer.startAction('celebrate', 30, Math.random() < 0.5 ? 1 : -1, { role: 'scorer', style, ft: -1 });
    }
    this.celebration = { team, scorer, style, spot, t0: this.time };
    let k = 0;
    for (const a of this.agents) {
      if (a === scorer) continue;
      if (a.action?.type === 'kick') a.action = null;
      if (a.action && a.action.type !== 'celebrate') continue; // (let a diving keeper land)
      const mine = a.team === team;
      a.startAction('celebrate', 30, k++ % 2 ? 1 : -1, mine ? { role: 'mate', slot: k, delay: 0.25 + Math.random() * 0.6, near: false } : { role: 'sad', variant: a.isGK ? 2 : Math.floor(Math.random() * 3) });
    }
  }

  private applyCelebration() {
    const c = this.celebration; if (!c) return;
    const el = this.time - c.t0; const s = c.scorer;
    for (const a of this.agents) {
      a.intent.steer = null; a.intent.jockey = false;
      const act = a.action; const d = act?.type === 'celebrate' ? act.data : null;
      if (!d) { if (!a.busy()) a.intent.move = { x: 0, z: 0 }; continue; }
      if (d.role === 'scorer') {
        const to = v2.sub(c.spot, a.pos); const dist = v2.len(to);
        if (d.ft < 0) {
          // the run: away toward the fans
          a.intent.move = dist > 0.3 ? v2.norm(to) : { x: 0, z: 0 }; a.intent.sprint = true; a.intent.face = null;
          const trigger = c.style === 'slide' ? dist < 5 && a.speed() > 4 : c.style === 'plane' ? el > 2.6 || dist < 1 : dist < 1.6;
          if (trigger || el > 3.2) {
            d.ft = act!.t;
            if (c.style === 'slide') { const sp = Math.max(5, a.speed()); d.slideV = v2.scale(v2.norm(a.vel), sp); }
          }
        } else {
          // the finale, on the spot (facing back toward the pitch and the cameras)
          if (!d.slideV) { a.intent.move = { x: 0, z: 0 }; a.intent.sprint = false; }
          if (!d.faceDir) d.faceDir = v2.norm({ x: -this.teams[c.team].attackDir * 0.6, z: -Math.sign(a.pos.z || 1) });
          if (!d.slideV) a.intent.face = d.faceDir;
        }
      } else if (d.role === 'mate') {
        // chase the scorer and mob them (each to their own place round them)
        if (!s || el < d.delay) { a.intent.move = { x: 0, z: 0 }; continue; }
        const ang = d.slot * 2.39996; const spot = v2.add(s.pos, { x: Math.cos(ang) * (0.95 + (d.slot % 3) * 0.35), z: Math.sin(ang) * (0.95 + (d.slot % 3) * 0.35) });
        const to = v2.sub(spot, a.pos); const dist = v2.len(to);
        a.intent.move = dist > 0.25 ? v2.scale(v2.norm(to), Math.min(1, dist / 2)) : { x: 0, z: 0 }; a.intent.sprint = dist > 4;
        d.near = v2.dist(a.pos, s.pos) < 2.4;
        a.intent.face = d.near ? v2.sub(s.pos, a.pos) : null;
      } else {
        // the other side: a slow, heavy walk back, or standing with hands on head
        if (a.isGK) { a.intent.move = { x: 0, z: 0 }; continue; }
        const home = { x: -this.teams[a.team].attackDir * 4, z: a.pos.z * 0.8 };
        const to = v2.sub(home, a.pos);
        a.intent.move = d.variant === 1 && el > 1 ? v2.scale(v2.norm(to), 0.28) : { x: 0, z: 0 }; a.intent.sprint = false;
        a.intent.face = d.variant === 1 && el > 1 ? null : v2.sub(c.spot, a.pos);
      }
    }
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
