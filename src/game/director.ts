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
}

export const FREE_PLAY: Modifiers = {
  botSkill: 0.6, homeAiSkill: 0.6, speedMul: [1, 1], keeper: ['normal', 'normal'], goalAllowed: [true, true], pushTeam: null, pushLevel: 0, forced: false, tackleBias: 0, shotAppetite: [1, 1],
};

const WINDOW_BEFORE = 0.035;
const FORCE_AFTER = 0.02;
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
  get pending(): GoalEvent | null { return this.events[this.idx] ?? null; }
  get done() { return this.idx >= this.events.length; }
  get remaining() { return this.events.length - this.idx; }
  teamOf(e: GoalEvent): 0 | 1 { return e.side === 'home' ? 0 : 1; }

  /** Called by the match when a goal is scored and credited to `team`. */
  onGoal(team: number) {
    const e = this.pending;
    if (e && this.teamOf(e) === team) this.idx++;
    else console.warn('[director] unscripted goal slipped through', team, e);
  }

  allowGoal(team: number): boolean {
    const e = this.pending;
    if (!e) return false;
    return this.teamOf(e) === team && this.match.frac >= e.t - WINDOW_BEFORE;
  }

  update(dt: number) {
    const m = this.mods; const frac = this.match.frac; const e = this.pending;
    const base = this.script.botStrength;
    m.botSkill = 0.35 + base * 0.5; m.homeAiSkill = 0.55; m.speedMul = [1, 0.96 + base * 0.08]; m.tackleBias = 0; m.forced = false; m.pushTeam = null; m.pushLevel = 0;
    m.keeper = ['wall', 'wall']; m.goalAllowed = [false, false]; m.shotAppetite = [0.45, 0.45];
    if (!e) {
      // Script complete: no more goals for anyone; keep bots lively but harmless.
      m.shotAppetite = [0.3, 0.25];
      return;
    }
    const team = this.teamOf(e);
    const other = team === 0 ? 1 : 0;
    const start = e.t - WINDOW_BEFORE;
    // Score-state pacing: if the human is "ahead of script" the bots look sharper; if behind, they look sloppy.
    if (frac >= start) {
      const level = Math.min(1, (frac - start) / (WINDOW_BEFORE + FORCE_AFTER));
      m.pushTeam = team; m.pushLevel = level; m.goalAllowed[team] = true;
      m.keeper[other] = level > 0.5 ? 'soft' : 'normal'; // the defending keeper gets beatable
      m.keeper[team] = 'wall';
      m.shotAppetite[team] = 1.2 + level * 1.5; m.shotAppetite[other] = 0.3;
      m.tackleBias = (team === 0 ? 1 : -1) * (0.35 + level * 0.6);
      if (team === 1) { m.botSkill = Math.min(1, 0.7 + level * 0.3); m.speedMul[1] = 1.04 + level * 0.1; m.speedMul[0] = 1 - level * 0.06; }
      else { m.homeAiSkill = 0.75 + level * 0.25; m.botSkill = Math.max(0.1, 0.35 - level * 0.25); m.speedMul[1] = 0.96 - level * 0.1; }
      if (frac >= e.t + FORCE_AFTER) {
        m.forced = true; m.pushLevel = 1; m.keeper[other] = 'soft';
        // escalate the longer a forced goal takes: the pushing side gets quicker, the other side wilts
        const esc = Math.min(1, (frac - (e.t + FORCE_AFTER)) / 0.05);
        m.speedMul[team] = 1.06 + esc * 0.18; m.speedMul[other] = 0.94 - esc * 0.2;
        m.shotAppetite[team] = 3 + esc * 3; m.tackleBias = (team === 0 ? 1 : -1) * (0.8 + esc * 0.2);
        if (team === 1) m.botSkill = 1; else { m.homeAiSkill = 1; m.botSkill = 0.1; }
      }
    } else {
      // Between windows: bots play to the score state. Ahead on the script => composed; behind => wasteful.
      const lead = this.match.teams[0].score - this.match.teams[1].score;
      const nextIsAway = team === 1;
      m.botSkill = 0.35 + base * 0.5 + (nextIsAway ? 0.1 : -0.1) - lead * 0.03;
    }
    m.botSkill = Math.max(0.1, Math.min(1, m.botSkill));
  }

  /** Steer a shot in flight into the net when a goal is being forced. */
  steerShot(dt: number) {
    const m = this.mods; const ball = this.match.ball;
    if (m.pushTeam === null || !m.forced) return;
    const shot = ball.inFlightShot;
    if (!shot || shot.team !== m.pushTeam || ball.owner) return;
    const team = this.match.teams[m.pushTeam];
    const gx = team.attackDir * this.match.pitch.length / 2;
    const dx = gx - ball.x;
    if (Math.sign(dx) !== Math.sign(ball.vx) || Math.abs(dx) > 40 || Math.abs(dx) < 0.3) return;
    const tz = shot.target?.z ?? Math.sign(ball.z || 1) * this.match.pitch.goalWidth * 0.3;
    const ty = shot.target?.y ?? 1.1;
    const hs = Math.hypot(ball.vx, ball.vz) || 1;
    const t = Math.abs(dx) / Math.max(hs, 8);
    const wantZ = (tz - ball.z) / t, wantY = (ty - ball.y + 0.5 * 9.81 * t * t) / t;
    const k = 1 - Math.exp(-6 * dt);
    ball.vz += (wantZ - ball.vz) * k; ball.vy += (wantY - ball.vy) * k; ball.curl *= 0.8;
    const want = Math.max(hs, 14); const cur = Math.hypot(ball.vx, ball.vz);
    const s = want / cur; ball.vx *= s; ball.vz *= s;
  }
}
