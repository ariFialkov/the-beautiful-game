import * as THREE from 'three';
import type { Kit } from '@shared/teams';

const cache = new Map<string, THREE.CanvasTexture>();

function drawPattern(ctx: CanvasRenderingContext2D, kit: Kit, w: number, h: number) {
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
    for (let i = 0; i < stripes; i++) { ctx.fillStyle = i % 2 ? '#2e8b3d' : '#35a047'; ctx.fillRect((i * W) / stripes, 0, W / stripes + 1, H); }
    // grass noise
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (let i = 0; i < 4000; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 3, 3);
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
