import { keeperSavePlan } from './ai';
import { BallBody, predictPath } from './ball';
import type { MatchScript } from '@shared/types';
import { Rng } from '@shared/rng';
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
  /** 0..1 per team: the chance a defensive touch in its own box (a clearance, a block, a keeper's first touch) goes
   *  into its own net. Only while a goal the result needs for the other side is overdue. */
  ownGoal: [number, number];
}

export const FREE_PLAY: Modifiers = {
  botSkill: 0.6, homeAiSkill: 0.6, speedMul: [1, 1], keeper: ['normal', 'normal'], goalAllowed: [true, true], pushTeam: null, pushLevel: 0, forced: false, tackleBias: 0, shotAppetite: [1, 1], defenseLapse: 0, ownGoal: [0, 0],
};

/** Window timing per pitch: futsal packs more goals into a shorter match, so its windows open earlier and escalate faster. */
const WINDOWS = { full: { before: 0.06, after: 0.02, esc: 0.05 }, futsal: { before: 0.08, after: 0.015, esc: 0.03 },
  // futsal sudden death: the golden goal is meant for a particular stage (3v3, 2v2 or 1v1), so its window is tight
  overtime: { before: 0.024, after: 0.004, esc: 0.02 } };

/** Hard stop: fraction of regulation after which any goals the result still needs are awarded outright. */
export const OVERRUN_LIMIT = 1.2;

/** One step of a scoring scenario.
 *  goal   - engineer a goal for `side` around `at` (a "soft" one is only encouraged, and dropped if it doesn't come)
 *  free   - both sides may score as play allows (within what keeps the result reachable), until `until`
 *  wait   - the player is given the chance to score first; the bots hold off until then (or until `until`)
 *  hold   - no goals for anyone until `until`
 *  settle - from here the score is paced to the scenario's final margin (spread out, not in a rush) */
export type Beat = { do: 'goal'; side: 0 | 1; at: number; soft?: boolean } | { do: 'free'; until: number } | { do: 'wait'; until: number } | { do: 'hold'; until: number } | { do: 'settle' };

/** Enforces the server's result. The tier (win / draw / loss) is fixed before kick-off; how the match gets there is a
 *  scenario picked at random for it - a late comeback after the player scores first, a back-and-forth first half and
 *  then the bots pulling away, an early blow, a sucker punch at the end, and so on - so the scoreline alone gives little
 *  away. On top of the scenario a safety layer only lets a goal stand if the result is still reachable in the time left,
 *  and pushes for the goals the result needs when time runs short.
 *
 *  Nothing is done to the ball in flight. Goals are made by play - the side being pushed is sharper and quicker, the
 *  defenders misread balls and mistime tackles, the keeper is slower and its shots are struck cleanly at a corner the
 *  keeper can't reach - and goals that mustn't happen are saved or, when the keeper couldn't get there, missed: the
 *  strike that would have gone in is decided as a miss at the moment it's hit. */
export class Director {
  mods: Modifiers = { ...FREE_PLAY, speedMul: [1, 1], keeper: ['normal', 'normal'], goalAllowed: [false, false], shotAppetite: [1, 1], ownGoal: [0, 0] };
  readonly scenario: string;
  readonly beats: Beat[];
  private bi = 0;
  /** Full-time goal difference (home - away) the tier needs: [lo, hi]. */
  readonly lo: number; readonly hi: number;
  /** The scenario's preferred final goal difference. */
  readonly pref: number;
  /** The goal being engineered now (from a beat, the settle, or the safety layer). */
  private push: { side: 0 | 1; at: number; soft: boolean; from: number } | null = null;
  /** Sudden death (futsal): the golden goal's side and time. */
  private ot: { side: 0 | 1; t: number } | null = null;
  private rng: Rng;

  constructor(public script: MatchScript, private match: Match) {
    this.mods.botSkill = 0.35 + script.botStrength * 0.5;
    const sf = script.finalScore;
    const tier = script.overtime ? 'draw' : script.tier === 'otwin' ? 'draw' : script.tier;
    const d = script.overtime ? 0 : sf.home - sf.away;
    [this.lo, this.hi] = tier === 'loss' ? [-99, -1] : tier === 'draw' ? [0, 0] : [1, 2];
    this.pref = Math.max(this.lo, Math.min(this.hi, d));
    this.rng = new Rng(`scenario:${script.tier}:${sf.home}-${sf.away}:${script.events.map((e) => e.side[0] + e.t.toFixed(3)).join(',')}`);
    const sc = pickScenario(tier, this.pref, script, this.rng);
    this.scenario = sc.name; this.beats = sc.beats;
  }

  private get win() { return this.match.overtime ? WINDOWS.overtime : this.match.pitch.futsal ? WINDOWS.futsal : WINDOWS.full; }
  private get D() { return this.match.teams[0].score - this.match.teams[1].score; }
  private get beat(): Beat | null { return this.beats[this.bi] ?? null; }
  /** How many more goals the bots could still be made to score, at a natural pace. */
  private botCap(f: number) { return Math.max(0, Math.floor((0.97 - f) / (this.match.pitch.futsal ? 0.085 : 0.075))); }
  /** The player's side's goals are less certain, so they need far more time each. */
  private homeCap(f: number) { return Math.max(0, Math.floor((0.9 - f) / 0.2)); }

  /** The result is settled: the goal difference is in the tier's range (and the scenario's margin reached, or time is up). */
  get done(): boolean {
    if (this.match.overtime) return false;
    const D = this.D; if (D < this.lo || D > this.hi) return false;
    return (this.beat?.do === 'settle' && D === this.pref) || this.match.frac >= 1.04;
  }
  /** A goal is being engineered right now (half time waits for it). */
  get pushing(): boolean { return !!this.push && this.match.frac >= this.push.at - this.win.before; }
  /** The goals the result still needs (the failsafe awards these if a match drags far past full time). */
  neededGoals(): Array<0 | 1> {
    if (this.match.overtime) return this.ot ? [this.ot.side] : [];
    const D = this.D; const out: Array<0 | 1> = [];
    for (let i = D; i > this.hi; i--) out.push(1);
    for (let i = D; i < this.lo; i++) out.push(0);
    return out;
  }
  /** Sudden death begins: the golden goal belongs to `side`, due at `t` (fraction of regulation). */
  startOvertime(side: 0 | 1, t: number) { this.ot = { side, t }; this.push = { side, at: t, soft: false, from: this.match.frac }; }

  /** Called by the match when a goal is scored and credited to `team`. */
  onGoal(team: number) {
    const b = this.beat;
    if (b?.do === 'goal' && b.side === team) this.bi++;
    else if (b?.do === 'wait' && team === 0) this.bi++;
    if (this.push && this.push.side === team) this.push = null;
  }

  /** Would a goal for `team` right now keep the result reachable? */
  private feasible(team: number): boolean {
    const f = this.match.frac; const Dn = this.D + (team === 0 ? 1 : -1);
    if (team === 0) {
      // the bots must still be able to bring it back into range in the time left
      const nb = Math.max(0, Dn - this.hi);
      if (nb > 0 && nb > this.botCap(f) - 1) return false;
      if (Dn > Math.max(this.pref, this.lo, 0) + 2) return false; // (no runaway scorelines)
    } else {
      const nh = Math.max(0, this.lo - Dn);
      if (nh > 0) {
        if (this.lo >= 1) return false; // winning results: the player scores first, and once ahead is never pegged back
        if (nh > 1 || f > 0.5) return false; // (a draw: the bots may lead by one early on, with time to come back)
      }
      if (Dn < Math.min(this.pref, this.hi, 0) - 1) return false;
    }
    return true;
  }

  /** The player's own goals: they stand whenever the bots can still score enough, in the time left (stoppage time
   *  included), to bring the result back to the drawn one. No phase of a scenario holds the player back - the
   *  scenarios and pushes only govern the bots - so a good chance taken is a goal, and the bots answer it with more of
   *  their own. Only right at the end of a match the player is winning against the script does this run out. */
  private playerMayScore(): boolean {
    const f = this.match.frac; const Dn = this.D + 1;
    const nb = Math.max(0, Dn - this.hi);
    const late = Math.max(0, Math.floor((1.1 - f) / (this.match.pitch.futsal ? 0.075 : 0.065)));
    return nb <= late && Dn <= Math.max(this.pref, this.lo, 0) + 4;
  }
  /** Is this the human player's side (whose goals are free)? */
  private human(team: number) { return team === 0 && this.match.humanTeam === 0; }

  allowGoal(team: number): boolean {
    const mt = this.match;
    if (mt.overtime) return !!this.ot && team === this.ot.side && mt.frac >= this.ot.t - this.win.before;
    if (this.human(team)) return this.playerMayScore();
    const b = this.beat; const p = this.push; const f = mt.frac;
    if (b?.do === 'hold') return false;
    if (b?.do === 'wait' && team === 1) return false;
    // while a goal is being engineered, only that side may score
    if (p && f >= p.at - this.win.before) return team === p.side && this.feasible(team);
    if (b?.do === 'settle') return false; // the score is being paced from here
    return this.feasible(team);
  }

  /** Advance the scenario and choose what (if anything) to push for. */
  private plan(f: number) {
    // finished beats
    for (;;) {
      const b = this.beat; if (!b) break;
      if ((b.do === 'free' || b.do === 'hold' || b.do === 'wait') && f >= b.until) { this.bi++; continue; }
      if (b.do === 'goal' && b.soft && f > b.at + 0.12) { this.bi++; if (this.push?.at === b.at) this.push = null; continue; }
      if (b.do === 'goal' && !this.feasible(b.side) && f > b.at - this.win.before) { this.bi++; continue; } // (overtaken by events)
      break;
    }
    if (this.match.overtime) return;
    const D = this.D;
    // safety: goals the result needs that can't wait any longer
    const nb = Math.max(0, D - this.hi), nh = Math.max(0, this.lo - D);
    if (nh > 0 && (nh >= this.homeCap(f) || f > 0.7)) { if (this.push?.side !== 0) this.push = { side: 0, at: f + this.win.before * 0.5, soft: false, from: f }; return; }
    if (nb > 0 && nb >= this.botCap(f)) { if (this.push?.side !== 1) this.push = { side: 1, at: f + this.win.before * 0.5, soft: false, from: f }; return; }
    // the player has run up a lead the bots will need several goals to undo: they start on it now, not all at the end
    if (nb >= 2 && this.beat?.do !== 'wait') { if (this.push?.side !== 1) this.push = { side: 1, at: f + this.win.before * 0.8, soft: false, from: f }; return; }
    const b = this.beat;
    if (b?.do === 'goal') { if (!this.push || this.push.at !== b.at) this.push = { side: b.side, at: b.at, soft: !!b.soft, from: f }; return; }
    if (b?.do === 'settle') {
      // pace the score to the scenario's margin (or just into the tier's range if time is short), goals spread out
      let target = this.pref;
      if (D > target && D - target > this.botCap(f)) target = Math.max(this.hi, D - this.botCap(f));
      if (D < target && target - D > Math.max(1, this.homeCap(f))) target = Math.min(D + Math.max(1, this.homeCap(f)), Math.max(this.lo, D));
      if (D === target) { this.push = null; return; }
      const side: 0 | 1 = D > target ? 1 : 0; const k = Math.abs(D - target);
      if (!this.push || this.push.side !== side) this.push = { side, at: Math.max(f + this.win.before * 0.6, Math.min(this.match.pitch.futsal ? 0.84 : 0.9, f + (0.94 - f) / (k + 0.5))), soft: false, from: f };
      return;
    }
    this.push = null; // free play, a hold or a wait: nothing engineered
  }

  update(dt: number) {
    const m = this.mods; const mt = this.match; const frac = mt.frac;
    this.plan(frac);
    const base = this.script.botStrength;
    m.botSkill = 0.35 + base * 0.5; m.homeAiSkill = 0.55; m.speedMul = [1, 0.96 + base * 0.08]; m.tackleBias = 0; m.forced = false; m.pushTeam = null; m.pushLevel = 0; m.defenseLapse = 0; m.ownGoal = [0, 0];
    m.goalAllowed = [this.allowGoal(0), this.allowGoal(1)];
    // the keeper facing a side that may not score is at its best; otherwise it plays them straight
    m.keeper = [m.goalAllowed[1] ? 'normal' : 'wall', m.goalAllowed[0] ? 'normal' : 'wall'];
    m.shotAppetite = [m.goalAllowed[0] ? 1 : 0.5, m.goalAllowed[1] ? 0.8 : 0.4];
    const b = this.beat;
    if (b?.do === 'wait') { m.pushTeam = 0; m.pushLevel = 0.25; m.shotAppetite[0] = 1.3; m.tackleBias = 0.2; }
    const p = this.push; const W = this.win;
    if (p && frac >= p.at - W.before) {
      const team = p.side; const other = team === 0 ? 1 : 0;
      const level = Math.min(p.soft ? 0.6 : 1, (frac - (p.at - W.before)) / (W.before + W.after));
      m.pushTeam = team; m.pushLevel = level;
      m.keeper[other] = level > 0.5 ? 'soft' : 'normal'; // the defending keeper gets beatable
      if (!m.goalAllowed[other]) m.keeper[team] = 'wall';
      m.shotAppetite[team] = 1.2 + level * 1.5; m.shotAppetite[other] = 0.3;
      m.tackleBias = (team === 0 ? 1 : -1) * (0.35 + level * 0.6);
      // the pushing side plays a quick, clean game; the defending side is a step slow and misreads balls
      if (team === 1) { m.botSkill = Math.min(1, 0.7 + level * 0.3); m.homeAiSkill = 0.55 - level * 0.2; m.speedMul[1] = 1.04 + level * 0.1; m.speedMul[0] = 1 - level * 0.06; }
      else { m.homeAiSkill = 0.75 + level * 0.25; m.botSkill = Math.max(0.1, 0.35 - level * 0.25); m.speedMul[1] = 0.96 - level * 0.1; }
      m.defenseLapse = level > 0.4 ? (level - 0.4) * 0.5 : 0;
      if (!p.soft && frac >= p.at + W.after) {
        m.forced = true; m.pushLevel = 1; m.keeper[other] = 'soft';
        // escalate the longer a forced goal takes: the pushing side gets quicker, the other side wilts
        const esc = Math.min(1, (frac - (p.at + W.after)) / W.esc);
        m.speedMul[team] = 1.06 + esc * 0.18; m.speedMul[other] = 0.94 - esc * 0.2;
        m.shotAppetite[team] = 3 + esc * 3; m.tackleBias = (team === 0 ? 1 : -1) * (0.8 + esc * 0.2);
        if (team === 1) { m.botSkill = 1; m.homeAiSkill = 0.15; } else { m.homeAiSkill = 1; m.botSkill = 0.1; }
        m.defenseLapse = 0.45 + esc * 0.5;
        // the player's side is owed a goal and it isn't coming: the defence starts to crack under the pressure -
        // a clearance sliced in, a block that loops over the keeper, a back-pass the keeper lets under his foot - so
        // the result never rests on the player scoring it himself
        // (only for a goal the result can't do without - never to pad a margin)
        if (team === 0 && (mt.overtime || this.D < this.lo)) m.ownGoal[1] = 0.3 + esc * 0.6;
        // (and the same for the player's AI team-mates when the bots are owed one - never the player you control)
        if (team === 1 && (mt.overtime || this.D > this.hi)) m.ownGoal[0] = 0.3 + esc * 0.6;
      }
    }
    m.botSkill = Math.max(0.1, Math.min(1, m.botSkill));
    void dt;
  }

  /** How much a shot by `team` is helped at the strike (0..1): picked out for a corner the keeper can't reach and struck
   *  cleanly, while that side is being pushed for a goal. Nothing touches the ball after it's hit. */
  shotAssist(team: number): number {
    const m = this.mods;
    if (m.pushTeam !== team || !m.goalAllowed[team]) return 0;
    return m.forced ? 1 : Math.max(0, (m.pushLevel - 0.3) / 0.7);
  }

  /** Each new touch is checked once, at the moment it's struck: a ball on its way into a goal that mustn't count, and
   *  beyond the keeper, is struck a little off - wide, onto the post or over - instead. (It is the strike that misses;
   *  the flight is untouched.) */
  private vetted = -1; private lastDir = 0; private lastHs = 0;
  lastVet: any = null;
  private scratch = new BallBody();
  steer(_dt: number) {
    const mt = this.match; const b = mt.ball;
    // a new strike: a touch, or the ball's line changing sharply off a post or a body (not a bounce, not curl)
    const hs0 = Math.hypot(b.vx, b.vz); const dir = hs0 > 0.5 ? Math.atan2(b.vz, b.vx) : this.lastDir;
    let turn = Math.abs(dir - this.lastDir); if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const kicked = Math.abs(hs0 - this.lastHs) > 2.5; this.lastDir = dir; this.lastHs = hs0;
    if (b.held || (b.owner && hs0 < 2.5)) { this.vetted = b.lastTouchTime; return; } // (a dribble touch counts once it's rolling)
    if (b.lastTouchTime === this.vetted && turn < 0.06 && !kicked) return;
    this.vetted = b.lastTouchTime;
    if (Math.hypot(b.vx, b.vy, b.vz) < 1) return;
    const hit = this.goalBound(b);
    if (!hit || this.allowGoal(hit.team)) return;
    const { goalWidth: gw, goalHeight: gh } = mt.pitch;
    const keeper = mt.opponentsOf(hit.team).agents.find((a) => a.isGK);
    if (keeper && !keeper.busy() && Math.abs(keeper.pos.x - hit.lineX) < 5 && Math.abs(hit.z) < gw / 2) {
      const kp = keeperSavePlan(mt, keeper, { t: hit.t, y: hit.y, z: hit.z });
      const avail = hit.t - kp.reaction - 0.06;
      if (kp.reachable && avail > 0.2 && kp.travel <= kp.speed * avail * 0.45 && hit.y > 0.25 && hit.y < 2) return; // a comfortable save: leave it to the keeper
    }
    // the strike goes just wrong: over the bar if it was rising high, else wide of (or, now and then, onto) the nearer post
    const s = this.scratch; const over = hit.y > gh - 0.7;
    const zs = Math.sign(hit.z || (Math.random() - 0.5)); const tz = zs * (gw / 2 + (Math.random() < 0.15 ? 0.04 : 0.5 + Math.random() * 0.4));
    // solve for the change of direction numerically (a secant on the crossing point), on a copy of the ball
    const at = (yaw: number, pitch: number) => {
      s.copyFrom(b); const hs = Math.hypot(b.vx, b.vz), sp = Math.hypot(hs, b.vy);
      const y0 = Math.atan2(b.vz, b.vx) + yaw, p0 = Math.atan2(b.vy, hs) + pitch;
      s.vx = Math.cos(y0) * Math.cos(p0) * sp; s.vz = Math.sin(y0) * Math.cos(p0) * sp; s.vy = Math.sin(p0) * sp;
      return this.crossing(s, hit.lineX);
    };
    let x0 = 0, x1 = over ? 0.03 : 0.02; let f0 = over ? hit.y - (gh + 0.5) : hit.z - tz;
    for (let it = 0; it < 6; it++) {
      const c = over ? at(0, x1) : at(x1, 0); if (!c) break;
      const f1 = over ? c.y - (gh + 0.5) : c.z - tz;
      if (Math.abs(f1) < 0.08) { x0 = x1; break; }
      const nx = x1 - f1 * (x1 - x0) / ((f1 - f0) || 1e-6); x0 = x1; f0 = f1; x1 = Math.max(-0.5, Math.min(0.5, nx));
    }
    // too close to send it wide in time: it goes over instead
    if (!over) { const c = at(x1, 0); if (c && Math.abs(c.z) < gw / 2 + 0.1 && c.y < gh + 0.1) { let lo = 0, hi = 0.6; for (let it = 0; it < 12; it++) { const mid = (lo + hi) / 2; const cc = at(x1, mid); if (cc && cc.y < gh + 0.45) lo = mid; else hi = mid; } const hs = Math.hypot(b.vx, b.vz), sp = Math.hypot(hs, b.vy); const y1 = Math.atan2(b.vz, b.vx) + x1, p1 = Math.atan2(b.vy, hs) + hi; b.vx = Math.cos(y1) * Math.cos(p1) * sp; b.vz = Math.sin(y1) * Math.cos(p1) * sp; b.vy = Math.sin(p1) * sp; this.lastDir = Math.atan2(b.vz, b.vx); this.lastHs = Math.hypot(b.vx, b.vz); return; } }
    const d = x1; const hs = Math.hypot(b.vx, b.vz), sp = Math.hypot(hs, b.vy);
    this.lastVet = { at: mt.time, hit, tz, over, d, after: over ? at(0, d) : at(d, 0) };
    const y0 = Math.atan2(b.vz, b.vx) + (over ? 0 : d), p0 = Math.atan2(b.vy, hs) + (over ? d : 0);
    b.vx = Math.cos(y0) * Math.cos(p0) * sp; b.vz = Math.sin(y0) * Math.cos(p0) * sp; b.vy = Math.sin(p0) * sp;
    this.lastDir = Math.atan2(b.vz, b.vx); this.lastHs = Math.hypot(b.vx, b.vz); // (the corrected strike is the new line)
  }

  /** Where a ball crosses the goal line at x = lineX (if it does, within 3 s). */
  private crossing(s: BallBody, lineX: number): { t: number; y: number; z: number } | null {
    const path = predictPath(s, 3.5, 1 / 120);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], c = path[i];
      if ((c.x - lineX) * Math.sign(lineX) >= 0 && (a.x - lineX) * Math.sign(lineX) < 0) { const k = (lineX - a.x) / (c.x - a.x || 1e-6); return { t: a.t + (c.t - a.t) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k }; }
    }
    return null;
  }

  /** Where the ball's path first crosses a goal line in or near the frame, and for which team that would be a goal. */
  private goalBound(b: BallBody): { team: number; t: number; y: number; z: number; lineX: number } | null {
    const mt = this.match; const { length: L, goalWidth: gw, goalHeight: gh } = mt.pitch;
    const side = Math.sign(b.vx) || 1; const lx = side * L / 2;
    const c = this.crossing(this.scratch.copyFrom(b), lx);
    if (!c || Math.abs(c.z) > gw / 2 + 0.5 || c.y > gh + 0.4) return null; // (a margin: the prediction isn't exact)
    return { team: mt.teams.find((t) => t.attackDir === side)!.index, t: c.t, y: c.y, z: c.z, lineX: lx };
  }
}

/** Pick a scoring scenario for the result. Times are fractions of regulation (0.5 = half time). */
function pickScenario(tier: string, pref: number, script: MatchScript, rng: Rng): { name: string; beats: Beat[] } {
  const r = (a: number, b: number) => rng.range(a, b);
  const H = 0 as const, A = 1 as const;
  const classic = (): Beat[] => {
    // the server's own drama-ordered schedule (for a winning result, the player's goal comes first)
    const ev = script.events.slice();
    if (tier === 'win') { const i = ev.findIndex((e) => e.side === 'home'); if (i > 0) { const [e] = ev.splice(i, 1); ev.unshift({ ...e, t: Math.min(e.t, ev[0].t) }); } }
    const out: Beat[] = ev.map((e) => ({ do: 'goal', side: e.side === 'home' ? H : A, at: e.t, soft: e.side === 'home' && (tier === 'loss' || tier === 'draw') }));
    return [...out, { do: 'settle' }];
  };
  const options: Array<[string, number, () => Beat[]]> = [];
  if (tier === 'loss') {
    options.push(
      // the player scores first; the bots come back from about the hour mark
      ['late comeback', 3, () => [{ do: 'wait', until: r(0.3, 0.42) }, { do: 'goal', side: H, at: r(0.36, 0.46) }, { do: 'free', until: r(0.55, 0.62) }, { do: 'settle' }]],
      // end to end in the first half; the bots pull away in the second
      ['pulls away', 3, () => [{ do: 'goal', side: H, at: r(0.1, 0.24), soft: true }, { do: 'goal', side: A, at: r(0.26, 0.4) }, { do: 'free', until: r(0.48, 0.55) }, { do: 'settle' }]],
      // an early blow, the player may hit back, the bots see it out
      ['early blow', 2, () => [{ do: 'goal', side: A, at: r(0.06, 0.18) }, { do: 'free', until: r(0.55, 0.7) }, { do: 'settle' }]],
      // level (or close) for a long time, then a sucker punch late on
      ['sucker punch', 2, () => [{ do: 'free', until: r(0.68, 0.8) }, { do: 'settle' }]],
      // the player leads at the break, the bots turn it round
      ['turned round', 2, () => [{ do: 'goal', side: H, at: r(0.14, 0.26) }, { do: 'goal', side: H, at: r(0.3, 0.42), soft: true }, { do: 'hold', until: 0.52 }, { do: 'settle' }]],
      // goals traded early, the bots edge it
      ['trading blows', 2, () => [{ do: 'goal', side: A, at: r(0.12, 0.22) }, { do: 'goal', side: H, at: r(0.26, 0.38), soft: true }, { do: 'goal', side: A, at: r(0.44, 0.56) }, { do: 'free', until: r(0.62, 0.72) }, { do: 'settle' }]],
      ['scheduled', 2, classic],
    );
  } else if (tier === 'draw') {
    options.push(
      ['late equaliser', 3, () => [{ do: 'goal', side: H, at: r(0.14, 0.34) }, { do: 'free', until: r(0.62, 0.72) }, { do: 'settle' }]],
      ['trading blows', 3, () => [{ do: 'goal', side: H, at: r(0.1, 0.24), soft: true }, { do: 'goal', side: A, at: r(0.26, 0.42) }, { do: 'free', until: r(0.7, 0.8) }, { do: 'settle' }]],
      ['fight back', 2, () => [{ do: 'goal', side: A, at: r(0.1, 0.24) }, { do: 'goal', side: H, at: r(0.36, 0.5) }, { do: 'free', until: r(0.7, 0.8) }, { do: 'settle' }]],
      ['tight', 1, () => [{ do: 'free', until: r(0.8, 0.88) }, { do: 'settle' }]],
      ['scheduled', 2, classic],
    );
  } else {
    options.push(
      ['early lead', 3, () => [{ do: 'goal', side: H, at: r(0.1, 0.28) }, { do: 'free', until: r(0.7, 0.8) }, { do: 'settle' }]],
      // two up, then a nervy finish when the bots pull one back
      ['nervy finish', 2, () => [{ do: 'goal', side: H, at: r(0.1, 0.24) }, { do: 'goal', side: H, at: r(0.3, 0.46) }, { do: 'free', until: r(0.62, 0.74) }, { do: 'settle' }]],
      ['scheduled', 2, classic],
    );
  }
  let tot = 0; for (const o of options) tot += o[1];
  let u = rng.next() * tot; let pick = options[0];
  for (const o of options) { u -= o[1]; if (u <= 0) { pick = o; break; } }
  return { name: pick[0], beats: pick[2]() };
}
