import * as THREE from 'three';

/** Rollerz advertising: the wordmark drawn on a canvas for the LED boards, the stand banners and the camera carpets.
 *  (Drawn here, so there are no image files to load; a supplied logo can replace `drawWordmark`.) */
export type AdStyle = 'led' | 'ledAlt' | 'banner' | 'carpet';

const PINK = '#ff2e7e', AMBER = '#ffb020', INK = '#0b0718';

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function texture(c: HTMLCanvasElement, repeatX = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = THREE.RepeatWrapping; t.repeat.x = repeatX; return t;
}
function grad(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: Array<[number, string]>, fallback: string): CanvasGradient | string {
  try { const gr = g.createLinearGradient?.(x0, y0, x1, y1); if (!gr) return fallback; for (const [o, c] of stops) gr.addColorStop(o, c); return gr; } catch { return fallback; }
}

/** The ROLLERZ wordmark: heavy italic caps in a pink-to-amber blaze, the two O's drawn as wheels, centred at (cx, cy). */
export function drawWordmark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, mono?: string) {
  g.save(); g.translate(cx, cy); g.transform(1, 0, -0.22, 1, 0, 0); // (an italic lean)
  g.font = `900 ${size}px "Arial Black", Arial, sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'left';
  const parts = ['R', 'O', 'LLERZ']; const ow = size * 0.78;
  const widths = parts.map((p) => (p === 'O' ? ow : g.measureText?.(p)?.width ?? size * 0.7 * p.length));
  const total = widths.reduce((a, b) => a + b, 0) + size * 0.04 * 2;
  let x = -total / 2;
  const fill = mono ?? grad(g, -total / 2, 0, total / 2, 0, [[0, PINK], [1, AMBER]], PINK);
  g.fillStyle = fill; g.strokeStyle = fill;
  parts.forEach((p, i) => {
    if (p === 'O') {
      // a wheel: a thick ring with a hub and spokes
      const r = size * 0.36, c = x + ow / 2; g.lineWidth = size * 0.15;
      g.beginPath(); g.arc(c, 0, r - g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(c, 0, size * 0.07, 0, Math.PI * 2); g.fill();
      g.lineWidth = size * 0.035; for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + 0.3; g.beginPath(); g.moveTo(c, 0); g.lineTo(c + Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75); g.stroke(); }
    } else g.fillText(p, x, size * 0.03);
    x += widths[i] + (i < parts.length - 1 ? size * 0.04 : 0);
  });
  g.restore();
}

const cache = new Map<string, THREE.CanvasTexture>();
/** A Rollerz texture. `len` is the board's length in metres (the art repeats along long boards). */
export function rollerzTexture(style: AdStyle, len = 12, height = 0.9): THREE.CanvasTexture {
  const key = `${style}:${len.toFixed(1)}:${height}`; const hit = cache.get(key); if (hit) return hit;
  const H = 128, W = 1024; const c = canvas(W, H); const g = c.getContext('2d');
  // one tile covers this many metres of board (about 8 m: two wordmarks per 16 m segment)
  const tileM = style === 'banner' ? 9 : style === 'carpet' ? len : (W / H) * height;
  const t = texture(c, Math.max(1, Math.round(len / tileM))); // (whole wordmarks only)
  if (!g) { cache.set(key, t); return t; }
  if (style === 'led' || style === 'ledAlt') {
    g.fillStyle = style === 'led' ? grad(g, 0, 0, 0, H, [[0, '#14082a'], [1, INK]], INK) : grad(g, 0, 0, W, 0, [[0, PINK], [1, AMBER]], PINK);
    g.fillRect(0, 0, W, H);
    if (style === 'led') {
      // a speed streak behind the wordmark, and the line under it
      g.fillStyle = 'rgba(255, 46, 126, 0.18)'; for (let i = 0; i < 6; i++) g.fillRect(40 + i * 26, 36 + i * 9, 220 - i * 30, 5);
      drawWordmark(g, W / 2, H / 2, 84);
      g.fillStyle = AMBER; g.font = '700 22px Arial, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText('OFFICIAL PARTNER', W - 28, H / 2);
    } else drawWordmark(g, W / 2, H / 2, 88, INK);
  } else if (style === 'banner') {
    g.fillStyle = INK; g.fillRect(0, 0, W, H);
    g.fillStyle = grad(g, 0, 0, W, 0, [[0, PINK], [1, AMBER]], PINK); g.fillRect(0, H - 10, W, 10); g.fillRect(0, 0, W, 6);
    drawWordmark(g, W / 2, H / 2 - 2, 80);
  } else {
    // a camera carpet: on the grass beside the goal, angled so it reads from the main camera
    g.fillStyle = INK; g.fillRect(0, 0, W, H);
    g.strokeStyle = AMBER; g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12);
    drawWordmark(g, W / 2, H / 2, 88);
  }
  t.needsUpdate = true; cache.set(key, t); return t;
}
