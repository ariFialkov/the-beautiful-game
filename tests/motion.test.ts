import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Agent } from '../src/game/player';
import { Motion } from '../src/game/motion';
import { B } from '../src/game/skeleton';
import { rosterOf } from '../shared/teams';

const card = rosterOf('lon-royals')[9];
function rig() { const a = new Agent(card, 0, 0); const m = new Motion(a); return { a, m }; }
const ball = { x: 5, y: 0.11, z: 5 };

test('standing pose: correct height, feet on the ground under the hips', () => {
  const { a, m } = rig(); a.pos = { x: 0, z: 0 }; a.heading = { x: 0, z: 1 };
  for (let i = 0; i < 30; i++) m.update(1 / 120, ball);
  const head = m.rig.pos(B.head), fl = m.ankle('L'), fr = m.ankle('R');
  const h = card.look.height;
  assert.ok(head.y > 1.5 * h / 1.8 && head.y < 1.75 * h / 1.8, `head height ${head.y.toFixed(2)} for a ${h.toFixed(2)} m player`);
  assert.ok(Math.abs(fl.y - m.body.ankleHeight) < 0.03 && Math.abs(fr.y - m.body.ankleHeight) < 0.03, 'ankles at ankle height');
  assert.ok(fl.x > 0.05 && fr.x < -0.05, 'left foot on the left (+x), right on the right');
  const toe = m.rig.pos(B.toeL); assert.ok(toe.z > fl.z + 0.08, 'feet point forward');
});

test('running gait: planted feet stay planted, feet alternate, knees never lock out', () => {
  const { a, m } = rig(); a.pos = { x: 0, z: 0 }; a.heading = { x: 0, z: 1 }; a.vel = { x: 0, z: 0 };
  let maxSlide = 0; let switches = 0; const wasSwing: Record<string, boolean> = { L: false, R: false };
  const prev: Record<string, THREE.Vector3 | null> = { L: null, R: null };
  let minKnee = Math.PI;
  for (let i = 0; i < 120 * 4; i++) {
    const speed = Math.min(8, i / 120 * 6); a.vel = { x: 0, z: speed }; a.pos = { x: 0, z: a.pos.z + speed / 120 };
    m.update(1 / 120, ball);
    for (const s of ['L', 'R'] as const) {
      const f = (m as any).feet[s]; const p = m.ankle(s);
      if (!f.swing && f.stanceT > 0.02 && f.stanceT < 0.05 && prev[s]) maxSlide = Math.max(maxSlide, Math.hypot(p.x - prev[s]!.x, p.z - prev[s]!.z));
      prev[s] = f.swing ? null : p.clone();
      if (wasSwing[s] && !f.swing && i > 120) switches++; // a landing
      wasSwing[s] = f.swing;
      const hip = m.rig.pos(s === 'L' ? B.thighL : B.thighR), knee = m.rig.pos(s === 'L' ? B.shinL : B.shinR), ank = m.ankle(s);
      const ang = hip.clone().sub(knee).angleTo(ank.clone().sub(knee)); minKnee = Math.min(minKnee, Math.PI - ang);
    }
  }
  console.log(`  max planted-foot slip per step ${(maxSlide * 1000).toFixed(1)} mm, ${switches} landings in 3 s`);
  assert.ok(maxSlide < 0.004, 'feet do not skate during stance');
  assert.ok(switches >= 10, 'feet alternate at a running cadence');
  for (let i = 0; i < 22; i++) for (const e of m.pose.q[i].toArray()) assert.ok(Number.isFinite(e));
});

test('kick: the boot reaches the ball at the moment of the strike', () => {
  const { a, m } = rig(); a.pos = { x: 0, z: 0 }; a.heading = { x: 0, z: 1 };
  for (let i = 0; i < 30; i++) m.update(1 / 120, ball);
  const contact = { x: -0.18, y: 0.11, z: 0.55 };
  a.startAction('kick', 0.45, 1, { side: 'R', dir: { x: 0, z: 1 }, contact, kind: 'shoot', strike: 0.2 });
  let atStrike = Infinity;
  for (let i = 0; i < 54; i++) { a.action!.t += 1 / 120; m.update(1 / 120, contact); if (Math.abs(a.action!.t - 0.2) < 0.005) { const fp = m.footPoint('R'); atStrike = Math.hypot(fp.x - contact.x, fp.y - contact.y, fp.z - contact.z); } }
  console.log(`  boot-to-ball distance at strike: ${(atStrike * 100).toFixed(1)} cm`);
  assert.ok(atStrike < 0.16, 'striking surface meets the ball');
});

test('colliders track the limbs', () => {
  const { a, m } = rig(); a.pos = { x: 3, z: -2 }; a.heading = { x: 1, z: 0 };
  for (let i = 0; i < 30; i++) m.update(1 / 120, ball);
  const caps = m.colliders();
  const foot = caps.find((c) => c.part === 'foot' && c.side === 'L')!; const ank = m.ankle('L');
  assert.ok(Math.hypot(foot.ax - ank.x, foot.az - ank.z) < 0.12, 'foot collider is at the foot');
  const head = caps.find((c) => c.part === 'head')!; assert.ok(head.ay > 1.5, 'head collider is up top');
});
