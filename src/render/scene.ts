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
  time = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas'); this.canvas.id = 'stage';
    parent.appendChild(this.canvas);
    this.quality = this.resolveQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = q === 'high';
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the pitch readable in portrait by widening the vertical FOV.
    this.camera.fov = this.camera.aspect < 1 ? 62 : this.camera.aspect < 1.5 ? 50 : 42;
    this.camera.updateProjectionMatrix();
  }
  setScene(scene: THREE.Scene | null, frame: ((dt: number, time: number) => void) | null) {
    this.scene = scene; this.frame = frame;
  }
  setFilter(on: boolean) { this.canvas.classList.toggle('stage-filter', on); }
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now; this.time += dt;
    try { this.frame?.(dt, this.time); } catch (e) { console.error(e); }
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
