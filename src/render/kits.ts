import * as THREE from 'three';
import type { Kit } from '@shared/teams';

const cache = new Map<string, THREE.CanvasTexture>();

export function drawPattern(ctx: CanvasRenderingContext2D, kit: Kit, w: number, h: number) {
  ctx.fillStyle = kit.primary; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = kit.secondary;
  switch (kit.pattern) {
    case 'stripes': for (let x = 0; x < w; x += w / 5) ctx.fillRect(x, 0, w / 10, h); break;
    case 'hoops': for (let y = 0; y < h; y += h / 5) ctx.fillRect(0, y, w, h / 10); break;
    case 'sash': ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w * 0.28, 0); ctx.lineTo(w, h * 0.72); ctx.lineTo(w, h); ctx.lineTo(w * 0.72, h); ctx.lineTo(0, h * 0.28); ctx.closePath(); ctx.fill(); break;
    case 'halves': ctx.fillRect(w / 2, 0, w / 2, h); break;
    case 'pinstripe': for (let x = w / 12; x < w; x += w / 6) ctx.fillRect(x, 0, w / 60, h); break;
    case 'chevron': ctx.beginPath(); ctx.moveTo(0, h * 0.35); ctx.lineTo(w / 2, h * 0.6); ctx.lineTo(w, h * 0.35); ctx.lineTo(w, h * 0.5); ctx.lineTo(w / 2, h * 0.75); ctx.lineTo(0, h * 0.5); ctx.closePath(); ctx.fill(); break;
    default: break;
  }
  // subtle fabric sheen
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

function tex(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function shirtTexture(kit: Kit, key: string): THREE.CanvasTexture {
  const k = `front:${key}`;
  let t = cache.get(k);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  drawPattern(ctx, kit, 128, 128);
  // small crest patch
  ctx.fillStyle = kit.secondary; ctx.beginPath(); ctx.arc(92, 34, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = kit.primary; ctx.beginPath(); ctx.arc(92, 34, 5, 0, Math.PI * 2); ctx.fill();
  t = tex(c); cache.set(k, t); return t;
}

export function shirtBackTexture(kit: Kit, key: string, number: number, name: string): THREE.CanvasTexture {
  const k = `back:${key}:${number}:${name}`;
  let t = cache.get(k);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  drawPattern(ctx, kit, 128, 128);
  const ink = contrastColor(kit.primary);
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 14px Arial'; ctx.fillText(name.toUpperCase().slice(0, 12), 64, 24);
  ctx.font = '900 64px Arial Black, Arial'; ctx.fillText(String(number), 64, 74);
  t = tex(c); cache.set(k, t); return t;
}

export function contrastColor(hex: string): string {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return lum > 0.5 ? '#111111' : '#ffffff';
}

export function keeperKit(home: Kit, away: Kit): Kit {
  const options = ['#2bd34a', '#ff8c1a', '#f0e130', '#8e44ad', '#19f5a4'];
  const dist = (a: string, b: string) => { const ca = new THREE.Color(a), cb = new THREE.Color(b); return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b); };
  const best = options.map((o) => ({ o, d: Math.min(dist(o, home.primary), dist(o, away.primary), dist(o, home.secondary)) })).sort((a, b) => b.d - a.d)[0].o;
  return { primary: best, secondary: '#111111', shorts: '#111111', socks: best, pattern: 'solid' };
}

/** Procedural pitch texture: mown stripes + line markings. */
export function pitchTexture(length: number, width: number, futsal: boolean): THREE.CanvasTexture {
  const key = `pitch:${length}:${width}:${futsal}`;
  let t = cache.get(key);
  if (t) return t;
  const W = 2048, H = Math.round(2048 * width / length);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const sx = W / length, sy = H / width; // px per metre
  if (futsal) { ctx.fillStyle = '#2b6cb0'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = 'rgba(255,255,255,0.04)'; for (let x = 0; x < W; x += 64) ctx.fillRect(x, 0, 32, H); }
  else {
    const stripes = 14;
    // (a faint painted stripe: the turf shader makes the real ones, from the way each was mown)
    for (let i = 0; i < stripes; i++) { ctx.fillStyle = i % 2 ? '#2f8f3f' : '#339a44'; ctx.fillRect((i * W) / stripes, 0, W / stripes + 1, H); }
    // wear: the goalmouths and the centre spot take a beating
    const wear = (xm: number, zm: number, r: number, a: number) => { const gr = ctx.createRadialGradient((xm + length / 2) * sx, (zm + width / 2) * sy, 0, (xm + length / 2) * sx, (zm + width / 2) * sy, r * sx); if (!gr) return; gr.addColorStop(0, `rgba(150,140,80,${a})`); gr.addColorStop(1, 'rgba(150,140,80,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); };
    if (typeof ctx.createRadialGradient === 'function') { // (a bare test canvas may not draw gradients)
      for (const s of [-1, 1]) { wear(s * (length / 2 - 3), 0, 5, 0.22); wear(s * (length / 2 - 11), 0, 3, 0.12); }
      wear(0, 0, 4, 0.1);
    }
  }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(3, 0.12 * sx); ctx.lineCap = 'round';
  const m = 0; // margin in metres
  const L = length - m * 2, Wd = width - m * 2;
  const X = (xm: number) => (xm + length / 2) * sx, Y = (zm: number) => (zm + width / 2) * sy;
  ctx.strokeRect(X(-L / 2), Y(-Wd / 2), L * sx, Wd * sy);
  ctx.beginPath(); ctx.moveTo(X(0), Y(-Wd / 2)); ctx.lineTo(X(0), Y(Wd / 2)); ctx.stroke();
  const circleR = futsal ? 3 : 9.15;
  ctx.beginPath(); ctx.ellipse(X(0), Y(0), circleR * sx, circleR * sy, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(X(0), Y(0), 0.2 * sx, 0.2 * sy, 0, 0, Math.PI * 2); ctx.fill();
  const boxD = futsal ? 6 : 16.5, boxW = futsal ? 16 : 40.3, sixD = futsal ? 0 : 5.5, sixW = futsal ? 0 : 18.3, penD = futsal ? 6 : 11;
  for (const s of [-1, 1]) {
    const gx = s * L / 2;
    ctx.strokeRect(Math.min(X(gx), X(gx - s * boxD)), Y(-boxW / 2), boxD * sx, boxW * sy);
    if (sixD) ctx.strokeRect(Math.min(X(gx), X(gx - s * sixD)), Y(-sixW / 2), sixD * sx, sixW * sy);
    ctx.beginPath(); ctx.ellipse(X(gx - s * penD), Y(0), 0.2 * sx, 0.2 * sy, 0, 0, Math.PI * 2); ctx.fill();
    if (!futsal) { ctx.beginPath(); ctx.ellipse(X(gx - s * penD), Y(0), 9.15 * sx, 9.15 * sy, 0, s > 0 ? Math.PI * 0.72 : -Math.PI * 0.28, s > 0 ? Math.PI * 1.28 : Math.PI * 0.28); ctx.stroke(); }
    for (const z of [-1, 1]) { ctx.beginPath(); ctx.ellipse(X(gx), Y(z * Wd / 2), 1 * sx, 1 * sy, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  t = tex(c); t.anisotropy = 8; cache.set(key, t); return t;
}

export function textTexture(text: string, bg: string, fg: string, w = 1024, h = 128, font = '900 72px Arial Black, Arial'): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2);
  const t = tex(c); t.wrapS = THREE.RepeatWrapping; return t;
}

/** Wrap-around shirt texture for a cylindrical torso: u = 0 is the chest (front), u = 0.5 the back.
 *  The back carries the name and number; the front a crest and a small number. */
export function shirtWrapTexture(kit: Kit, key: string, number: number | null, name: string): THREE.CanvasTexture {
  const k = `wrap:${key}:${number}:${name}`;
  let t = cache.get(k); if (t) return t;
  const W = 512, H = 256; const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  // pattern tiled twice around the body so stripes have a sensible width
  ctx.save(); drawPattern(ctx, kit, W / 2, H); ctx.translate(W / 2, 0); drawPattern(ctx, kit, W / 2, H); ctx.restore();
  if (number !== null) {
    const ink = contrastColor(kit.primary);
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 24px Arial'; ctx.fillText(name.toUpperCase().slice(0, 12), W * 0.5, H * 0.2);
    ctx.font = '900 120px Arial Black, Arial'; ctx.fillText(String(number), W * 0.5, H * 0.58);
    // crest on the left chest (u ≈ 0.1) and a small number on the right chest (u ≈ 0.9)
    ctx.fillStyle = kit.secondary; ctx.beginPath(); ctx.arc(W * 0.1, H * 0.3, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = kit.primary; ctx.beginPath(); ctx.arc(W * 0.1, H * 0.3, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink; ctx.font = '900 34px Arial Black, Arial'; ctx.fillText(String(number), W * 0.9, H * 0.36);
  }
  t = tex(c); cache.set(k, t); return t;
}
