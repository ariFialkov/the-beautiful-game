import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PlayerRecord, StoreLike } from '../shared/engine';
export type { PlayerRecord };

interface StoreShape { players: Record<string, PlayerRecord>; }

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const file = path.join(dir, 'store.json');

export class Store implements StoreLike {
  private data: StoreShape = { players: {} };
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    try {
      if (fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { console.warn('[store] could not load store, starting fresh', e); }
  }
  get players() { return this.data.players; }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(this.data)); } catch (e) { console.warn('[store] save failed', e); }
    }, 250);
  }
}
