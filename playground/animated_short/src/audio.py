"""LANTERN — the score and sound effects, synthesized offline with numpy/scipy.

Every cue is placed from timeline.py (the same constants the renderer uses),
so picture and sound are synced by construction.  Output: 48 kHz stereo
16-bit WAV at output/audio/score.wav, plus waveform/spectrogram PNGs for review.

    python src/audio.py            # render score.wav + review images
"""
import os
import sys

import numpy as np
from scipy import signal
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import timeline as TL  # noqa: E402

SR = 48000
DUR = TL.DURATION
N = int(DUR * SR)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "output", "audio")
rng = np.random.default_rng(7)


# ------------------------------------------------------------------ helpers
def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}


def nf(name):
    """'A4' / 'F#3' / 'Bb2' -> Hz."""
    name = name.replace("Bb", "A#").replace("Eb", "D#")
    pitch, octv = name[:-1], int(name[-1])
    return midi(12 * (octv + 1) + NOTE[pitch])


def tt(a, b):
    """Sample index range and local time array for [a, b)."""
    i0, i1 = max(0, int(a * SR)), min(N, int(b * SR))
    return i0, i1, np.arange(i1 - i0) / SR


def pan_gains(p):
    """Constant-power pan, p in [-1, 1]."""
    a = (p + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


class Bus:
    def __init__(self):
        self.x = np.zeros((2, N), dtype=np.float64)

    def add(self, start, mono, gain=1.0, pan=0.0):
        i0 = int(round(start * SR))
        if i0 >= N:
            return
        s0 = 0
        if i0 < 0:
            s0, i0 = -i0, 0
        mono = mono[s0:s0 + N - i0]
        gl, gr = pan_gains(pan)
        self.x[0, i0:i0 + len(mono)] += mono * gain * gl
        self.x[1, i0:i0 + len(mono)] += mono * gain * gr


def env_keys(keys, n=N):
    """Piecewise-linear envelope from [(t, v), ...] over the whole film (smoothed)."""
    ts = np.array([k[0] for k in keys]) * SR
    vs = np.array([k[1] for k in keys])
    e = np.interp(np.arange(n), ts, vs)
    return e


def adsr(n, a, r, sus=1.0):
    e = np.full(n, sus)
    na, nr = min(int(a * SR), n), min(int(r * SR), n)
    if na:
        e[:na] = sus * (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, na)))
    if nr:
        e[n - nr:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, nr))
    return e


def lowpass(x, fc, order=2):
    b, a = signal.butter(order, min(fc / (SR / 2), 0.99), "low")
    return signal.lfilter(b, a, x)


def highpass(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), "high")
    return signal.lfilter(b, a, x)


def bandpass(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), min(hi / (SR / 2), 0.99)], "band")
    return signal.lfilter(b, a, x)


def noise(n):
    return rng.standard_normal(n)


def swept_filter(x, fc, q=2.0):
    """Time-varying resonant bandpass (state-variable filter), fc: array per sample."""
    y = np.zeros_like(x)
    low = band = 0.0
    damp = 1.0 / q
    f = 2 * np.sin(np.pi * np.clip(fc, 20, SR / 6) / SR)
    for i in range(len(x)):
        high = x[i] - low - damp * band
        band += f[i] * high
        low += f[i] * band
        y[i] = band
    return y


# ------------------------------------------------------------------ instruments
def pad_voice(freq, dur, bright=0.5, detune=0.004, a=3.0, r=4.0):
    """Warm string/choir-like pad: 3 detuned additive saws, soft harmonics."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    nh = max(1, int(min(14, 7000 / freq)))
    for d in (-detune, 0.0, detune):
        f = freq * (1 + d)
        ph = rng.uniform(0, 2 * np.pi)
        vib = 0.0015 * np.sin(2 * np.pi * (4.7 + 3 * d * 100) * t + ph)
        phase = 2 * np.pi * f * (t + np.cumsum(vib) / SR)
        for h in range(1, nh + 1):
            amp = (1.0 / h) * (bright ** (h - 1) if h > 1 else 1.0)
            out += amp * np.sin(h * phase + ph * h)
    out /= 3.0
    return out * adsr(n, a, r)


def chord(bus, start, dur, notes, gain, bright=0.45, a=3.0, r=4.0, spread=0.6):
    for i, nm in enumerate(notes):
        p = spread * (2 * (i / max(1, len(notes) - 1)) - 1) if len(notes) > 1 else 0.0
        bus.add(start, pad_voice(nf(nm), dur, bright=bright, a=a, r=r), gain / np.sqrt(len(notes)), pan=p)


def bell(freq, dur=4.0, index=2.5, ratio=1.4, decay=1.4, bright_decay=3.0):
    """FM bell."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * decay) * (1 - np.exp(-t * 900))
    ienv = index * np.exp(-t * bright_decay)
    mod = ienv * np.sin(2 * np.pi * freq * ratio * t)
    y = np.sin(2 * np.pi * freq * t + mod) * env
    y += 0.35 * np.sin(2 * np.pi * freq * 2.0 * t) * np.exp(-t * decay * 2.2) * (1 - np.exp(-t * 900))
    y += 0.15 * np.sin(2 * np.pi * freq * 0.5 * t) * np.exp(-t * decay * 0.7) * (1 - np.exp(-t * 200))
    return y


def ping(bus, t0, low=False, gain=1.0, pan=0.0, octave=0, soft=False):
    """The motif: rising fifth A -> E, 0.22 s apart. Probe = A4/E5, beacon = A3/E4."""
    base = 57 if low else 69
    base += 12 * octave
    for k, (semi, dt) in enumerate(((0, 0.0), (7, TL.PING_NOTE_GAP))):
        f = midi(base + semi)
        if low:
            y = bell(f, dur=6.0, index=1.6, ratio=2.0, decay=0.7, bright_decay=1.5)
        else:
            y = bell(f, dur=4.5, index=2.8 if not soft else 1.2, ratio=1.4, decay=1.25, bright_decay=3.5)
        bus.add(t0 + dt, y, gain * (1.0 if k == 0 else 0.85), pan)


def boom(dur=6.0, f0=70.0, f1=28.0, noise_amt=0.6, decay=0.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 3.0)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * decay)
    nz = lowpass(noise(n), 400, 2) * np.exp(-t * 3.5) * noise_amt
    y = y + nz
    return y * (1 - np.exp(-t * 400))


def whoosh(dur, f_lo, f_hi, peak=0.5, q=1.5):
    """Filtered-noise pass-by; the band sweeps f_lo -> f_hi -> f_lo around the peak."""
    n = int(dur * SR)
    x = np.linspace(0, 1, n)
    shape = np.exp(-((x - peak) / 0.18) ** 2)
    fc = f_lo + (f_hi - f_lo) * shape
    y = swept_filter(noise(n), fc, q)
    return y * shape * adsr(n, 0.05, 0.1)


def tom(f0=110.0, dur=1.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (0.55 + 0.45 * np.exp(-t * 12))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.0)
    y += lowpass(noise(n), 2500) * np.exp(-t * 40) * 0.3
    return y


def thump(f0=55.0, dur=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (0.7 + 0.6 * np.exp(-t * 25))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * (1 - np.exp(-t * 600))


def crackle(dur, density=60.0, seed=0):
    r = np.random.default_rng(seed)
    n = int(dur * SR)
    y = np.zeros(n)
    k = int(density * dur)
    pos = r.integers(0, n - 200, k)
    for p in pos:
        L = r.integers(20, 160)
        y[p:p + L] += r.standard_normal(L) * np.exp(-np.arange(L) / (L / 4)) * r.uniform(0.2, 1)
    return highpass(y, 1500)


def drone(freq, dur, a=4.0, r=4.0, wobble=0.1):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2.003 * t + 1.0)
    y *= 1 + wobble * np.sin(2 * np.pi * 0.13 * t)
    return y * adsr(n, a, r)


def shepard(dur, rate=0.5, base=55.0, octaves=7):
    """Endlessly rising tone: octave-spaced sines gliding up under a fixed bell-shaped spectral window."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(octaves):
        pos = (k + rate * t) % octaves               # position in octaves
        f = base * 2 ** pos
        amp = np.exp(-((pos - octaves / 2) / (octaves / 5)) ** 2)
        ph = 2 * np.pi * np.cumsum(f) / SR
        y += amp * np.sin(ph)
    return y


def reverb_ir(seconds=4.0, decay=2.6, predelay=0.02, bright=6000, seed=1):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    for c in range(2):
        x = r.standard_normal(n) * np.exp(-t * (6.9 / decay))
        # darker tail: progressively low-passed by mixing with a smoothed copy
        sm = lowpass(x, bright * 0.25)
        mix = np.clip(t / seconds, 0, 1)
        ir[c] = x * (1 - mix) + sm * mix
    pd = int(predelay * SR)
    ir = np.concatenate([np.zeros((2, pd)), ir], axis=1)
    return ir / np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))


def apply_reverb(x, ir, wet):
    y = np.zeros_like(x)
    for c in range(2):
        y[c] = signal.fftconvolve(x[c], ir[c])[:N]
    return x + wet * y


# ------------------------------------------------------------------ swarm timing (mirrors scene.frag)
def _fract(x):
    return x - np.floor(x)


def hash11(p):
    p = np.float32(p)
    p = _fract(np.float32(p * np.float32(.1031)))
    p = np.float32(p * (p + np.float32(33.33)))
    p = np.float32(p * (p + p))
    return float(_fract(p))


def hash33(p):
    p3 = np.array(p, dtype=np.float32)
    p3 = _fract(p3 * np.array([.1031, .1030, .0973], dtype=np.float32)).astype(np.float32)
    p3 = (p3 + np.dot(p3, p3[[1, 0, 2]] + np.float32(33.33))).astype(np.float32)
    return _fract((p3[[0, 0, 1]] + p3[[1, 0, 0]]) * p3[[2, 1, 0]]).astype(np.float32)


def swarm_events():
    """(time, distance, pan) of every lantern answer, same formula as the shader."""
    ev = []
    for i in range(140):
        h = hash33([float(i), 7.1, 3.3])
        d = h * 2 - 1
        d = d / (np.linalg.norm(d) + 1e-9)
        dist = .03 + 2.2 * hash11(i * 1.7 + .3) ** 1.6
        act = 2.1 + 6.0 * hash11(i * 3.1 + .7) ** .8 + dist * .9
        if i == 0:
            act, dist = 2.1, 0.09
        ev.append((TL.SWARM_START + act, dist, float(np.clip(d[0], -1, 1))))
    return sorted(ev)


# ------------------------------------------------------------------ the score
def compose():
    music = Bus()   # pads, chords, drones
    bells = Bus()   # motif pings (big reverb)
    sfx = Bus()     # booms, whooshes, crackles (small reverb)

    # ---- 0–20: sub drone + shimmer, D minor pad
    sfx.add(0.0, drone(nf("D1"), 34.0, a=6.0, r=6.0), 0.22)
    sh = bandpass(noise(int(30 * SR)), 5000, 11000) * adsr(int(30 * SR), 6.0, 8.0)
    sh *= 1 + 0.5 * np.sin(2 * np.pi * 0.21 * np.arange(len(sh)) / SR)
    music.add(0.0, sh, 0.025)
    chord(music, 7.0, 16.0, ["D3", "A3", "F4", "E4"], 0.20, bright=0.35, a=5.0, r=6.0)
    chord(music, 20.0, 14.5, ["D3", "A3", "E4"], 0.13, bright=0.3, a=3.0, r=5.0)     # thins out
    # soft whoosh as the probe passes (drift ends close on the right)
    sfx.add(16.3, whoosh(3.0, 300, 2200, peak=0.45), 0.10, pan=0.4)

    # ---- 20–32: pings 1-2, then flicker crackle
    for t0 in TL.PROBE_PINGS[:2]:
        ping(bells, t0, gain=0.34, pan=0.05)
    f0, f1, _ = TL.FLICKERS[0]
    sfx.add(f0, crackle(f1 - f0 + 0.3, 70, seed=1), 0.18, pan=0.1)
    sfx.add(f0, drone(nf("A2") * 0.995, f1 - f0 + 1.0, a=0.1, r=0.8, wobble=0.6), 0.05)

    # ---- 32–50: WOW 1, swell Bb -> F at the sunrise
    chord(music, 31.5, 10.5, ["Bb1", "Bb2", "F3", "D4", "F4", "Bb4"], 0.34, bright=0.5, a=7.0, r=2.5)
    chord(music, TL.SUNRISE - 0.5, 14.0, ["F1", "F2", "C3", "A3", "C4", "F4", "A4", "C5"], 0.62, bright=0.55, a=1.0, r=6.0)
    sfx.add(TL.SUNRISE - 0.05, boom(7.0, f0=60, f1=30, noise_amt=0.35, decay=0.6), 0.55)
    sfx.add(TL.SUNRISE - 1.6, whoosh(2.4, 200, 4000, peak=0.8, q=0.9), 0.08)

    # ---- 50–62: settle; minor-second shimmer (A4 + Bb4 beating)
    chord(music, 50.0, 16.0, ["D2", "A2", "E3", "A3"], 0.20, bright=0.3, a=4.0, r=5.0)
    n = int(12 * SR)
    tl = np.arange(n) / SR
    ms = (np.sin(2 * np.pi * nf("A5") * tl) + np.sin(2 * np.pi * nf("Bb5") * tl)) * adsr(n, 4.0, 4.0)
    music.add(51.0, ms, 0.018, pan=-0.3)

    # ---- 62–76: WOW 2, brass-like swell + deep hum
    chord(music, 61.5, 15.5, ["G1", "D2", "G2", "D3", "Bb3", "D4", "G4"], 0.50, bright=0.72, a=6.0, r=4.0, spread=0.8)
    sfx.add(62.0, drone(nf("G0") * 2, 15.0, a=5.0, r=4.0, wobble=0.25), 0.28)
    sfx.add(64.0, whoosh(4.0, 150, 1200, peak=0.5, q=1.2), 0.07, pan=-0.5)   # probe crosses foreground

    # ---- 76–88: chase — heartbeat bass pulse, whooshes past towers
    chord(music, 76.0, 13.0, ["D2", "A2", "D3", "F3", "C4"], 0.18, bright=0.4, a=1.5, r=2.5)
    bpm_t = 76.0
    while bpm_t < 87.4:
        sfx.add(bpm_t, thump(52.0), 0.45)
        sfx.add(bpm_t + 0.28, thump(46.0), 0.30)
        bpm_t += 60.0 / 72.0
    for k, tw in enumerate([77.1, 78.3, 79.6, 80.4, 81.9, 83.0, 84.6, 86.1]):
        sfx.add(tw, whoosh(1.4, 250, 2600 - 150 * k, peak=0.5, q=1.8), 0.09, pan=0.7 if k % 2 else -0.7)

    # ---- 88–98: THE TURN — everything drops out after ping 3
    ping(bells, TL.PROBE_PINGS[2], gain=0.30)
    sfx.add(88.0, drone(nf("D1"), 11.0, a=1.0, r=3.0), 0.10)        # barely-there floor, not dead air
    ping(bells, TL.BEACON_ANSWERS[0], low=True, gain=0.30, pan=-0.1)
    sfx.add(TL.BEACON_ANSWERS[0], boom(4.0, f0=45, f1=35, noise_amt=0.0, decay=1.2), 0.18)
    ping(bells, TL.PROBE_PINGS[3], gain=0.30)
    ping(bells, TL.BEACON_ANSWERS[1], low=True, gain=0.34, pan=-0.1)
    chord(music, TL.BEACON_ANSWERS[1] + 0.3, 5.0, ["A2", "E3", "A3"], 0.12, bright=0.3, a=2.5, r=2.0)

    # ---- 98–110: WOW 3, the cascade — accelerating arpeggio + ticks, pad builds
    arp = ["D4", "F4", "A4", "E5", "D5", "A4", "F5", "A5"]
    t_ = TL.CASCADE_START
    k = 0
    while t_ < TL.CASCADE_MEET + 0.1:
        x = (t_ - TL.CASCADE_START) / (TL.CASCADE_MEET - TL.CASCADE_START)
        f = nf(arp[k % len(arp)])
        bells.add(t_, bell(f, dur=2.0, index=1.2, ratio=2.0, decay=2.5, bright_decay=5.0), 0.10 + 0.08 * x,
                  pan=0.6 * np.sin(k * 1.3))
        sfx.add(t_, highpass(noise(int(0.02 * SR)) * np.exp(-np.arange(int(0.02 * SR)) / 150), 3000),
                0.05, pan=-0.6 * np.sin(k * 1.3))
        t_ += 0.34 * (1 - 0.75 * x ** 0.8)
        k += 1
    chord(music, 98.0, 5.5, ["D2", "A2", "D3", "F3", "A3", "D4"], 0.26, bright=0.5, a=2.0, r=1.5)
    chord(music, 103.0, 4.0, ["Bb1", "Bb2", "F3", "D4", "F4"], 0.32, bright=0.55, a=1.0, r=1.2)
    chord(music, TL.CASCADE_MEET, 5.0, ["C2", "C3", "G3", "E4", "G4", "C5"], 0.40, bright=0.65, a=0.3, r=2.5)
    sfx.add(TL.CASCADE_MEET, boom(4.0, f0=80, f1=40, noise_amt=0.2, decay=1.4), 0.3)

    # ---- 110–122: power-up — Shepard riser, crackles, flickers
    n = int(13 * SR)
    ris = shepard(13.0, rate=0.32, base=40.0) * adsr(n, 3.0, 0.2) * np.linspace(0.3, 1.0, n)
    music.add(109.5, ris, 0.10)
    chord(music, 110.0, 12.8, ["D2", "A2", "D3", "E3", "A3"], 0.20, bright=0.6, a=3.0, r=0.3)
    for (a, b, _) in TL.FLICKERS[1:]:
        sfx.add(a, crackle(b - a + 0.2, 90, seed=int(a)), 0.2, pan=0.15)
    sfx.add(110.0, crackle(12.0, 6, seed=5), 0.12)

    # ---- 122–134: CLIMAX — tear, shock hit, silence, relight
    tear_n = int(2.6 * SR)
    xt = np.linspace(0, 1, tear_n)
    tear = swept_filter(noise(tear_n), 200 + 5000 * xt ** 2, q=3.0) * adsr(tear_n, 0.05, 0.4) * (0.4 + xt)
    sfx.add(TL.PORTAL_TEAR, tear, 0.22)
    sfx.add(TL.PORTAL_TEAR, boom(3.0, f0=120, f1=50, noise_amt=0.3, decay=1.5), 0.30)
    # shockwave approaching: rising rumble into the hit
    rn = int((TL.SHOCK_HIT - TL.SHOCK_START) * SR)
    rumble = lowpass(noise(rn), 180, 2) * np.linspace(0, 1, rn) ** 2
    sfx.add(TL.SHOCK_START, rumble, 0.9)
    sfx.add(TL.SHOCK_HIT, boom(8.0, f0=90, f1=24, noise_amt=1.0, decay=0.55), 1.0)
    sfx.add(TL.SHOCK_HIT, highpass(noise(int(0.6 * SR)), 800) * np.exp(-np.arange(int(0.6 * SR)) / (0.08 * SR)), 0.35)
    # muffled tinnitus hum through the dark
    tn = int((TL.DARK_END - TL.SHOCK_HIT + 1.5) * SR)
    tin = np.sin(2 * np.pi * 3700 * np.arange(tn) / SR) * adsr(tn, 0.3, 1.5)
    music.add(TL.SHOCK_HIT + 0.4, tin, 0.012)
    sfx.add(TL.SHOCK_HIT + 0.5, lowpass(noise(int(5.0 * SR)), 120) * adsr(int(5.0 * SR), 0.5, 3.0), 0.25)
    # relight: single soft note, then the motif returns softly
    bells.add(TL.DARK_END, bell(nf("A4"), dur=5.0, index=0.6, ratio=2.0, decay=0.8), 0.22)
    ping(bells, TL.RELIT, gain=0.2, soft=True)
    chord(music, TL.RELIT - 0.5, 4.5, ["D3", "A3", "E4"], 0.14, bright=0.3, a=3.0, r=1.5)

    # ---- 134–144: dive — toms, rising pad, big whoosh
    chord(music, 134.0, 10.5, ["D2", "A2", "D3", "F3", "A3", "C4"], 0.26, bright=0.55, a=4.0, r=0.8)
    chord(music, 139.0, 5.8, ["Bb1", "F2", "Bb2", "F3", "D4", "F4"], 0.30, bright=0.65, a=3.0, r=0.6)
    beat = 60.0 / 96.0
    tb = 134.0
    k = 0
    while tb < 143.4:
        sfx.add(tb, tom(98.0 if k % 4 != 3 else 130.0), 0.36 + 0.25 * (tb - 134) / 10, pan=-0.2 if k % 2 else 0.2)
        if tb > 139:
            sfx.add(tb + beat / 2, tom(82.0), 0.22, pan=0.3)
        tb += beat
        k += 1
    sfx.add(141.6, whoosh(3.0, 200, 5000, peak=0.62, q=0.9), 0.26)

    # ---- 144–150: tunnel — rushing wind with rising pitch, crescendo to white-out
    wn = int((TL.WHITEOUT - TL.TUNNEL_START + 0.2) * SR)
    xw = np.linspace(0, 1, wn)
    wind = swept_filter(noise(wn), 400 + 3500 * xw ** 1.5, q=1.2) * (0.4 + 0.6 * xw) * adsr(wn, 0.3, 0.15)
    sfx.add(TL.TUNNEL_START, wind, 0.3)
    wind2 = swept_filter(noise(wn), 900 + 6000 * xw ** 1.5, q=2.5) * (0.2 + 0.8 * xw ** 2) * adsr(wn, 0.5, 0.15)
    sfx.add(TL.TUNNEL_START, wind2, 0.12, pan=0.3)
    chord(music, 144.0, 5.8, ["C2", "G2", "C3", "E3", "G3", "C4", "E4"], 0.34, bright=0.7, a=4.0, r=0.3)
    sfx.add(TL.WHITEOUT, boom(5.0, f0=70, f1=40, noise_amt=0.2, decay=0.9), 0.4)

    # ---- 150–166: resolution in D major — ping 5, silence, then the swarm answers
    sfx.add(TL.WHITEOUT, whoosh(2.5, 3000, 300, peak=0.1, q=0.8), 0.08)     # air settling
    ping(bells, TL.PROBE_PINGS[4], gain=0.38)
    swarm_notes = [(57, 0), (64, 0), (69, 0), (76, 0), (74, 0), (78, 0), (62, 0), (81, 0), (45, 0)]
    for j, (ts, dist, pan) in enumerate(swarm_events()):
        if ts > 176 - 1:
            continue
        base, _ = swarm_notes[j % len(swarm_notes)]
        g = 0.5 if j == 0 else 0.30 / (1 + dist * 1.2) / (1 + j * 0.02)
        for kk, (semi, dt) in enumerate(((0, 0.0), (7, TL.PING_NOTE_GAP))):
            f = midi(base + semi)
            bells.add(ts + dt, bell(f, dur=4.0, index=1.8, ratio=1.4 if j % 2 else 2.0, decay=1.1, bright_decay=3.0),
                      g * (1.0 if kk == 0 else 0.85), pan=0.8 * pan)
    # the answers become a sustained D major chord across octaves
    chord(music, 155.0, 13.5, ["D2", "A2", "D3", "F#3", "A3", "E4"], 0.26, bright=0.5, a=4.0, r=3.0)
    chord(music, 158.0, 18.0, ["D1", "D2", "A2", "D3", "F#3", "A3", "C#4", "E4", "F#4", "A4", "D5"],
          0.46, bright=0.55, a=4.0, r=8.0, spread=0.9)
    n = int(18 * SR)
    sh2 = bandpass(noise(n), 6000, 12000) * adsr(n, 4.0, 8.0)
    music.add(158.0, sh2, 0.02)

    # ---- 166–176: credits — chord tail, one last distant ping
    ping(bells, TL.FINAL_PING, gain=0.12, pan=0.5, soft=True)

    return music, bells, sfx


def master(music, bells, sfx):
    ir_big = reverb_ir(5.0, decay=4.2, predelay=0.03, seed=1)
    ir_mid = reverb_ir(3.0, decay=2.2, predelay=0.015, seed=2)
    m = apply_reverb(music.x, ir_mid, 0.35)
    b = apply_reverb(bells.x, ir_big, 0.9)
    s = apply_reverb(sfx.x, ir_mid, 0.18)
    mix = m + b + s
    mix = highpass(mix, 22, 2)                    # remove DC / sub-rumble below hearing
    # global fade-in/out
    t = np.arange(N) / SR
    mix *= np.clip(t / 2.5, 0, 1) * np.clip((DUR - t) / 3.0, 0, 1)
    # gentle bus compression via soft knee: tanh on peaks above -6 dB only
    pk = np.max(np.abs(mix))
    mix = mix / pk * 0.98
    thr = 0.5
    over = np.abs(mix) > thr
    mix[over] = np.sign(mix[over]) * (thr + (1 - thr) * np.tanh((np.abs(mix[over]) - thr) / (1 - thr)))
    mix = mix / np.max(np.abs(mix)) * 10 ** (-1.0 / 20)   # peak -1 dBFS
    return mix


def write_wav(path, x):
    from scipy.io import wavfile
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).T
    wavfile.write(path, SR, pcm)


def review_images(x, prefix):
    """Waveform (with shot boundaries) and spectrogram PNGs for REVIEW.md."""
    W, H = 2400, 360
    mono = x.mean(axis=0)
    img = Image.new("RGB", (W, H), (16, 16, 20))
    d = ImageDraw.Draw(img)
    per = len(mono) // W
    for i in range(W):
        seg = mono[i * per:(i + 1) * per]
        lo, hi = seg.min(), seg.max()
        rms = np.sqrt(np.mean(seg ** 2))
        d.line([(i, H / 2 - hi * H / 2.2), (i, H / 2 - lo * H / 2.2)], fill=(90, 120, 170))
        d.line([(i, H / 2 - rms * H / 2.2), (i, H / 2 + rms * H / 2.2)], fill=(170, 200, 250))
    for name, a, b in TL.SHOTS:
        xx = int(a / DUR * W)
        d.line([(xx, 0), (xx, H)], fill=(200, 80, 80))
        d.text((xx + 3, 3), name, fill=(240, 220, 120))
    for tev in TL.PROBE_PINGS + TL.BEACON_ANSWERS + [TL.SUNRISE, TL.SHOCK_HIT, TL.WHITEOUT, TL.SWARM_FIRST]:
        xx = int(tev / DUR * W)
        d.line([(xx, H - 14), (xx, H)], fill=(120, 255, 140))
    img.save(prefix + "_wave.png")

    f, t, S = signal.spectrogram(mono, SR, nperseg=4096, noverlap=2048)
    S = 10 * np.log10(S + 1e-12)
    keep = f < 12000
    S = S[keep][::-1]
    S = np.clip((S - (S.max() - 90)) / 90, 0, 1)
    im = (np.stack([S ** 1.5, S ** 0.8 * 0.9, S ** 0.5 * 0.6 + 0.1 * S], -1) * 255).astype(np.uint8)
    Image.fromarray(im).resize((W, 480)).save(prefix + "_spec.png")


def main():
    os.makedirs(OUT, exist_ok=True)
    music, bells, sfx = compose()
    mix = master(music, bells, sfx)
    path = os.path.join(OUT, "score.wav")
    write_wav(path, mix)
    review_images(mix, os.path.join(OUT, "score"))
    # level report
    mono = mix.mean(axis=0)
    win = SR // 2
    rms = np.sqrt(np.convolve(mono ** 2, np.ones(win) / win, mode="valid")[::win])
    db = 20 * np.log10(rms + 1e-9)
    quiet = [(i * 0.5, round(v, 1)) for i, v in enumerate(db) if v < -50]
    print(f"wrote {path}  peak {20*np.log10(np.max(np.abs(mix))):.2f} dBFS  "
          f"rms {20*np.log10(np.sqrt(np.mean(mono**2))):.1f} dBFS")
    print("half-second windows below -50 dBFS:", quiet[:40], "..." if len(quiet) > 40 else "")


if __name__ == "__main__":
    main()
