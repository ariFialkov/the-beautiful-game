import type { Screen } from '../app/router';
import type { FutClub, PlayerCard, PackType } from '@shared/types';
import { app } from '../main';
import { state, fmt } from '../app/state';
import { api } from '../app/api';
import { audio } from '../app/audio';
import { el, button, topbar, betPanel, cardMini } from '../ui/components';
import { Showcase } from '../render/showcase';
import { playerById, TEAM_BY_ID, type Kit } from '@shared/teams';
import { chemistry, SLOTS_433, positionFit } from '../fut/chemistry';
import { focus } from '../ui/focus';
import { resolveSurface, conditionsPanel } from './setup';

export const FUT_HOME_KIT: Kit = { primary: '#0b1a33', secondary: '#19f5a4', shorts: '#0b1a33', socks: '#19f5a4', pattern: 'sash' };
export const FUT_AWAY_KIT: Kit = { primary: '#ff4d6d', secondary: '#111111', shorts: '#111111', socks: '#ff4d6d', pattern: 'chevron' };

/** Ultimate Team hub: squad builder with chemistry, packs, and matches against a rival UT. */
export class FutScreen implements Screen {
  private club: FutClub | null = null;
  private cards = new Map<string, PlayerCard>();
  private tab: 'squad' | 'packs' | 'play' = 'squad';
  private pickingSlot: string | null = null;
  private showcase: Showcase | null = null;
  private body!: HTMLElement;
  private root!: HTMLElement;
  private saveTimer = 0;

  async mount(root: HTMLElement) {
    this.root = root;
    const sc = new Showcase(app.stage, '#f7c948'); this.showcase = sc;
    app.stage.setScene(sc.scene, (dt, t) => sc.frame(dt, t, 0.7));
    const screen = el('div', 'screen screen-dim scroll');
    screen.appendChild(topbar('Ultimate Team', () => app.router.go('home')));
    const tabs = el('div', 'tabs');
    const renderTabs = () => { tabs.innerHTML = ''; for (const [k, l] of [['squad', 'Squad'], ['packs', 'Packs'], ['play', 'Play match']] as const) { const b = el('button', `chip${this.tab === k ? ' active' : ''}`, l); b.setAttribute('data-focus', ''); b.addEventListener('click', () => { this.tab = k; this.pickingSlot = null; renderTabs(); this.render(); }); tabs.appendChild(b); } };
    renderTabs();
    screen.appendChild(tabs);
    this.body = el('div', 'fut-layout'); screen.appendChild(this.body);
    root.appendChild(screen);
    focus.setRoot(screen); focus.onBack = () => app.router.go('home');
    this.body.innerHTML = `<div class="panel">Loading your club…</div>`;
    try { const r = await api.club(); this.club = r.club; state.setWallet(r.wallet); this.index(); this.render(); this.updateShowcase(); }
    catch (e: any) { this.body.innerHTML = `<div class="panel error">${e.message ?? 'Could not load your club'}. The outcome server must be running.</div>`; }
  }
  private index() { this.cards.clear(); for (const id of this.club!.cards) { const c = playerById(id); if (c) this.cards.set(id, c); } }
  private squadCards(): PlayerCard[] { return Object.values(this.club!.squad).filter((x): x is string => !!x).map((id) => this.cards.get(id)!).filter(Boolean); }
  private updateShowcase() {
    if (!this.showcase || !this.club) return;
    const best = this.squadCards().sort((a, b) => b.rating - a.rating).slice(0, 3);
    this.showcase.setPlayers(best.map((card) => ({ card, kit: FUT_HOME_KIT, kitKey: 'fut:h' })));
  }

  private render() {
    const body = this.body; body.innerHTML = '';
    const club = this.club!; const chem = chemistry(club.squad, this.cards);
    // left: the pitch with slots
    const left = el('div', 'col');
    const header = el('div', 'panel col');
    header.innerHTML = `<div class="row"><div class="grow"><div class="label">Club</div><div style="font-family:var(--font-display);font-size:18px">${club.clubName}</div></div><div><div class="label">Rating</div><span class="rating hi">${chem.rating}</span></div></div><div class="label">Chemistry ${chem.team}/100</div><div class="chem-bar"><i style="width:${chem.team}%"></i></div>`;
    left.appendChild(header);
    const pitch = el('div', 'fut-pitch');
    for (const s of SLOTS_433) {
      const id = club.squad[s.id]; const card = id ? this.cards.get(id) ?? null : null;
      const slot = el('div', 'slot'); slot.style.left = `${s.x}%`; slot.style.top = `${s.y}%`;
      const cm = cardMini(card, { chem: card ? chem.slots[s.id] : undefined, slot: s.pos, onClick: () => { this.tab = 'squad'; this.pickingSlot = this.pickingSlot === s.id ? null : s.id; this.render(); } });
      if (this.pickingSlot === s.id) cm.style.boxShadow = '0 0 0 3px var(--accent)';
      slot.appendChild(cm); pitch.appendChild(slot);
    }
    left.appendChild(pitch);
    body.appendChild(left);
    const right = el('div', 'col');
    if (this.tab === 'squad') this.renderSquad(right, chem);
    else if (this.tab === 'packs') this.renderPacks(right);
    else this.renderPlay(right, chem);
    body.appendChild(right);
    focus.ensure();
  }

  private renderSquad(right: HTMLElement, chem: ReturnType<typeof chemistry>) {
    const club = this.club!;
    if (this.pickingSlot) {
      const s = SLOTS_433.find((x) => x.id === this.pickingSlot)!;
      const p = el('div', 'panel col');
      p.innerHTML = `<div class="row"><div class="label grow">Pick a ${s.pos} for ${s.id}</div></div>`;
      const inSquad = new Map(Object.entries(club.squad).filter(([, v]) => v).map(([k, v]) => [v!, k]));
      const list = Array.from(this.cards.values()).sort((a, b) => positionFit(s.pos, b.position) * 10 + b.rating - (positionFit(s.pos, a.position) * 10 + a.rating));
      const grid = el('div', 'card-grid');
      const clear = button('Clear slot', 'small danger', () => { club.squad[s.id] = null; this.pickingSlot = null; this.queueSave(); this.render(); });
      p.appendChild(clear);
      for (const c of list) {
        const where = inSquad.get(c.id);
        const cm = cardMini(c, { onClick: () => {
          const prev = club.squad[s.id];
          if (where && where !== s.id) club.squad[where] = prev ?? null; // swap
          club.squad[s.id] = c.id; this.pickingSlot = null; this.queueSave(); audio.ui(); this.render(); this.updateShowcase();
        } });
        if (where) cm.style.outline = '2px solid var(--gold)';
        grid.appendChild(cm);
      }
      p.appendChild(grid); right.appendChild(p); return;
    }
    const info = el('div', 'panel col');
    info.innerHTML = `<div class="label">Squad builder</div><p class="small muted">Tap a slot to assign a player. Chemistry grows with correct positions and links between team-mates from the same club, league or nation. Higher chemistry makes your players sharper on the pitch.</p>`;
    const rename = el('div', 'row'); const nameIn = el('input'); nameIn.type = 'text'; nameIn.value = club.clubName; nameIn.maxLength = 24; nameIn.placeholder = 'Club name';
    rename.append(nameIn, button('Rename', 'small', () => { club.clubName = nameIn.value.trim() || club.clubName; this.queueSave(); this.render(); }));
    info.appendChild(rename);
    const missing = SLOTS_433.filter((s) => !club.squad[s.id]).length;
    if (missing) info.appendChild(el('div', 'error', `${missing} empty slot${missing > 1 ? 's' : ''} · fill the XI before playing`));
    right.appendChild(info);
    const all = el('div', 'panel col'); all.innerHTML = `<div class="label">Club · ${this.cards.size} players</div>`;
    const grid = el('div', 'card-grid');
    for (const c of Array.from(this.cards.values()).sort((a, b) => b.rating - a.rating)) grid.appendChild(cardMini(c));
    all.appendChild(grid); right.appendChild(all);
  }

  private renderPacks(right: HTMLElement) {
    const cfg = state.config; const p = el('div', 'panel col');
    p.innerHTML = `<div class="label">Store</div><p class="small muted">Packs are bought with credits from your wallet and add players to your club permanently.</p>`;
    const grid = el('div', 'pack-grid');
    for (const t of ['bronze', 'silver', 'gold', 'elite'] as PackType[]) {
      const pk = cfg?.packs[t]; const b = el('button', `pack ${t}`); b.setAttribute('data-focus', '');
      b.innerHTML = `<div class="box"></div><div style="font-weight:800">${pk?.label ?? t}</div><div class="price">${pk ? fmt(pk.price) : '—'} CR</div><div class="small muted">${{ bronze: '3 players · up to 72', silver: '4 players · 64–80', gold: '5 players · 74–92', elite: '5 players · 80+' }[t]}</div>`;
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { const r = await api.openPack(t); state.setWallet(r.wallet); this.club = r.club; this.index(); audio.goal(); this.reveal(r.cards); this.updateShowcase(); }
        catch (e: any) { p.appendChild(el('div', 'error', e.message)); } finally { b.disabled = false; }
      });
      grid.appendChild(b);
    }
    p.appendChild(grid); right.appendChild(p);
    const rv = el('div', 'panel col reveal-holder hidden'); right.appendChild(rv);
  }
  private reveal(cards: PlayerCard[]) {
    const holder = this.body.querySelector<HTMLElement>('.reveal-holder'); if (!holder) return;
    holder.classList.remove('hidden'); holder.innerHTML = `<div class="label">Pack contents</div>`;
    const r = el('div', 'reveal');
    cards.forEach((c, i) => { const cm = cardMini(c); cm.style.animationDelay = `${i * 0.25}s`; r.appendChild(cm); });
    holder.appendChild(r);
    holder.appendChild(button('Back to squad', 'small', () => { this.tab = 'squad'; this.render(); }));
    this.render(); // refresh counts (re-renders packs tab)
    const h2 = this.body.querySelector<HTMLElement>('.reveal-holder'); if (h2) { h2.classList.remove('hidden'); h2.innerHTML = holder.innerHTML; }
  }

  private renderPlay(right: HTMLElement, chem: ReturnType<typeof chemistry>) {
    const club = this.club!;
    const missing = SLOTS_433.filter((s) => !club.squad[s.id]).length;
    const p = el('div', 'panel col');
    p.innerHTML = `<div class="label">Rivals</div><p class="small muted">Your squad faces a rival Ultimate Team of similar quality. Chemistry ${chem.team}/100 · Rating ${chem.rating}.</p>`;
    right.appendChild(p);
    if (missing) { right.appendChild(el('div', 'panel error', 'Fill every slot in your XI first.')); return; }
    const bet = betPanel('fut', async (stake) => {
      bet.setError(''); bet.setBusy(true);
      try {
        const squad = SLOTS_433.map((s) => this.cards.get(club.squad[s.id]!)!);
        const best = squad.slice().sort((a, b) => b.rating - a.rating)[0];
        const opp = await api.opponent(String(Date.now()));
        const oppBest = opp.squad.slice().sort((a, b) => b.rating - a.rating)[0];
        const r = await api.startRound('fut', stake, best.teamId, oppBest.teamId);
        state.setWallet(r.wallet);
        app.router.go('match', { mode: 'fut', round: r, stake, homeTeamId: best.teamId, awayTeamId: oppBest.teamId === best.teamId ? Object.keys(TEAM_BY_ID).find((k) => k !== best.teamId) : oppBest.teamId, homeSquad: squad, awaySquad: opp.squad, clubName: club.clubName, homeKit: FUT_HOME_KIT, awayKit: FUT_AWAY_KIT, chemistry: chem.team, surface: resolveSurface(false) });
      } catch (e: any) { bet.setError(e.message ?? 'Could not start'); bet.setBusy(false); }
    }, 'Play match');
    right.appendChild(conditionsPanel());
    right.appendChild(bet.el);
  }

  private queueSave() { clearTimeout(this.saveTimer); this.saveTimer = window.setTimeout(() => { api.saveSquad(this.club!.squad, this.club!.clubName).catch((e) => console.warn(e)); }, 400); }
  unmount() { clearTimeout(this.saveTimer); if (this.club) api.saveSquad(this.club.squad, this.club.clubName).catch(() => {}); app.stage.setScene(null, null); }
}
