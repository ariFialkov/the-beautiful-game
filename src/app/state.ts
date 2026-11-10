import type { ServerConfigPublic, Wallet } from '@shared/types';

export interface Settings {
  sound: boolean;
  quality: 'auto' | 'low' | 'high';
  cameraHeight: number; // 0.6..1.6 multiplier
  showTouch: 'auto' | 'on' | 'off';
  vibration: boolean;
}

type Listener = () => void;

class AppState {
  config: ServerConfigPublic | null = null;
  wallet: Wallet | null = null;
  nextServerSeedHash = '';
  settings: Settings = { sound: true, quality: 'auto', cameraHeight: 1, showTouch: 'auto', vibration: true };
  homeTeamId = 'lon-royals';
  awayTeamId = 'mad-blancos';
  stake = 50;
  offline = false;
  private listeners = new Set<Listener>();

  constructor() {
    try { const s = localStorage.getItem('tbg.settings'); if (s) this.settings = { ...this.settings, ...JSON.parse(s) }; } catch { /* ignore */ }
    try { const t = localStorage.getItem('tbg.teams'); if (t) { const o = JSON.parse(t); this.homeTeamId = o.home ?? this.homeTeamId; this.awayTeamId = o.away ?? this.awayTeamId; this.stake = o.stake ?? this.stake; } } catch { /* ignore */ }
  }
  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const l of this.listeners) l(); }
  setWallet(w: Wallet) { this.wallet = w; this.emit(); }
  saveSettings(patch: Partial<Settings>) { this.settings = { ...this.settings, ...patch }; localStorage.setItem('tbg.settings', JSON.stringify(this.settings)); this.emit(); }
  saveTeams() { localStorage.setItem('tbg.teams', JSON.stringify({ home: this.homeTeamId, away: this.awayTeamId, stake: this.stake })); }
}

export const state = new AppState();
export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
