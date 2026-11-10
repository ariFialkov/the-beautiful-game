/** Small procedural sound design: crowd bed, kicks, whistles, goal roar. No assets needed. */
class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  enabled = true;
  private ensure() {
    if (this.ctx) return;
    const C = (window.AudioContext || (window as any).webkitAudioContext);
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(this.ctx.destination);
  }
  unlock() { this.ensure(); this.ctx?.resume(); }
  setEnabled(on: boolean) { this.enabled = on; if (this.master) this.master.gain.value = on ? 0.6 : 0; }

  private noise(duration: number): AudioBufferSourceNode | null {
    if (!this.ctx) return null;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * duration), this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf; return src;
  }
  startCrowd() {
    this.ensure(); if (!this.ctx || !this.master || this.crowd) return;
    const src = this.noise(4); if (!src) return; src.loop = true;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 500; filter.Q.value = 0.5;
    const gain = this.ctx.createGain(); gain.gain.value = 0.05;
    src.connect(filter).connect(gain).connect(this.master); src.start();
    this.crowd = { gain, filter };
  }
  stopCrowd() { if (this.crowd && this.ctx) { this.crowd.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5); setTimeout(() => { this.crowd?.gain.disconnect(); this.crowd = null; }, 600); } }
  crowdLevel(level: number) { if (this.crowd && this.ctx) this.crowd.gain.gain.setTargetAtTime(0.04 + level * 0.25, this.ctx.currentTime, 0.2); }
  kick(power = 0.5) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const src = this.noise(0.12); if (!src) return;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400 + power * 900;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.5 + power * 0.5, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    src.connect(f).connect(g).connect(this.master); src.start();
  }
  whistle(long = false) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(2800, t);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 40; const lg = this.ctx.createGain(); lg.gain.value = 120; lfo.connect(lg).connect(o.frequency);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.setValueAtTime(0.25, t + (long ? 1.0 : 0.35)); g.gain.exponentialRampToValueAtTime(0.0001, t + (long ? 1.2 : 0.5));
    o.connect(g).connect(this.master); o.start(t); lfo.start(t); o.stop(t + 1.3); lfo.stop(t + 1.3);
  }
  goal() { this.crowdLevel(1); setTimeout(() => this.crowdLevel(0.2), 3500); this.post(0.3); }
  post(vol = 0.6) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(380, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.4);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.5);
  }
  ui() {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime; const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.06);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.12);
  }
}
export const audio = new Audio();
