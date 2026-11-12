import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Match } from '../src/game/match';
import { PITCH_11, PITCH_FUTSAL } from '../src/game/pitch';
import { CameraRig } from '../src/render/camera';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

// The camera is measured over a match played by the AI; seed its dice so every run plays (and measures) the same match.
function seedRandom(seed: number) { let x = seed >>> 0; Math.random = () => { x = (x + 0x6d2b79f5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const q = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };

for (const [label, aspect, futsal] of [['landscape 11-a-side', 16 / 9, false], ['portrait phone 11-a-side', 9 / 19.5, false], ['landscape futsal', 16 / 9, true]] as const) {
  test(`broadcast camera is smooth and keeps the ball in shot (${label})`, () => {
    seedRandom(20261112);
    const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
    const five = (x: any[]) => [x[0], x[2], x[8], x[10], x[9]];
    const pitch = futsal ? PITCH_FUTSAL : PITCH_11;
    const m = new Match({ pitch, mode: futsal ? 'futsal' : 'kickoff', humanTeam: null, script: null, durationSec: 600, clockMinutes: 90,
      teams: [{ team: home, players: futsal ? five(startingXI(rosterOf(home.id))) : startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short },
        { team: away, players: futsal ? five(startingXI(rosterOf(away.id))) : startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
    const cam = new THREE.PerspectiveCamera(aspect < 1 ? 66 : 46, aspect, 0.5, 600);
    const rig = new CameraRig(cam, pitch.length, pitch.width);
    rig.setFixed(new THREE.Vector3(0, 12, -(pitch.width / 2 + 9)), new THREE.Vector3(0, 0.4, -3));
    const dt = 1 / 60; const P: THREE.Vector3[] = []; const D: THREE.Vector3[] = []; let inPlay = 0, onScreen = 0;
    for (let i = 0; i < 60 * 90; i++) {
      m.update(dt); const b = m.ball; const al = m.alpha;
      const t = new THREE.Vector3(b.px + (b.x - b.px) * al, b.py + (b.y - b.py) * al, b.pz + (b.z - b.pz) * al);
      rig.update(dt, t, new THREE.Vector3(b.owner ? m.teams[b.owner.team].attackDir : 0, 0, 0), i * dt);
      cam.updateMatrixWorld();
      if (i < 60) continue; // settle
      P.push(cam.position.clone()); const d = new THREE.Vector3(); cam.getWorldDirection(d); D.push(d);
      if (m.phase === 'play') { inPlay++; const n = t.clone().project(cam); if (Math.abs(n.x) < 1 && Math.abs(n.y) < 1) onScreen++; }
    }
    const acc: number[] = []; for (let i = 2; i < P.length; i++) acc.push(P[i].clone().sub(P[i - 1].clone().multiplyScalar(2)).add(P[i - 2]).length() / (dt * dt));
    const aim: number[] = []; for (let i = 1; i < D.length; i++) aim.push((D[i].angleTo(D[i - 1]) / dt) * 180 / Math.PI);
    const r = { accP95: q(acc, 0.95), accP99: q(acc, 0.99), accMax: q(acc, 1), aimP99: q(aim, 0.99), aimMax: q(aim, 1), onScreen: onScreen / inPlay };
    console.log(`  ${label}: acc p95 ${r.accP95.toFixed(1)}, p99 ${r.accP99.toFixed(1)}, max ${r.accMax.toFixed(0)} m/s² · aim p99 ${r.aimP99.toFixed(1)}, max ${r.aimMax.toFixed(1)} °/s · ball on screen ${(r.onScreen * 100).toFixed(1)}%`);
    // The previous camera measured acc p95 81.6, max 2545 m/s² and aim p95 9.2, max 30 °/s on the same kind of run.
    assert.ok(r.accP95 < (aspect < 1 ? 30 : 25), 'camera acceleration stays low'); // narrow portrait framing has to track tighter
    assert.ok(r.accP99 < 60, 'rare peaks stay gentle');
    assert.ok(r.accMax < 200, 'no jarring jumps');
    assert.ok(r.aimP99 < 12, 'no whip pans');
    assert.ok(r.onScreen > 0.99, 'the ball stays in shot');
  });
}

test('the camera moves in and zooms for play on the far side, and widens for the near side', () => {
  seedRandom(7);
  const cam = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 600);
  const rig = new CameraRig(cam, PITCH_11.length, PITCH_11.width);
  const settle = (z: number) => { for (let i = 0; i < 60 * 5; i++) rig.update(1 / 60, new THREE.Vector3(5, 0.1, z), new THREE.Vector3(1, 0, 0), i / 60); return { fov: cam.fov, dist: cam.position.distanceTo(new THREE.Vector3(5, 0, z)) }; };
  const mid = settle(0), far = settle(28), near = settle(-28);
  console.log(`  fov: far ${far.fov.toFixed(1)}°, centre ${mid.fov.toFixed(1)}°, near ${near.fov.toFixed(1)}° · distance to play: far ${far.dist.toFixed(0)} m, centre ${mid.dist.toFixed(0)} m, near ${near.dist.toFixed(0)} m`);
  assert.ok(Math.abs(mid.fov - 46 * 0.82) < 1.5, 'centre play: the Tele framing (tighter than the base lens)');
  assert.ok(far.fov < mid.fov * 0.85, 'far side: zoomed in');
  assert.ok(far.dist < 60, 'far side: the camera has moved in toward the play');
  assert.ok(near.fov > mid.fov, 'near side: a little wider');
  // the ball stays in shot in each case
  for (const z of [28, -28, 0]) { settle(z); cam.updateMatrixWorld(); const n = new THREE.Vector3(5, 0.1, z).project(cam); assert.ok(Math.abs(n.x) < 0.9 && Math.abs(n.y) < 0.9, `ball in shot at z ${z}`); }
});

for (const style of ['high', 'ball', 'end'] as const) for (const futsal of [false, true]) {
  test(`the ${style} camera follows play smoothly and keeps the ball in shot (${futsal ? 'futsal' : '11-a-side'})`, () => {
    seedRandom(31337);
    const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
    const five = (x: any[]) => [x[0], x[2], x[8], x[10], x[9]];
    const pitch = futsal ? PITCH_FUTSAL : PITCH_11;
    const m = new Match({ pitch, mode: futsal ? 'futsal' : 'kickoff', humanTeam: null, script: null, durationSec: 600, clockMinutes: 90,
      teams: [{ team: home, players: futsal ? five(startingXI(rosterOf(home.id))) : startingXI(rosterOf(home.id)), kit: home.home, kitKey: 'h', name: home.name, short: home.short },
        { team: away, players: futsal ? five(startingXI(rosterOf(away.id))) : startingXI(rosterOf(away.id)), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
    const cam = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 600); const rig = new CameraRig(cam, pitch.length, pitch.width); rig.style = style;
    const dt = 1 / 60; const P: THREE.Vector3[] = []; let inPlay = 0, onScreen = 0;
    for (let i = 0; i < 60 * 40; i++) {
      m.update(dt); const b = m.ball; const t = new THREE.Vector3(b.x, b.y, b.z);
      rig.endDir = m.teams[0].attackDir; rig.update(dt, t, new THREE.Vector3(b.owner ? m.teams[b.owner.team].attackDir : 0, 0, 0), i * dt); cam.updateMatrixWorld();
      if (i < 120) continue; P.push(cam.position.clone());
      if (m.phase === 'play') { inPlay++; const n = t.clone().project(cam); if (Math.abs(n.x) < 1 && Math.abs(n.y) < 1 && n.z < 1) onScreen++; }
    }
    const acc: number[] = []; for (let i = 2; i < P.length; i++) acc.push(P[i].clone().sub(P[i - 1].clone().multiplyScalar(2)).add(P[i - 2]).length() / (dt * dt));
    console.log(`  ${style}${futsal ? ' futsal' : ''}: acc p95 ${q(acc, 0.95).toFixed(1)} m/s² · ball on screen ${(onScreen / inPlay * 100).toFixed(1)}%`);
    assert.ok(q(acc, 0.95) < 30, 'smooth');
    assert.ok(onScreen / inPlay > (style === 'high' ? 0.99 : 0.97), 'the ball stays in shot'); // (the close cameras can lose a hoofed clearance for a moment)
  });
}
