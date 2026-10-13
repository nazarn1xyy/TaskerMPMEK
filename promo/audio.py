"""Beat grid + UI sound mix for the МПМЕК loop.

  python3 audio.py analyze                 -> prints tempo, beat phase, downbeats and the chosen start
  python3 audio.py mix out/sounds.json     -> writes out/mix.wav (14 s, 48 kHz stereo, loops)

Music: "House Vibes" by Alejandro Magaña (A. M.), Mixkit (Mixkit Stock Music Free License).
Downloaded by build.sh to audio/house-vibes.mp3 (not committed).
"""
import json, subprocess, sys
import numpy as np

SR = 48000
LOOP = 14.0
SONG = 'audio/house-vibes.mp3'


def load(path, ch=1):
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', path, '-ac', str(ch), '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    return x.reshape(-1, ch) if ch > 1 else x


def flux(x, hop=256, n=2048):
    w = np.hanning(n)
    fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * w
    S = np.log1p(100 * np.abs(np.fft.rfft(fr, axis=1)))
    f = np.maximum(0, np.diff(S, axis=0)).sum(1)
    f = f - np.convolve(f, np.ones(16) / 16, 'same')
    return np.maximum(f, 0), SR / hop


def band_energy(x, t, dur, lo, hi):
    seg = x[int(t * SR):int((t + dur) * SR)]
    S = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    f = np.fft.rfftfreq(len(seg), 1 / SR)
    return float(np.sqrt((S[(f >= lo) & (f < hi)] ** 2).sum()) / len(seg))


def analyze(verbose=True):
    x = load(SONG)
    env, fps = flux(x)
    # 1. tempo: autocorrelation of the onset envelope, 100–140 BPM
    e = env - env.mean()
    ac = np.correlate(e, e, 'full')[len(e) - 1:]
    lags = np.arange(len(ac))
    bpm_of = 60 * fps / np.maximum(lags, 1)
    m = (bpm_of >= 100) & (bpm_of <= 140)
    lag = lags[m][np.argmax(ac[m])]
    # 2. phase + fine tempo: maximise onset energy on the grid
    best = (-1, 0, 0)
    for bpm in np.linspace(60 * fps / (lag + 1), 60 * fps / (lag - 1), 81):
        P = 60 / bpm
        for ph in np.linspace(0, P, 100, endpoint=False):
            idx = (np.arange(ph, len(x) / SR - 0.2, P) * fps).astype(int)
            sc = env[idx].sum()
            if sc > best[0]:
                best = (sc, bpm, ph)
    _, bpm, ph = best
    P = 60 / bpm
    beats = np.arange(ph, len(x) / SR - 1, P)
    # 3. the drop: first beat where the kick (30–150 Hz) jumps up and stays
    kick = np.array([band_energy(x, b, 0.12, 30, 150) for b in beats])
    drop = int(np.argmax((kick > 0.5 * kick.max()) & (np.roll(kick, -1) > 0.5 * kick.max())))
    # 4. downbeat: claps (150–2000 Hz) land on beats 2 and 4, so beat 1 is the one before a clap
    clap = np.array([band_energy(x, b, 0.12, 150, 2000) for b in beats])
    odd = clap[drop + 1:drop + 33:2].mean(); even = clap[drop:drop + 32:2].mean()
    if odd < even:  # claps on the drop's own parity → shift by one beat
        drop += 1
    # 5. re-fit the grid on the kicks after the drop with sample accuracy (cross-correlation with the first kick)
    L = int(0.06 * SR)
    tmpl = x[int((beats[drop] - 0.01) * SR):int((beats[drop] - 0.01) * SR) + L]
    hits = []
    for i in range(32):
        a = int((beats[drop] + P * i - 0.04) * SR)
        c = np.correlate(x[a:a + L + int(0.08 * SR)], tmpl, 'valid')
        hits.append((a + np.argmax(c)) / SR + 0.01)
    hits = np.array(hits)
    k = np.arange(32)
    slope, icpt = np.polyfit(k, hits, 1)
    for _ in range(3):  # drop beats where another instrument wins the correlation, refit
        ok = np.abs(hits - np.polyval([slope, icpt], k)) < 0.002
        slope, icpt = np.polyfit(k[ok], hits[ok], 1)
    resid = (hits[ok] - np.polyval([slope, icpt], k[ok])) * 1000
    # 6. where the beat is heard: the first sharp transient of the averaged downbeat (beats 1 and 3, no clap),
    #    whichever band (kick body 30–120 Hz or its click 2–16 kHz) crosses half its peak first
    acc_l = np.zeros(int(0.3 * SR)); acc_h = np.zeros(int(0.3 * SR))
    for i in range(0, 28, 2):
        a = int((icpt + slope * i - 0.15) * SR); seg = x[a:a + len(acc_l)].astype(float)
        acc_l += bandpass(seg, 30, 120) ** 2; acc_h += bandpass(seg, 2000, 16000) ** 2
    def first_half(acc):
        e = np.sqrt(np.convolve(acc, np.ones(48) / 48, 'same'))[int(0.1 * SR):int(0.3 * SR)]
        return (np.argmax(e > 0.5 * e.max()) + int(0.1 * SR)) / SR - 0.15
    attack = min(first_half(acc_l), first_half(acc_h))
    start = icpt + attack
    if verbose:
        print(f'tempo {60 / slope:.3f} BPM  (period {slope * 1000:.3f} ms)')
        print(f'drop / downbeat (grid) at {icpt:.4f} s, kick attack +{attack * 1000:.1f} ms → loop starts at {start:.4f} s')
        print(f'grid residuals: max {np.abs(resid).max():.3f} ms over {ok.sum()} of 32 beats')
        print('beat times in the loop:', ', '.join(f'{i * slope:.3f}' for i in range(28)))
    return start, slope


# ───────── UI sounds (synthesised, deterministic) ─────────
rng = np.random.default_rng(7)
tt = lambda d: np.arange(int(d * SR)) / SR


def bandpass(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))


def ping(f, dur, decay, amp=1.0, att=0.0008):
    t = tt(dur)
    return amp * np.sin(2 * np.pi * f * t) * np.exp(-t / decay) * np.minimum(1, t / att)


def noise_burst(dur, decay, lo, hi, amp=1.0):
    t = tt(dur)
    return amp * bandpass(rng.standard_normal(len(t)), lo, hi) * np.exp(-t / decay) * 0.3


def mixs(*xs):
    n = max(len(x) for x in xs); y = np.zeros(n)
    for x in xs: y[:len(x)] += x
    return y


def sweep(f0, f1, dur, decay, amp=1.0):
    t = tt(dur); f = f0 + (f1 - f0) * np.minimum(1, t / (dur * 0.5))
    return amp * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay) * np.minimum(1, t / 0.003)


def airy(dur, peak, lo, hi, amp=1.0):
    t = tt(dur)
    envl = np.where(t < peak, (t / peak) ** 2, np.exp(-(t - peak) / (0.35 * (dur - peak))))
    return amp * bandpass(rng.standard_normal(len(t)), lo, hi) * envl * 0.25


def sound(kind):
    j = 1 + 0.06 * rng.standard_normal()
    if kind == 'click':   return mixs(ping(1700 * j, .06, .016, .55), noise_burst(.02, .0025, 2500, 9000, 1.2), ping(140, .06, .02, .35))
    if kind == 'key':     return mixs(ping(2300 * j, .03, .007, .22), noise_burst(.015, .0018, 3000, 12000, .7))
    if kind == 'grab':    return mixs(ping(950, .06, .014, .5), noise_burst(.02, .002, 2000, 8000, .9))
    if kind == 'release': return mixs(ping(1350, .06, .014, .45), noise_burst(.02, .002, 2000, 8000, .8))
    if kind == 'tock':    return mixs(ping(520, .12, .04, .5), ping(1040, .08, .015, .15))
    if kind == 'toggle':  return mixs(ping(1900, .07, .014, .5), ping(2850, .07, .02, .2), noise_burst(.02, .002, 2500, 9000, .9))
    if kind == 'chime':   return mixs(ping(1046.5, .5, .16, .35, .004), np.concatenate([np.zeros(int(.045 * SR)), ping(1568, .5, .18, .3, .004)]))
    if kind == 'pop':     return sweep(320, 760, .14, .045, .5)
    if kind == 'tick':    return ping(3000 * j, .02, .004, .25)
    if kind == 'hover':   return ping(1250, .04, .01, .18)
    if kind == 'enter':   return mixs(ping(190, .12, .04, .55), ping(1400, .05, .01, .3), noise_burst(.02, .003, 1500, 7000, .9))
    if kind == 'swish':   return airy(.22, .07, 1800, 7000, .5)
    if kind == 'whoosh':  return airy(.5, .17, 400, 5000, .9)
    raise ValueError(kind)


def peak_of(x):
    e = np.convolve(np.abs(x), np.ones(48) / 48, 'same')
    return int(np.argmax(e))


def mix(sounds_json, out='out/mix.wav'):
    start, period = analyze(verbose=True)
    n = int(LOOP * SR)
    song = load(SONG, 2)
    a = int(round(start * SR))
    music = song[a:a + n].astype(np.float64).copy()
    # the bar after the loop rings into its first beat: fold 60 ms of it back, faded
    tail = song[a + n:a + n + int(0.06 * SR)].astype(np.float64)
    music[:len(tail)] += tail * np.linspace(1, 0, len(tail))[:, None]
    sfx = np.zeros(n)
    events = json.load(open(sounds_json))
    for ev in events:
        s = sound(ev['k']) * ev.get('g', 1.0)
        at = int(round(ev['t'] * SR)) - peak_of(s)   # the sound's measured peak lands on its cue
        idx = (np.arange(len(s)) + at) % n          # wrap around the loop point
        np.add.at(sfx, idx, s)
    sfx *= 0.55 / max(1e-9, np.abs(sfx).max())
    y = music * 0.82 + sfx[:, None]
    y *= 0.89 / np.abs(y).max()  # ≈ -1 dBFS
    import wave
    with wave.open(out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((y * 32767).astype('<i2').tobytes())
    print(f'{len(events)} cues → {out}')


if __name__ == '__main__':
    if sys.argv[1] == 'analyze':
        analyze()
    else:
        mix(sys.argv[2], *(sys.argv[3:4]))
