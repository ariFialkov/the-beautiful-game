import * as THREE from 'three';
import type { Weather } from '../game/surface';

/** Falling rain streaks or snowflakes in a volume that follows the camera. */
export class WeatherFx {
  object: THREE.Object3D | null = null;
  private pos: Float32Array | null = null;
  private vel: Float32Array | null = null;
  private count = 0;
  private readonly box = { x: 70, y: 32, z: 60 };
  constructor(public kind: Weather, lowDetail: boolean) {
    if (kind !== 'rain' && kind !== 'snow') return;
    this.count = kind === 'rain' ? (lowDetail ? 1400 : 3200) : (lowDetail ? 900 : 2200);
    const n = this.count; this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * this.box.x; this.pos[i * 3 + 1] = Math.random() * this.box.y; this.pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
      if (kind === 'rain') { this.vel[i * 3] = 1.5; this.vel[i * 3 + 1] = -(16 + Math.random() * 6); this.vel[i * 3 + 2] = 0.8; }
      else { this.vel[i * 3] = (Math.random() - 0.5) * 0.8; this.vel[i * 3 + 1] = -(1.1 + Math.random() * 0.9); this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.8; }
    }
    if (kind === 'rain') {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      this.object = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaec3d8, transparent: true, opacity: 0.38, depthWrite: false }));
    } else {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      this.object = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }));
    }
    this.object.frustumCulled = false;
  }
  update(dt: number, center: THREE.Vector3, time: number) {
    if (!this.object || !this.pos || !this.vel) return;
    const P = this.pos, V = this.vel; const attr = (this.object as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute; const out = attr.array as Float32Array;
    const { x: bx, y: by, z: bz } = this.box;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      P[k] += V[k] * dt + (this.kind === 'snow' ? Math.sin(time * 0.8 + i) * 0.15 * dt : 0); P[k + 1] += V[k + 1] * dt; P[k + 2] += V[k + 2] * dt;
      if (P[k + 1] < 0) { P[k + 1] += by; P[k] = (Math.random() - 0.5) * bx; P[k + 2] = (Math.random() - 0.5) * bz; }
      // wrap around the camera so the volume follows the view
      const wx = ((P[k] + bx / 2) % bx + bx) % bx - bx / 2, wz = ((P[k + 2] + bz / 2) % bz + bz) % bz - bz / 2;
      const x = center.x + wx, y = P[k + 1], z = center.z + wz;
      if (this.kind === 'rain') { const j = i * 6; out[j] = x; out[j + 1] = y; out[j + 2] = z; out[j + 3] = x - V[k] * 0.035; out[j + 4] = y - V[k + 1] * 0.035; out[j + 5] = z - V[k + 2] * 0.035; }
      else { out[k] = x; out[k + 1] = y; out[k + 2] = z; }
    }
    attr.needsUpdate = true;
  }
}
