import { keeperSavePlan } from './ai';
import type { GoalEvent, MatchScript } from '@shared/types';
import type { Match } from './match';

export type KeeperMode = 'normal' | 'wall' | 'soft';

/** Per-tick modifiers consumed by the AI and the physics. Team index 0 = home (human), 1 = away (bots). */
export interface Modifiers {
  /** General bot quality 0..1 (passing/shooting accuracy, decision speed). */
  botSkill: number;
  /** Quality of the human's AI teammates. */
  homeAiSkill: number;
  speedMul: [number, number];
  keeper: [KeeperMode, KeeperMode];
  goalAllowed: [boolean, boolean];
  /** Team whose goal is currently being engineered, with ramp level 0..1 and a hard-force flag. */
  pushTeam: 0 | 1 | null;
  pushLevel: number;
  forced: boolean;
  /** -1..1: positive makes home tackles succeed and away tackles fail. */
  tackleBias: number;
  /** Shot appetite multipliers per team. */
  shotAppetite: [number, number];
  /** 0..1 chance that the team defending a goal window misreads a ball or doesn't commit to a tackle. */
  defenseLapse: number;
}

export const FREE_PLAY: Modifiers = {
  botSkill: 0.6, homeAiSkill: 0.6, speedMul: [1, 1], keeper: ['normal', 'normal'], goalAllowed: [true, true], pushTeam: null, pushLevel: 0, forced: false, tackleBias: 0, shotAppetite: [1, 1], defenseLapse: 0,
};

/** Window timing per pitch: futsal scripts pack more goals into a shorter match, so its windows open earlier and escalate faster. */
const WINDOWS = { full: { before: 0.06, after: 0.02, esc: 0.05 }, futsal: { before: 0.1, after: 0.01, esc: 0.03 },
  // futsal sudden death: the golden goal is meant for a particular stage (3v3, 2v2 or 1v1), so its window is tight
  overtime: { before: 0.024, after: 0.004, esc: 0.02 } };

/** Hard stop: fraction of regulation after which any remaining scripted goals are awarded outright. */
export const OVERRUN_LIMIT = 1.2;

/** Enforces the server script: the final score is fixed before kickoff; the director paces the match toward it
 *  by opening/closing goal windows, boosting or sandbagging the bots, steering shots and controlling keepers. */
export class Director {
  mods: Modifiers = { ...FREE_PLAY, speedMul: [1, 1], keeper: ['normal', 'normal'], goalAllowed: [false, false], shotAppetite: [1, 1] };
  private idx = 0;
  readonly events: GoalEvent[];
  constructor(public script: MatchScript, private match: Match) {
    this.events = script.events.slice();
    this.mods.botSkill = 0.35 + script.botStrength * 0.5;
  }
  private get win() { return this.match.overtime ? WINDOWS.overtime : this.match.pitch.futsal ? WINDOWS.futsal : WINDOWS.full; }
  get pending(): GoalEvent | null { return this.events[this.idx] ?? null; }
  get done() { return this.idx >= this.events.length; }
  get remaining() { return this.events.length - this.idx; }
  teamOf(e: GoalEvent): 0 | 1 { return e.side === 'home' ? 0 : 1; }

  /** Goals the player scored off the script, each answered by the other side. */
  answered = 0;

  /** Called by the match when a goal is scored and credited to `team`. */
  onGoal(team: number) {
    const e = this.pending;
    if (e && this.teamOf(e) === team) { this.idx++; return; }
    if (!this.freeScoring(team)) { console.warn('[director] unscripted goal slipped through', team, e); return; }
    // The player scored when the script didn't have them scoring: the goal stands, and the other side gets one more
    // later on (sooner if time is short), so the result - and the goal difference - stays as drawn.
    const frac = this.match.frac;
    const t = Math.min(Math.max(frac + 0.045 + Math.random() * 0.05, frac + 0.02), Math.max(0.985, frac + 0.025));
    const ev: GoalEvent = { t, side: team === 0 ? 'away' : 'home', style: 'open' };
    let i = this.idx; while (i < this.events.length && this.events[i].t <= t) i++;
    this.events.splice(i, 0, ev);
    this.answered++;
  }

  /** The player's side may score whenever they manage it (the bots answer it later, see onGoal) - except in sudden
   *  death, where a golden goal would end the match, and in the closing minutes, when there'd be no time to answer. */
  freeScoring(team: number): boolean {
    const mt = this.match;
    return team === 0 && mt.humanTeam === 0 && !mt.overtime && mt.frac < 0.95;
  }

  allowGoal(team: number): boolean {
    if (this.freeScoring(team)) return true;
    const e = this.pending;
    if (!e) return false;
    return this.teamOf(e) === team && this.match.frac >= e.t - this.win.before;
  }

  update(dt: number) {
    const m = this.mods; const frac = this.match.frac; const e = this.pending;
    const base = this.script.botStrength;
    m.botSkill = 0.35 + base * 0.5; m.homeAiSkill = 0.55; m.speedMul = [1, 0.96 + base * 0.08]; m.tackleBias = 0; m.forced = false; m.pushTeam = null; m.pushLevel = 0; m.defenseLapse = 0;
    m.keeper = ['wall', 'wall']; m.goalAllowed = [false, false]; m.shotAppetite = [0.45, 0.45];
    if (!e) {
      // Script complete: no more goals for the bots; keep them lively but harmless.
      m.shotAppetite = [this.freeScoring(0) ? 1 : 0.3, 0.25];
      if (this.freeScoring(0)) m.keeper[1] = 'normal';
      return;
    }
    const team = this.teamOf(e);
    const other = team === 0 ? 1 : 0;
    const W = this.win; const start = e.t - W.before;
    // Score-state pacing: if the human is "ahead of script" the bots look sharper; if behind, they look sloppy.
    if (frac >= start) {
      const level = Math.min(1, (frac - start) / (W.before + W.after));
      m.pushTeam = team; m.pushLevel = level; m.goalAllowed[team] = true;
      m.keeper[other] = level > 0.5 ? 'soft' : 'normal'; // the defending keeper gets beatable
      m.keeper[team] = 'wall';
      m.shotAppetite[team] = 1.2 + level * 1.5; m.shotAppetite[other] = 0.3;
      m.tackleBias = (team === 0 ? 1 : -1) * (0.35 + level * 0.6);
      if (team === 1) { m.botSkill = Math.min(1, 0.7 + level * 0.3); m.homeAiSkill = 0.55 - level * 0.2; m.speedMul[1] = 1.04 + level * 0.1; m.speedMul[0] = 1 - level * 0.06; }
      else { m.homeAiSkill = 0.75 + level * 0.25; m.botSkill = Math.max(0.1, 0.35 - level * 0.25); m.speedMul[1] = 0.96 - level * 0.1; }
      m.defenseLapse = level > 0.4 ? (level - 0.4) * 0.5 : 0;
      if (frac >= e.t + W.after) {
        m.forced = true; m.pushLevel = 1; m.keeper[other] = 'soft';
        // escalate the longer a forced goal takes: the pushing side gets quicker, the other side wilts
        const esc = Math.min(1, (frac - (e.t + W.after)) / W.esc);
        m.speedMul[team] = 1.06 + esc * 0.18; m.speedMul[other] = 0.94 - esc * 0.2;
        m.shotAppetite[team] = 3 + esc * 3; m.tackleBias = (team === 0 ? 1 : -1) * (0.8 + esc * 0.2);
        if (team === 1) { m.botSkill = 1; m.homeAiSkill = 0.15; } else { m.homeAiSkill = 1; m.botSkill = 0.1; }
        m.defenseLapse = 0.45 + esc * 0.5;
      }
    } else {
      // Between windows: bots play to the score state. Ahead on the script => composed; behind => wasteful.
      const lead = this.match.teams[0].score - this.match.teams[1].score;
      const nextIsAway = team === 1;
      m.botSkill = 0.35 + base * 0.5 + (nextIsAway ? 0.1 : -0.1) - lead * 0.03;
    }
    m.botSkill = Math.max(0.1, Math.min(1, m.botSkill));
    // while the player is free to score, the keeper they face plays them straight (no "wall")
    if (this.freeScoring(0) && m.keeper[1] === 'wall') m.keeper[1] = 'normal';
  }

  /** Per-step steering. Forced goals are guided in; goals that are not scheduled are bent onto the woodwork,
   *  wide or over before they reach the line, so the outcome stays exactly as scripted while the ball keeps flying naturally. */
  steer(dt: number) {
    const ball = this.match.ball;
    if (ball.held || ball.owner) return;
    if (this.mods.pushTeam !== null && this.mods.forced) this.steerIn(dt);
    for (const team of [0, 1] as const) if (!this.allowGoal(team)) this.deny(team, dt);
  }

  private steerIn(dt: number) {
    const m = this.mods; const ball = this.match.ball;
    const shot = ball.inFlightShot;
    if (!shot || shot.team !== m.pushTeam) return;
    const team = this.match.teams[m.pushTeam!];
    const gx = team.attackDir * this.match.pitch.length / 2;
    const dx = gx - ball.x;
    if (Math.sign(dx) !== Math.sign(ball.vx) || Math.abs(dx) > 40 || Math.abs(dx) < 0.3) return;
    const tz = shot.target?.z ?? Math.sign(ball.z || 1) * this.match.pitch.goalWidth * 0.3;
    const ty = Math.min(this.match.pitch.goalHeight - 0.4, shot.target?.y ?? 1.1);
    const hs = Math.hypot(ball.vx, ball.vz) || 1;
    const t = Math.abs(dx) / Math.max(hs, 8);
    const wantZ = (tz - ball.z) / t, wantY = (ty - ball.y + 0.5 * 9.81 * t * t) / t;
    const k = 1 - Math.exp(-5 * dt);
    ball.vz += (wantZ - ball.vz) * k; ball.vy += (wantY - ball.vy) * k;
    ball.wx *= 0.9; ball.wy *= 0.9; ball.wz *= 0.9;
    const want = Math.max(hs, 14); const cur = Math.hypot(ball.vx, ball.vz);
    const s = want / cur; ball.vx *= s; ball.vz *= s;
  }

  private denyPlan = new Map<number, 'post' | 'wide' | 'over'>();
  /** Per shot: can the keeper reach it (decided once, when it is first read)? */
  private keeperVerdict = new Map<number, boolean>();
  private deny(team: 0 | 1, dt: number) {
    const mt = this.match; const ball = mt.ball; const { length: L, goalWidth: gw, goalHeight: gh } = mt.pitch;
    const side = mt.teams[team].attackDir; const lineX = side * L / 2;
    if (ball.vx * side < 1.5) return;
    const dist = (lineX - ball.x) * side;
    if (dist < -0.2 || dist > 38) return;
    const path = mt.predicted();
    let hit: { t: number; y: number; z: number } | null = null;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      if ((b.x - lineX) * side >= 0 && (a.x - lineX) * side < 0) {
        const k = (lineX - a.x) / (b.x - a.x || 1e-6);
        hit = { t: a.t + (b.t - a.t) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k }; break;
      }
    }
    if (!hit || Math.abs(hit.z) > gw / 2 + 0.12 || hit.y > gh + 0.12) return;
    // The keeper gets every shot he can genuinely reach (he saves it with his hands, in plain sight); only a shot
    // beyond him is nudged off target, gently, from as early as possible.
    const keeper = mt.opponentsOf(team).agents.find((a) => a.isGK);
    const key = Math.round(ball.lastTouchTime * 1000);
    if (keeper && !keeper.busy() || keeper?.action?.type === 'dive') {
      if (!this.keeperVerdict.has(key)) { const kp = keeperSavePlan(mt, keeper!, { t: hit.t, y: hit.y, z: hit.z }); this.keeperVerdict.set(key, kp.reachable && Math.abs(keeper!.pos.x - lineX) < 6); if (this.keeperVerdict.size > 40) this.keeperVerdict.clear(); }
      if (this.keeperVerdict.get(key)) return;
    }
    let plan = this.denyPlan.get(key);
    if (!plan) { plan = hit.y > gh - 0.8 ? 'over' : Math.random() < 0.3 ? 'post' : 'wide'; this.denyPlan.set(key, plan); if (this.denyPlan.size > 40) this.denyPlan.clear(); }
    const zSign = Math.sign(hit.z || (Math.random() - 0.5));
    let tz = hit.z, ty = hit.y;
    if (plan === 'post') tz = zSign * (gw / 2 + 0.02);
    else if (plan === 'wide') tz = zSign * (gw / 2 + 0.6);
    else ty = gh + 0.45;
    const t = Math.max(0.05, hit.t);
    const cap = 10;
    const az = Math.max(-cap, Math.min(cap, (2 * (tz - hit.z)) / (t * t)));
    const ay = Math.max(-cap, Math.min(cap, (2 * (ty - hit.y)) / (t * t)));
    ball.vz += az * dt; ball.vy += ay * dt;
  }
}
