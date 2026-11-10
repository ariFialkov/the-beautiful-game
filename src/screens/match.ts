import type { Screen } from '../app/router';
import type { MatchScript, PlayerCard, SettleRoundResponse } from '@shared/types';
import { app } from '../main';
import { state, fmt, isTouchDevice } from '../app/state';
import { api } from '../app/api';
import { audio } from '../app/audio';
import { el, button, controllerHint } from '../ui/components';
import { crestSvg } from '../ui/crest';
import { Match } from '../game/match';
import { PITCH_11, PITCH_FUTSAL } from '../game/pitch';
import { MatchView } from '../render/matchView';
import { TouchControls } from '../input/touch';
import { input } from '../input/input';
import { TEAM_BY_ID, rosterOf, startingXI, type Team, type Kit } from '@shared/teams';
import { CLOCK_MINUTES } from '@shared/script';
import { pickKits, type MatchParams } from './setup';
import { focus } from '../ui/focus';

export function futsalFive(xi: PlayerCard[]): PlayerCard[] { return [xi[0], xi[2], xi[8], xi[10], xi[9]]; }

/** The live match: HUD, controls, pause menu and the settlement screen. */
export class MatchScreen implements Screen {
  private match!: Match;
  private view!: MatchView;
  private hud!: HTMLElement;
  private touch: TouchControls | null = null;
  private root!: HTMLElement;
  private params!: MatchParams;
  private banner!: HTMLElement; private toast!: HTMLElement; private power!: HTMLElement;
  private bannerTimer = 0; private toastTimer = 0;
  private paused = false;
  private settled: SettleRoundResponse | null = null;
  private ended = false;

  mount(root: HTMLElement, params?: Record<string, unknown>) {
    this.root = root; this.params = params as MatchParams;
    const p = this.params;
    const script = p.round.script as MatchScript;
    const futsal = p.mode === 'futsal';
    const home: Team = TEAM_BY_ID[p.homeTeamId ?? 'lon-royals'], away: Team = TEAM_BY_ID[p.awayTeamId ?? 'mad-blancos'];
    const [hk, ak] = p.homeKit && p.awayKit ? [p.homeKit, p.awayKit] : pickKits(home, away);
    const hxi = p.homeSquad ?? startingXI(rosterOf(home.id)), axi = p.awaySquad ?? startingXI(rosterOf(away.id));
    const match = new Match({
      pitch: futsal ? PITCH_FUTSAL : PITCH_11, mode: p.mode as any, humanTeam: 0, script, surface: p.surface ?? (futsal ? 'court' : 'dry'), durationSec: script.durationSec, clockMinutes: CLOCK_MINUTES[p.mode as 'kickoff' | 'futsal' | 'fut'],
      teams: [
        { team: home, players: futsal ? futsalFive(hxi) : hxi, kit: hk as Kit, kitKey: `${home.id}:${hk === home.home ? 'h' : 'a'}`, name: p.clubName ?? home.name, short: p.clubName ? p.clubName.slice(0, 3).toUpperCase() : home.short },
        { team: away, players: futsal ? futsalFive(axi) : axi, kit: ak as Kit, kitKey: `${away.id}:${ak === away.home ? 'h' : 'a'}`, name: p.mode === 'fut' ? 'Rival UT' : away.name, short: p.mode === 'fut' ? 'RIV' : away.short },
      ],
    });
    this.match = match;
    // FUT chemistry: a sharper, quicker squad (cosmetic feel only; the result is fixed by the script)
    if (p.chemistry !== undefined) match.teamSpeedBonus[0] = 0.94 + (p.chemistry / 100) * 0.1;
    this.view = new MatchView(app.stage, match, Math.random() < 0.5);
    app.stage.setScene(this.view.scene, (dt, t) => this.frame(dt, t));
    input.menuMode = false;
    audio.unlock(); audio.startCrowd(); audio.crowdLevel(0.15);

    const hud = el('div', 'hud'); this.hud = hud;
    hud.innerHTML = `
      <div class="stake-tag">STAKE <b>${fmt(p.stake)}</b> · ${script.mode.toUpperCase()}</div>
      <div class="scoreboard"><div class="team home" style="background:${hk.primary};color:${contrast(hk.primary)}">${crestSvg(home, 22)} <span>${match.teams[0].setup.short}</span></div><div class="score"><span class="h">0</span><span>–</span><span class="a">0</span></div><div class="team away" style="background:${ak.primary};color:${contrast(ak.primary)}"><span>${match.teams[1].setup.short}</span> ${crestSvg(away, 22)}</div><div class="clock">00:00</div></div>
      <div class="banner"></div><div class="toast"></div><div class="power"><i></i></div>
      <div class="controls-hint"></div>
      <div class="pausebtn"></div>`;
    hud.querySelector('.pausebtn')!.appendChild(button('II', 'small', () => this.togglePause()));
    this.banner = hud.querySelector('.banner')!; this.toast = hud.querySelector('.toast')!; this.power = hud.querySelector('.power')!;
    root.appendChild(hud);
    const showTouch = state.settings.showTouch === 'on' || (state.settings.showTouch === 'auto' && isTouchDevice());
    if (showTouch) { this.touch = new TouchControls(root); this.touch.show(true); }
    const rot = el('div', 'rotate-hint in-game', `<div><h2>Rotate your device</h2><p class="muted">The Beautiful Game plays in landscape.</p></div>`); root.appendChild(rot);

    match.on((e) => {
      switch (e.type) {
        case 'goal': { const t = match.teams[e.team]; this.showBanner(`GOAL!<small>${t.setup.name}${e.scorer ? ' · ' + e.scorer.card.name : ''}</small>`, 3.2); audio.goal(); if (state.settings.vibration && navigator.vibrate) navigator.vibrate([60, 40, 120]); break; }
        case 'post': this.showToast(e.bar ? 'Off the crossbar!' : 'Off the post!'); audio.post(); break;
        case 'save': this.showToast(e.caught ? `Held by ${e.keeper.card.shortName}` : `Parried by ${e.keeper.card.shortName}!`); audio.crowdLevel(0.4); setTimeout(() => audio.crowdLevel(0.15), 1500); break;
        case 'foul': this.showToast(e.card ? `Yellow card · ${e.by.card.shortName}` : e.penalty ? 'Penalty!' : `Foul by ${e.by.card.shortName}`); audio.whistle(); if (e.penalty) this.showBanner('PENALTY', 1.8); break;
        case 'setpiece': if (e.kind === 'freekick') this.showToast(`Free kick · ${match.teams[e.team].setup.short}`); else if (e.kind === 'penalty') this.showToast(`Penalty · ${match.teams[e.team].setup.short}`); break;
        case 'kickoff': audio.whistle(); break;
        case 'halftime': this.showBanner('HALF TIME', 2.5); audio.whistle(true); break;
        case 'fulltime': this.showBanner('FULL TIME', 2.5); audio.whistle(true); this.onFullTime(); break;
        case 'kick': if (e.agent.isHuman || Math.random() < 0.5) audio.kick(e.kind === 'shoot' ? 0.9 : 0.4); break;
        case 'tackle': if (e.success) audio.kick(0.3); break;
        case 'out': this.showToast(e.kind === 'throw' ? (futsal ? 'Kick-in' : 'Throw-in') : e.kind === 'corner' ? 'Corner' : 'Goal kick'); break;
      }
    });
    this.showBanner(`${home.short} <small>vs</small> ${match.teams[1].setup.short}<small>${futsal ? 'Indoor court' : home.stadium.name + ' · ' + match.surface.label}</small>`, 2.4);
  }

  private frame(dt: number, time: number) {
    const m = this.match;
    if (input.pause.justPressed && !this.ended) this.togglePause();
    if (!this.paused) m.update(dt, input);
    this.view.frame(dt, time);
    // HUD
    const sb = this.hud.querySelector('.scoreboard')!;
    sb.querySelector('.h')!.textContent = String(m.teams[0].score); sb.querySelector('.a')!.textContent = String(m.teams[1].score);
    const c = m.clockText(); const clock = sb.querySelector('.clock')!; clock.textContent = c.text; clock.classList.toggle('stoppage', c.stoppage);
    if (m.charge) { this.power.classList.add('show'); (this.power.firstElementChild as HTMLElement).style.width = `${Math.min(100, (m.charge.t / (m.charge.kind === 'shoot' ? 0.9 : 0.5)) * 100)}%`; } else this.power.classList.remove('show');
    this.touch?.setDefending(!(m.controlled?.hasBall));
    const hint = this.hud.querySelector('.controls-hint')!; const txt = m.autopilot ? 'AUTO-PILOT · touch the controls to take over' : controllerHint(); if (hint.textContent !== txt) hint.textContent = txt;
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.banner.classList.remove('show'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.toast.classList.remove('show'); }
  }
  private showBanner(html: string, secs: number) { this.banner.innerHTML = html; this.banner.classList.add('show'); this.bannerTimer = secs; }
  private showToast(text: string) { this.toast.textContent = text; this.toast.classList.add('show'); this.toastTimer = 1.8; }

  private togglePause() {
    if (this.ended) return;
    this.paused = !this.paused; this.match.setPaused(this.paused); input.menuMode = this.paused;
    const existing = this.root.querySelector('.modal.pause'); existing?.remove();
    if (!this.paused) { focus.setRoot(null); return; }
    const modal = el('div', 'modal pause'); const card = el('div', 'panel card col');
    card.innerHTML = `<h2>Paused</h2><p class="muted small">Leaving now settles the round at its pre-determined result.</p>`;
    card.appendChild(button('Resume', 'primary', () => this.togglePause()));
    card.appendChild(button('Settle & leave', 'danger', () => { this.togglePause(); this.onFullTime(true); }));
    modal.appendChild(card); this.root.appendChild(modal);
    focus.setRoot(card); focus.onBack = () => this.togglePause();
  }

  private async onFullTime(early = false) {
    if (this.ended) return; this.ended = true;
    input.menuMode = true;
    const m = this.match; if (early) { m.setPaused(true); }
    audio.stopCrowd();
    const p = this.params;
    let settle: SettleRoundResponse | null = null; let error = '';
    try { settle = await api.settle(p.round.roundId); state.setWallet(settle.wallet); } catch (e: any) { error = e.message ?? 'Could not settle'; }
    this.settled = settle;
    const script = p.round.script as MatchScript;
    const final = early ? script.finalScore : { home: m.teams[0].score, away: m.teams[1].score };
    const won = settle ? settle.multiplier > 1 : script.multiplier > 1;
    const draw = settle ? settle.multiplier === 1 : script.multiplier === 1;
    const modal = el('div', 'modal'); const card = el('div', 'panel card col');
    const payout = settle?.payout ?? p.stake * script.multiplier;
    card.innerHTML = `<div class="result-hero"><h2>${won ? 'Victory' : draw ? 'Draw' : 'Defeat'}</h2><div class="score">${m.teams[0].setup.short} ${final.home} – ${final.away} ${m.teams[1].setup.short}</div>
      <div class="big ${payout > 0 ? '' : 'lose'}">${payout > 0 ? `+${fmt(payout)}` : 'No return'}</div><div class="muted small">${(settle?.multiplier ?? script.multiplier).toFixed(2)}× on a ${fmt(p.stake)} stake${early ? ' · settled early at the scheduled result' : ''}</div>${error ? `<div class="error">${error}</div>` : ''}</div>`;
    const fair = el('details', ''); fair.innerHTML = `<summary class="label" style="cursor:pointer">Provably fair</summary>`;
    const kv = el('div', 'kv');
    kv.innerHTML = `<span class="k">Round</span><span class="v">${p.round.roundId}</span><span class="k">Server seed hash</span><span class="v">${p.round.serverSeedHash}</span><span class="k">Server seed</span><span class="v">${settle?.serverSeed ?? '(revealed on settle)'}</span><span class="k">Client seed</span><span class="v">${p.round.clientSeed}</span><span class="k">Nonce</span><span class="v">${p.round.nonce}</span><span class="k">Verify</span><span class="v">sha256(serverSeed) = hash · u = HMAC_SHA256(serverSeed, clientSeed:nonce)[0:13] / 2^52 → paytable</span>`;
    fair.appendChild(kv); card.appendChild(fair);
    const row = el('div', 'row');
    const again = button('Play again', 'primary', () => app.router.go(p.mode === 'fut' ? 'fut' : p.mode === 'futsal' ? 'futsal' : 'kickoff', undefined, true)); again.setAttribute('data-focus', 'default');
    row.append(again, button('Home', '', () => app.router.go('home', undefined, true)));
    card.appendChild(row); modal.appendChild(card); this.root.appendChild(modal);
    focus.setRoot(card); focus.onBack = () => app.router.go('home', undefined, true);
  }

  unmount() { input.menuMode = true; audio.stopCrowd(); app.stage.setScene(null, null); this.view?.dispose(); this.touch?.destroy(); }
}

function contrast(hex: string): string { const c = parseInt(hex.slice(1), 16); const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? '#111' : '#fff'; }
