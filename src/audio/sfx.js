// Effetti sonori sintetizzati con WebAudio (nessun file audio da scaricare).
export class Sfx {
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  noise(dur, freq, gain, { type = 'lowpass', q = 1, delay = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(freq, dur, gain, { type = 'sine', delay = 0, slide = null } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  hit(heavy) {
    this.noise(heavy ? 0.18 : 0.1, heavy ? 1300 : 2600, heavy ? 0.9 : 0.6);
    this.tone(heavy ? 95 : 150, 0.14, heavy ? 0.7 : 0.4, { slide: 50 });
  }

  block() { this.noise(0.08, 3000, 0.35, { type: 'bandpass' }); }

  slam(big) {
    this.tone(62, big ? 0.7 : 0.45, 1, { slide: 30 });
    this.noise(big ? 0.6 : 0.4, 450, 1);
    this.crowd(big ? 1 : 0.6);
  }

  rope() { this.tone(110, 0.35, 0.35, { type: 'triangle', slide: 70 }); }

  slap() {
    this.noise(0.08, 1800, 0.9, { type: 'bandpass' });
    this.tone(210, 0.08, 0.3);
  }

  bell(times = 1) {
    for (let i = 0; i < times; i++) {
      for (const [f, g] of [[620, 0.5], [1490, 0.25], [2550, 0.12]]) this.tone(f, 1.6, g, { delay: i * 0.4 });
    }
  }

  crowd(level) {
    this.noise(1.6, 900, 0.3 * level, { type: 'bandpass', q: 0.6 });
    this.noise(1.2, 2200, 0.12 * level, { type: 'bandpass', q: 0.8, delay: 0.1 });
  }
}
