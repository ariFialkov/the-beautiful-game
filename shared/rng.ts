/** Deterministic PRNG utilities shared by server and client.
 *  Every "random" decision that affects a round outcome is derived from a seed
 *  so a round can be replayed and verified. */

export function hashString(str: string): number {
  // FNV-1a 32-bit, then one xorshift round to spread bits.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(seed: number | string) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    // sfc32 seeded via splitmix-ish expansion
    this.a = s ^ 0x9e3779b9; this.b = Math.imul(s, 0x85ebca6b) ^ 0xc2b2ae35; this.c = s + 0x1b873593; this.d = ~s;
    for (let i = 0; i < 12; i++) this.next();
  }
  /** Uniform float in [0, 1). */
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  int(min: number, maxInclusive: number): number { return Math.floor(this.range(min, maxInclusive + 1)); }
  bool(p = 0.5): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  shuffle<T>(arr: T[]): T[] { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  /** Approximately normal via sum of uniforms. */
  gauss(mean = 0, sd = 1): number { let s = 0; for (let i = 0; i < 6; i++) s += this.next(); return mean + (s - 3) * sd; }
  /** Weighted choice from [value, weight] pairs. */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    let total = 0; for (const [, w] of items) total += w;
    let r = this.next() * total;
    for (const [v, w] of items) { r -= w; if (r <= 0) return v; }
    return items[items.length - 1][0];
  }
}

export function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
