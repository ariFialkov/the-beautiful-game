import crypto from 'node:crypto';
import { Engine, DEFAULT_CONFIG, type CryptoProvider, type EngineConfig } from '../shared/engine';
import { Store } from './store';

export { DEFAULT_CONFIG };
export type { EngineConfig };

const nodeCrypto: CryptoProvider = {
  sha256: async (s) => crypto.createHash('sha256').update(s).digest('hex'),
  hmacSha256: async (key, msg) => crypto.createHmac('sha256', key).update(msg).digest('hex'),
  randomHex: (n) => crypto.randomBytes(n).toString('hex'),
  uuid: () => crypto.randomUUID(),
};

/** Server-side engine: Node crypto + JSON-file store. */
export function createEngine(config: EngineConfig): Engine { return new Engine(config, new Store(), nodeCrypto); }
