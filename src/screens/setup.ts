import * as THREE from 'three';
import type { Screen } from '../app/router';
import type { GameMode } from '@shared/types';
import { app } from '../main';
import { state } from '../app/state';
import { api } from '../app/api';
import { el, button, topbar, teamPicker, betPanel } from '../ui/components';
import { crestSvg } from '../ui/crest';
import { Showcase } from '../render/showcase';
import { TEAM_BY_ID, rosterOf, startingXI, type Team, type Kit } from '@shared/teams';
import { focus } from '../ui/focus';
import { SURFACES, randomSurface, type SurfaceId } from '../game/surface';

/** Resolve the conditions preference to a surface for one match. */
export function resolveSurface(futsal: boolean): SurfaceId {
  if (futsal) return 'court';
  return state.conditions === 'random' ? randomSurface() : (state.conditions as SurfaceId);
}

/** Pitch-conditions chips (outdoor modes). */
export function conditionsPanel(): HTMLElement {
  const p = el('div', 'panel col');
  p.appendChild(el('div', 'label', 'Conditions'));
  const row = el('div', 'league-tabs');
  const opts: Array<[string, string]> = [['random', 'Random'], ['dry', 'Dry'], ['firm', 'Firm'], ['wet', 'Rain'], ['snow', 'Snow']];
  const hint = el('div', 'small muted');
  const render = () => {
    row.innerHTML = '';
    for (const [id, label] of opts) { const b = el('button', `chip${state.conditions === id ? ' active' : ''}`, label); b.setAttribute('data-focus', ''); b.addEventListener('click', () => { state.conditions = id; state.saveTeams(); render(); }); row.appendChild(b); }
    const s = state.conditions === 'random' ? null : SURFACES[state.conditions as SurfaceId];
    hint.textContent = s ? ({ dry: 'True bounce, firm passing.', firm: 'Hard ground: the ball bounces higher and runs on.', wet: 'Slick surface: passes zip and skid, slides go further, footing is looser.', snow: 'Heavy ball: it dies on landing and rolls short; players struggle to turn.', court: '' } as Record<string, string>)[s.id] : 'Weather is drawn at kick-off.';
  };
  render(); p.append(row, hint); return p;
}

export function kitClash(a: Kit, b: Kit): boolean {
  const ca = new THREE.Color(a.primary), cb = new THREE.Color(b.primary);
  return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b) < 0.45;
}
/** Home wears home; away switches to its change kit on a clash. */
export function pickKits(home: Team, away: Team): [Kit, Kit] { return [home.home, kitClash(home.home, away.home) ? away.away : away.home]; }

/** Team selection + stake for Kick Off and Futsal. */
export class SetupScreen implements Screen {
  private showcase: Showcase | null = null;
  constructor(private mode: 'kickoff' | 'futsal') {}

  mount(root: HTMLElement) {
    const sc = new Showcase(app.stage); this.showcase = sc;
    app.stage.setScene(sc.scene, (dt, t) => sc.frame(dt, t, 0.6));
    const screen = el('div', 'screen screen-dim');
    screen.appendChild(topbar(this.mode === 'futsal' ? 'Futsal' : 'Kick Off', () => app.router.go('home')));
    const layout = el('div', 'setup-layout');
    const teamsPane = el('div', 'teams-pane col');
    const side = el('div', 'side-pane');
    let picking: 'home' | 'away' = 'home';
    const tabs = el('div', 'tabs');
    const renderTabs = () => {
      tabs.innerHTML = '';
      for (const [k, label] of [['home', 'Your team'], ['away', 'Opponent']] as const) { const b = el('button', `chip${picking === k ? ' active' : ''}`, label); b.setAttribute('data-focus', ''); b.addEventListener('click', () => { picking = k; renderTabs(); renderPicker(); }); tabs.appendChild(b); }
    };
    const pickerHolder = el('div');
    const renderPicker = () => {
      pickerHolder.innerHTML = '';
      const sel = picking === 'home' ? state.homeTeamId : state.awayTeamId;
      pickerHolder.appendChild(teamPicker(sel, (id) => { if (picking === 'home') state.homeTeamId = id; else state.awayTeamId = id; if (state.homeTeamId === state.awayTeamId) state.awayTeamId = Object.keys(TEAM_BY_ID).find((k) => k !== id)!; state.saveTeams(); renderVersus(); this.updateShowcase(); }, picking === 'home' ? state.awayTeamId : state.homeTeamId));
    };
    renderTabs(); renderPicker();
    teamsPane.append(tabs, pickerHolder);
    const versus = el('div', 'panel versus');
    const renderVersus = () => {
      const h = TEAM_BY_ID[state.homeTeamId], a = TEAM_BY_ID[state.awayTeamId];
      versus.innerHTML = `<div class="slot">${crestSvg(h, 64)}<div class="name">${h.name}</div><div class="muted small">${h.stadium.name}</div><span class="rating">${h.rating}</span></div><div class="vs">VS</div><div class="slot">${crestSvg(a, 64)}<div class="name">${a.name}</div><div class="muted small">${a.league}</div><span class="rating">${a.rating}</span></div>`;
    };
    renderVersus();
    const bet = betPanel(this.mode, async (stake) => {
      bet.setError(''); bet.setBusy(true);
      try {
        const r = await api.startRound(this.mode, stake, state.homeTeamId, state.awayTeamId);
        state.setWallet(r.wallet);
        app.router.go('match', { mode: this.mode, round: r, stake, homeTeamId: state.homeTeamId, awayTeamId: state.awayTeamId, surface: resolveSurface(this.mode === 'futsal') });
      } catch (e: any) { bet.setError(e.message ?? 'Could not start the round'); bet.setBusy(false); }
    }, this.mode === 'futsal' ? 'Play Futsal' : 'Kick Off');
    side.append(versus);
    if (this.mode !== 'futsal') side.append(conditionsPanel());
    side.append(bet.el);
    layout.append(teamsPane, side);
    screen.appendChild(layout);
    root.appendChild(screen);
    focus.setRoot(screen); focus.onBack = () => app.router.go('home');
    this.updateShowcase();
  }
  private updateShowcase() {
    if (!this.showcase) return;
    const t = TEAM_BY_ID[state.homeTeamId];
    const xi = startingXI(rosterOf(t.id)).slice(1).sort((a, b) => b.rating - a.rating).slice(0, 3);
    this.showcase.setPlayers(xi.map((card) => ({ card, kit: t.home, kitKey: `${t.id}:h` })));
  }
  unmount() { app.stage.setScene(null, null); this.showcase = null; }
}

export type MatchParams = { mode: GameMode; round: any; stake: number; homeTeamId?: string; awayTeamId?: string; homeSquad?: any[]; awaySquad?: any[]; clubName?: string; homeKit?: Kit; awayKit?: Kit; chemistry?: number; surface?: SurfaceId };
