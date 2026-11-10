import type { MatchScript, PlayerCard } from '@shared/types';
import type { Kit, Team } from '@shared/teams';
import { Ball, passSpeedFor, passTimeFor } from './ball';
import { Agent } from './player';
import { FORMATION_433, FORMATION_FUTSAL, v2, type PitchSpec, type V2 } from './pitch';
import { Director, FREE_PLAY, OVERRUN_LIMIT, type Modifiers } from './director';
import { updateTeamAI } from './ai';
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
}
export type KickKind = 'pass' | 'through' | 'lob' | 'shoot';
export type Phase = 'kickoff' | 'play' | 'goal' | 'restart' | 'halftime' | 'fulltime';
export type MatchEvent =
  | { type: 'goal'; team: number; scorer: Agent | null; forced?: boolean }
  | { type: 'post' } | { type: 'save'; keeper: Agent } | { type: 'kickoff'; half: number } | { type: 'halftime' } | { type: 'fulltime' }
  | { type: 'out'; kind: 'throw' | 'corner' | 'goalkick' } | { type: 'kick'; kind: KickKind; power: number; agent: Agent } | { type: 'tackle'; success: boolean } | { type: 'switch'; agent: Agent };

export class TeamState {
  score = 0; agents: Agent[] = []; kickoffs = 0;
  constructor(public index: number, public attackDir: 1 | -1, public setup: TeamSetup) {}
}

export class Match {
  ball = new Ball();
  agents: Agent[] = [];
  teams: [TeamState, TeamState];
  pitch: PitchSpec;
  time = 0;
  clock = 0;
  phase: Phase = 'kickoff';
  phaseTimer = 0;
  half = 1;
  possessionTeam = -1;
  controlled: Agent | null = null;
  director: Director | null = null;
  mods: Modifiers = { ...FREE_PLAY, speedMul: [1, 1], keeper: ['normal', 'normal'], goalAllowed: [true, true], shotAppetite: [1, 1] };
  /** Persistent per-team speed factor (e.g. Ultimate Team chemistry); multiplies the director's modifiers. */
  teamSpeedBonus: [number, number] = [1, 1];
  charge: { kind: 'shoot' | 'pass'; t: number } | null = null;
  ended = false;
  stoppage = false;
  lastSwitch = 0;
  /** Seconds since the human last touched the controls; the AI takes over the controlled player when idle. */
  idleTime = 0;
  /** Camera-relative control axes, set by the renderer each frame so stick directions match the screen. */
  controlBasis = { right: { x: -1, z: 0 }, forward: { x: 0, z: 1 } };
  autopilot = false;
  private knockTimer = 0;
  private restartTaker: Agent | null = null;
  private listeners = new Set<(e: MatchEvent) => void>();
  private firstKickoff = 0;
  private paused = false;

  constructor(public opts: MatchOptions) {
    this.pitch = opts.pitch;
    this.teams = [new TeamState(0, 1, opts.teams[0]), new TeamState(1, -1, opts.teams[1])];
    const formation = opts.pitch.futsal ? FORMATION_FUTSAL : FORMATION_433;
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
  private emit(e: MatchEvent) { for (const l of this.listeners) l(e); }
  get frac() { return this.clock / this.opts.durationSec; }
  get humanTeam() { return this.opts.humanTeam; }
  setPaused(p: boolean) { this.paused = p; }
  get isPaused() { return this.paused; }

  /** Game clock as "mm:ss" with stoppage indicator. */
  clockText(): { text: string; stoppage: boolean } {
    const mins = this.opts.clockMinutes; const f = this.frac;
    const halfLen = mins / 2;
    const shown = this.half === 1 ? Math.min(f * mins, halfLen) : Math.min(f * mins, mins);
    const m = Math.floor(shown), s = Math.floor((shown - Math.floor(shown)) * 60);
    const over = this.half === 1 ? f * mins - halfLen : f * mins - mins;
    const text = over > 0.02 ? `${this.half === 1 ? halfLen : mins}'+${Math.max(1, Math.ceil(over))}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return { text, stoppage: over > 0.02 };
  }

  /* ------------------------------ set pieces ------------------------------ */
  kickoff(teamIdx: number, initial = false) {
    const t = this.teams[teamIdx];
    const { length: L, width: W } = this.pitch;
    this.ball.reset(0, 0);
    for (const team of this.teams) {
      for (const a of team.agents) {
        // everyone in their own half
        let x = (a.home.x - 1) / 2 * (L / 2) * 0.9; // -1..0 scaled → own half (negative along attack dir)
        x = Math.min(-1.5, x) * team.attackDir;
        const z = a.home.z * (W / 2) * 0.8;
        a.pos = { x, z }; a.vel = { x: 0, z: 0 }; a.heading = { x: team.attackDir, z: 0 }; a.action = null; a.hasBall = false; a.cooldown = 0; a.stunned = 0;
        a.intent = { move: { x: 0, z: 0 }, sprint: false };
      }
    }
    const taker = t.agents[t.agents.length - 1 - (this.pitch.futsal ? 0 : 1)] ?? t.agents[t.agents.length - 1]; // ST
    taker.pos = { x: -0.4 * t.attackDir, z: 0 };
    const helper = t.agents[t.agents.length - 1];
    if (helper !== taker) helper.pos = { x: -1.5 * t.attackDir, z: 2 };
    this.ball.owner = null; this.restartTaker = taker;
    this.phase = 'kickoff'; this.phaseTimer = initial ? 2.2 : 1.6;
    this.possessionTeam = teamIdx; t.kickoffs++;
    if (this.humanTeam !== null) this.setControlled(this.humanTeam === teamIdx ? taker : this.closestToBall(this.humanTeam));
    this.emit({ type: 'kickoff', half: this.half });
  }

  private restart(kind: 'throw' | 'corner' | 'goalkick', teamIdx: number, pos: V2) {
    const t = this.teams[teamIdx];
    this.ball.reset(pos.x, pos.z);
    let taker: Agent;
    if (kind === 'goalkick') taker = t.agents[0];
    else taker = t.agents.filter((a) => !a.isGK).sort((p, q) => v2.dist(p.pos, pos) - v2.dist(q.pos, pos))[0];
    for (const a of this.agents) { a.hasBall = false; a.action = null; }
    const inward = v2.norm({ x: (pos.x === 0 ? 0 : -Math.sign(pos.x)) || 0.001, z: -Math.sign(pos.z) || 0 });
    taker.pos = v2.sub(pos, v2.scale(inward, 0.8)); taker.vel = { x: 0, z: 0 }; taker.heading = inward;
    this.restartTaker = taker;
    this.phase = 'restart'; this.phaseTimer = kind === 'goalkick' ? 1.2 : 0.9;
    this.possessionTeam = teamIdx;
    if (this.humanTeam === teamIdx) this.setControlled(taker);
    this.emit({ type: 'out', kind });
  }

  private setControlled(a: Agent | null) {
    if (this.controlled === a) return;
    if (this.controlled) this.controlled.isHuman = false;
    this.controlled = a;
    if (a) { a.isHuman = true; a.intent = { move: { x: 0, z: 0 }, sprint: false }; this.lastSwitch = this.time; this.emit({ type: 'switch', agent: a }); }
  }
  private closestToBall(teamIdx: number, exclude?: Agent | null): Agent {
    const t = this.teams[teamIdx]; const bp = { x: this.ball.x, z: this.ball.z };
    return t.agents.filter((a) => !a.isGK && a !== exclude).sort((p, q) => v2.dist(p.pos, bp) - v2.dist(q.pos, bp))[0];
  }

  /* ------------------------------ main loop ------------------------------ */
  update(dt: number, input?: InputManager) {
    if (this.ended || this.paused) return;
    this.time += dt;
    if (this.phase === 'play' || this.phase === 'restart') this.clock += dt;
    this.director?.update(dt);

    // phase timers
    if (this.phaseTimer > 0) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.phase === 'kickoff' || this.phase === 'restart') { this.phase = 'play'; if (this.restartTaker) this.givePossession(this.restartTaker); }
        else if (this.phase === 'goal') this.kickoff(this.lastConceded);
        else if (this.phase === 'halftime') { this.half = 2; this.kickoff(this.firstKickoff === 0 ? 1 : 0); }
      }
    }
    // human + AI intents
    if (input && this.controlled && this.humanTeam !== null) this.handleHuman(input, dt);
    for (const t of this.teams) updateTeamAI(this, t, dt);

    // integrate agents
    for (const a of this.agents) {
      if (this.phase === 'kickoff' || this.phase === 'halftime') { a.intent.move = { x: 0, z: 0 }; a.intent.sprint = false; }
      else if (this.phase === 'restart' && a.team !== this.possessionTeam) {
        const d = v2.sub({ x: this.ball.x, z: this.ball.z }, a.pos); const dl = v2.len(d);
        if (dl < 6) { a.intent.move = v2.scale(v2.norm(d), -1); a.intent.sprint = false; }
      }
      const mul = this.mods.speedMul[a.team] * this.teamSpeedBonus[a.team] * (this.phase === 'goal' ? 0.4 : 1);
      a.update(dt, mul);
      // keep inside the stadium apron
      const lim = { x: this.pitch.length / 2 + 3, z: this.pitch.width / 2 + 3 };
      a.pos.x = Math.max(-lim.x, Math.min(lim.x, a.pos.x)); a.pos.z = Math.max(-lim.z, Math.min(lim.z, a.pos.z));
    }
    this.resolveActions(dt);
    if (this.phase === 'play') this.ballInteractions(dt);
    this.followOwner();
    this.director?.steerShot(dt);
    this.ball.update(dt);
    if (this.phase === 'play') this.checkBounds();
    this.separateAgents();
    this.updateClockPhases();
  }

  private lastConceded = 0;
  lastScorer: Agent | null = null;
  lastScorerTeam: number | null = null;

  private updateClockPhases() {
    if (this.phase !== 'play' && this.phase !== 'restart') return;
    const f = this.frac;
    const pending = this.director ? !this.director.done : false;
    if (this.half === 1 && f >= 0.5) {
      // allow stoppage in the first half only until the next scripted goal that belongs before half time has happened
      const e = this.director?.pending;
      if (!e || e.t > 0.5 || f >= 0.6) { this.phase = 'halftime'; this.phaseTimer = 3; for (const t of this.teams) t.attackDir = (t.attackDir === 1 ? -1 : 1); this.ball.owner = null; for (const a of this.agents) a.hasBall = false; this.emit({ type: 'halftime' }); this.stoppage = false; return; }
      this.stoppage = true;
    }
    if (this.half === 2 && f >= 1) {
      if (!pending) { this.fullTime(); return; }
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
      const scorer = t.agents[t.agents.length - 1];
      this.emit({ type: 'goal', team, scorer, forced: true });
    }
    this.fullTime();
  }

  private givePossession(a: Agent) {
    this.ball.owner = a; a.hasBall = true; this.ball.lastTouch = a; this.ball.lastTouchTeam = a.team; this.possessionTeam = a.team;
    this.ball.x = a.pos.x + a.heading.x * 0.45; this.ball.z = a.pos.z + a.heading.z * 0.45; this.ball.y = this.ball.radius;
  }

  /* ------------------------------ human control ------------------------------ */
  /** Convert a stick direction (x right, y up on screen) into a pitch direction using the camera basis. */
  stickToWorld(x: number, y: number): V2 {
    const { right, forward } = this.controlBasis;
    return { x: right.x * x + forward.x * y, z: right.z * x + forward.z * y };
  }

  /** True when `a` should be driven by the AI (bots, or the human's player while on auto-pilot). */
  aiDriven(a: Agent) { return !a.isHuman || this.autopilot; }

  private handleHuman(input: InputManager, dt: number) {
    const me = this.controlled!; const team = this.teams[this.humanTeam!];
    const move = this.stickToWorld(input.move.x, input.move.y);
    const active = v2.len(move) > 0.1 || input.sprint.down || input.pass.down || input.shoot.down || input.through.down || input.lob.down || input.switch.down || input.slide.down;
    this.idleTime = active ? 0 : this.idleTime + dt;
    this.autopilot = this.idleTime > 2.0;
    if (this.autopilot) { this.charge = null; return; }
    me.intent.move = move; me.intent.sprint = input.sprint.down; me.intent.face = null;
    const defending = !me.hasBall;
    const bp = { x: this.ball.x, z: this.ball.z };

    if (me.hasBall && this.phase === 'play') {
      // charge-and-release kicks
      if (input.shoot.down) { if (!this.charge || this.charge.kind !== 'shoot') this.charge = { kind: 'shoot', t: 0 }; else this.charge.t += dt; }
      if (input.pass.down) { if (!this.charge || this.charge.kind !== 'pass') this.charge = { kind: 'pass', t: 0 }; else this.charge.t += dt; }
      const aimDir = v2.len(move) > 0.2 ? v2.norm(move) : me.heading;
      if (input.shoot.justReleased && !me.action) { const p = Math.min(1, Math.max(0.22, this.charge?.t ?? 0.3) / 0.9); this.startKick(me, 'shoot', p, aimDir, { finesse: input.finesse.down }); this.charge = null; }
      else if (input.pass.justReleased && !me.action) { const p = Math.min(1, Math.max(0.2, this.charge?.t ?? 0.2) / 0.5); this.startKick(me, 'pass', p, aimDir, {}); this.charge = null; }
      else if (input.through.justPressed && !me.action) this.startKick(me, 'through', 0.7, aimDir, {});
      else if (input.lob.justPressed && !me.action) this.startKick(me, 'lob', 0.7, aimDir, {});
      if (input.shield.down) { me.intent.sprint = false; me.intent.move = v2.scale(move, 0.4); }
      if (!input.shoot.down && !input.pass.down) this.charge = null;
    } else {
      this.charge = null;
      if (this.phase === 'play') {
        if (input.pass.down && v2.len(move) < 0.2) { const d = v2.sub(bp, me.pos); if (v2.len(d) > 0.8) { me.intent.move = v2.norm(d); me.intent.sprint = true; } } // contain
        if (input.shoot.justPressed && !me.action) this.tackle(me, 'tackle');
        if ((input.through.justPressed || input.slide.justPressed) && !me.action) this.tackle(me, 'slide');
        if (input.switch.justPressed) this.setControlled(this.closestToBall(team.index, me));
        // auto switch when the ball is loose or with the opponent and someone else is clearly closer
        if (this.time - this.lastSwitch > 0.7 && (!this.ball.owner || this.ball.owner.team !== team.index) && !me.action) {
          const c = this.closestToBall(team.index);
          if (c !== me && v2.dist(c.pos, bp) + 2.5 < v2.dist(me.pos, bp)) this.setControlled(c);
        }
      }
    }
    void defending;
  }

  /* ------------------------------ kicks ------------------------------ */
  startKick(a: Agent, kind: KickKind, power: number, dir: V2, opts: { targetAgent?: Agent; finesse?: boolean; botSkill?: number; target?: V2 }) {
    if (a.action || !a.hasBall) return;
    const act = a.startAction('kick', 0.32, dir.z * (a.team === 0 ? 1 : -1) > 0 ? 1 : -1, { kind, power, dir, ...opts });
    act.data.strike = 0.12;
    this.charge = null;
  }

  private pickPassTarget(a: Agent, dir: V2, through: boolean): Agent | null {
    const t = this.teams[a.team]; let best: Agent | null = null; let bs = -Infinity;
    for (const m of t.agents) {
      if (m === a) continue;
      const d = v2.sub(m.pos, a.pos); const dist = v2.len(d); if (dist < 1.5) continue;
      const cos = v2.dot(v2.norm(d), dir);
      if (cos < 0.25) continue;
      const fwd = (m.pos.x - a.pos.x) * t.attackDir;
      const s = cos * 2 - dist * (through ? 0.015 : 0.03) + (through ? fwd * 0.03 : 0) - (m.isGK ? 1 : 0);
      if (s > bs) { bs = s; best = m; }
    }
    return best;
  }

  private fireKick(a: Agent, d: any) {
    const kind: KickKind = d.kind; const team = this.teams[a.team]; const dir0: V2 = d.dir;
    const human = a.isHuman; const skill = d.botSkill ?? 0.5;
    const noise = (sigma: number) => (Math.random() + Math.random() + Math.random() - 1.5) * sigma * 1.5;
    let vx = 0, vy = 0, vz = 0, curl = 0;
    const g = 9.81;
    if (kind === 'shoot') {
      const { length: L, goalWidth: gw, goalHeight: gh } = this.pitch;
      const gx = team.attackDir * L / 2;
      let dir = dir0;
      let zHit: number;
      const towardGoal = dir.x * team.attackDir;
      if (towardGoal > 0.15) {
        zHit = a.pos.z + (dir.z / dir.x) * (gx - a.pos.x);
        const edge = gw / 2 - 0.45;
        // aim assist: pull wild aims back toward the frame
        if (Math.abs(zHit) > edge) zHit = Math.sign(zHit) * (edge + (Math.abs(zHit) - edge) * (human ? 0.25 : 0.1));
      } else { zHit = a.pos.z + dir.z * 20; }
      const target = d.target ? d.target : { x: gx, z: zHit };
      dir = v2.norm(v2.sub(target, a.pos));
      const dist = v2.dist(target, a.pos);
      const power = d.power as number;
      let speed = 15 + power * 15; if (d.finesse) speed *= 0.85;
      let elev = 0.05 + power * 0.17 + (power > 0.92 ? 0.14 : 0);
      let sigma = human ? (0.15 - (a.card.attrs.shooting / 99) * 0.1) * (0.6 + power * 0.7) : 0.17 - skill * 0.13;
      const allowed = this.mods.goalAllowed[a.team];
      const push = this.mods.pushTeam === a.team ? this.mods.pushLevel : 0;
      if (allowed && push > 0) { sigma *= 1 - push * 0.85; elev = Math.min(elev, 0.05 + 0.1 * (1 - push)); if (dist > 10) speed = Math.max(speed, 20); }
      const ang = v2.angle(dir) + noise(sigma);
      elev = Math.max(0.02, elev + noise(sigma * 0.6));
      const hs = speed * Math.cos(elev);
      vx = Math.cos(ang) * hs; vz = Math.sin(ang) * hs; vy = speed * Math.sin(elev);
      if (d.finesse) curl = -Math.sign(zHit || 1) * team.attackDir * 0.45;
      this.ball.inFlightShot = { team: a.team, target: { x: gx, y: Math.min(gh - 0.5, 0.6 + power * 1.2), z: Math.max(-gw / 2 + 0.5, Math.min(gw / 2 - 0.5, zHit)) } };
    } else {
      const through = kind === 'through';
      const target: Agent | null = d.targetAgent ?? this.pickPassTarget(a, dir0, through);
      let aim: V2; let dist: number;
      if (target) {
        const base = v2.dist(target.pos, a.pos);
        const tFlight = kind === 'lob' ? Math.sqrt(2 * base / g) * 1.1 : passTimeFor(base);
        const lead = v2.scale(target.vel, Math.min(tFlight, 1.6) * (through ? 1.0 : 0.6));
        aim = v2.add(target.pos, lead);
        if (through) aim = v2.add(aim, { x: team.attackDir * Math.min(9, 3 + base * 0.2), z: 0 });
        dist = v2.dist(aim, a.pos);
        target.ai.expectBall = this.time + Math.min(3, tFlight + 0.8);
      } else { aim = v2.add(a.pos, v2.scale(dir0, 14 + d.power * 14)); dist = v2.dist(aim, a.pos); }
      const dir = v2.norm(v2.sub(aim, a.pos));
      const sigma = human ? 0.035 : 0.15 - skill * 0.12;
      const ang = v2.angle(dir) + noise(sigma);
      if (kind === 'lob') {
        const elev = 0.66; const v = Math.max(9, Math.min(27, Math.sqrt((g * dist) / Math.sin(2 * elev))));
        vx = Math.cos(ang) * v * Math.cos(elev); vz = Math.sin(ang) * v * Math.cos(elev); vy = v * Math.sin(elev);
      } else {
        const v = Math.max(7, Math.min(28, passSpeedFor(dist * (through ? 1.15 : 1)) * (0.9 + d.power * 0.2)));
        vx = Math.cos(ang) * v; vz = Math.sin(ang) * v; vy = dist > 26 ? 1.2 : 0;
      }
      this.ball.inFlightShot = null;
    }
    this.ball.kick(vx, vy, vz, a, curl);
    a.hasBall = false; a.cooldown = 0.4; this.knockTimer = 0;
    this.emit({ type: 'kick', kind, power: d.power, agent: a });
  }

  /* ------------------------------ tackles ------------------------------ */
  tackle(a: Agent, kind: 'tackle' | 'slide') {
    if (a.action || a.stunned > 0 || a.tackleCooldown > 0) return;
    a.tackleCooldown = kind === 'slide' ? 2.2 : 1.3;
    const bp = { x: this.ball.x, z: this.ball.z };
    const dir = v2.norm(v2.sub(bp, a.pos));
    const act = a.startAction(kind, kind === 'slide' ? 1.0 : 0.5, 1, { dir: v2.len(dir) ? dir : a.heading });
    act.data.strike = kind === 'slide' ? 0.22 : 0.14;
  }

  private resolveActions(dt: number) {
    for (const a of this.agents) {
      const act = a.action; if (!act) continue;
      if (act.type === 'kick' && !act.fired && act.t >= act.data.strike) { act.fired = true; if (a.hasBall && this.ball.owner === a) this.fireKick(a, act.data); }
      if ((act.type === 'tackle' || act.type === 'slide') && !act.fired && act.t >= act.data.strike) {
        act.fired = true;
        const owner = this.ball.owner;
        const range = act.type === 'slide' ? 2.1 : 1.5;
        if (owner && owner.team !== a.team && v2.dist(a.pos, owner.pos) < range) {
          const bias = this.mods.tackleBias * (a.team === 0 ? 1 : -1);
          let p = 0.42 + (a.card.attrs.defending - owner.card.attrs.dribbling) / 160 + bias * 0.5 + (a.isHuman ? 0.12 : 0) + (act.type === 'slide' ? 0.1 : 0);
          p = Math.max(0.05, Math.min(0.96, p));
          const ok = Math.random() < p;
          if (ok) {
            owner.hasBall = false; this.ball.owner = null; owner.stunned = 0.5; owner.cooldown = 0.5;
            const kd = v2.norm(v2.add(act.data.dir, { x: (Math.random() - 0.5) * 0.8, z: (Math.random() - 0.5) * 0.8 }));
            this.ball.kick(kd.x * 4, 0.8, kd.z * 4, a);
            if (act.type === 'slide' || Math.random() < 0.3) owner.startAction('fallen', 0.9);
            a.cooldown = act.type === 'slide' ? 0.5 : 0.1;
          } else { if (act.type === 'slide') { act.duration = 1.3; } else a.stunned = 0.35; }
          this.emit({ type: 'tackle', success: ok });
        } else if (!owner && v2.dist(a.pos, { x: this.ball.x, z: this.ball.z }) < range * 0.8 && this.ball.y < 0.8) {
          const kd = act.data.dir as V2; this.ball.kick(kd.x * 7, 0.5, kd.z * 7, a); a.cooldown = 0.3;
        }
      }
      if (act.type === 'dive' && act.data.save && !this.ball.owner) {
        const dz = Math.abs(this.ball.z - a.pos.z), dx = Math.abs(this.ball.x - a.pos.x);
        if (dx < 1.7 && dz < 1.9 && this.ball.y < 2.5 && this.ball.lastTouch !== a) {
          const wall = act.data.mode === 'wall';
          if (this.ball.speed3() < 17 || (wall && Math.random() < 0.7)) { this.givePossession(a); a.keeperHold = 0; this.ball.vx = this.ball.vz = this.ball.vy = 0; }
          else { const dir = this.teams[a.team].attackDir; this.ball.kick(Math.abs(this.ball.vx) * 0.4 * dir + dir * 2, 3.5, Math.sign(this.ball.z - a.pos.z || 1) * (5 + Math.random() * 5), a); }
          this.ball.inFlightShot = null; act.data.save = false;
          this.emit({ type: 'save', keeper: a });
        }
      }
    }
  }

  /* ------------------------------ ball & players ------------------------------ */
  private ballInteractions(dt: number) {
    const ball = this.ball;
    if (ball.owner) {
      const o = ball.owner;
      // knock-ons while sprinting
      this.knockTimer -= dt;
      if (o.intent.sprint && o.speed() > 5.5 && this.knockTimer <= 0 && !o.action) {
        const sp = o.speed() + 1.8;
        ball.kick(o.heading.x * sp, 0.3, o.heading.z * sp, o);
        o.hasBall = false; o.cooldown = 0.08; this.knockTimer = 0.7;
      }
      return;
    }
    // claim the loose ball: closest eligible player
    let best: Agent | null = null; let bd = Infinity;
    for (const a of this.agents) {
      if (a.cooldown > 0 || a.stunned > 0) continue;
      if (a.action && a.action.type !== 'kick' && !(a.action.type === 'dive')) continue;
      const reachY = a.isGK ? 2.3 : 1.25;
      if (ball.y > reachY) continue;
      const fx = a.pos.x + a.heading.x * 0.25, fz = a.pos.z + a.heading.z * 0.25;
      const d = Math.hypot(ball.x - fx, ball.z - fz);
      const r = a.isGK ? 1.3 : 0.8;
      if (d < r && d < bd) { bd = d; best = a; }
    }
    if (!best) return;
    const rel = Math.hypot(ball.vx - best.vel.x, ball.vz - best.vel.z);
    if (best.isGK) {
      const mode = this.mods.keeper[best.team];
      if (ball.inFlightShot && ball.inFlightShot.team !== best.team && mode === 'soft') return; // scripted: the keeper is beaten
      if (rel > 16 && mode !== 'wall' && Math.random() < 0.5) { this.deflect(best, rel); return; }
    } else {
      // A ball that has just been struck flies past or off a nearby player; nobody controls a 20 m/s pass from a metre away.
      if (ball.flight < 0.28 && best !== ball.lastTouch) { if (Math.random() < 0.18 * (dt * 60)) this.deflect(best, rel); return; }
      const skill = 0.45 + (best.card.attrs.dribbling / 99) * 0.55;
      const pControl = rel < 8 ? 1 : Math.max(0, 1 - (rel - 8) / 14) * skill + (rel < 13 ? 0.25 : 0);
      if (Math.random() > pControl * (dt * 60 * 0.6 + 0.4)) { if (rel > 12) this.deflect(best, rel); return; }
    }
    this.givePossession(best);
    if (best.isGK) best.keeperHold = 0;
    ball.inFlightShot = null;
    if (this.humanTeam === best.team && !best.isHuman && !best.isGK && this.phase === 'play') this.setControlled(best);
    best.ai.nextDecision = this.time + 0.45 + Math.random() * 0.35;
  }

  private deflect(a: Agent, rel: number) {
    const ball = this.ball;
    const n = v2.norm({ x: ball.x - a.pos.x + (Math.random() - 0.5) * 0.5, z: ball.z - a.pos.z + (Math.random() - 0.5) * 0.5 });
    ball.vx = n.x * rel * 0.3 + a.vel.x; ball.vz = n.z * rel * 0.3 + a.vel.z; ball.vy = Math.max(ball.vy * 0.3, 0.8);
    ball.lastTouch = a; ball.lastTouchTeam = a.team; a.cooldown = 0.3; ball.inFlightShot = null; ball.flight = 0.3;
  }

  private followOwner() {
    const o = this.ball.owner; if (!o) return;
    const ahead = o.action?.type === 'kick' ? 0.35 : 0.45;
    const tx = o.pos.x + o.heading.x * ahead, tz = o.pos.z + o.heading.z * ahead;
    this.ball.x += (tx - this.ball.x) * 0.5; this.ball.z += (tz - this.ball.z) * 0.5; this.ball.y = this.ball.radius;
    this.ball.vx = o.vel.x; this.ball.vz = o.vel.z; this.ball.vy = 0;
    this.ball.spin += o.speed() / this.ball.radius / 60;
  }

  private checkBounds() {
    const b = this.ball; const { length: L, width: W, goalWidth: gw, goalHeight: gh } = this.pitch;
    const r = b.radius;
    if (Math.abs(b.x) > L / 2 + r) {
      const side = Math.sign(b.x);
      const scoring = this.teams.find((t) => t.attackDir === side)!;
      const defending = this.teams[scoring.index === 0 ? 1 : 0];
      const inFrame = Math.abs(b.z) < gw / 2 - r * 0.5 && b.y < gh - r * 0.5;
      if (inFrame) {
        if (this.director && !this.director.allowGoal(scoring.index)) {
          // the woodwork intervenes
          b.x = side * (L / 2 - 0.2); b.vx = -b.vx * 0.45 + -side * 2; b.vz += (Math.random() - 0.5) * 6; b.vy = Math.max(b.vy * 0.5, 1.5); b.curl = 0; b.inFlightShot = null;
          b.lastTouchTeam = scoring.index;
          this.emit({ type: 'post' });
          return;
        }
        this.scoreGoal(scoring.index);
        return;
      }
      if (Math.abs(b.x) > L / 2 + 2.5 || b.y < gh + 1) {
        if (b.lastTouchTeam === scoring.index) this.restart('goalkick', defending.index, { x: side * (L / 2 - (this.pitch.futsal ? 3 : 5.5)), z: Math.sign(b.z || 1) * (this.pitch.futsal ? 3 : 9) });
        else this.restart('corner', scoring.index, { x: side * (L / 2 - 0.5), z: Math.sign(b.z || 1) * (W / 2 - 0.5) });
      }
      return;
    }
    if (Math.abs(b.z) > W / 2 + r) {
      const team = b.lastTouchTeam === 0 ? 1 : 0;
      this.restart('throw', team, { x: Math.max(-L / 2 + 2, Math.min(L / 2 - 2, b.x)), z: Math.sign(b.z) * (W / 2 - 0.3) });
    }
  }

  private scoreGoal(teamIdx: number) {
    const t = this.teams[teamIdx];
    t.score++;
    this.director?.onGoal(teamIdx);
    const scorer = this.ball.lastTouch && this.ball.lastTouch.team === teamIdx ? this.ball.lastTouch : null;
    this.phase = 'goal'; this.phaseTimer = 4.2; this.lastConceded = teamIdx === 0 ? 1 : 0;
    this.ball.owner = null; for (const a of this.agents) { a.hasBall = false; if (a.action?.type === 'kick') a.action = null; }
    this.ball.vx *= 0.2; this.ball.vz *= 0.2; this.ball.inFlightShot = null;
    if (scorer) { scorer.action = null; scorer.startAction('celebrate', 4); scorer.intent.move = { x: 0, z: 0 }; }
    this.lastScorer = scorer; this.lastScorerTeam = teamIdx;
    this.emit({ type: 'goal', team: teamIdx, scorer });
  }

  private separateAgents() {
    const n = this.agents.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = this.agents[i], b = this.agents[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z; const d2 = dx * dx + dz * dz;
      const min = 0.7;
      if (d2 < min * min && d2 > 1e-6) { const d = Math.sqrt(d2); const push = (min - d) / 2; const nx = dx / d, nz = dz / d; a.pos.x -= nx * push; a.pos.z -= nz * push; b.pos.x += nx * push; b.pos.z += nz * push; }
    }
  }
}
