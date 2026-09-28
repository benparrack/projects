// Procedural WebAudio: wind that roars with speed, web "thwip"s, whooshes,
// landings, collect chimes and a low city bed. No audio files.
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.8; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.out = ctx.createGain(); this.out.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.out.connect(comp).connect(ctx.destination);
    // shared noise
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // brown noise for city rumble
    const bb = ctx.createBuffer(1, len, ctx.sampleRate), bd = bb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    this.brown = bb;
    // wind: two bands of looping noise
    this.wind = [];
    for (const [f, q] of [[420, 0.6], [1600, 0.9]]) {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.out); src.start();
      this.wind.push({ bp, g, f });
    }
    const city = ctx.createBufferSource(); city.buffer = bb; city.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300;
    this.cityG = ctx.createGain(); this.cityG.gain.value = 0.12;
    city.connect(lp).connect(this.cityG).connect(this.out); city.start();
    this.hornT = 3;
  }

  setVolume(v) { this.vol = v; if (this.out) this.out.gain.value = v; }

  noiseBurst({ dur = 0.2, f0 = 3000, f1 = 800, q = 1.5, gain = 0.4, type = "bandpass", attack = 0.005, when = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  tone({ f0 = 440, f1 = f0, dur = 0.2, gain = 0.2, type = "sine", when = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.05);
  }

  play(e, speed = 0) {
    if (!this.ctx) return;
    switch (e) {
      case "thwip":
        this.noiseBurst({ dur: 0.16, f0: 5200, f1: 1400, q: 2.2, gain: 0.35 });
        this.noiseBurst({ dur: 0.05, f0: 9000, f1: 6000, q: 1, gain: 0.2, type: "highpass" });
        break;
      case "zip": case "dash":
        this.noiseBurst({ dur: 0.12, f0: 6000, f1: 2000, q: 2, gain: 0.3 });
        this.noiseBurst({ dur: 0.12, f0: 5000, f1: 1800, q: 2, gain: 0.25, when: 0.05 });
        this.noiseBurst({ dur: 0.5, f0: 400, f1: 1600, q: 0.8, gain: 0.3, attack: 0.15 });
        break;
      case "release": case "releaseJump":
        this.noiseBurst({ dur: 0.45, f0: 500, f1: 1400, q: 0.7, gain: 0.25 + Math.min(0.25, speed / 150), attack: 0.1 });
        break;
      case "launch":
        this.noiseBurst({ dur: 0.7, f0: 300, f1: 2000, q: 0.7, gain: 0.4, attack: 0.1 });
        break;
      case "jump": this.noiseBurst({ dur: 0.1, f0: 900, f1: 300, q: 1, gain: 0.15 }); break;
      case "superjump":
        this.tone({ f0: 70, f1: 40, dur: 0.3, gain: 0.5 });
        this.noiseBurst({ dur: 0.6, f0: 300, f1: 1500, q: 0.7, gain: 0.35, attack: 0.05 });
        break;
      case "step": this.noiseBurst({ dur: 0.06, f0: 1200, f1: 400, q: 1, gain: 0.08 }); break;
      case "land": case "vault":
        this.noiseBurst({ dur: 0.15, f0: 900, f1: 200, q: 0.8, gain: 0.25 });
        this.tone({ f0: 110, f1: 55, dur: 0.15, gain: 0.25 });
        break;
      case "landHard":
        this.tone({ f0: 80, f1: 30, dur: 0.5, gain: 0.8 });
        this.noiseBurst({ dur: 0.5, f0: 600, f1: 80, q: 0.6, gain: 0.5, type: "lowpass" });
        break;
      case "wall": this.noiseBurst({ dur: 0.1, f0: 1500, f1: 500, q: 1, gain: 0.15 }); break;
      case "splash":
        this.noiseBurst({ dur: 1.0, f0: 2500, f1: 300, q: 0.5, gain: 0.6, type: "lowpass", attack: 0.01 });
        break;
      case "noanchor": this.tone({ f0: 220, f1: 180, dur: 0.12, gain: 0.08, type: "triangle" }); break;
      case "token":
        [0, 4, 7, 12].forEach((s, i) => this.tone({ f0: 660 * 2 ** (s / 12), dur: 0.35, gain: 0.12, type: "triangle", when: i * 0.06 }));
        break;
      case "allTokens":
        [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone({ f0: 440 * 2 ** (s / 12), dur: 0.6, gain: 0.15, type: "triangle", when: i * 0.09 }));
        break;
    }
  }

  update(dt, speed, height) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed / 60);
    this.wind[0].g.gain.setTargetAtTime(0.02 + s * s * 0.55, t, 0.1);
    this.wind[0].bp.frequency.setTargetAtTime(300 + s * 700, t, 0.1);
    this.wind[1].g.gain.setTargetAtTime(s * s * s * 0.25, t, 0.1);
    this.wind[1].bp.frequency.setTargetAtTime(1200 + s * 2200, t, 0.1);
    // the city is louder near the street
    this.cityG.gain.setTargetAtTime(0.03 + 0.14 * Math.max(0, 1 - height / 150), t, 0.5);
    this.hornT -= dt;
    if (this.hornT < 0) {
      this.hornT = 6 + Math.random() * 14;
      const g = 0.03 * Math.max(0.1, 1 - height / 200);
      const f = 330 + Math.random() * 120;
      this.tone({ f0: f, dur: 0.25 + Math.random() * 0.3, gain: g, type: "sawtooth" });
      this.tone({ f0: f * 1.26, dur: 0.25, gain: g * 0.6, type: "sawtooth" });
    }
  }
}
