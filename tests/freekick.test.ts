import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../shared/rng';
import { generateFreeKickScript } from '../shared/script';
import { TEAM_BY_ID, rosterOf, startingXI } from '../shared/teams';

// Minimal DOM stand-ins so the procedural kits/models can be built headlessly.
const ctx = new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };
(globalThis as any).window = { innerWidth: 1280, innerHeight: 720 };

const { FreeKickGame } = await import('../src/freekick/freekick');

function side(id: string) { const t = TEAM_BY_ID[id]; const xi = startingXI(rosterOf(id)); return { team: t, kit: t.home, kitKey: id, kicker: xi[9], keeper: xi[0], wall: xi.slice(1, 6) }; }
const idle = () => ({ move: { x: 0, y: 0 }, switch: { down: false }, finesse: { down: false }, shoot: { down: false }, pass: { down: false }, touchCurl: 0 });

test('free-kick duels always finish with the scripted result, whatever the player does', () => {
  const stage: any = { quality: 'low', camera: new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500) };
  const tally = { win: 0, loss: 0, rounds: 0, fallback: 0 };
  for (let i = 0; i < 60; i++) {
    const tier = i % 2 ? 'win' : 'loss';
    const script = generateFreeKickScript(new Rng(`fk-${i}`), tier, tier === 'win' ? 1.92 : 0);
    const g = new FreeKickGame(stage, script, side('lon-royals'), side('mad-blancos'), false, (['dry', 'wet', 'snow', 'firm'] as const)[i % 4]);
    const rng = new Rng(`inp-${i}`);
    let aimX = 0, aimY = 0, hold = 0;
    let t = 0; let fellBack = false;
    while (g.phase !== 'end' && t < 120) {
      const inp: any = idle();
      if (g.phase === 'aim') {
        if (hold === 0) { aimX = rng.range(-1, 1); aimY = rng.range(-1, 1); hold = rng.range(0.2, 1.1); }
        inp.move = { x: aimX, y: aimY };
        if (g.phase === 'aim' && t % 2 > 0.6) { inp.shoot.down = true; hold -= 1 / 60; if (hold <= 0) { inp.shoot.down = false; hold = 0; } }
        if (rng.bool(0.3)) inp.finesse.down = true;
      }
      g.update(1 / 60, inp, t); t += 1 / 60;
      if (g.round >= script.rounds.length) fellBack = true;
    }
    assert.equal(g.phase, 'end', `duel ${i} finished`);
    assert.equal(g.won, tier === 'win', `duel ${i} (${tier}) result after ${g.results.length} rounds: ${JSON.stringify(g.results)}`);
    tally[tier]++; tally.rounds += g.results.length; if (fellBack) tally.fallback++;
  }
  console.log(`  ${tally.win} wins, ${tally.loss} losses, ${(tally.rounds / 60).toFixed(1)} rounds per duel, ${tally.fallback} decided by the fallback`);
  assert.ok(tally.fallback <= 3, 'the physical shots should almost always settle the duel themselves');
});
