import type { Screen } from '../app/router';
import { app } from '../main';
import { el, button, walletBadge } from '../ui/components';
import { Match } from '../game/match';
import { PITCH_11 } from '../game/pitch';
import { MatchView } from '../render/matchView';
import { TEAMS, rosterOf, startingXI, type Team } from '@shared/teams';
import { crestSvg } from '../ui/crest';
import { pickKits } from './setup';
import { focus } from '../ui/focus';

/** Main menu over a cinematic league-highlights tape (an AI vs AI match with cuts and a broadcast filter). */
export class HomeScreen implements Screen {
  private match: Match | null = null;
  private view: MatchView | null = null;
  private tape: HTMLElement | null = null;
  private timer = 0;

  mount(root: HTMLElement) {
    this.startTape();
    const tape = el('div', 'tape'); this.tape = tape;
    tape.innerHTML = `<div class="letterbox top"></div><div class="letterbox bottom"></div><div class="vignette"></div><div class="grain"></div>
      <div class="decal"><span class="dot"></span>League Highlights</div>
      <div class="scoreline"><span class="team home"></span><span class="score"></span><span class="team away"></span></div>
      <div class="ticker"><span>${TEAMS.map((t) => `${t.name.toUpperCase()} · ${t.league.toUpperCase()}`).join('   ●   ')}</span></div>`;
    root.appendChild(tape);
    const screen = el('div', 'screen screen-dim');
    const top = el('div', 'topbar'); top.innerHTML = `<div class="brand">The <b>Beautiful</b> Game</div><div class="spacer"></div>`; top.appendChild(walletBadge());
    top.appendChild(button('⚙', 'small ghost', () => app.router.go('settings')));
    screen.appendChild(top);
    const hero = el('div', 'home-hero', `<h1>Play.<br/><span>Win.</span><br/>Repeat.</h1><p>Fluid 3D football with real stakes. Pick a mode, place your stake, and take the pitch.</p>`);
    screen.appendChild(hero);
    const menu = el('div', 'home-menu');
    const modes: Array<[string, string, string, string, () => void]> = [
      ['KO', '', 'Kick Off', 'Full 11v11 match · pick both teams', () => app.router.go('kickoff')],
      ['UT', 'fut', 'Ultimate Team', 'Open packs, build chemistry, play your squad', () => app.router.go('fut')],
      ['FK', 'fk', 'Free Kick', 'Sudden-death set-piece duel vs. a rival', () => app.router.go('freekick')],
      ['5v5', 'fs', 'Futsal', 'Fast indoor 5v5 on a small court', () => app.router.go('futsal')],
    ];
    modes.forEach(([ic, cls, title, sub, go], i) => {
      const c = el('button', 'mode-card'); c.setAttribute('data-focus', i === 0 ? 'default' : '');
      c.innerHTML = `<div class="icon ${cls}">${ic}</div><div><div class="title">${title}</div><div class="sub">${sub}</div></div>`;
      c.addEventListener('click', go); menu.appendChild(c);
    });
    screen.appendChild(menu);
    const foot = el('div', 'home-footer small muted', `Works offline as an app · Gamepad, keyboard & touch supported · Outcomes are provably fair`);
    screen.appendChild(foot);
    root.appendChild(screen);
    focus.setRoot(screen); focus.onBack = null;
    this.timer = window.setInterval(() => this.updateScoreline(), 500);
    this.updateScoreline();
  }

  private startTape() {
    const pool = TEAMS.slice().sort(() => Math.random() - 0.5);
    const home: Team = pool[0], away: Team = pool[1];
    const kits = pickKits(home, away);
    const match = new Match({ pitch: PITCH_11, mode: 'kickoff', humanTeam: null, script: null, durationSec: 600, clockMinutes: 90,
      teams: [{ team: home, players: startingXI(rosterOf(home.id)), kit: kits[0], kitKey: `${home.id}:${kits[0] === home.home ? 'h' : 'a'}`, name: home.name, short: home.short },
        { team: away, players: startingXI(rosterOf(away.id)), kit: kits[1], kitKey: `${away.id}:${kits[1] === away.home ? 'h' : 'a'}`, name: away.name, short: away.short }] });
    // Highlights are more fun with goals: let both sides attack freely.
    match.mods.shotAppetite = [1.6, 1.6];
    const view = new MatchView(app.stage, match, Math.random() < 0.6);
    view.cinematic = true;
    this.match = match; this.view = view;
    app.stage.setScene(view.scene, (dt, time) => { match.update(dt); view.frame(dt, time); if (match.ended) { this.startTape(); } });
    app.stage.setFilter(true);
  }
  private updateScoreline() {
    if (!this.match || !this.tape) return;
    const [h, a] = this.match.teams;
    this.tape.querySelector('.team.home')!.innerHTML = `${crestSvg(h.setup.team, 22)} ${h.setup.short}`;
    this.tape.querySelector('.team.away')!.innerHTML = `${a.setup.short} ${crestSvg(a.setup.team, 22)}`;
    this.tape.querySelector('.score')!.textContent = `${h.score} – ${a.score}`;
  }
  unmount() { clearInterval(this.timer); app.stage.setFilter(false); app.stage.setScene(null, null); this.view?.dispose(); this.match = null; this.view = null; }
}
