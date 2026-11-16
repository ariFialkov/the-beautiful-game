import * as THREE from 'three';

/** Rollerz advertising on the LED perimeter boards: the Rollerz logo (the pink "R" mark and the wordmark), drawn as
 *  vectors on a canvas so it stays sharp at any size, in a few colour schemes. */
export type AdScheme = 'dark' | 'pink' | 'light';

export const ROLLERZ = { pink: '#db3b7c', ink: '#1b1b1f', paper: '#dfdfd7' };
const SCHEMES: Record<AdScheme, { bg: string; mark: string; text: string }> = {
  dark: { bg: ROLLERZ.ink, mark: ROLLERZ.pink, text: ROLLERZ.paper },
  pink: { bg: ROLLERZ.pink, mark: ROLLERZ.ink, text: '#ffffff' },
  light: { bg: ROLLERZ.paper, mark: ROLLERZ.pink, text: ROLLERZ.ink },
};

/** The "R" mark in a unit square: a solid bowl over a hollow, slanted counter, with the leg kicking out bottom right. */
function markPath(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const P = (u: number, v: number): [number, number] => [x + u * s, y + v * s];
  g.beginPath();
  g.moveTo(...P(0, 0)); g.lineTo(...P(0.55, 0));
  // the bowl: round at the right, meeting the leg underneath
  g.arc(x + 0.55 * s, y + 0.295 * s, 0.295 * s, -Math.PI / 2, (80 * Math.PI) / 180);
  g.lineTo(...P(1, 1)); g.lineTo(...P(0.346, 1)); g.lineTo(...P(0, 0.654)); g.closePath();
  // the counter (cut out)
  g.moveTo(...P(0.082, 0.21)); g.lineTo(...P(0.79, 0.913)); g.lineTo(...P(0.38, 0.913)); g.lineTo(...P(0.082, 0.62)); g.closePath();
}

/** The wordmark's letters, drawn as strokes in cap-height units (0 = cap line, 1 = baseline): a squared, slightly
 *  rounded face like the logo's. [advance, strokes] per letter; each stroke is a polyline. */
const GLYPHS: Array<[number, Array<Array<[number, number]>>]> = [
  [0.8, [[[0.1, 1], [0.1, 0.1], [0.6, 0.1], [0.7, 0.2], [0.7, 0.41], [0.6, 0.51], [0.1, 0.51]], [[0.56, 0.51], [0.7, 0.62], [0.7, 1]]]], // R
  [0.7, [[[0.19, 0.38], [0.51, 0.38], [0.6, 0.47], [0.6, 0.81], [0.51, 0.9], [0.19, 0.9], [0.1, 0.81], [0.1, 0.47], [0.19, 0.38]]]], // o
  [0.22, [[[0.11, 0], [0.11, 1]]]], // l
  [0.22, [[[0.11, 0], [0.11, 1]]]], // l
  [0.74, [[[0.64, 0.64], [0.64, 0.47], [0.55, 0.38], [0.19, 0.38], [0.1, 0.47], [0.1, 0.81], [0.19, 0.9], [0.64, 0.9]], [[0.1, 0.64], [0.64, 0.64]]]], // e
  [0.55, [[[0.1, 1], [0.1, 0.47], [0.19, 0.38], [0.55, 0.38]]]], // r
  [0.63, [[[0.02, 0.38], [0.6, 0.38], [0.06, 0.9], [0.63, 0.9]]]], // z
];
const GAPS = [0.16, 0.16, 0.18, 0.16, 0.15, 0.04];

/** The logo with its left edge at x, centred on cy, `h` tall (the mark's height). Returns its width. */
export function drawLogo(g: CanvasRenderingContext2D, x: number, cy: number, h: number, scheme: AdScheme = 'dark'): number {
  const c = SCHEMES[scheme];
  g.save();
  g.fillStyle = c.mark; markPath(g, x, cy - h / 2, h);
  try { g.fill('evenodd'); } catch { g.fill(); }
  // the wordmark: cap height about half the mark's, its middle level with the mark's
  const cap = h * 0.52; const top = cy - cap * 0.56; let tx = x + h * 1.42;
  g.strokeStyle = c.text; g.lineWidth = cap * 0.185; g.lineJoin = 'round'; g.lineCap = 'butt';
  GLYPHS.forEach(([adv, strokes], i) => {
    for (const st of strokes) { g.beginPath(); st.forEach(([u, v], k) => { const px = tx + u * cap, py = top + (v === 0 ? 0 : v === 1 ? cap : v * cap); if (k) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); }
    tx += (adv + (GAPS[i] ?? 0)) * cap;
  });
  g.restore();
  return tx - x;
}
/** The logo's width for a mark `h` tall. */
export const logoWidth = (h: number) => h * 1.42 + h * 0.52 * (GLYPHS.reduce((a, [w]) => a + w, 0) + GAPS.reduce((a, b) => a + b, 0));

const cache = new Map<string, THREE.CanvasTexture>();
/** An LED board's Rollerz art: the logo repeated along the board on the scheme's background. Scroll it by moving
 *  `offset.x`. `len` and `height` are the board's size in metres. */
export function rollerzBoard(scheme: AdScheme, len: number, height: number): THREE.CanvasTexture {
  const key = `${scheme}:${len.toFixed(2)}:${height}`; const hit = cache.get(key); if (hit) return hit;
  const H = 128, W = 1024; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const tileM = (W / H) * height; // (the art keeps its proportions on the board)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.wrapS = THREE.RepeatWrapping; t.repeat.x = Math.max(1, Math.round(len / tileM));
  if (g) {
    const s = SCHEMES[scheme];
    g.fillStyle = s.bg; g.fillRect(0, 0, W, H);
    // two logos per tile, so it reads as a rolling strip
    const h = H * 0.72; for (const cx of [W * 0.25, W * 0.75]) drawLogo(g, cx - logoWidth(h) / 2, H / 2, h, scheme);
  }
  t.needsUpdate = true; cache.set(key, t); return t;
}
