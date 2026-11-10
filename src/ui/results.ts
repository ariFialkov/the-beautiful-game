import type { SettleRoundResponse } from '@shared/types';
import { el, button } from './components';
import { fmt } from '../app/state';
import { focus } from './focus';
import { app } from '../main';

export function showResults(root: HTMLElement, opts: { title: string; detail: string; stake: number; multiplier: number; settle: SettleRoundResponse | null; round: any; error?: string; onAgain: () => void }) {
  const payout = opts.settle?.payout ?? opts.stake * opts.multiplier;
  const modal = el('div', 'modal'); const card = el('div', 'panel card col');
  card.innerHTML = `<div class="result-hero"><h2>${opts.title}</h2><div class="score">${opts.detail}</div><div class="big ${payout > 0 ? '' : 'lose'}">${payout > 0 ? `+${fmt(payout)}` : 'No return'}</div><div class="muted small">${opts.multiplier.toFixed(2)}× on a ${fmt(opts.stake)} stake</div>${opts.error ? `<div class="error">${opts.error}</div>` : ''}</div>`;
  const fair = el('details'); fair.innerHTML = `<summary class="label" style="cursor:pointer">Provably fair</summary>`;
  const kv = el('div', 'kv');
  kv.innerHTML = `<span class="k">Round</span><span class="v">${opts.round.roundId}</span><span class="k">Server seed hash</span><span class="v">${opts.round.serverSeedHash}</span><span class="k">Server seed</span><span class="v">${opts.settle?.serverSeed ?? '(revealed on settle)'}</span><span class="k">Client seed</span><span class="v">${opts.round.clientSeed}</span><span class="k">Nonce</span><span class="v">${opts.round.nonce}</span><span class="k">Verify</span><span class="v">sha256(serverSeed) = hash · u = HMAC_SHA256(serverSeed, clientSeed:nonce)[0:13] / 2^52 → paytable tier</span>`;
  fair.appendChild(kv); card.appendChild(fair);
  const row = el('div', 'row');
  const again = button('Play again', 'primary', opts.onAgain); again.setAttribute('data-focus', 'default');
  row.append(again, button('Home', '', () => app.router.go('home', undefined, true)));
  card.appendChild(row); modal.appendChild(card); root.appendChild(modal);
  focus.setRoot(card); focus.onBack = () => app.router.go('home', undefined, true);
}
