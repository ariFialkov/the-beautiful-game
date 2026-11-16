import * as THREE from 'three';
import { state, isTouchDevice } from '../app/state';

export type QualityLevel = 'low' | 'high';

/** Owns the single WebGL renderer and the currently displayed scene. */
export class Stage {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene | null = null;
  camera: THREE.PerspectiveCamera;
  quality: QualityLevel;
  private raf = 0;
  private last = performance.now();
  private frame: ((dt: number, time: number) => void) | null = null;
  preFrame: (() => void) | null = null;
  time = 0;
  /** Dynamic resolution (phones and tablets): the pixel ratio climbs while the frame rate holds, and steps back down
   *  (and stays under the level that was too much) if it dips. */
  private dyn = { ratio: 1.25, ceil: 2, avg: 1 / 60, t: 0 };

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas'); this.canvas.id = 'stage';
    parent.appendChild(this.canvas);
    this.quality = this.resolveQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.baseRatio());
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 600);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.loop();
  }
  resolveQuality(): QualityLevel {
    const q = state.settings.quality;
    if (q === 'low' || q === 'high') return q;
    return isTouchDevice() ? 'low' : 'high';
  }
  applyQuality() {
    const q = this.resolveQuality();
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(this.baseRatio());
    this.renderer.shadowMap.enabled = q === 'high';
  }
  private baseRatio() {
    const dpr = window.devicePixelRatio || 1;
    if (this.quality === 'high') return Math.min(dpr, 2);
    this.dyn = { ratio: Math.min(dpr, 1.25), ceil: Math.min(dpr, 2), avg: 1 / 60, t: 0 };
    return this.dyn.ratio;
  }
  private adaptResolution(dt: number) {
    if (this.quality !== 'low' || !this.scene) return;
    const d = this.dyn; d.avg += (dt - d.avg) * 0.05; d.t += dt;
    if (d.t < 2) return; // (settle after each change)
    if (d.avg > 1 / 50 && d.ratio > 1) { d.ceil = Math.max(1, d.ratio - 0.25); d.ratio = Math.max(1, d.ratio - 0.25); }
    else if (d.avg < 1 / 57 && d.ratio < d.ceil) d.ratio = Math.min(d.ceil, d.ratio + 0.25);
    else return;
    d.t = 0; this.renderer.setPixelRatio(d.ratio); this.resize();
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the pitch readable in portrait by widening the vertical FOV.
    this.camera.fov = this.camera.aspect < 1 ? 66 : this.camera.aspect < 1.5 ? 54 : 46;
    this.camera.userData.baseFov = this.camera.fov; // the match camera zooms relative to this
    this.camera.updateProjectionMatrix();
  }
  setScene(scene: THREE.Scene | null, frame: ((dt: number, time: number) => void) | null) {
    this.scene = scene; this.frame = frame; this.dyn.t = -3; // (a new scene: let loading hitches pass before judging)
    const base = this.camera.userData.baseFov as number | undefined; // undo any match-camera zoom
    if (base && this.camera.fov !== base) { this.camera.fov = base; this.camera.updateProjectionMatrix(); }
  }
  setFilter(on: boolean) { this.canvas.classList.toggle('stage-filter', on); }
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now; this.time += dt; this.adaptResolution(dt);
    try { this.preFrame?.(); this.frame?.(dt, this.time); } catch (e) { console.error(e); }
    if (this.scene) this.renderer.render(this.scene, this.camera);
  };
  dispose() { cancelAnimationFrame(this.raf); }
}

export function makeLighting(scene: THREE.Scene, night: boolean, shadows: boolean, size = 60): { sun: THREE.DirectionalLight } {
  scene.background = new THREE.Color(night ? 0x060a14 : 0x9fd3ff);
  scene.fog = new THREE.Fog(night ? 0x060a14 : 0xa8d4f5, 140, 420);
  const hemi = new THREE.HemisphereLight(night ? 0x8fa8ff : 0xcfe8ff, night ? 0x202a3a : 0x3f6b3f, night ? 0.9 : 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(night ? 0xfff2cc : 0xffffff, night ? 2.4 : 2.8);
  sun.position.set(-40, 70, -50);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
    sun.shadow.camera.left = -size; sun.shadow.camera.right = size; sun.shadow.camera.top = size; sun.shadow.camera.bottom = -size;
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
  }
  scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight(night ? 0xc0d0ff : 0xdfe9ff, night ? 0.9 : 0.5);
  fill.position.set(50, 40, 60);
  scene.add(fill);
  const amb = new THREE.AmbientLight(night ? 0x303a55 : 0x405a40, night ? 0.9 : 0.35);
  scene.add(amb);
  return { sun };
}
