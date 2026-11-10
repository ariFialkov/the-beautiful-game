import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Match } from '../src/game/match';
import { PITCH_11, PITCH_FUTSAL } from '../src/game/pitch';
import { CameraRig, groundBasis } from '../src/render/camera';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

/** For the broadcast camera at several ball positions, a stick push must move a player the same way on screen. */
for (const futsal of [false, true]) {
  test(`stick directions match the screen (${futsal ? 'futsal' : '11-a-side'})`, () => {
    const home = TEAM_BY_ID['lon-royals'], away = TEAM_BY_ID['mad-blancos'];
    const xi = (id: string) => { const s = startingXI(rosterOf(id)); return futsal ? [s[0], s[2], s[8], s[10], s[9]] : s; };
    const pitch = futsal ? PITCH_FUTSAL : PITCH_11;
    const m = new Match({ pitch, mode: futsal ? 'futsal' : 'kickoff', humanTeam: 0, script: null, durationSec: 300, clockMinutes: 90,
      teams: [{ team: home, players: xi(home.id), kit: home.home, kitKey: 'h', name: home.name, short: home.short }, { team: away, players: xi(away.id), kit: away.home, kitKey: 'a', name: away.name, short: away.short }] });
    const cam = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 600);
    const rig = new CameraRig(cam, pitch.length, pitch.width);
    const L = pitch.length / 2, W = pitch.width / 2;
    for (const [bx, bz] of [[0, 0], [L * 0.7, 0], [-L * 0.7, 0], [0, W * 0.8], [0, -W * 0.8], [L * 0.6, -W * 0.6]]) {
      const target = new THREE.Vector3(bx, 0.1, bz);
      for (let i = 0; i < 300; i++) rig.update(1 / 60, target, new THREE.Vector3(1, 0, 0), i / 60);
      cam.updateMatrixWorld();
      m.controlBasis = groundBasis(cam);
      const screen = (p: { x: number; z: number }) => new THREE.Vector3(p.x, 0, p.z).project(cam);
      const at = (sx: number, sy: number) => { const d = m.stickToWorld(sx, sy); const a = screen({ x: bx, z: bz }), b = screen({ x: bx + d.x * 2, z: bz + d.z * 2 }); return { dx: b.x - a.x, dy: b.y - a.y }; };
      const where = `ball (${bx.toFixed(0)}, ${bz.toFixed(0)})`;
      const r = at(1, 0), l = at(-1, 0), u = at(0, 1), d = at(0, -1);
      assert.ok(r.dx > 0 && Math.abs(r.dx) > Math.abs(r.dy) * 2, `right at ${where}: ${JSON.stringify(r)}`);
      assert.ok(l.dx < 0 && Math.abs(l.dx) > Math.abs(l.dy) * 2, `left at ${where}: ${JSON.stringify(l)}`);
      assert.ok(u.dy > 0 && Math.abs(u.dy) > Math.abs(u.dx), `up at ${where}: ${JSON.stringify(u)}`);
      assert.ok(d.dy < 0 && Math.abs(d.dy) > Math.abs(d.dx), `down at ${where}: ${JSON.stringify(d)}`);
    }
  });
}
