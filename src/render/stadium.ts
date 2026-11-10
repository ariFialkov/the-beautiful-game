import * as THREE from 'three';
import type { Team } from '@shared/teams';
import { pitchTexture, textTexture } from './kits';

import type { PitchSpec } from '../game/pitch';

export class Stadium {
  group = new THREE.Group();
  private crowd: THREE.InstancedMesh | null = null;
  private crowdBase: Float32Array | null = null;
  private crowdPhase: Float32Array | null = null;
  private excitement = 0;
  readonly lights: THREE.Group = new THREE.Group();
  pitchMaterial!: THREE.MeshLambertMaterial;

  constructor(public spec: PitchSpec, home: Team, away: Team, public night: boolean, lowDetail: boolean) {
    const { length: L, width: W } = spec;
    // Pitch surface + surrounding grass apron
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: night ? 0x1a2230 : 0x5c6670 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; this.group.add(ground);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(L + 30, W + 30), new THREE.MeshLambertMaterial({ color: spec.futsal ? 0x1c2a44 : 0x2a7a37 }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; apron.receiveShadow = true;
    this.group.add(apron);
    this.pitchMaterial = new THREE.MeshLambertMaterial({ map: pitchTexture(L, W, spec.futsal) });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(L, W), this.pitchMaterial);
    pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0; pitch.receiveShadow = true;
    this.group.add(pitch);

    for (const s of [-1, 1]) this.group.add(this.buildGoal(s));
    this.buildStands(home, lowDetail);
    this.buildAdBoards(home, away);
    this.buildFloodlights();
    this.group.add(this.lights);
  }

  private buildGoal(side: number): THREE.Group {
    const { goalWidth: gw, goalHeight: gh, length: L } = this.spec;
    const g = new THREE.Group();
    const depth = this.spec.futsal ? 1.0 : 2.2;
    const post = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const r = 0.06;
    const mk = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, post); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; g.add(m); };
    const postGeo = new THREE.CylinderGeometry(r, r, gh, 8), barGeo = new THREE.CylinderGeometry(r, r, gw + r * 2, 8), backGeo = new THREE.CylinderGeometry(r * 0.6, r * 0.6, depth, 6);
    const x = side * L / 2;
    mk(postGeo, x, gh / 2, -gw / 2); mk(postGeo, x, gh / 2, gw / 2); mk(barGeo, x, gh, 0, Math.PI / 2);
    mk(backGeo, x + side * depth / 2, gh - 0.3, -gw / 2, 0, Math.PI / 2); mk(backGeo, x + side * depth / 2, gh - 0.3, gw / 2, 0, Math.PI / 2);
    mk(postGeo.clone().scale(0.6, (gh - 0.3) / gh, 0.6), x + side * depth, (gh - 0.3) / 2, -gw / 2); mk(postGeo.clone().scale(0.6, (gh - 0.3) / gh, 0.6), x + side * depth, (gh - 0.3) / 2, gw / 2);
    // Net: semi-transparent grid planes
    const net = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, wireframe: true, depthWrite: false });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh - 0.3, Math.round(gw * 3), Math.round(gh * 3)), net); back.position.set(x + side * depth, (gh - 0.3) / 2, 0); back.rotation.y = Math.PI / 2; g.add(back);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(depth, gw, 4, Math.round(gw * 3)), net); top.position.set(x + side * depth / 2, gh - 0.15, 0); top.rotation.set(Math.PI / 2, 0, 0); g.add(top);
    for (const z of [-1, 1]) { const sd = new THREE.Mesh(new THREE.PlaneGeometry(depth, gh - 0.15, 4, 6), net); sd.position.set(x + side * depth / 2, (gh - 0.15) / 2, z * gw / 2); g.add(sd); }
    return g;
  }

  private buildStands(home: Team, lowDetail: boolean) {
    const { length: L, width: W } = this.spec;
    const seatColor = new THREE.Color(home.stadium.seats);
    const concrete = new THREE.MeshLambertMaterial({ color: this.night ? 0x4a5566 : 0x6b7684 });
    const tiers = this.spec.futsal ? 3 : 6; const tierH = 1.3, tierD = 1.6;
    const gap = this.spec.futsal ? 6 : 10;
    const standGroup = new THREE.Group();
    const seatPositions: number[] = [];
    const addStand = (len: number, cx: number, cz: number, rotY: number) => {
      const g = new THREE.Group();
      for (let t = 0; t < tiers; t++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, tierH, tierD), concrete);
        step.position.set(0, tierH / 2 + t * tierH, t * tierD + tierD / 2);
        g.add(step);
        // seats
        const perRow = Math.floor(len / 0.6);
        const rows = 2;
        for (let r = 0; r < rows; r++) for (let i = 0; i < perRow; i += lowDetail ? 2 : 1) {
          const lx = -len / 2 + 0.3 + i * 0.6, ly = tierH + t * tierH + 0.35, lz = t * tierD + 0.4 + r * 0.6;
          // world transform of this stand
          const wx = cx + lx * Math.cos(rotY) + lz * Math.sin(rotY);
          const wz = cz - lx * Math.sin(rotY) + lz * Math.cos(rotY);
          seatPositions.push(wx, ly, wz, rotY);
        }
      }
      // roof
      if (home.stadium.roof) {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.4, tiers * tierD + 3), new THREE.MeshLambertMaterial({ color: 0x2a3340 }));
        roof.position.set(0, tiers * tierH + 6, tiers * tierD / 2 + 0.5); g.add(roof);
        for (const sx of [-1, 1]) { const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, tiers * tierH + 6, 0.6), concrete); pillar.position.set(sx * (len / 2 + 0.5), (tiers * tierH + 6) / 2, tiers * tierD + 1); g.add(pillar); }
      }
      g.position.set(cx, 0, cz); g.rotation.y = rotY;
      standGroup.add(g);
    };
    addStand(L + 10, 0, W / 2 + gap, 0);           // far side
    addStand(L + 10, 0, -W / 2 - gap - 7, Math.PI); // near side (camera side, set back so the broadcast camera clears it)
    addStand(W + 10, L / 2 + gap, 0, Math.PI / 2); // right end
    addStand(W + 10, -L / 2 - gap, 0, -Math.PI / 2); // left end
    this.group.add(standGroup);

    // Crowd: instanced low-poly spectators
    const n = seatPositions.length / 4;
    const geo = new THREE.BoxGeometry(0.4, 0.75, 0.3);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const crowd = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(); const color = new THREE.Color();
    const base = new Float32Array(n * 3); const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = seatPositions[i * 4], y = seatPositions[i * 4 + 1], z = seatPositions[i * 4 + 2], ry = seatPositions[i * 4 + 3];
      // empty seat sometimes shows seat colour; else fan in team colours or random clothing
      const fan = Math.random() < 0.88;
      if (!fan) color.copy(seatColor); else if (Math.random() < 0.55) color.copy(seatColor).offsetHSL(0, 0, (Math.random() - 0.5) * 0.25); else color.setHSL(Math.random(), 0.5, 0.3 + Math.random() * 0.4);
      base[i * 3] = x; base[i * 3 + 1] = fan ? y : y - 0.3; base[i * 3 + 2] = z; phase[i] = Math.random() * Math.PI * 2;
      m.makeRotationY(ry + Math.PI); m.setPosition(x, base[i * 3 + 1], z);
      crowd.setMatrixAt(i, m); crowd.setColorAt(i, color);
    }
    crowd.instanceMatrix.needsUpdate = true; if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    this.crowd = crowd; this.crowdBase = base; this.crowdPhase = phase;
    this.group.add(crowd);
  }

  private buildAdBoards(home: Team, away: Team) {
    const { length: L, width: W } = this.spec;
    const texts = [`${home.name.toUpperCase()}`, 'THE BEAUTIFUL GAME', `${away.name.toUpperCase()}`, home.league.toUpperCase(), 'PLAY · WIN · REPEAT', `${home.stadium.name.toUpperCase()}`];
    const colors = [[home.home.primary, home.home.secondary], ['#07101f', '#19f5a4'], [away.home.primary, away.home.secondary], ['#ffffff', '#111111'], ['#f7c948', '#2a1d00'], [home.home.secondary, home.home.primary]];
    const segs = 6; const segLen = (L + 4) / segs; const h = 0.9;
    for (const side of [-1, 1]) for (let i = 0; i < segs; i++) {
      const k = (i + (side > 0 ? 3 : 0)) % texts.length;
      const t = textTexture(texts[k], colors[k][0], colors[k][1], 1024, 128);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(segLen, h), new THREE.MeshBasicMaterial({ map: t }));
      board.position.set(-(L + 4) / 2 + segLen * (i + 0.5), h / 2 + 0.05, side * (W / 2 + 3.5));
      board.rotation.y = side > 0 ? Math.PI : 0;
      this.group.add(board);
    }
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const k = (i + 2) % texts.length;
      const t = textTexture(texts[k], colors[k][0], colors[k][1], 1024, 128);
      const board = new THREE.Mesh(new THREE.PlaneGeometry((W + 4) / 3, h), new THREE.MeshBasicMaterial({ map: t }));
      board.position.set(side * (L / 2 + 5), h / 2 + 0.05, -(W + 4) / 2 + (W + 4) / 3 * (i + 0.5));
      board.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.group.add(board);
    }
  }

  private buildFloodlights() {
    const { length: L, width: W } = this.spec;
    const mast = new THREE.MeshLambertMaterial({ color: 0x3a4454 });
    const lamp = new THREE.MeshBasicMaterial({ color: this.night ? 0xfff6d0 : 0x9aa3ad });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const h = this.spec.futsal ? 14 : 38;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, h, 8), mast);
      pole.position.set(sx * (L / 2 + 22), h / 2, sz * (W / 2 + 20)); this.lights.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.8), lamp);
      head.position.set(sx * (L / 2 + 22), h + 1, sz * (W / 2 + 20)); head.lookAt(0, 0, 0); this.lights.add(head);
    }
  }

  /** Crowd bounce: excitement 0..1 ramps up after goals. */
  update(dt: number, time: number) {
    if (!this.crowd || !this.crowdBase || !this.crowdPhase) return;
    this.excitement = Math.max(0, this.excitement - dt * 0.35);
    if (this.excitement < 0.02) return;
    const m = new THREE.Matrix4(); const n = this.crowd.count;
    const step = n > 4000 ? 2 : 1;
    for (let i = 0; i < n; i += step) {
      this.crowd.getMatrixAt(i, m);
      const y = this.crowdBase[i * 3 + 1] + Math.max(0, Math.sin(time * 7 + this.crowdPhase[i])) * 0.35 * this.excitement;
      m.elements[13] = y;
      this.crowd.setMatrixAt(i, m);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
  }
  cheer(level = 1) { this.excitement = Math.max(this.excitement, level); }
}
