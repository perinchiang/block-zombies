// All sound is synthesized with Web Audio; there are no audio files.
export class Sfx {
  constructor() { this.ctx = null; }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get ok() { return !!this.ctx && this.ctx.state === 'running'; }

  burst({ t = 0, dur = 0.1, gain = 0.5, type = 'lowpass', f0 = 3000, f1 = 300, q = 0.7, pan = 0 } = {}) {
    const c = this.ctx, now = c.currentTime + t;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = c.createBiquadFilter();
    flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, now);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    let node = src.connect(flt).connect(g);
    if (p) { p.pan.value = pan; node = node.connect(p); }
    node.connect(this.master);
    src.start(now, Math.random() * 0.5, dur + 0.05);
  }

  tone({ t = 0, dur = 0.12, gain = 0.4, f0 = 160, f1 = 50, type = 'sine' } = {}) {
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    o.connect(g).connect(this.master);
    o.start(now); o.stop(now + dur + 0.02);
  }

  shot() {
    if (!this.ok) return;
    this.burst({ dur: 0.09, gain: 0.7, f0: 5200, f1: 700 });
    this.tone({ dur: 0.1, gain: 0.55, f0: 180, f1: 45, type: 'triangle' });
    this.burst({ t: 0.02, dur: 0.18, gain: 0.12, type: 'bandpass', f0: 1800, f1: 900, q: 1.5 });
  }

  hit(pan = 0) {
    if (!this.ok) return;
    this.burst({ dur: 0.06, gain: 0.35, type: 'bandpass', f0: 900, f1: 300, q: 2, pan });
  }

  kill(pan = 0) {
    if (!this.ok) return;
    this.burst({ dur: 0.22, gain: 0.45, f0: 1400, f1: 120, pan });
    this.tone({ dur: 0.18, gain: 0.35, f0: 120, f1: 40 });
  }

  groan(pan = 0, pitch = 1) {
    if (!this.ok) return;
    const c = this.ctx, now = c.currentTime, dur = 0.7 + Math.random() * 0.4;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f = (70 + Math.random() * 30) * pitch;
    o.frequency.setValueAtTime(f, now);
    o.frequency.linearRampToValueAtTime(f * 0.7, now + dur);
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 420; flt.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.14, now + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    let node = o.connect(flt).connect(g);
    if (p) { p.pan.value = pan; node = node.connect(p); }
    node.connect(this.master);
    o.start(now); o.stop(now + dur + 0.05);
  }

  hurt() {
    if (!this.ok) return;
    this.tone({ dur: 0.25, gain: 0.5, f0: 220, f1: 60, type: 'square' });
    this.burst({ dur: 0.2, gain: 0.4, f0: 2500, f1: 200 });
  }

  reload() {
    if (!this.ok) return;
    this.burst({ dur: 0.04, gain: 0.3, type: 'highpass', f0: 3000, f1: 2000 });
    this.burst({ t: 0.5, dur: 0.05, gain: 0.35, type: 'highpass', f0: 2600, f1: 1800 });
  }

  click() {
    if (!this.ok) return;
    this.burst({ dur: 0.03, gain: 0.2, type: 'highpass', f0: 4000, f1: 3000 });
  }

  win() {
    if (!this.ok) return;
    [0, 0.12, 0.24].forEach((t, i) => this.tone({ t, dur: 0.3, gain: 0.25, f0: 392 * [1, 1.25, 1.5][i], f1: 392 * [1, 1.25, 1.5][i], type: 'triangle' }));
  }
}
