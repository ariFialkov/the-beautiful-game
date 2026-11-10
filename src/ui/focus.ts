/** Spatial focus navigation so menus work with a gamepad (D-pad / left stick + A / B) and keyboard arrows. */
export type NavDir = 'up' | 'down' | 'left' | 'right';

export class FocusManager {
  private root: HTMLElement | null = null;
  private current: HTMLElement | null = null;
  onBack: (() => void) | null = null;

  setRoot(root: HTMLElement | null) { this.root = root; this.current = null; this.ensure(); }
  private items(): HTMLElement[] {
    if (!this.root) return [];
    return Array.from(this.root.querySelectorAll<HTMLElement>('[data-focus]')).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }
  ensure() {
    const items = this.items();
    if (this.current && items.includes(this.current)) return;
    const preferred = items.find((el) => el.dataset.focus === 'default') ?? items[0] ?? null;
    this.set(preferred, false);
  }
  set(el: HTMLElement | null, scroll = true) {
    if (this.current) this.current.classList.remove('focused');
    this.current = el;
    if (el) { el.classList.add('focused'); if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  move(dir: NavDir) {
    const items = this.items();
    if (!items.length) return;
    if (!this.current || !items.includes(this.current)) { this.set(items[0]); return; }
    const cr = this.current.getBoundingClientRect();
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    let best: HTMLElement | null = null; let bestScore = Infinity;
    for (const el of items) {
      if (el === this.current) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      let primary = 0, secondary = 0;
      switch (dir) {
        case 'up': primary = -dy; secondary = Math.abs(dx); break;
        case 'down': primary = dy; secondary = Math.abs(dx); break;
        case 'left': primary = -dx; secondary = Math.abs(dy); break;
        case 'right': primary = dx; secondary = Math.abs(dy); break;
      }
      if (primary <= 4) continue;
      const score = primary + secondary * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.set(best);
  }
  activate() { this.ensure(); this.current?.click(); }
  back() { this.onBack?.(); }
  get element() { return this.current; }
}

export const focus = new FocusManager();
