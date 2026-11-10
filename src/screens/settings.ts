import type { Screen } from '../app/router';
import type { GameMode } from '@shared/types';
import { app } from '../main';
import { state } from '../app/state';
import { api } from '../app/api';
import { audio } from '../app/audio';
import { el, button, topbar } from '../ui/components';
import { Showcase } from '../render/showcase';
import { TEAM_BY_ID, rosterOf, startingXI } from '@shared/teams';
import { focus } from '../ui/focus';
import { input } from '../input/input';

export class SettingsScreen implements Screen {
  mount(root: HTMLElement) {
    const sc = new Showcase(app.stage, '#06b6d4');
    const t = TEAM_BY_ID[state.homeTeamId]; const xi = startingXI(rosterOf(t.id));
    sc.setPlayers([{ card: xi[0], kit: { ...t.away, pattern: 'solid' }, kitKey: `${t.id}:gk`, keeper: true }, { card: xi[9], kit: t.home, kitKey: `${t.id}:h` }]);
    app.stage.setScene(sc.scene, (dt, tm) => sc.frame(dt, tm, 0.8));
    const screen = el('div', 'screen screen-dim scroll');
    screen.appendChild(topbar('Settings', () => app.router.back()));
    const grid = el('div', 'settings-grid');

    const prefs = el('div', 'panel col'); prefs.appendChild(el('div', 'label', 'Preferences'));
    const toggle = (label: string, get: () => string, cycle: () => void) => { const b = el('button', 'toggle'); b.setAttribute('data-focus', ''); const render = () => { b.innerHTML = `<span>${label}</span><span class="state">${get()}</span>`; b.classList.toggle('off', /off/i.test(get())); }; render(); b.addEventListener('click', () => { cycle(); render(); audio.ui(); }); return b; };
    prefs.appendChild(toggle('Sound', () => state.settings.sound ? 'On' : 'Off', () => { state.saveSettings({ sound: !state.settings.sound }); audio.setEnabled(state.settings.sound); }));
    prefs.appendChild(toggle('Graphics', () => state.settings.quality.toUpperCase(), () => { const q = state.settings.quality; state.saveSettings({ quality: q === 'auto' ? 'high' : q === 'high' ? 'low' : 'auto' }); app.stage.applyQuality(); }));
    prefs.appendChild(toggle('Touch controls', () => state.settings.showTouch.toUpperCase(), () => { const q = state.settings.showTouch; state.saveSettings({ showTouch: q === 'auto' ? 'on' : q === 'on' ? 'off' : 'auto' }); }));
    prefs.appendChild(toggle('Vibration', () => state.settings.vibration ? 'On' : 'Off', () => state.saveSettings({ vibration: !state.settings.vibration })));
    prefs.appendChild(toggle('Camera height', () => `${Math.round(state.settings.cameraHeight * 100)}%`, () => { const v = state.settings.cameraHeight; state.saveSettings({ cameraHeight: v >= 1.4 ? 0.7 : Math.round((v + 0.15) * 100) / 100 }); }));
    grid.appendChild(prefs);

    const ctl = el('div', 'panel col'); ctl.appendChild(el('div', 'label', `Controls · ${input.gamepadConnected ? (input.gamepadKind === 'playstation' ? 'PS5 controller connected' : 'Xbox controller connected') : 'no controller detected'}`));
    const ps = input.gamepadKind === 'playstation';
    const rows: Array<[string, string, string, string]> = [
      ['Move', 'WASD / Arrows', 'Left stick / D-pad', 'Left joystick'],
      ['Sprint', 'Shift', ps ? 'R2' : 'RT', 'Sprint'],
      ['Pass · Contain & jockey (hold, defending)', 'Space', ps ? '✕' : 'A', 'Pass / Press'],
      ['Shoot · Standing tackle at the ball', 'Z', ps ? '○' : 'B', 'Shoot / Tackle'],
      ['Through ball', 'C', ps ? '△' : 'Y', 'Through'],
      ['Cross / lofted pass (hold: lower and harder)', 'X', ps ? '□' : 'X', 'Cross'],
      ['Finesse (hold)', 'R', ps ? 'R1' : 'RB', '—'],
      ['Shield (hold)', 'F', ps ? 'L2' : 'LT', '—'],
      ['Switch player', 'Q', ps ? 'L1' : 'LB', 'Switch'],
      ['Slide tackle (miss the ball, take the man: foul)', 'E or X', ps ? '□' : 'X', 'Slide (cross button)'],
      ['Free kick curl', 'Q / E', ps ? 'L1 / R1' : 'LB / RB', 'Curl buttons'],
      ['Pause', 'Esc', 'Options / Menu', 'II'],
      ['Menus', 'Arrows · Enter · Esc', 'D-pad · A/✕ · B/○', 'Tap'],
    ];
    const table = el('table', 'controls-table'); table.innerHTML = `<tr><td></td><td><b>Keyboard</b></td><td><b>Controller</b></td><td><b>Touch</b></td></tr>` + rows.map((r) => `<tr><td>${r[0]}</td><td><kbd>${r[1]}</kbd></td><td><kbd>${r[2]}</kbd></td><td>${r[3]}</td></tr>`).join('');
    ctl.appendChild(table); grid.appendChild(ctl);

    const fair = el('div', 'panel col'); fair.appendChild(el('div', 'label', 'Provably fair'));
    fair.innerHTML += `<p class="small muted">Every round's result is fixed before kick-off from a server seed (committed by its SHA-256 hash), your client seed and a nonce. The seed is revealed when the round settles so you can verify the HMAC.</p><div class="kv"><span class="k">Player</span><span class="v">${localStorage.getItem('tbg.playerId')}</span><span class="k">Next seed hash</span><span class="v">${state.nextServerSeedHash || '—'}</span></div>`;
    const hist = el('div', 'col'); hist.innerHTML = `<div class="label">Recent rounds</div><div class="small muted">loading…</div>`;
    fair.appendChild(hist);
    api.history().then((h) => { hist.innerHTML = `<div class="label">Recent rounds</div>` + (h.rounds.length ? h.rounds.map((r) => `<div class="row small"><span class="grow">${r.mode} · ${r.tier}</span><span>${r.stake} → <b style="color:${r.payout > 0 ? 'var(--gold)' : 'var(--muted)'}">${r.payout}</b></span></div>`).join('') : '<div class="small muted">No rounds yet.</div>'); }).catch(() => { hist.innerHTML = '<div class="small error">Server unavailable.</div>'; });
    grid.appendChild(fair);

    const admin = el('div', 'panel col'); admin.appendChild(el('div', 'label', 'Operator · RTP'));
    admin.innerHTML += state.local ? `<p class="small muted">Demo mode: outcomes are generated on this device, so you can set the RTP freely here (no token needed).</p>` : `<p class="small muted">Set the return-to-player per mode. Requires the server's admin token (ADMIN_TOKEN env, default <kbd>change-me</kbd>).</p>`;
    const tokenIn = el('input'); tokenIn.type = 'password'; tokenIn.placeholder = 'Admin token';
    const modeSel = el('select'); modeSel.innerHTML = `<option value="all">All modes</option>` + (['kickoff', 'futsal', 'fut', 'freekick'] as GameMode[]).map((m) => `<option value="${m}">${m}</option>`).join('');
    const rtpIn = el('input'); rtpIn.type = 'number'; rtpIn.step = '0.005'; rtpIn.min = '0.5'; rtpIn.max = '0.995'; rtpIn.placeholder = 'RTP e.g. 0.96';
    const out = el('div', 'small');
    const refresh = () => { if (!state.config) return; out.innerHTML = `Current RTP: ` + Object.entries(state.config.modes).map(([m, pt]) => `<b>${m}</b> ${(pt.rtp * 100).toFixed(1)}%`).join(' · '); };
    refresh();
    admin.append(tokenIn, modeSel, rtpIn, button('Apply RTP', 'gold', async () => {
      try { await api.adminSetRtp(tokenIn.value, modeSel.value as GameMode | 'all', Number(rtpIn.value)); state.config = await api.config(); refresh(); out.innerHTML += ' <span style="color:var(--accent)">updated</span>'; }
      catch (e: any) { out.innerHTML = `<span class="error">${e.message}</span>`; }
    }), out);
    grid.appendChild(admin);

    screen.appendChild(grid);
    root.appendChild(screen);
    focus.setRoot(screen); focus.onBack = () => app.router.back();
  }
  unmount() { app.stage.setScene(null, null); }
}
