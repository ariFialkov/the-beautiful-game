import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Match } from '../src/game/match';
import { PITCH_11, PITCH_FUTSAL } from '../src/game/pitch';
import { CameraRig } from '../src/render/camera';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

const q = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };

for (const [label, aspect, futsal] of [['landscape 11-a-side', 16 / 9, false], ['portrait phone 11-a-side', 9 / 19.5, false], ['landscape futsal', 16 / 9, true]] as const) {
  test(`broadcast camera is smooth and keeps the ball in shot (${label})`, () => {
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
