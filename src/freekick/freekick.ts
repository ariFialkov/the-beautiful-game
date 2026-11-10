import * as THREE from 'three';
import type { FreeKickScript, FreeKickRoundPlan, PlayerCard, MissStyle, ShotStyle } from '@shared/types';
import type { Kit, Team } from '@shared/teams';
import { Ball } from '../game/ball';
import { PITCH_11 } from '../game/pitch';
import { Stadium } from '../render/stadium';
import { makeLighting, type Stage } from '../render/scene';
import { Humanoid } from '../render/humanoid';
import { makeBallMesh } from '../render/matchView';
import { keeperKit } from '../render/kits';
import type { InputManager } from '../input/input';

export type FKPhase = 'intro' | 'aim' | 'flight' | 'result' | 'botThink' | 'botFlight' | 'botResult' | 'end';
export interface FKSide { team: Team; kit: Kit; kitKey: string; kicker: PlayerCard; keeper: PlayerCard; wall: PlayerCard[]; }
export type FKEvent = { type: 'kick'; power: number } | { type: 'goal'; who: 'player' | 'bot' } | { type: 'miss'; who: 'player' | 'bot'; how: string } | { type: 'end'; won: boolean } | { type: 'phase'; phase: FKPhase };

const G = 9.81;

/** Turn-based free-kick duel. The player kicks first; the bot answers according to the server's reactive plan. */
export class FreeKickGame {
  scene = new THREE.Scene();
  ball = new Ball();
  phase: FKPhase = 'intro';
  phaseTimer = 2.2;
  round = 0;
  results: Array<{ player: boolean; bot: boolean }> = [];
  aim = { z: 0, y: 1.4 };        // target point on the goal plane (metres)
  curl = 0;                      // -1..1
  power = 0; charging = false;
  won: boolean | null = null;
  lastOutcome: { who: 'player' | 'bot'; goal: boolean; how: string } | null = null;
  private pitch = PITCH_11;
  private stadium: Stadium;
  private kicker: Humanoid; private botKicker: Humanoid; private keeper: Humanoid; private botKeeper: Humanoid;
  private wall: Humanoid[] = []; private botWall: Humanoid[] = [];
  private ballMesh: THREE.Mesh; private ballShadow: THREE.Mesh;
  private ballPos0: THREE.Vector3;
  private goalDir: THREE.Vector3;
  private keeperState = { x: 0, z: 0, diveT: -1, diveDir: 0, diveTarget: { z: 0, y: 1 }, reach: 1.6, save: false };
  private wallJump = 0;
  private kickAnim = -1; private kickWho: 'player' | 'bot' = 'player';
  private pendingLaunch: { vx: number; vy: number; vz: number; curl: number } | null = null;
  private shotResolved = false;
  private flightTime = 0;
  private listeners = new Set<(e: FKEvent) => void>();
  private camPos = new THREE.Vector3(); private camLook = new THREE.Vector3();
  private sun: THREE.DirectionalLight;
  private magnetActive = false;
  private aimMarker: THREE.Mesh;

  constructor(private stage: Stage, public script: FreeKickScript, public player: FKSide, public bot: FKSide, night = true) {
    this.stadium = new Stadium(this.pitch, player.team, bot.team, night, stage.quality === 'low');
    this.scene.add(this.stadium.group);
    this.sun = makeLighting(this.scene, night, stage.quality === 'high', 30).sun;
    const s = script.situation;
    const ang = (s.angleDeg * Math.PI) / 180;
    const L = this.pitch.length;
    this.ballPos0 = new THREE.Vector3(L / 2 - s.distance * Math.cos(ang), 0.11, s.distance * Math.sin(ang));
    this.goalDir = new THREE.Vector3(L / 2, 0, 0).sub(this.ballPos0).setY(0).normalize();
    const gk = [keeperKit(player.kit, bot.kit), keeperKit(bot.kit, player.kit)];
    this.kicker = this.add(new Humanoid(player.kicker, player.kit, player.kitKey));
    this.botKicker = this.add(new Humanoid(bot.kicker, bot.kit, bot.kitKey));
    this.keeper = this.add(new Humanoid(bot.keeper, gk[1], `${bot.kitKey}:gk`, true));
    this.botKeeper = this.add(new Humanoid(player.keeper, gk[0], `${player.kitKey}:gk`, true));
    for (let i = 0; i < s.wallSize; i++) { this.wall.push(this.add(new Humanoid(bot.wall[i % bot.wall.length], bot.kit, bot.kitKey))); this.botWall.push(this.add(new Humanoid(player.wall[i % player.wall.length], player.kit, player.kitKey))); }
    this.ballMesh = makeBallMesh(); this.scene.add(this.ballMesh);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2; this.scene.add(this.ballShadow);
    this.aimMarker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 24), new THREE.MeshBasicMaterial({ color: 0x19f5a4, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.aimMarker.rotation.y = Math.PI / 2; this.scene.add(this.aimMarker);
    this.setupKick('player');
    this.camPos.copy(this.ballPos0).addScaledVector(this.goalDir, -9).setY(3.2); this.camLook.set(L / 2, 1.2, 0);
    stage.camera.position.copy(this.camPos); stage.camera.lookAt(this.camLook);
  }
  private add(h: Humanoid) { h.setShadowsReal(this.stage.quality === 'high'); this.scene.add(h.root); return h; }
  on(fn: (e: FKEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: FKEvent) { for (const l of this.listeners) l(e); }
  get plan(): FreeKickRoundPlan { return this.script.rounds[Math.min(this.round, this.script.rounds.length - 1)]; }
  get goalCenter() { return new THREE.Vector3(this.pitch.length / 2, 0, 0); }

  /** Place kicker, wall and keeper for whoever is kicking. The defending side belongs to the other team. */
  private setupKick(who: 'player' | 'bot') {
    this.kickWho = who;
    this.ball.reset(this.ballPos0.x, this.ballPos0.z); this.ball.y = this.ball.radius;
    const { goalWidth: gw, length: L } = this.pitch;
    const kicker = who === 'player' ? this.kicker : this.botKicker;
    const other = who === 'player' ? this.botKicker : this.kicker;
    const wall = who === 'player' ? this.wall : this.botWall;
    const hidden = who === 'player' ? this.botWall : this.wall;
    const keeper = who === 'player' ? this.keeper : this.botKeeper;
    const otherKeeper = who === 'player' ? this.botKeeper : this.keeper;
    const back = this.goalDir.clone().multiplyScalar(-1);
    kicker.root.position.copy(this.ballPos0).addScaledVector(back, 2.2).add(new THREE.Vector3(0, 0, -0.35)); kicker.root.position.y = 0;
    kicker.root.rotation.y = Math.atan2(this.goalDir.x, this.goalDir.z);
    other.root.position.set(-20, 0, 0); // bench
    otherKeeper.root.position.set(-25, 0, 3);
    // wall 9.15 m from the ball on the line to the near post
    const nearPostZ = Math.sign(this.ballPos0.z || 1) * gw / 2;
    const toPost = new THREE.Vector3(L / 2, 0, nearPostZ).sub(this.ballPos0).setY(0).normalize();
    const base = this.ballPos0.clone().addScaledVector(toPost, 9.15);
    const lateral = new THREE.Vector3(-toPost.z, 0, toPost.x);
    wall.forEach((h, i) => { const off = (i - (wall.length - 1) / 2) * 0.62 - Math.sign(this.ballPos0.z || 1) * 0.6; h.root.position.copy(base).addScaledVector(lateral, off); h.root.position.y = 0; h.root.rotation.y = Math.atan2(-toPost.x, -toPost.z); });
    hidden.forEach((h, i) => h.root.position.set(-30 - i, 0, -10));
    const kz = Math.max(-gw / 2 + 0.8, Math.min(gw / 2 - 0.8, this.ballPos0.z * 0.18 + this.script.situation.keeperBias * 1.4));
    this.keeperState = { x: L / 2 - 0.6, z: kz, diveT: -1, diveDir: 0, diveTarget: { z: 0, y: 1 }, reach: 1.6, save: false };
    keeper.root.position.set(L / 2 - 0.6, 0, kz); keeper.root.rotation.y = -Math.PI / 2;
    this.wallJump = 0; this.kickAnim = -1; this.pendingLaunch = null; this.shotResolved = false; this.flightTime = 0; this.magnetActive = false;
    this.aim = { z: nearPostZ * -0.55, y: 1.6 }; this.curl = 0; this.power = 0; this.charging = false;
  }

  /** Compute a launch velocity that reaches (goal line, z, y) at `speed`, pre-compensating curl. */
  private launchFor(targetZ: number, targetY: number, speed: number, curl: number, sigma: number): { vx: number; vy: number; vz: number; curl: number } {
    const L = this.pitch.length;
    const dx = L / 2 - this.ballPos0.x, dz = targetZ - this.ballPos0.z;
    const D = Math.hypot(dx, dz);
    const h = targetY - this.ball.radius;
    // ballistic elevation (low solution); fall back to 40 deg when out of range
    const v2 = speed * speed; const disc = v2 * v2 - G * (G * D * D + 2 * h * v2);
    let elev = disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (G * D)) : 0.7;
    elev += (Math.random() * 2 - 1) * sigma;
    let yaw = Math.atan2(dz, dx) + (Math.random() * 2 - 1) * sigma * 1.4;
    // Magnus pre-compensation: the ball will bend sideways by roughly k*curl over the flight
    const bend = curl * 0.55 * 0.5 * (D / speed) * (D / speed) * speed / D; // approximate lateral angle
    yaw -= bend * 0.9;
    const hs = speed * Math.cos(elev);
    return { vx: Math.cos(yaw) * hs, vz: Math.sin(yaw) * hs, vy: speed * Math.sin(elev), curl: curl * 0.6 };
  }

  private startKick(who: 'player' | 'bot', launch: { vx: number; vy: number; vz: number; curl: number }, keeperPlan: { save: boolean; towardTargetZ: number; towardY: number; wrongWay?: boolean }) {
    this.pendingLaunch = launch; this.kickAnim = 0; this.kickWho = who;
    this.keeperState.save = keeperPlan.save; this.keeperState.diveTarget = { z: keeperPlan.towardTargetZ, y: keeperPlan.towardY }; this.keeperState.diveT = -1; this.keeperState.diveDir = keeperPlan.wrongWay ? -1 : 1;
    this.emit({ type: 'kick', power: Math.hypot(launch.vx, launch.vy, launch.vz) / 30 });
  }

  /** The human's kick: aim point, power and curl. */
  private playerShoot() {
    const plan = this.plan;
    const speed = 15 + this.power * 14;
    const sigma = 0.012 + this.power * 0.025 + Math.abs(this.curl) * 0.01;
    let targetZ = this.aim.z, targetY = this.aim.y, curl = this.curl;
    if (plan.goalMagnet) {
      // scripted assist: nudge the aim inside the frame away from the keeper
      const gw = this.pitch.goalWidth; const away = this.keeperState.z >= 0 ? -1 : 1;
      targetZ = Math.abs(targetZ) < gw / 2 - 0.4 && Math.sign(targetZ) !== Math.sign(this.keeperState.z) ? targetZ : away * (gw / 2 - 0.7);
      targetY = Math.min(this.pitch.goalHeight - 0.5, Math.max(0.5, targetY));
      this.magnetActive = true;
    }
    const launch = this.launchFor(targetZ, targetY, speed, curl, plan.goalMagnet ? 0 : sigma);
    // keeper reaction: a wall keeper always gets there; a natural keeper has reach and bias
    const natural = !plan.keeperWall && !plan.goalMagnet;
    this.startKick('player', launch, { save: plan.keeperWall ? true : natural ? Math.random() < 0.5 + (Math.abs(targetZ) < 2 ? 0.3 : -0.15) + (targetY < 0.9 ? 0.1 : 0) : false, towardTargetZ: targetZ, towardY: targetY, wrongWay: plan.goalMagnet });
  }

  /** The bot's kick is fully determined by the plan and the player's result this round. */
  private botShoot(outcome: 'score' | 'miss', style: ShotStyle, miss: MissStyle) {
    const { goalWidth: gw, goalHeight: gh } = this.pitch;
    const kz = this.keeperState.z; const away = kz >= 0 ? -1 : 1;
    const speed = style === 'power' ? 28 : style === 'driven' ? 25 : style === 'chip' ? 17 : 22;
    const curl = style === 'curl' ? -away * 0.9 : style === 'chip' ? 0 : -away * 0.3;
    let tz = away * (gw / 2 - 0.6), ty = style === 'chip' ? gh - 0.4 : style === 'power' ? 0.9 : 1.7;
    let save = false; let wrongWay = true;
    if (outcome === 'miss') {
      switch (miss) {
        case 'post': tz = away * (gw / 2 + 0.03); ty = 1.2; break;
        case 'bar': tz = away * 1.5; ty = gh + 0.04; break;
        case 'over': tz = away * 1; ty = gh + 0.9; break;
        case 'wide': tz = away * (gw / 2 + 0.8); ty = 1.4; break;
        case 'saved': tz = kz + away * 0.9; ty = 1.3; save = true; wrongWay = false; break;
        case 'wall': { tz = Math.sign(this.ballPos0.z || 1) * gw / 2 * 0.9; ty = 0.9; break; }
      }
    }
    const launch = this.launchFor(tz, ty, speed, curl, outcome === 'score' ? 0 : miss === 'post' || miss === 'bar' ? 0 : 0.01);
    this.startKick('bot', launch, { save, towardTargetZ: tz, towardY: ty, wrongWay });
  }

  /* ------------------------------ update ------------------------------ */
  update(dt: number, input: InputManager, time: number) {
    const L = this.pitch.length;
    this.phaseTimer -= dt;
    switch (this.phase) {
      case 'intro': if (this.phaseTimer <= 0) this.setPhase('aim'); break;
      case 'aim': {
        const sp = 3.2 * dt;
        this.aim.z = Math.max(-6, Math.min(6, this.aim.z + input.move.x * sp)); this.aim.y = Math.max(0.3, Math.min(3.6, this.aim.y + input.move.y * sp));
        if (input.switch.down || input.touchCurl < 0) this.curl = Math.max(-1, this.curl - dt * 2.2);
        else if (input.finesse.down || input.touchCurl > 0) this.curl = Math.min(1, this.curl + dt * 2.2);
        else this.curl *= Math.exp(-2 * dt);
        const btn = input.shoot.down || input.pass.down;
        if (btn) { this.charging = true; this.power = Math.min(1, this.power + dt / 1.1); if (this.power >= 1) { this.playerShoot(); this.setPhase('flight'); } }
        else if (this.charging) { this.power = Math.max(0.18, this.power); this.playerShoot(); this.setPhase('flight'); }
        break;
      }
      case 'flight': case 'botFlight': this.updateFlight(dt); break;
      case 'result': if (this.phaseTimer <= 0) { this.setupKick('bot'); this.setPhase('botThink'); } break;
      case 'botThink': if (this.phaseTimer <= 0) { const r = this.results[this.round]; const plan = this.plan; const outcome = r.player ? plan.ifPlayerScores : plan.ifPlayerMisses; this.botShoot(outcome, plan.botShot, plan.botMiss); this.setPhase('botFlight'); } break;
      case 'botResult': if (this.phaseTimer <= 0) this.resolveRound(); break;
      case 'end': break;
    }
    // kick animation + ball launch at the strike moment
    if (this.kickAnim >= 0) {
      this.kickAnim += dt;
      if (this.pendingLaunch && this.kickAnim >= 0.42) { const l = this.pendingLaunch; this.ball.vx = l.vx; this.ball.vy = l.vy; this.ball.vz = l.vz; this.ball.curl = l.curl; this.ball.y = this.ball.radius + 0.01; this.pendingLaunch = null; this.flightTime = 0; this.wallJump = 0.01; }
      if (this.kickAnim > 1.2) this.kickAnim = -1;
    }
    if (this.wallJump > 0) this.wallJump += dt;
    this.render(dt, time, input);
  }

  private setPhase(p: FKPhase) {
    this.phase = p;
    this.phaseTimer = p === 'result' || p === 'botResult' ? 2.6 : p === 'botThink' ? 2.4 : 0;
    this.emit({ type: 'phase', phase: p });
  }

  private updateFlight(dt: number) {
    const b = this.ball; const { length: L, goalWidth: gw, goalHeight: gh } = this.pitch;
    if (this.pendingLaunch) return; // still in the run-up
    this.flightTime += dt;
    // keeper reaction after a short delay
    const ks = this.keeperState;
    if (ks.diveT < 0 && this.flightTime > 0.25) { ks.diveT = 0; }
    if (ks.diveT >= 0) {
      ks.diveT += dt;
      // slide the keeper toward the dive target (or the wrong way)
      const tz = ks.save ? ks.diveTarget.z : ks.z + (ks.diveDir < 0 ? -Math.sign(ks.diveTarget.z - ks.z || 1) * 1.6 : Math.sign(ks.diveTarget.z - ks.z || 1) * 1.2);
      const k = 1 - Math.exp(-7 * dt); ks.z += (tz - ks.z) * k;
    }
    // wall block
    const wallHumans = this.kickWho === 'player' ? this.wall : this.botWall;
    for (const w of wallHumans) {
      const p = w.root.position; const jumpH = this.wallJump > 0 ? Math.sin(Math.min(Math.PI, this.wallJump * 5)) * 0.45 : 0;
      if (Math.abs(b.x - p.x) < 0.35 && Math.abs(b.z - p.z) < 0.4 && b.y < 1.9 + jumpH && b.y > jumpH * 0.8 && !this.shotResolved && Math.hypot(b.vx, b.vz) > 2) {
        b.vx = -b.vx * 0.3; b.vz = b.vz * 0.3 + (Math.random() - 0.5) * 3; b.vy = Math.abs(b.vy) * 0.3 + 1.5; b.curl = 0;
        this.resolve(false, 'wall'); break;
      }
    }
    // keeper save (hands near the ball while diving)
    if (!this.shotResolved && ks.save && b.x > L / 2 - 2.2 && b.x < L / 2 + 0.3 && Math.abs(b.z - ks.z) < 1.3 && b.y < 2.4) {
      b.vx = -Math.abs(b.vx) * 0.25; b.vz = (b.z - ks.z) * 3; b.vy = 2; b.curl = 0;
      this.resolve(false, 'saved');
    }
    // posts / crossbar
    const prevX = b.x;
    b.update(dt);
    if (!this.shotResolved) {
      for (const pz of [-gw / 2, gw / 2]) {
        if (Math.hypot(b.x - L / 2, b.z - pz) < 0.06 + b.radius && b.y < gh + 0.1) { b.vx = -b.vx * 0.6; b.vz = -b.vz * 0.4 + Math.sign(b.z - pz) * 4; this.resolve(false, 'post'); }
      }
      if (Math.abs(b.x - L / 2) < 0.15 && Math.abs(b.z) < gw / 2 && Math.abs(b.y - gh) < 0.06 + b.radius) { b.vx = -b.vx * 0.5; b.vy = -Math.abs(b.vy) * 0.6 - 1; this.resolve(false, 'bar'); }
      if (prevX < L / 2 && b.x >= L / 2) {
        const goal = Math.abs(b.z) < gw / 2 - b.radius && b.y < gh - b.radius;
        if (goal) { this.resolve(true, 'goal'); b.vx *= 0.25; b.vz *= 0.25; }
        else this.resolve(false, b.y >= gh ? 'over' : 'wide');
      }
      if (this.flightTime > 4) this.resolve(false, 'wide');
    }
    // net catches the ball
    if (b.x > L / 2 + 2.0) { b.x = L / 2 + 2.0; b.vx = -Math.abs(b.vx) * 0.1; b.vz *= 0.3; }
    if (this.shotResolved && this.phaseTimer <= -0.1 && (this.phase === 'flight' || this.phase === 'botFlight')) { /* handled by resolve timers */ }
  }

  private resolve(goal: boolean, how: string) {
    if (this.shotResolved) return;
    this.shotResolved = true;
    const who = this.kickWho;
    this.lastOutcome = { who, goal, how };
    if (who === 'player') { this.results[this.round] = { player: goal, bot: false }; }
    else { this.results[this.round].bot = goal; }
    this.emit(goal ? { type: 'goal', who } : { type: 'miss', who, how });
    if (goal) this.stadium.cheer(who === 'player' ? 1 : 0.5);
    setTimeout(() => { if (this.phase === 'flight') this.setPhase('result'); else if (this.phase === 'botFlight') this.setPhase('botResult'); }, 1400);
  }

  private resolveRound() {
    const r = this.results[this.round];
    if (r.player && !r.bot) { this.won = true; this.setPhase('end'); this.emit({ type: 'end', won: true }); return; }
    if (!r.player && r.bot) { this.won = false; this.setPhase('end'); this.emit({ type: 'end', won: false }); return; }
    this.round++;
    if (this.round >= this.script.rounds.length) {
      // Cannot happen by construction (the last plan is decisive) but settle on the tier to be safe.
      this.won = this.script.tier === 'win'; this.setPhase('end'); this.emit({ type: 'end', won: this.won }); return;
    }
    this.setupKick('player'); this.setPhase('intro'); this.phaseTimer = 1.4;
  }

  /* ------------------------------ render ------------------------------ */
  private render(dt: number, time: number, input: InputManager) {
    const L = this.pitch.length; const b = this.ball;
    this.ballMesh.position.set(b.x, b.y, b.z);
    this.ballMesh.rotation.x += Math.hypot(b.vx, b.vz) / b.radius * dt * 0.2;
    this.ballShadow.position.set(b.x, 0.015, b.z); const sh = Math.max(0.3, 1 - (b.y - b.radius) * 0.25); this.ballShadow.scale.set(sh, sh, 1);
    const kicker = this.kickWho === 'player' ? this.kicker : this.botKicker;
    const idle = this.kickWho === 'player' ? this.botKicker : this.kicker;
    const keeper = this.kickWho === 'player' ? this.keeper : this.botKeeper;
    const wall = this.kickWho === 'player' ? this.wall : this.botWall;
    // kicker: run-up then strike
    if (this.kickAnim >= 0) {
      const t = this.kickAnim;
      const back = this.goalDir.clone().multiplyScalar(-1);
      const runT = Math.min(1, t / 0.42);
      kicker.root.position.copy(this.ballPos0).addScaledVector(back, 2.2 - 1.75 * runT).add(new THREE.Vector3(0, 0, -0.35 * (1 - runT * 0.5))); kicker.root.position.y = 0;
      kicker.animate(t < 0.3 ? { state: 'run', phase: t * 14, speed: 0.8, action: 0, dir: 1, time } : { state: 'kick', phase: 0, speed: 0, action: Math.min(1, (t - 0.3) / 0.5), dir: 1, time });
    } else kicker.animate({ state: 'idle', phase: 0, speed: 0, action: 0, dir: 1, time });
    idle.animate({ state: 'idle', phase: 0, speed: 0, action: 0, dir: 1, time });
    const ks = this.keeperState;
    keeper.root.position.set(ks.x, 0, ks.z); keeper.root.rotation.y = -Math.PI / 2;
    if (ks.diveT >= 0) keeper.animate({ state: 'dive', phase: 0, speed: 0, action: Math.min(1, ks.diveT / 0.7), dir: ks.save ? (ks.diveTarget.z - ks.z >= 0 ? 1 : -1) : ks.diveDir, time });
    else keeper.animate({ state: 'keeperReady', phase: 0, speed: 0, action: 0, dir: 1, time });
    for (const w of wall) { const jumpH = this.wallJump > 0 ? Math.sin(Math.min(Math.PI, this.wallJump * 5)) * 0.45 : 0; w.root.position.y = jumpH; w.animate({ state: 'idle', phase: 0, speed: 0, action: 0, dir: 1, time }); }
    // aim marker
    this.aimMarker.visible = this.phase === 'aim';
    this.aimMarker.position.set(L / 2 - 0.05, this.aim.y, this.aim.z);
    (this.aimMarker.material as THREE.MeshBasicMaterial).color.setHex(this.charging ? 0xf7c948 : 0x19f5a4);
    // camera
    const cam = this.stage.camera;
    let want: THREE.Vector3; let look: THREE.Vector3;
    if (this.phase === 'aim' || this.phase === 'intro' || this.phase === 'botThink') {
      const ballV = new THREE.Vector3(this.ballPos0.x, 0, this.ballPos0.z);
      const lateral = new THREE.Vector3(-this.goalDir.z, 0, this.goalDir.x);
      want = ballV.clone().addScaledVector(this.goalDir, -6.5).addScaledVector(lateral, 2.6).setY(2.3);
      look = new THREE.Vector3(L / 2 - 4, 1.2, this.phase === 'aim' ? this.aim.z * 0.4 : 0);
    } else if (this.phase === 'end') {
      want = new THREE.Vector3(L / 2 - 10, 3, 6); look = new THREE.Vector3(L / 2 - 2, 1, 0);
    } else {
      // follow the flight from behind and to the side
      const bp = new THREE.Vector3(b.x, b.y, b.z);
      want = new THREE.Vector3(Math.min(b.x - 7, L / 2 - 9), 3.4 + Math.min(2, b.y * 0.4), b.z * 0.4 - 4);
      look = bp.clone().setY(Math.max(0.8, b.y));
    }
    const k = 1 - Math.exp(-(this.phase === 'flight' || this.phase === 'botFlight' ? 7 : 3) * dt);
    this.camPos.lerp(want, k); this.camLook.lerp(look, k);
    cam.position.copy(this.camPos); cam.lookAt(this.camLook);
    this.sun.target.position.set(L / 2 - 10, 0, 0); this.sun.position.set(L / 2 - 50, 70, -50); this.sun.target.updateMatrixWorld();
    this.stadium.update(dt, time);
    void input;
  }

  /** Screen-space position of the aim marker for the HUD reticle. */
  aimScreen(): { x: number; y: number } {
    const v = new THREE.Vector3(this.pitch.length / 2, this.aim.y, this.aim.z).project(this.stage.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }
}
