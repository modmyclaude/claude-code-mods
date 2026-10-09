"""Synthesize Pager's nine alert sounds from scratch.

Every sample is computed here from sine and pulse waves: no recordings, no
samples from other products. Run it from anywhere with the Python standard
library alone:

    python3 -I mods/pager/tools/synth.py

It writes sounds/<pack>/<event>.wav beside this tools/ folder (mono, 16-bit,
22050 Hz, each under 1.2 s) and prints each file's size. The output is
deterministic, so running it again reproduces the committed files byte for byte.
"""

import math
import os
import struct
import wave

RATE = 22050
PEAK = 0.6  # leave headroom: an alert should be noticed, not startle
LOUDNESS = 0.14  # target RMS, so the three packs sound about as loud
FADE_IN = 0.004  # seconds; a ramp this short still removes the start click
FADE_OUT = 0.06
MAX_SECONDS = 1.2

# Equal-tempered pitches used below (Hz).
NOTE = {
    "G3": 196.00, "C4": 261.63, "C#4": 277.18, "D4": 293.66, "E4": 329.63,
    "G4": 392.00, "C5": 523.25, "D5": 587.33, "E5": 659.25, "G5": 783.99,
    "A5": 880.00, "C6": 1046.50, "E6": 1318.51,
}


def bell(freq, t, decay=0.35):
    """A soft struck bell: a few inharmonic partials, the high ones dying first."""
    partials = ((1.0, 1.0), (2.0, 0.45), (2.76, 0.22), (5.4, 0.08))
    out = 0.0
    for ratio, gain in partials:
        f = freq * ratio
        if f >= RATE / 2:
            continue
        out += gain * math.exp(-t * ratio ** 0.5 / decay) * math.sin(2 * math.pi * f * t)
    return out * min(1.0, t / 0.003)


def chime(freq, t, decay=0.5):
    """A gentle chime: a slow attack and a long, pure decay with one shimmer partial."""
    attack = min(1.0, t / 0.015)
    body = math.sin(2 * math.pi * freq * t)
    shimmer = 0.18 * math.sin(2 * math.pi * freq * 2.76 * t) * math.exp(-t / (decay * 0.4))
    return attack * math.exp(-t / decay) * (body + shimmer)


def pulse(freq, t, length, duty=0.25):
    """A band-limited 8-bit style pulse wave held for `length` seconds."""
    if t >= length:
        return 0.0
    out = 0.0
    k = 1
    while freq * k < RATE / 2 and k <= 24:
        out += (2 / (k * math.pi)) * math.sin(math.pi * k * duty) * math.cos(2 * math.pi * k * freq * t)
        k += 1
    # A 3 ms ramp at each end of the note keeps the blips click-free.
    edge = min(1.0, t / 0.003, (length - t) / 0.003)
    return 0.8 * out * edge


def gong(freq, t, decay=0.45):
    """A soft low tone: two slightly detuned sines that beat slowly, plus a sub octave."""
    attack = min(1.0, t / 0.02)
    body = math.sin(2 * math.pi * freq * t) + math.sin(2 * math.pi * freq * 1.006 * t)
    sub = 0.35 * math.sin(2 * math.pi * freq * 0.5 * t)
    return 0.5 * attack * math.exp(-t / decay) * (body + sub)


def render(seconds, voices):
    """Mix voices, each (start_seconds, fn(t)), into one faded, normalized clip."""
    n = int(seconds * RATE)
    buf = [0.0] * n
    for start, fn in voices:
        first = int(start * RATE)
        for i in range(first, n):
            buf[i] += fn((i - first) / RATE)
    # Match loudness (RMS) across packs so no pack is louder than another,
    # never letting the peak pass PEAK.
    top = max(abs(x) for x in buf) or 1.0
    rms = (sum(x * x for x in buf) / n) ** 0.5 or 1.0
    level = min(PEAK / top, LOUDNESS / rms)
    fade_in, fade_out = int(FADE_IN * RATE), int(FADE_OUT * RATE)
    for i in range(n):
        gain = level
        if i < fade_in:
            gain *= i / fade_in
        if i >= n - fade_out:
            gain *= (n - 1 - i) / fade_out
        buf[i] *= gain
    return buf


def blips(notes, step, hold):
    """Pulse notes `step` seconds apart, each held `hold` seconds."""
    return [(i * step, lambda t, f=NOTE[name]: pulse(f, t, hold)) for i, name in enumerate(notes)]


SOUNDS = {
    # Soft bell tones.
    ("classic", "done"): (1.05, [
        (0.00, lambda t: bell(NOTE["E5"], t)),
        (0.28, lambda t: bell(NOTE["C5"], t, decay=0.4)),
    ]),
    ("classic", "needs-you"): (0.85, [
        (0.00, lambda t: bell(NOTE["C5"], t, decay=0.25)),
        (0.18, lambda t: bell(NOTE["G5"], t, decay=0.3)),
    ]),
    ("classic", "error"): (1.0, [
        (0.00, lambda t: bell(NOTE["D4"], t, decay=0.3)),
        (0.30, lambda t: bell(NOTE["C#4"], t, decay=0.38)),
    ]),
    # 8-bit blips.
    ("arcade", "done"): (0.5, blips(["C5", "E5", "G5"], 0.075, 0.065)
                         + [(0.225, lambda t: pulse(NOTE["C6"], t, 0.2))]),
    ("arcade", "needs-you"): (0.42, blips(["A5", "A5", "E6"], 0.12, 0.08)),
    ("arcade", "error"): (0.5, blips(["G4", "E4", "C4", "G3"], 0.1, 0.09)),
    # Gentle chimes.
    ("zen", "done"): (1.15, [
        (0.00, lambda t: chime(NOTE["A5"], t)),
        (0.18, lambda t: chime(NOTE["E5"], t)),
        (0.36, lambda t: chime(NOTE["D5"], t, decay=0.55)),
    ]),
    ("zen", "needs-you"): (1.0, [
        (0.00, lambda t: chime(NOTE["D5"], t, decay=0.4)),
        (0.22, lambda t: chime(NOTE["A5"], t, decay=0.5)),
    ]),
    ("zen", "error"): (1.15, [
        (0.00, lambda t: gong(NOTE["D4"], t)),
    ]),
}


def write_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    frames = b"".join(struct.pack("<h", max(-32767, min(32767, round(x * 32767)))) for x in samples)
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(frames)


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sounds")
    for (pack, event), (seconds, voices) in SOUNDS.items():
        assert seconds < MAX_SECONDS, f"{pack}/{event} is {seconds}s"
        path = os.path.normpath(os.path.join(root, pack, f"{event}.wav"))
        write_wav(path, render(seconds, voices))
        print(f"{pack}/{event}.wav  {seconds:.2f}s  {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
