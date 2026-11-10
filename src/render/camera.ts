import * as THREE from 'three';

export type CamMode = 'broadcast' | 'low' | 'behindGoal' | 'drone' | 'closeup' | 'freekick' | 'showcase';

/** Camera rigs: smoothed broadcast camera for play and cinematic cuts for the highlight tape. */
export class CameraRig {
  mode: CamMode = 'broadcast';
  heightMul = 1;
  private pos = new THREE.Vector3(0, 30, -60);
  private look = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private shake = 0;
  private cutTime = 0;
  private cutSide = 1;
  constructor(private camera: THREE.PerspectiveCamera, public pitchLength: number, public pitchWidth: number) {}

  snap() { this.camera.position.copy(this.pos); this.camera.lookAt(this.look); }
  addShake(v: number) { this.shake = Math.min(1, this.shake + v); }

  /** target = point of interest (ball), lead = direction of play for look-ahead. */
  update(dt: number, target: THREE.Vector3, lead: THREE.Vector3, time: number) {
    const L = this.pitchLength, W = this.pitchWidth;
    const scale = L / 105; // futsal gets a tighter camera
    let desired = new THREE.Vector3(); let desiredLook = new THREE.Vector3();
    switch (this.mode) {
      case 'broadcast': {
        const tx = THREE.MathUtils.clamp(target.x + lead.x * 6, -L / 2 + 10 * scale, L / 2 - 10 * scale);
        const tz = target.z;
        desired.set(tx * 0.9, (26 + tz * 0.1) * this.heightMul * (0.55 + 0.45 * scale), -(W / 2 + 34 * scale) * (0.6 + 0.4 * this.heightMul));
        desiredLook.set(tx, 1.5, THREE.MathUtils.clamp(tz * 0.6, -W / 2, W / 2));
        break;
      }
      case 'low': {
        desired.set(target.x - 6, 3.5, -(W / 2 + 6));
        desiredLook.set(target.x, 1.2, target.z);
        break;
      }
      case 'behindGoal': {
        const s = this.cutSide;
        desired.set(s * (L / 2 + 16), 9, 0);
        desiredLook.set(target.x, 1, target.z);
        break;
      }
      case 'drone': {
        const a = time * 0.12;
        desired.set(Math.cos(a) * (L * 0.55), 32 + Math.sin(time * 0.3) * 4, Math.sin(a) * (W * 0.9));
        desiredLook.set(target.x * 0.5, 0, target.z * 0.5);
        break;
      }
      case 'closeup': {
        const dir = new THREE.Vector3(-lead.x, 0, -lead.z); if (dir.lengthSq() < 0.01) dir.set(0, 0, -1); dir.normalize();
        desired.copy(target).addScaledVector(dir, 7).setY(2.4);
        desiredLook.copy(target).setY(1.2);
        break;
      }
      default: return;
    }
    const stiff = this.mode === 'broadcast' ? 4.5 : this.mode === 'closeup' ? 8 : 2.5;
    this.pos.lerp(desired, 1 - Math.exp(-stiff * dt));
    this.look.lerp(desiredLook, 1 - Math.exp(-(stiff + 2) * dt));
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) { this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6; this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.4; this.shake *= Math.exp(-6 * dt); }
    this.camera.lookAt(this.look);
  }

  /** Cinematic cut scheduler for the highlight tape. */
  cinematic(dt: number, target: THREE.Vector3, lead: THREE.Vector3, time: number) {
    this.cutTime -= dt;
    if (this.cutTime <= 0) {
      const modes: CamMode[] = ['broadcast', 'low', 'behindGoal', 'drone', 'closeup', 'low', 'broadcast'];
      this.mode = modes[Math.floor(Math.random() * modes.length)];
      this.cutSide = target.x > 0 ? 1 : -1;
      this.cutTime = 4 + Math.random() * 5;
      // hard cut: snap position near the desired spot
      this.pos.set(target.x + (Math.random() - 0.5) * 20, 10 + Math.random() * 20, -(this.pitchWidth / 2 + 20));
    }
    this.update(dt, target, lead, time);
  }

  setFixed(pos: THREE.Vector3, look: THREE.Vector3) { this.pos.copy(pos); this.look.copy(look); this.camera.position.copy(pos); this.camera.lookAt(look); }
  moveTo(dt: number, pos: THREE.Vector3, look: THREE.Vector3, stiff = 4) {
    this.pos.lerp(pos, 1 - Math.exp(-stiff * dt)); this.look.lerp(look, 1 - Math.exp(-(stiff + 1) * dt));
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) { this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.4; this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3; this.shake *= Math.exp(-6 * dt); }
    this.camera.lookAt(this.look);
  }
}
