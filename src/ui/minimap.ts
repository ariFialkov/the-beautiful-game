import type { Match } from '../game/match';

type Basis = { right: { x: number; z: number }; forward: { x: number; z: number } };

/** FIFA-style radar: the pitch from above with every player as a dot in his team's colour, the ball, and a ring on the
 *  player you control. It turns with the match camera, snapped to the pitch's axes: lengthways across the screen for
 *  the side-on cameras, up the screen for end-to-end, and always with the same left/right and up/down as the view. */
export class Minimap {
  readonly el: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private size = '';
  private cssW = 0; private cssH = 0;

  constructor(private m: Match, private colors: [string, string]) {
    this.el = document.createElement('canvas'); this.el.className = 'minimap';
    this.g = this.el.getContext('2d')!;
  }

  /** Draw it for the camera's ground basis; `long` is the pitch length in CSS pixels, `maxH` caps its height. Returns
   *  the CSS height. */
  draw(b: Basis, long: number, maxH = Infinity): number {
    const m = this.m; const { length: L, width: W, boxDepth, boxWidth, goalWidth, futsal } = m.pitch;
    const across = Math.abs(b.right.x) >= Math.abs(b.right.z);
    const sx = Math.sign(across ? b.right.x : b.right.z) || 1, sy = Math.sign(across ? b.forward.z : b.forward.x) || 1;
    const pad = 5; const s = Math.min(long / L, (maxH - pad * 2) / (across ? W : L));
    const w = Math.round((across ? L : W) * s + pad * 2), h = Math.round((across ? W : L) * s + pad * 2);
    const dpr = Math.min(2, window.devicePixelRatio || 1); const key = `${w}x${h}@${dpr}`;
    if (key !== this.size) {
      this.size = key; this.cssW = w; this.cssH = h;
      this.el.width = Math.round(w * dpr); this.el.height = Math.round(h * dpr); this.el.style.width = `${w}px`; this.el.style.height = `${h}px`;
    }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    // world (x along the length, z across) -> map pixels
    const P = (x: number, z: number): [number, number] => across
      ? [pad + (sx * x + L / 2) * s, pad + (W / 2 - sy * z) * s]
      : [pad + (sx * z + W / 2) * s, pad + (L / 2 - sy * x) * s];
    const line = (pts: Array<[number, number]>, close = false) => { g.beginPath(); pts.forEach(([x, z], i) => { const [px, py] = P(x, z); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); if (close) g.closePath(); g.stroke(); };
    // the pitch
    g.fillStyle = 'rgba(14, 52, 30, 0.62)'; g.beginPath(); g.roundRect(0, 0, w, h, 7); g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.42)'; g.lineWidth = 1;
    line([[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]], true);
    line([[0, -W / 2], [0, W / 2]]);
    { const [cx, cy] = P(0, 0); g.beginPath(); g.arc(cx, cy, (futsal ? 3 : 9.15) * s, 0, Math.PI * 2); g.stroke(); }
    for (const e of [-1, 1]) {
      const gx = e * L / 2, bx = gx - e * boxDepth;
      line([[gx, -boxWidth / 2], [bx, -boxWidth / 2], [bx, boxWidth / 2], [gx, boxWidth / 2]]);
      g.save(); g.strokeStyle = 'rgba(255, 255, 255, 0.85)'; g.lineWidth = 2; line([[gx, -goalWidth / 2], [gx, goalWidth / 2]]); g.restore();
    }
    // the players: a dot each (keepers too), a ring on yours
    const dot = Math.max(2.6, Math.min(3.4, long / 55));
    for (const a of m.agents) {
      const [px, py] = P(a.pos.x, a.pos.z);
      g.fillStyle = this.colors[a.team]; g.strokeStyle = 'rgba(0, 0, 0, 0.55)'; g.lineWidth = 1;
      g.beginPath(); g.arc(px, py, dot, 0, Math.PI * 2); g.fill(); g.stroke();
      if (a === m.controlled) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, dot + 2.2, 0, Math.PI * 2); g.stroke(); }
    }
    // the ball, on top
    const [bx, by] = P(m.ball.x, m.ball.z);
    g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0, 0, 0, 0.8)'; g.lineWidth = 1;
    g.beginPath(); g.arc(bx, by, Math.max(1.8, dot * 0.7), 0, Math.PI * 2); g.fill(); g.stroke();
    return this.cssH;
  }
}
