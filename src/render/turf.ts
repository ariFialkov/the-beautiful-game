import * as THREE from 'three';
import type { PitchSpec } from '../game/pitch';
import type { Match } from '../game/match';

/** Natural turf, Premier League style.
 *
 *  - The surface: the painted pitch (lines and a faint stripe base) under fine blade detail and broad mottling, and the
 *    mowing stripes as real lawns show them - not paint, but light: each stripe was mown the other way along the pitch, so
 *    its blades lean the other way and it reads light or dark depending on where you look from.
 *  - Trails: a map of the pitch that the players' boots, slides, falls and the rolling ball brush as they go. Brushed
 *    grass leans the way it was pushed (so it catches the light differently, like a footprint across a stripe), is a
 *    little flattened and crushed, and slowly stands back up. Wet grass marks more and recovers slower; snow most of all.
 *  - Blades: up close, layers of grass ("shells") rise from the surface, swaying in the wind (stronger in rain and snow),
 *    trodden down where the trails are. They follow the camera's focus and fade out with distance, where the surface's
 *    own detail takes over.
 */

type Weather = 'none' | 'rain' | 'snow' | string;

function noiseTexture(size: number, blades: boolean): THREE.DataTexture {
  // value noise with a little clustering (tufts), wrapped for tiling
  const data = new Uint8Array(size * size * 4);
  let seed = blades ? 7 : 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const base = new Float32Array(size * size); for (let i = 0; i < base.length; i++) base[i] = rnd();
  const at = (x: number, y: number) => base[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v: number;
    if (blades) v = at(x, y) * 0.75 + (at(x + 1, y) + at(x, y + 1) + at(x - 1, y) + at(x, y - 1)) * 0.0625; // crisp blades, loosely clustered
    else { // short blade strokes for the surface: smeared along one axis, a touch of cross-grain
      v = 0; for (let k = -2; k <= 2; k++) v += at(x, y + k) * (k === 0 ? 0.3 : 0.175); v = v * 0.85 + at(x + 1, y) * 0.15;
    }
    const b = Math.max(0, Math.min(255, Math.round(v * 255)));
    const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = b; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = blades ? THREE.NearestFilter : THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

// Shared shader pieces: where we are on the pitch, the detail, the stripes' sheen, the trail.
const COMMON = /* glsl */ `
uniform sampler2D uDetail; uniform sampler2D uTrail; uniform vec2 uHalf; uniform float uStripeW;
uniform float uSheen; uniform float uWet; uniform float uSnow;
varying vec3 vTW;
float turfBrush(out vec2 bdir) {
  vec4 tr = texture2D(uTrail, vec2(vTW.x / (uHalf.x * 2.0) + 0.5, 0.5 - vTW.z / (uHalf.y * 2.0)));
  bdir = tr.gb * 2.0 - 1.0;
  return clamp((tr.r - 0.06) / 0.94, 0.0, 1.0); // (below the canvas's rounding floor: none)
}
vec3 turfShade(vec3 col, float brush, vec2 bdir) {
  float d = texture2D(uDetail, vTW.xz / 1.4).r, d2 = texture2D(uDetail, vTW.xz / 11.0 + 0.37).r, d3 = texture2D(uDetail, vTW.xz / 37.0 + 0.71).r;
  // natural grass: deeper and less saturated than paint, blade to blade a little yellower or bluer
  float lum = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(lum), col, 0.78) * vec3(0.9, 0.94, 0.8);
  col *= mix(vec3(0.86, 0.88, 0.74), vec3(1.05, 1.06, 1.02), d);
  col *= (0.9 + 0.2 * d) * (0.93 + 0.14 * d2) * (0.95 + 0.1 * d3);
  // mowing: stripes across the pitch, each mown along it the other way - the blades lean with the mower
  float band = floor((vTW.x + uHalf.x) / uStripeW); float mow = mod(band, 2.0) < 0.5 ? 1.0 : -1.0;
  vec2 lean = mix(vec2(0.0, mow), bdir, clamp(brush * 2.0, 0.0, 1.0));
  lean /= max(0.001, length(lean));
  vec3 V = normalize(cameraPosition - vTW); vec2 vxz = V.xz / max(0.001, length(V.xz));
  float grazing = 1.0 - 0.55 * V.y; // (seen low across the pitch, the stripes stand out most)
  col *= 1.0 - uSheen * (1.0 + 0.6 * clamp(brush * 2.0, 0.0, 1.0)) * dot(vxz, lean) * grazing; // looking along the lean: the blades' light backs; against it: dark (pushed-over grass most of all)
  col *= 1.0 + brush * (0.17 - 0.36 * uWet);      // trodden: bent blades show their pale backs; wet, they lie flat and dark
  col = mix(col, col * vec3(0.62, 0.78, 0.6), brush * uSnow * 0.9); // (in snow, a footprint shows the grass through)
  return col;
}
`;

function injectVertex(shader: THREE.WebGLProgramParametersWithUniforms, shells: boolean) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vTW;\n${shells ? 'uniform float uShellH; uniform vec2 uWind; uniform float uTime; varying float vFrac;' : ''}`)
    .replace('#include <begin_vertex>', shells ? `#include <begin_vertex>
      vFrac = instanceMatrix[3].y / uShellH;
      { // the blades sway: more at the tips, in waves across the pitch, with gusts
        vec2 wp = (modelMatrix * vec4(transformed, 1.0)).xz;
        float wave = sin(uTime * 1.9 + dot(wp, vec2(0.31, 0.23))) * 0.6 + sin(uTime * 3.7 + dot(wp, vec2(-0.47, 0.61))) * 0.4;
        float gust = 0.65 + 0.35 * sin(uTime * 0.37 + wp.x * 0.05);
        transformed.xz += uWind * (0.4 + 0.6 * wave) * gust * vFrac * vFrac;
      }` : '#include <begin_vertex>')
    .replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vTW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
}

export class Turf {
  readonly group = new THREE.Group();
  readonly base: THREE.MeshLambertMaterial;
  private shellMat: THREE.MeshLambertMaterial | null = null;
  private shells: THREE.InstancedMesh | null = null;
  private uniforms: Record<string, THREE.IUniform>;
  private trail: HTMLCanvasElement; private tctx: CanvasRenderingContext2D; private trailTex: THREE.CanvasTexture;
  private sx: number; private sy: number;
  private wind: THREE.Vector2; private windStrength: number;
  private wetness: number; private markMul: number; private recover: number;
  private uploadEvery = 8; private stampAcc = 0; private decayAcc = 0; private dirty = false; private frame = 0;
  private lastFoot = new Map<object, { t: number; side: number }>();
  private lastBall: { x: number; z: number } | null = null; private lastBallVy = 0;
  private readonly shellH = 0.028;

  constructor(private spec: PitchSpec, map: THREE.Texture, weather: Weather, shellCount: number) {
    const { length: L, width: W } = spec;
    // the trail map: one texel per 10 cm or so
    const TRAIL_W = shellCount > 0 ? 1024 : 512; this.uploadEvery = shellCount > 0 ? 8 : 12; // (a lighter map, sent less often, on low-end devices)
    this.trail = document.createElement('canvas'); this.trail.width = TRAIL_W; this.trail.height = Math.round(TRAIL_W * W / L);
    this.tctx = this.trail.getContext('2d')!; this.tctx.fillStyle = 'rgb(0,128,128)'; this.tctx.fillRect(0, 0, this.trail.width, this.trail.height);
    this.sx = this.trail.width / L; this.sy = this.trail.height / W;
    this.trailTex = new THREE.CanvasTexture(this.trail); this.trailTex.minFilter = THREE.LinearFilter; this.trailTex.generateMipmaps = false;
    const snow = weather === 'snow', rain = weather === 'rain';
    this.wetness = rain ? 1 : snow ? 0.6 : 0;
    this.markMul = snow ? 1.9 : rain ? 1.5 : weather === 'firm' ? 0.75 : 1;
    this.recover = snow ? 0.0012 : rain ? 0.0024 : 0.004; // (per second: a mark takes minutes to stand back up - longer wet, longest in snow) // (per second: snow and wet turf hold marks far longer)
    const a = Math.random() * Math.PI * 2; this.wind = new THREE.Vector2(Math.cos(a), Math.sin(a));
    this.windStrength = rain ? 1 : snow ? 0.75 : weather === 'firm' ? 0.3 : 0.45;
    this.uniforms = {
      uDetail: { value: noiseTexture(256, false) }, uTrail: { value: this.trailTex }, uHalf: { value: new THREE.Vector2(L / 2, W / 2) },
      uStripeW: { value: L / 14 }, uSheen: { value: rain ? 0.15 : 0.11 }, uWet: { value: this.wetness }, uSnow: { value: snow ? 1 : 0 },
      uBlade: { value: noiseTexture(256, true) }, uShellH: { value: this.shellH }, uWind: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uFade: { value: new THREE.Vector2(9, 22) }, uPatch: { value: new THREE.Vector3(0, 0, 22) },
    };
    const u = this.uniforms;
    // the surface
    this.base = new THREE.MeshLambertMaterial({ map });
    this.base.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u); injectVertex(shader, false);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${COMMON}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n{ vec2 bd; float br = turfBrush(bd); diffuseColor.rgb = turfShade(diffuseColor.rgb, br, bd) * 0.93; }`);
    };
    this.base.customProgramCacheKey = () => 'turf-base';
    const geo = new THREE.PlaneGeometry(L, W, 1, 1); geo.rotateX(-Math.PI / 2);
    const surf = new THREE.Mesh(geo, this.base); surf.receiveShadow = true; this.group.add(surf);
    // the blades
    if (shellCount > 0) {
      const sm = new THREE.MeshLambertMaterial({ map });
      sm.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, u); injectVertex(shader, true);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${COMMON}\nuniform sampler2D uBlade; uniform vec2 uFade; uniform vec3 uPatch; varying float vFrac;`)
          .replace('#include <map_fragment>', `diffuseColor *= texture2D(map, vec2(vTW.x / (uHalf.x * 2.0) + 0.5, 0.5 - vTW.z / (uHalf.y * 2.0))); // (the pitch's own paint, by position)
          {
            vec2 bd; float br = turfBrush(bd);
            float n = texture2D(uBlade, vTW.xz * 1.1).r;
            float h = n * (1.0 - br * 0.8);                                  // trodden grass stands lower
            float camD = distance(cameraPosition, vTW);
            float near = smoothstep(uFade.y, uFade.x, camD);                 // blades up close; the surface takes over further out
            vec2 e = abs(vTW.xz - uPatch.xy) / uPatch.z; float edge = smoothstep(1.0, 0.8, max(e.x, e.y));
            float inside = step(abs(vTW.x), uHalf.x) * step(abs(vTW.z), uHalf.y);
            if (h * near * edge * inside < vFrac * 0.92 + 0.06) discard;
            float hue = fract(n * 7.13);
            // darker at the roots, every blade its own shade - balanced to the surface's own tone on average, and easing to
            // it as the blades fade out with distance (no ring where the blades start)
            float root = mix(mix(0.76, 1.1, vFrac), 0.93, 1.0 - near);
            vec3 tint = mix(vec3(0.84, 0.86, 0.66), vec3(1.04, 1.07, 1.0), hue) / vec3(0.94, 0.965, 0.83);
            diffuseColor.rgb = turfShade(diffuseColor.rgb, br, bd) * root * mix(vec3(1.0), tint, near);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), uSnow * vFrac * vFrac * (1.0 - br) * 0.8); // snow on the tips
            diffuseColor.a = 1.0;
          }`);
      };
      sm.customProgramCacheKey = () => 'turf-shell';
      this.shellMat = sm;
      const sg = new THREE.PlaneGeometry(44, 44, 22, 22); sg.rotateX(-Math.PI / 2);
      const inst = new THREE.InstancedMesh(sg, sm, shellCount);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < shellCount; i++) inst.setMatrixAt(i, m4.makeTranslation(0, (this.shellH * (i + 1)) / shellCount, 0));
      inst.instanceMatrix.needsUpdate = true; inst.receiveShadow = true; inst.frustumCulled = false;
      this.shells = inst; this.group.add(inst);
    }
  }

  /** Weather tint (applied to the surface and the blades alike). */
  tint(color: THREE.Color, emissive?: THREE.Color) {
    for (const m of [this.base, this.shellMat]) { if (!m) continue; m.color.copy(color); if (emissive) m.emissive.copy(emissive); }
  }

  /** Per frame: wind, blades following the camera, and the trail map brushed by the players and the ball. */
  update(dt: number, time: number, camera: THREE.Camera, match?: Match) {
    const u = this.uniforms; u.uTime.value = time;
    const gust = this.windStrength * (0.75 + 0.25 * Math.sin(time * 0.23));
    (u.uWind.value as THREE.Vector2).copy(this.wind).multiplyScalar(this.shellH * 0.9 * gust);
    if (this.shells) {
      // the blade patch sits where the camera is looking (snapped, so nothing swims); only when the camera is near enough
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir); const p = camera.position;
      const t = dir.y < -0.05 ? -p.y / dir.y : 30; const fx = p.x + dir.x * Math.min(t, 40), fz = p.z + dir.z * Math.min(t, 40);
      const cx = Math.round(fx * 2) / 2, cz = Math.round(fz * 2) / 2;
      this.shells.position.set(cx, 0, cz); (u.uPatch.value as THREE.Vector3).set(cx, cz, 22);
      const ground = Math.hypot(p.x - cx, p.z - cz); const nearest = Math.max(0, Math.hypot(Math.max(0, ground - 22), p.y));
      this.shells.visible = nearest < (u.uFade.value as THREE.Vector2).y;
    }
    if (match) this.mark(dt, match);
    // recovery: the trodden grass slowly stands up again (in steps the canvas's 8 bits can resolve)
    // (applied in steps of at least 4%: smaller ones vanish in the canvas's 8-bit rounding and leave marks stuck)
    this.decayAcc += dt;
    if (this.decayAcc * this.recover >= 0.04) {
      const a = Math.min(0.5, this.recover * this.decayAcc); this.decayAcc = 0;
      const g = this.tctx; g.globalCompositeOperation = 'source-over'; g.fillStyle = `rgba(0,128,128,${a})`; g.fillRect(0, 0, this.trail.width, this.trail.height); this.dirty = true;
    }
    if (this.dirty && (++this.frame % this.uploadEvery === 0)) { this.trailTex.needsUpdate = true; this.dirty = false; }
  }

  /** A brush mark: an ellipse `len` x `wid` metres, along `dir`, of strength `amt` (0..1). */
  private stamp(x: number, z: number, dx: number, dz: number, len: number, wid: number, amt: number) {
    const { length: L, width: W } = this.spec;
    if (Math.abs(x) > L / 2 || Math.abs(z) > W / 2) return;
    const a = Math.min(1, amt * this.markMul); if (a < 0.02) return;
    const l = Math.hypot(dx, dz) || 1; const ux = dx / l, uz = dz / l;
    const g = this.tctx; const px = (x + L / 2) * this.sx, py = (z + W / 2) * this.sy;
    g.save(); g.translate(px, py); g.rotate(Math.atan2(uz * this.sy, ux * this.sx));
    g.fillStyle = `rgba(255,${Math.round(127.5 + 127.5 * ux)},${Math.round(127.5 + 127.5 * uz)},${a})`;
    g.beginPath(); g.ellipse(0, 0, Math.max(0.6, (len / 2) * this.sx), Math.max(0.6, (wid / 2) * this.sy), 0, 0, Math.PI * 2); g.fill(); g.restore();
    this.dirty = true;
  }

  private mark(dt: number, m: Match) {
    this.stampAcc += dt; if (this.stampAcc < 1 / 30) return; const step = this.stampAcc; this.stampAcc = 0;
    const now = m.time;
    for (const a of m.agents) {
      const sp = a.speed(); const act = a.action?.type;
      if (act === 'slide' && sp > 1) { this.stamp(a.pos.x, a.pos.z, a.vel.x, a.vel.z, Math.max(0.6, sp * step * 1.2), 0.45, 0.75); continue; } // a slide tears a streak
      if ((act === 'dive' || act === 'fallen') && a.action!.t > 0.25 && a.action!.t < 0.45) { this.stamp(a.pos.x, a.pos.z, a.vel.x || a.heading.x, a.vel.z || a.heading.z, 1.4, 0.55, 0.5); continue; }
      if (sp < 1.2) continue;
      // footsteps, alternating feet, more often the faster he goes; a hard cut plants and drags
      const f = this.lastFoot.get(a) ?? { t: 0, side: 1 }; const every = Math.max(0.11, 0.42 - sp * 0.035);
      if (now - f.t < every) continue;
      f.t = now; f.side = -f.side; this.lastFoot.set(a, f);
      const ux = a.vel.x / sp, uz = a.vel.z / sp; const off = 0.11 * f.side;
      const cut = a.agileT > 0 ? 0.35 : 0;
      // (a stride's brush: the boot pushes the blades along the way he runs - his route leaves a faint lane)
      this.stamp(a.pos.x - uz * off, a.pos.z + ux * off, a.vel.x, a.vel.z, 0.45 + sp * 0.06, 0.2, 0.28 + 0.4 * Math.min(1, sp / 8.5) + cut);
      if (cut > 0) this.stamp(a.pos.x, a.pos.z, a.vel.x, a.vel.z, 0.5, 0.32, 0.45); // (a hard plant scuffs)
    }
    // the ball rolling (and its landings)
    const b = m.ball; const onGround = b.y < b.radius + 0.04 && !b.held; const bs = Math.hypot(b.vx, b.vz);
    if (onGround && bs > 1) {
      const last = this.lastBall ?? { x: b.x, z: b.z }; const d = Math.hypot(b.x - last.x, b.z - last.z);
      if (d > 0.12) { const n = Math.min(8, Math.ceil(d / 0.25)); for (let i = 1; i <= n; i++) { const k = i / n; this.stamp(last.x + (b.x - last.x) * k, last.z + (b.z - last.z) * k, b.vx, b.vz, Math.max(0.25, d / n + 0.1), 0.16, 0.12 + 0.3 * Math.min(1, bs / 20)); } this.lastBall = { x: b.x, z: b.z }; }
    } else this.lastBall = onGround ? { x: b.x, z: b.z } : null;
    if (b.y < b.radius + 0.08 && this.lastBallVy < -3 && b.vy >= 0) this.stamp(b.x, b.z, b.vx || 1, b.vz, 0.4, 0.3, 0.35); // a landing
    this.lastBallVy = b.vy;
  }
}
