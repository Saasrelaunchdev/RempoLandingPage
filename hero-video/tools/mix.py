#!/usr/bin/env python3
"""The hero video's sound: the narration, a quiet music bed that follows the story, and a few effects on the beats
the picture shows (a phone ringing, a message arriving, a job marked complete). Everything is synthesised here, so
there is no licence to track. The music ducks under the voice; the mix is set to -16 LUFS by tools/render.mjs.

    .venv/bin/python tools/mix.py        # writes audio/mix.wav (48 kHz stereo, not committed) from audio/narration.flac and timings.json
"""
import json, os, re
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve, resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
rng = np.random.default_rng(7)

tm = json.load(open(os.path.join(ROOT, "audio", "timings.json")))
DUR = tm["duration"]
N = int(DUR * SR) + SR
L = {l["id"]: l for l in tm["lines"]}
norm = lambda x: re.sub(r"[^a-z0-9']", "", x.lower())


def w(lid, word, n=0):
    """When a word starts, as story.js reads it."""
    l = L[lid]
    c = 0
    for x in l.get("words", []):
        if norm(x["w"]) == norm(word):
            if c == n:
                return x["t"]
            c += 1
    i = l["text"].lower().find(word.lower())
    return l["start"] + (l["end"] - l["start"]) * (max(i, 0) / len(l["text"]))


def s(lid):
    return L[lid]["start"]


def hz(note):
    """'C4' -> frequency"""
    names = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
    m = re.match(r"([A-G][#b]?)(-?\d)", note)
    return 440.0 * 2 ** ((names[m.group(1)] + 12 * (int(m.group(2)) + 1) - 69) / 12)


def lp(x, cut, order=2):
    return sosfilt(butter(order, cut, "low", fs=SR, output="sos"), x)


def hp(x, cut, order=2):
    return sosfilt(butter(order, cut, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def put(bus, t, sig, gain=1.0, pan=0.0):
    """Add a mono (or stereo) signal at time t, panned -1..1."""
    a = int(t * SR)
    if a >= N or a + 1 < 0:
        return
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l, sig * r], 1) * np.sqrt(2)
    b = min(N, a + len(sig))
    bus[a:b] += sig[: b - a] * gain


def env(n, a, d, sustain=1.0, release=None):
    e = np.ones(n) * sustain
    ai = max(1, int(a * SR))
    e[:ai] = np.linspace(0, 1, ai) ** 1.5 * sustain
    if release:
        ri = max(1, int(release * SR))
        e[-ri:] *= np.linspace(1, 0, ri) ** 2
    return e


# ---------------------------------------------------------------------------------------------------------- music
TEMPO = 84.0
BEAT = 60.0 / TEMPO
BAR = BEAT * 4
CH = {
    "C": ["C3", "E3", "G3"], "Am": ["A2", "C3", "E3"], "F": ["F2", "A2", "C3"], "G": ["G2", "B2", "D3"],
    "Dm": ["D3", "F3", "A3"], "E": ["E2", "G#2", "B2"], "Gsus": ["G2", "C3", "D3"], "Fmaj7": ["F2", "A2", "C3", "E3"],
}
ROOT_OF = {"C": "C2", "Am": "A1", "F": "F1", "G": "G1", "Dm": "D2", "E": "E2", "Gsus": "G1", "Fmaj7": "F1"}


def pad_note(f, dur, gain):
    """A soft pad: a few detuned triangle-like tones, a slow swell and fall."""
    n = int((dur + 1.6) * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for ch, det in enumerate((-0.0035, 0.0035)):
        x = np.zeros(n)
        for k in (1, 3, 5, 7):
            x += np.sin(2 * np.pi * f * (1 + det) * k * t + rng.random() * 6.28) / (k * k)
        x += 0.5 * np.sin(2 * np.pi * f * 2.001 * t)
        out[:, ch] = x
    e = env(n, 0.9, 0, 1.0, release=1.6)
    trem = 1 + 0.06 * np.sin(2 * np.pi * 0.23 * t)
    return out * (e * trem)[:, None] * gain


def pluck(f, gain, decay=0.55):
    """A soft mallet or electric piano note."""
    n = int(decay * 5 * SR)
    t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * f * t) + 0.32 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / (decay * 0.35))
         + 0.12 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t / (decay * 0.18)))
    e = np.exp(-t / decay) * np.minimum(1, t / 0.004)
    return x * e * gain


def bass(f, dur, gain):
    n = int((dur + 0.4) * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) + 0.2 * np.sin(2 * np.pi * 2 * f * t)
    return x * env(n, 0.06, 0, 1.0, release=0.5) * np.exp(-t / (dur * 1.6)) * gain


def section(bus, start, end, chords, pad=0.05, arp=0.0, arp_oct=1, arp_step=0.5, bass_g=0.07, pulse=0.0, shaker=0.0):
    t = start
    i = 0
    while t < end - 0.2:
        ch = chords[i % len(chords)]
        dur = min(BAR, end - t)
        for nm in CH[ch]:
            put(bus, t, pad_note(hz(nm) * 2, dur, pad), pan=rng.uniform(-0.3, 0.3))
        put(bus, t, bass(hz(ROOT_OF[ch]), dur, bass_g))
        if arp > 0:
            notes = [hz(n) * 2 ** arp_oct for n in CH[ch]]
            seq = [notes[0], notes[1], notes[2], notes[1] * 2 if len(notes) < 4 else notes[3], notes[2], notes[1], notes[0] * 2, notes[2]]
            k = 0
            while k * arp_step * BEAT < dur - 0.05:
                f = seq[k % len(seq)]
                put(bus, t + k * arp_step * BEAT, pluck(f, arp * (1.0 if k % 2 == 0 else 0.72)), pan=0.35 * np.sin(k * 1.3))
                k += 1
        if pulse > 0:
            for b in range(4):
                if b * BEAT < dur:
                    n = int(0.35 * SR)
                    tt = np.arange(n) / SR
                    thump = np.sin(2 * np.pi * 52 * tt) * np.exp(-tt / 0.09)
                    put(bus, t + b * BEAT, thump, pulse * (1.0 if b % 2 == 0 else 0.55))
        if shaker > 0:
            for b in range(8):
                if b * BEAT / 2 < dur:
                    n = int(0.06 * SR)
                    nz = hp(rng.standard_normal(n), 6000) * np.exp(-np.arange(n) / SR / 0.018)
                    put(bus, t + b * BEAT / 2, nz, shaker * (1.0 if b % 2 else 0.6), pan=0.3)
        t += BAR
        i += 1


def music():
    bus = np.zeros((N, 2))
    # day: the work, then the quiet
    section(bus, 0.0, 11.6, ["C", "Am", "F", "G"], pad=0.045, arp=0.05, arp_step=0.5)
    section(bus, 11.6, 24.6, ["Am", "F", "C", "Gsus"], pad=0.042, arp=0.035, arp_step=1.0)
    # night: the leak, the search, the call that goes to them
    section(bus, 24.6, 49.4, ["Am", "F", "Dm", "E"], pad=0.05, arp=0.028, arp_oct=0, arp_step=1.0, bass_g=0.08, pulse=0.05)
    # the cost
    section(bus, 49.4, 69.5, ["Am", "F", "C", "G"], pad=0.04, arp=0.0, bass_g=0.06)
    # Rempo, every customer asked, the next search
    section(bus, 69.5, 107.1, ["C", "G", "Am", "F"], pad=0.045, arp=0.05, arp_oct=1, arp_step=0.5, bass_g=0.075, shaker=0.012)
    # the close: F, G, then C held under the end card
    section(bus, 107.1, 107.1 + BAR, ["Fmaj7"], pad=0.05, arp=0.045, arp_step=0.5)
    t = 107.1 + BAR
    for nm in ["C3", "E3", "G3", "C4"]:
        put(bus, t, pad_note(hz(nm) * 2, DUR - t + 0.5, 0.05))
    put(bus, t, bass(hz("C2"), DUR - t, 0.08))
    for k, nm in enumerate(["C5", "E5", "G5", "C6"]):
        put(bus, t + k * 0.18, pluck(hz(nm), 0.05, decay=1.2), pan=-0.3 + k * 0.2)
    return bus


# ---------------------------------------------------------------------------------------------------------- effects
def pop(gain=0.05):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = 620 + 380 * np.minimum(1, t / 0.04)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035) * np.minimum(1, t / 0.003)
    return x * gain


def whoosh(dur=0.7, gain=0.05, up=True):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    steps = 12
    for i in range(steps):
        a, b = i * n // steps, (i + 1) * n // steps
        k = i / (steps - 1) if up else 1 - i / (steps - 1)
        lo = 300 + 2400 * k
        seg = bp(noise, lo, lo * 2.2)[a:b]
        out[a:b] = seg
    e = np.sin(np.pi * np.minimum(1, t / dur)) ** 2
    return lp(out * e, 7000) * gain


def chime(notes, gain=0.05, step=0.11, decay=0.9):
    total = int((len(notes) * step + decay * 4) * SR)
    out = np.zeros(total)
    for i, nm in enumerate(notes):
        f = hz(nm)
        n = int(decay * 4 * SR)
        t = np.arange(n) / SR
        x = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / (decay * 0.25))
             + 0.15 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / (decay * 0.1)))
        x *= np.exp(-t / decay) * np.minimum(1, t / 0.003)
        a = int(i * step * SR)
        out[a:a + n] += x
    return out * gain


def ring(dur, gain=0.05):
    """A phone ringing: a two-tone trill, on and off."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * 1046 * t) + 0.7 * np.sin(2 * np.pi * 1318 * t)) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 16 * t)))
    gate = ((t % 1.2) < 0.38) | (((t % 1.2) > 0.5) & ((t % 1.2) < 0.88))
    sm = lp(gate.astype(float), 60)
    return lp(x * sm, 5000) * gain


def ringback(dur, gain=0.03):
    """What a caller hears while the other phone rings (440 and 480 Hz, two seconds on)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 440 * t) + np.sin(2 * np.pi * 480 * t)
    gate = lp(((t % 3.0) < 2.0).astype(float), 40)
    return lp(x * gate, 3000) * gain


def drip(gain=0.03):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    f = 1900 * np.exp(-t / 0.05) + 700
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.04)
    return x * gain


def tick(gain=0.02):
    n = int(0.03 * SR)
    x = hp(rng.standard_normal(n), 2500) * np.exp(-np.arange(n) / SR / 0.006)
    return x * gain


def effects():
    bus = np.zeros((N, 2))
    cu = w("A2", "Customers")
    put(bus, w("A2", "Furnaces"), pop(0.045), pan=-0.2)
    put(bus, w("A2", "Leaks"), pop(0.045), pan=0.2)
    put(bus, cu + 0.5, pop(0.04), pan=-0.1)
    put(bus, 12.9, whoosh(0.5, 0.025), pan=-0.2)
    for i, word in enumerate(["dinner", "kids", "life"]):
        put(bus, w("B2", word) - 0.05, pop(0.04), pan=[-0.4, -0.5, 0.4][i])
    put(bus, s("B3") + 0.1, ring(0.85, 0.035), pan=-0.5)
    put(bus, 24.15, whoosh(0.8, 0.045, up=False))
    for k in range(9):
        put(bus, 25.2 + k * 0.625 + 0.37, drip(0.03), pan=0.3)
    put(bus, 31.2, whoosh(0.6, 0.035))
    for k in range(15):
        put(bus, 31.5 + k * 0.08 + rng.uniform(0, 0.015), tick(0.025), pan=0.15)
    for t_ in (s("C3"), w("C3", "newest"), w("C4", "two") - 0.1):
        put(bus, t_, tick(0.02))
    call = w("C5", "calls")
    put(bus, call, tick(0.03))
    put(bus, call + 0.45, ringback(1.3, 0.02))
    put(bus, 47.35, ring(2.2, 0.045), pan=0.4)
    put(bus, 49.25, whoosh(0.7, 0.04))
    put(bus, s("D2") - 0.25, whoosh(0.5, 0.025))
    put(bus, 58.4, whoosh(0.6, 0.03, up=False))
    put(bus, w("D3", "never", 1) - 0.2, whoosh(1.2, 0.025))
    put(bus, 65.45, whoosh(0.5, 0.035))
    put(bus, w("D4", "proof") - 0.25, pop(0.035), pan=0.5)
    put(bus, 70.55, chime(["C5", "E5", "G5", "C6"], 0.045, step=0.09, decay=1.1))
    put(bus, w("E2", "connect") + 0.7, tick(0.035), pan=-0.3)
    put(bus, w("E3", "complete"), chime(["G5", "C6"], 0.04, step=0.1, decay=0.6), pan=-0.4)
    put(bus, w("E3", "photo") - 0.4, chime(["E6", "A6"], 0.035, step=0.12, decay=0.35), pan=0.4)
    put(bus, w("E3", "reminder") - 0.3, chime(["E6", "A6"], 0.03, step=0.12, decay=0.35), pan=0.4)
    put(bus, w("E4", "reply"), pop(0.035), pan=0.3)
    for i, nm in enumerate(["C5", "D5", "E5", "G5", "A5"]):
        put(bus, s("E5") + 0.15 + i * 0.32 + 0.5, chime([nm], 0.025, decay=0.5), pan=-0.6 + i * 0.3)
    for k in range(3):
        put(bus, s("F1") + 0.1 + k * 0.35, pop(0.03), pan=-0.4 + k * 0.4)
    put(bus, 99.1, whoosh(0.8, 0.04, up=False))
    put(bus, w("F2", "searches"), whoosh(0.5, 0.03))
    put(bus, 104.35, tick(0.03))
    put(bus, 104.8, ringback(0.65, 0.02))
    put(bus, 105.5, ring(0.95, 0.045), pan=-0.4)
    put(bus, 106.8, whoosh(0.7, 0.04))
    put(bus, 109.7, chime(["G5", "C6", "E6"], 0.03, step=0.14, decay=1.4))
    return bus


def reverb(x, secs=2.0, wet=0.22):
    n = int(secs * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t / (secs / 6.9))
        ir = lp(ir, 5000)
        ir /= np.sqrt(np.sum(ir ** 2))
        out[:, ch] = fftconvolve(x[:, ch], ir)[: len(x)]
    return x * (1 - wet) + out * wet * 1.6


MUSIC, FX = 0.13, 0.8      # the bed sits about 17 dB under the voice, 14 dB in the pauses
TARGET = "I=-16.5:TP=-1.5:LRA=7"   # as loud as the testimonial on the same page (-16.8 LUFS)


def ffmpeg(args):
    import subprocess
    return subprocess.run(["ffmpeg", "-y", "-hide_banner", "-nostats", *args], capture_output=True, text=True, check=True)


def compress_voice(v):
    """Even out the voice so the mix can reach web loudness without clipping its peaks."""
    tmp = os.path.join(ROOT, "out", "voice-pre.wav")
    sf.write(tmp, v.astype(np.float32), SR, subtype="FLOAT")
    ffmpeg(["-i", tmp, "-af", "acompressor=threshold=0.08:ratio=3:attack=4:release=140:knee=3:makeup=1.6", os.path.join(ROOT, "out", "voice-comp.wav")])
    out, _ = sf.read(os.path.join(ROOT, "out", "voice-comp.wav"), dtype="float64")
    return out[: len(v)]


def loudness(src, dst):
    """Two passes of EBU R128 loudness normalisation, linear when the peaks allow it."""
    r = ffmpeg(["-i", src, "-af", f"loudnorm={TARGET}:print_format=json", "-f", "null", "-"])
    j = json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])
    ffmpeg(["-i", src, "-af", f"loudnorm={TARGET}:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}"
            f":measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true", "-ar", str(SR), "-c:a", "pcm_s16le", dst])


def main():
    voice, vsr = sf.read(os.path.join(ROOT, "audio", "narration.flac"), dtype="float64")
    voice = resample_poly(voice, SR, vsr)
    # a little shape for the voice: no rumble, a touch of presence
    voice = hp(voice, 75)
    voice = voice + 0.18 * bp(voice, 2500, 5500)
    v = np.zeros(N)
    v[: min(N, len(voice))] = voice[:N]
    v = compress_voice(v)
    # the music steps back while he speaks
    rms = np.sqrt(np.maximum(lp(v ** 2, 8), 0) + 1e-12)
    speaking = (rms > 0.02).astype(float)
    duck = lp(speaking, 3)
    duck = np.clip(duck, 0, 1)
    gain = 1.0 - 0.55 * duck
    m = reverb(music(), 2.4, 0.3) * gain[:, None]
    fx = reverb(effects(), 1.4, 0.15)
    stems = {"voice": np.stack([v, v], 1) * 0.9, "music": m * MUSIC, "fx": fx * FX}
    mix = stems["voice"] + stems["music"] + stems["fx"]
    if os.environ.get("STEMS"):
        for k, x in stems.items():
            sf.write(os.path.join(ROOT, "out", f"stem-{k}.wav"), x[: int(DUR * SR)].astype(np.float32), SR, subtype="FLOAT")
    # fade in and out
    fi, fo = int(0.4 * SR), int(1.6 * SR)
    mix[:fi] *= np.linspace(0, 1, fi)[:, None]
    end = int(DUR * SR)
    mix = mix[:end]
    mix[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
    mix *= 0.7 / np.max(np.abs(mix))
    pre = os.path.join(ROOT, "out", "mix-pre.wav")
    sf.write(pre, mix.astype(np.float32), SR, subtype="FLOAT")
    loudness(pre, os.path.join(ROOT, "audio", "mix.wav"))
    sf.write(os.path.join(ROOT, "out", "music-only.wav"), (m[:end] / max(1e-9, np.max(np.abs(m)))).astype(np.float32) * 0.8, SR, subtype="PCM_16")
    print(f"mix: {end / SR:.2f}s at {SR} Hz stereo")


if __name__ == "__main__":
    main()
