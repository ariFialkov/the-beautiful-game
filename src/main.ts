import './styles.css';
import { Router } from './app/router';
import { Stage } from './render/scene';
import { state } from './app/state';
import { api } from './app/api';
import { audio } from './app/audio';
import { input } from './input/input';
import { focus } from './ui/focus';
import { el } from './ui/components';
import { HomeScreen } from './screens/home';
import { SetupScreen } from './screens/setup';
import { MatchScreen } from './screens/match';
import { FutScreen } from './screens/fut';
import { FreeKickScreen } from './screens/freekick';
import { SettingsScreen } from './screens/settings';

class App {
  stage!: Stage;
  router!: Router;
  ui!: HTMLElement;
}
export const app = new App();

async function boot() {
  const rootEl = document.getElementById('app')!;
  const loading = el('div', 'loading', `<div><div>The Beautiful Game</div><div class="bar"><i></i></div></div>`);
  rootEl.appendChild(loading);
  app.stage = new Stage(rootEl);
  app.ui = el('div'); app.ui.id = 'ui'; rootEl.appendChild(app.ui);
  app.router = new Router(app.ui);
  app.router.register('home', () => new HomeScreen());
  app.router.register('kickoff', () => new SetupScreen('kickoff'));
  app.router.register('futsal', () => new SetupScreen('futsal'));
  app.router.register('match', () => new MatchScreen());
  app.router.register('fut', () => new FutScreen());
  app.router.register('freekick', () => new FreeKickScreen());
  app.router.register('settings', () => new SettingsScreen());

  // Input: poll once per frame; menus navigate with the pad/keyboard.
  app.stage.preFrame = () => input.update();
  input.onNav((e) => {
    if (!input.menuMode) return;
    if (e === 'accept') { focus.activate(); audio.ui(); }
    else if (e === 'back') focus.back();
    else if (e === 'pause') { /* handled by screens */ }
    else focus.move(e);
  });
  // Unlock audio + keep settings applied on first interaction.
  const unlock = () => { audio.unlock(); audio.setEnabled(state.settings.sound); };
  window.addEventListener('pointerdown', unlock, { once: true }); window.addEventListener('keydown', unlock, { once: true });
  audio.setEnabled(state.settings.sound);

  // Server config + wallet (the app still opens offline; betting needs the outcome server).
  try {
    const [cfg, w] = await Promise.all([api.config(), api.wallet()]);
    state.config = cfg; state.wallet = w.wallet; state.nextServerSeedHash = w.nextServerSeedHash; state.offline = false;
  } catch (e) { console.warn('[tbg] outcome server unreachable', e); state.offline = true; }
  state.emit();

  // PWA service worker
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('sw', e)));
  }
  loading.remove();
  app.router.go('home');
  // Keep the wallet fresh when returning to the app.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) api.wallet().then((w) => { state.wallet = w.wallet; state.nextServerSeedHash = w.nextServerSeedHash; state.offline = false; state.emit(); }).catch(() => {}); });
}

boot();
