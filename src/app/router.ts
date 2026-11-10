export type ScreenName = 'home' | 'kickoff' | 'futsal' | 'fut' | 'freekick' | 'match' | 'settings' | 'admin';
export interface Screen { mount(root: HTMLElement, params?: Record<string, unknown>): void; unmount(): void; }

type Factory = () => Screen;

export class Router {
  private screens = new Map<ScreenName, Factory>();
  private current: { name: ScreenName; screen: Screen } | null = null;
  private history: ScreenName[] = [];
  constructor(private root: HTMLElement) {}
  register(name: ScreenName, factory: Factory) { this.screens.set(name, factory); }
  go(name: ScreenName, params?: Record<string, unknown>, replace = false) {
    const f = this.screens.get(name);
    if (!f) throw new Error(`no screen ${name}`);
    if (this.current) { this.current.screen.unmount(); if (!replace) this.history.push(this.current.name); }
    this.root.innerHTML = '';
    const screen = f();
    this.current = { name, screen };
    screen.mount(this.root, params);
    if (this.history.length > 12) this.history.shift();
  }
  back() { const prev = this.history.pop(); this.go(prev ?? 'home', undefined, true); }
  get name() { return this.current?.name ?? null; }
}
