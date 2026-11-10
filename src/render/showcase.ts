import * as THREE from 'three';
import type { PlayerCard } from '@shared/types';
import type { Kit } from '@shared/teams';
import { Humanoid, juggleBallHeight } from './humanoid';
import { makeBallMesh } from './matchView';
import type { Stage } from './scene';

/** Menu backdrop: footballers in kit doing idle / juggling animations under studio lights. */
export class Showcase {
  scene = new THREE.Scene();
  private models: Array<{ h: Humanoid; mode: 'idle' | 'juggle'; offset: number }> = [];
  private balls: THREE.Mesh[] = [];
  private floor: THREE.Mesh;
  private orbit = 0;
  constructor(private stage: Stage, accent = '#19f5a4') {
    this.scene.background = new THREE.Color(0x07101f);
    this.scene.fog = new THREE.Fog(0x07101f, 12, 40);
    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x0b1a33, 1.1); this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(4, 8, 6); key.castShadow = stage.quality === 'high';
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(accent), 1.8); rim.position.set(-6, 5, -6); this.scene.add(rim);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), new THREE.MeshStandardMaterial({ color: 0x1f6b35, roughness: 0.9 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true; this.scene.add(this.floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.3, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.7 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; this.scene.add(ring);
  }
  setPlayers(cards: Array<{ card: PlayerCard; kit: Kit; kitKey: string; keeper?: boolean }>) {
    for (const m of this.models) this.scene.remove(m.h.root);
    for (const b of this.balls) this.scene.remove(b);
    this.models = []; this.balls = [];
    const n = cards.length;
    cards.forEach((c, i) => {
      const h = new Humanoid(c.card, c.kit, c.kitKey, c.keeper);
      h.setShadowsReal(this.stage.quality === 'high');
      const x = (i - (n - 1) / 2) * 1.6;
      h.root.position.set(x, 0, 0); h.root.rotation.y = -x * 0.15;
      this.scene.add(h.root);
      const mode = i === Math.floor(n / 2) ? 'juggle' : 'idle';
      this.models.push({ h, mode, offset: Math.random() * 10 });
      if (mode === 'juggle') { const b = makeBallMesh(); this.scene.add(b); this.balls.push(b); b.position.set(x + Math.sin(-x * 0.15) * 0.4, 0.5, 0.45); }
    });
  }
  frame(dt: number, time: number, cameraSide = 0.35) {
    this.orbit += dt * 0.08;
    for (const m of this.models) m.h.puppetUpdate(dt, { state: m.mode, time: time + m.offset });
    for (let i = 0; i < this.balls.length; i++) {
      const juggler = this.models.find((m) => m.mode === 'juggle'); if (!juggler) continue;
      const b = this.balls[i]; const t = time + juggler.offset; const r = juggler.h.root;
      b.position.set(r.position.x + Math.sin(r.rotation.y) * 0.36, juggleBallHeight(t) * juggler.h.scale, r.position.z + Math.cos(r.rotation.y) * 0.36);
      b.rotation.x += dt * 6; b.rotation.z += dt * 1.5;
    }
    const cam = this.stage.camera;
    const r = 6.4, a = Math.sin(this.orbit) * 0.5 + cameraSide;
    cam.position.set(Math.sin(a) * r, 1.9 + Math.sin(this.orbit * 0.7) * 0.2, Math.cos(a) * r);
    cam.lookAt(0, 0.95, 0);
  }
}
