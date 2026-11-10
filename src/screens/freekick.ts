import type { Screen } from '../app/router';
import type { FreeKickScript, SettleRoundResponse } from '@shared/types';
import { app } from '../main';
import { state, fmt, isTouchDevice } from '../app/state';
import { api } from '../app/api';
import { audio } from '../app/audio';
import { el, button, topbar, betPanel, teamPicker } from '../ui/components';
import { Showcase } from '../render/showcase';
import { FreeKickGame, type FKSide } from '../freekick/freekick';
import { TEAM_BY_ID, rosterOf, startingXI, TEAMS } from '@shared/teams';
import { pickKits, resolveSurface } from './setup';
import { input } from '../input/input';
import { focus } from '../ui/focus';
import { showResults } from '../ui/results';
import { crestSvg } from '../ui/crest';

function side(teamId: string, kit: any, kitKey: string): FKSide {
  const team = TEAM_BY_ID[teamId]; const xi = startingXI(rosterOf(teamId));
  const out = xi.slice(1);
  const kicker = out.slice().sort((a, b) => b.attrs.shooting - a.attrs.shooting)[0];
  return { team, kit, kitKey, kicker, keeper: xi[0], wall: out.filter((p) => p !== kicker).sort((a, b) => b.attrs.physical - a.attrs.physical) };
}

/** Free Kick duel: stake → set-piece showdown → settlement. */
export class FreeKickScreen implements Screen {
  private root!: HTMLElement;
  private game: FreeKickGame | null = null;
  private showcase: Showcase | null = null;
  private hud: HTMLElement | null = null;
  private round: any = null; private stake = 0;
  private ended = false;

  mount(root: HTMLElement) {
    this.root = root;
    const sc = new Showcase(app.stage, '#ff4d6d'); this.showcase = sc;
    app.stage.setScene(sc.scene, (dt, t) => sc.frame(dt, t, 0.5));
    const screen = el('div', 'screen screen-dim');
    screen.appendChild(topbar('Free Kick', () => app.router.go('home')));
    const layout = el('div', 'setup-layout');
    const teams = el('div', 'teams-pane col'); teams.appendChild(el('div', 'label', 'Your team'));
    teams.appendChild(teamPicker(state.homeTeamId, (id) => { state.homeTeamId = id; if (state.awayTeamId === id) state.awayTeamId = TEAMS.find((t) => t.id !== id)!.id; state.saveTeams(); this.updateShowcase(); }));
    const sidePane = el('div', 'side-pane');
    const info = el('div', 'panel col');
    info.innerHTML = `<div class="label">How it works</div><p class="small muted">A random free-kick situation is set up. You shoot first; a rival from <b>${TEAM_BY_ID[state.awayTeamId].name}</b> answers. Score when they miss and you win the duel. Both score or both miss and it goes again.</p><p class="small muted">Aim with the stick / arrows / drag · hold Shoot for power · Curl with Q/E, L1/R1 or the curl buttons.</p>`;
    sidePane.appendChild(info);
    const bet = betPanel('freekick', async (stake) => {
      bet.setError(''); bet.setBusy(true);
      try {
        const opp = state.awayTeamId === state.homeTeamId ? TEAMS.find((t) => t.id !== state.homeTeamId)!.id : state.awayTeamId;
        const r = await api.startRound('freekick', stake, state.homeTeamId, opp);
        state.setWallet(r.wallet); this.round = r; this.stake = stake;
        this.startDuel(r.script as FreeKickScript, state.homeTeamId, opp);
      } catch (e: any) { bet.setError(e.message ?? 'Could not start'); bet.setBusy(false); }
    }, 'Take the kick');
    sidePane.appendChild(bet.el);
    layout.append(teams, sidePane); screen.appendChild(layout); root.appendChild(screen);
    focus.setRoot(screen); focus.onBack = () => app.router.go('home');
    this.updateShowcase();
  }
  private updateShowcase() {
    if (!this.showcase) return; const t = TEAM_BY_ID[state.homeTeamId]; const s = side(t.id, t.home, `${t.id}:h`);
    this.showcase.setPlayers([{ card: s.kicker, kit: t.home, kitKey: `${t.id}:h` }]);
  }

  private startDuel(script: FreeKickScript, homeId: string, awayId: string) {
    this.root.innerHTML = ''; this.showcase = null;
    const home = TEAM_BY_ID[homeId], away = TEAM_BY_ID[awayId];
    const [hk, ak] = pickKits(home, away);
    const game = new FreeKickGame(app.stage, script, side(homeId, hk, `${homeId}:${hk === home.home ? 'h' : 'a'}`), side(awayId, ak, `${awayId}:${ak === away.home ? 'h' : 'a'}`), Math.random() < 0.7, resolveSurface(false));
    this.game = game;
    input.menuMode = false; audio.unlock(); audio.startCrowd(); audio.crowdLevel(0.12);
    const hud = el('div', 'hud fk-hud'); this.hud = hud;
    hud.innerHTML = `<div class="stake-tag">STAKE <b>${fmt(this.stake)}</b> · FREE KICK</div>
      <div class="duel"><span>${crestSvg(home, 20)} YOU</span><span class="pips you"></span><span class="muted">·</span><span class="pips them"></span><span>RIVAL ${crestSvg(away, 20)}</span></div>
      <div class="reticle"></div><div class="banner"></div><div class="toast"></div><div class="power"><i></i></div><div class="controls-hint"></div>
      <div class="aimpad"></div>
      <div class="curl"><button class="tbtn" data-c="-1">Curl ◀</button><button class="tbtn" data-c="1">Curl ▶</button></div>
      <button class="tbtn shootbtn" style="width:92px;height:92px;font-size:14px">Shoot</button>
      <div class="pausebtn"></div>`;
    hud.querySelector('.pausebtn')!.appendChild(button('✕', 'small', () => this.finish(true)));
    this.root.appendChild(hud);
    const touch = isTouchDevice();
    const aimpad = hud.querySelector<HTMLElement>('.aimpad')!; let drag: { id: number; x: number; y: number } | null = null;
    aimpad.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; aimpad.setPointerCapture(e.pointerId); });
    aimpad.addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag.id || game.phase !== 'aim') return; game.aim.z = Math.max(-6, Math.min(6, game.aim.z + (e.clientX - drag.x) * 0.02)); game.aim.y = Math.max(0.3, Math.min(3.6, game.aim.y - (e.clientY - drag.y) * 0.012)); drag.x = e.clientX; drag.y = e.clientY; });
    const endDrag = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) drag = null; };
    aimpad.addEventListener('pointerup', endDrag); aimpad.addEventListener('pointercancel', endDrag);
    const shoot = hud.querySelector<HTMLElement>('.shootbtn')!;
    shoot.addEventListener('pointerdown', (e) => { e.preventDefault(); shoot.classList.add('pressed'); input.setTouchButton('shoot', true); });
    const up = () => { shoot.classList.remove('pressed'); input.setTouchButton('shoot', false); };
    shoot.addEventListener('pointerup', up); shoot.addEventListener('pointercancel', up); shoot.addEventListener('pointerleave', up);
    for (const b of Array.from(hud.querySelectorAll<HTMLElement>('.curl .tbtn'))) {
      const v = Number(b.dataset.c); b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('pressed'); input.touchCurl = v; });
      const rel = () => { b.classList.remove('pressed'); input.touchCurl = 0; }; b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
    }
    if (!touch) { (hud.querySelector('.curl') as HTMLElement).style.display = 'none'; shoot.style.display = 'none'; }
    const banner = hud.querySelector<HTMLElement>('.banner')!; const toast = hud.querySelector<HTMLElement>('.toast')!; const power = hud.querySelector<HTMLElement>('.power')!; const reticle = hud.querySelector<HTMLElement>('.reticle')!;
    let bannerT = 0, toastT = 0;
    const showBanner = (h: string, s: number) => { banner.innerHTML = h; banner.classList.add('show'); bannerT = s; };
    const showToast = (t: string) => { toast.textContent = t; toast.classList.add('show'); toastT = 2; };
    const pips = () => {
      const you = hud.querySelector('.pips.you')!, them = hud.querySelector('.pips.them')!;
      you.innerHTML = game.results.map((r) => `<span class="pip ${r.player ? 'goal' : 'miss'}"></span>`).join('') + '<span class="pip"></span>';
      them.innerHTML = game.results.map((r, i) => `<span class="pip ${i < game.results.length - 1 || game.phase === 'botResult' || game.phase === 'end' ? (r.bot ? 'goal' : 'miss') : ''}"></span>`).join('') + '<span class="pip"></span>';
    };
    game.on((e) => {
      switch (e.type) {
        case 'kick': audio.kick(0.9); break;
        case 'goal': showBanner(e.who === 'player' ? 'GOAL!<small>Top class</small>' : 'THEY SCORE<small>Rival levels it</small>', 2); audio.goal(); if (e.who === 'player' && state.settings.vibration && navigator.vibrate) navigator.vibrate(100); break;
        case 'miss': showBanner(e.who === 'player' ? 'MISS<small>' + e.how + '</small>' : 'RIVAL MISSES<small>' + e.how + '</small>', 2); if (e.how === 'post' || e.how === 'bar') audio.post(); else if (e.how === 'saved') audio.crowdLevel(0.4); break;
        case 'phase': if (e.phase === 'aim') showToast(`Round ${game.round + 1} · your kick`); if (e.phase === 'botThink') showToast('Rival steps up…'); pips(); break;
        case 'end': showBanner(e.won ? 'YOU WIN<small>Duel over</small>' : 'DEFEAT<small>Duel over</small>', 3); setTimeout(() => this.finish(false), 2600); break;
      }
    });
    showBanner(`${home.short} <small>vs</small> ${away.short}<small>${Math.round(script.situation.distance)} m · ${script.situation.wallSize}-man wall</small>`, 2.2);
    app.stage.setScene(game.scene, (dt, t) => {
      game.update(dt, input, t);
      const a = game.aimScreen(); reticle.style.left = `${a.x}px`; reticle.style.top = `${a.y}px`; reticle.style.display = game.phase === 'aim' ? 'block' : 'none';
      if (game.charging) { power.classList.add('show'); (power.firstElementChild as HTMLElement).style.width = `${game.power * 100}%`; } else power.classList.remove('show');
      const hint = hud.querySelector('.controls-hint')!; const txt = game.phase === 'aim' ? (touch ? 'Drag to aim · hold Shoot · curl buttons' : 'Aim: arrows / stick · Curl: Q/E or L1/R1 · Hold Z / Space / ○ to shoot') : ''; if (hint.textContent !== txt) hint.textContent = txt;
      const cur = hud.querySelector('.curl')!; cur.querySelectorAll('.tbtn').forEach((b, i) => (b as HTMLElement).style.opacity = (i === 0 ? game.curl < -0.2 : game.curl > 0.2) ? '1' : '0.6');
      if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) banner.classList.remove('show'); }
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toast.classList.remove('show'); }
      if (input.pause.justPressed) this.finish(true);
    });
  }

  private async finish(early: boolean) {
    if (this.ended) return; this.ended = true; input.menuMode = true; audio.stopCrowd();
    const script = this.round.script as FreeKickScript;
    let settle: SettleRoundResponse | null = null; let error = '';
    try { settle = await api.settle(this.round.roundId); state.setWallet(settle.wallet); } catch (e: any) { error = e.message; }
    const won = (settle?.multiplier ?? script.multiplier) > 0;
    const g = this.game!;
    const detail = early ? 'Settled early at the scheduled result' : `${g.results.filter((r) => r.player).length} – ${g.results.filter((r) => r.bot).length} after ${g.results.length} round${g.results.length === 1 ? '' : 's'}`;
    showResults(this.root, { title: won ? 'Duel won' : 'Duel lost', detail, stake: this.stake, multiplier: settle?.multiplier ?? script.multiplier, settle, round: this.round, error, onAgain: () => app.router.go('freekick', undefined, true) });
  }
  unmount() { input.menuMode = true; audio.stopCrowd(); app.stage.setScene(null, null); }
}
