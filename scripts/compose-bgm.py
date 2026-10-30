"""Original 32-bar, 88 BPM score: '轻轻弹'. Render a seamless local MP3.

Dev-only requirements: numpy, scipy, ffmpeg. No runtime synthesis/dependencies.
Tails and room reflections wrap across the bar-32/bar-1 seam.
"""
from pathlib import Path
import subprocess
import tempfile
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
BEAT = 60 / 88
SECONDS = 32 * 4 * BEAT
N = round(SECONDS * SR)
mix = np.zeros((N, 2), dtype=np.float64)
rng = np.random.default_rng(142857)


def frequency(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def put(samples, beat, level, pan=0):
    start = round(beat * BEAT * SR)
    indices = (start + np.arange(len(samples))) % N
    angle = (pan + 1) * np.pi / 4
    mix[indices, 0] += samples * level * np.cos(angle)
    mix[indices, 1] += samples * level * np.sin(angle)


def note(midi, beat, length, level, kind='wood', pan=0):
    duration = length * BEAT
    t = np.arange(round((duration + 1.4) * SR)) / SR
    f = frequency(midi)
    if kind == 'wood':
        # Soft mallet: mostly the fundamental, a short warm overtone, no bright click.
        wave = np.sin(2 * np.pi * f * t) * np.exp(-t / .55)
        wave += .19 * np.sin(2 * np.pi * f * 2.756 * t) * np.exp(-t / .12)
        wave += .045 * np.sin(2 * np.pi * f * 5.404 * t) * np.exp(-t / .055)
        envelope = (1 - np.exp(-t / .008)) * np.exp(-np.maximum(0, t - duration) / .18)
    elif kind == 'keys':
        wave = np.sin(2 * np.pi * f * t + .36 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t / .14))
        wave += .10 * np.sin(2 * np.pi * f * 2.002 * t) * np.exp(-t / .4)
        envelope = (1 - np.exp(-t / .027)) * np.exp(-t / 1.15) * np.exp(-np.maximum(0, t - duration) / .40)
    else:
        wave = np.sin(2 * np.pi * f * t) + .16 * np.sin(2 * np.pi * f * 2 * t)
        envelope = (1 - np.exp(-t / .018)) * np.exp(-t / .65) * np.exp(-np.maximum(0, t - duration) / .10)
    envelope[-450:] *= np.linspace(1, 0, 450)
    put(wave * envelope, beat, level, pan)


def brush(beat, level, pan):
    t = np.arange(round(.13 * SR)) / SR
    noise = rng.normal(size=len(t))
    noise = signal.sosfilt(signal.butter(2, [1700, 4200], 'bandpass', fs=SR, output='sos'), noise)
    envelope = np.sin(np.minimum(t / .013, 1) * np.pi / 2) ** 2 * np.exp(-t / .025)
    envelope[-300:] *= np.linspace(1, 0, 300)
    put(noise * envelope, beat, level, pan)


def tap(beat, level):
    t = np.arange(round(.11 * SR)) / SR
    wave = np.sin(2 * np.pi * 260 * t) + .23 * np.sin(2 * np.pi * 730 * t)
    envelope = (1 - np.exp(-t / .004)) * np.exp(-t / .018)
    envelope[-250:] *= np.linspace(1, 0, 250)
    put(wave * envelope, beat, level, -.24)


# Close, warm voicings: Cmaj9 / Am7 / Fmaj9 / G6, with a gentle middle-eight.
chords = {
    'C': (36, [55, 59, 62, 64]), 'A': (33, [55, 60, 64, 67]),
    'F': (29, [53, 57, 60, 64]), 'G': (31, [55, 59, 62, 64]),
    'E': (28, [55, 59, 62, 67]), 'D': (38, [57, 60, 64, 65]),
}
progression = ['C','C','A','A','F','F','G','G',
               'C','E','A','A','F','D','G','G',
               'F','F','C','C','D','A','G','G',
               'C','E','A','A','F','D','G','G']
# Hand-composed phrases, with rests and space at their ends (beat, MIDI, length).
phrases = [
    [(0,76,.55),(.75,79,.5),(1.5,81,.8),(3,79,.6)],
    [(.5,76,.65),(1.5,74,.55),(2.5,72,.95)],
    [(0,72,.6),(1,76,.55),(1.75,79,.75),(3,76,.6)],
    [(.5,74,.6),(1.5,72,1.1)],
    [(0,69,.65),(1,72,.55),(2,76,.95)],
    [(.5,79,.55),(1.5,76,.55),(2.5,74,.8)],
    [(0,74,.55),(.75,76,.5),(1.5,79,.8),(3,76,.5)],
    [(.5,74,.65),(1.5,71,.75)],
    [(0,76,.55),(.75,79,.55),(2,83,.85)],
    [(.5,79,.65),(1.5,76,.6),(2.5,74,.7)],
    [(0,72,.7),(1.25,76,.55),(2.25,79,.7)],
    [(.5,81,.5),(1.25,79,.55),(2.25,76,.9)],
    [(0,77,.6),(1,76,.55),(2,72,.9)],
    [(.5,74,.6),(1.5,77,.6),(2.5,76,.8)],
    [(0,74,.6),(1,71,.6),(2,67,.8)],
    [(1,71,.6),(2.5,74,.55)],
    [(0,72,.8),(1.5,69,.65),(2.5,67,.8)],
    [(.5,69,.7),(2,72,1.0)],
    [(0,67,.65),(1,72,.65),(2.5,76,.8)],
    [(.5,74,.7),(2,72,1.0)],
    [(0,69,.65),(1,74,.65),(2.5,77,.8)],
    [(.5,76,.65),(1.75,72,1.0)],
    [(0,71,.65),(1.5,74,.6),(2.5,79,.65)],
    [(.5,76,.6),(1.5,74,.8)],
    [(0,76,.55),(.75,79,.5),(1.5,81,.8),(3,79,.6)],
    [(.5,76,.65),(1.5,74,.65),(2.5,71,.8)],
    [(0,72,.55),(1,76,.6),(2,79,.8)],
    [(.5,81,.55),(1.5,79,.55),(2.5,76,.9)],
    [(0,77,.6),(1.25,76,.6),(2.5,72,.7)],
    [(.5,74,.6),(1.5,77,.65),(2.5,76,.7)],
    [(0,74,.55),(1,71,.65),(2,67,.8)],
    [(.5,71,.7),(2,74,.65)],
]

for bar, chord in enumerate(progression):
    beat = bar * 4
    root, voicing = chords[chord]
    # Airy electric-piano offbeats, slight arpeggiation rather than hard blocks.
    for hit, strength in [(0, .040), (2.5, .024)]:
        for i, pitch in enumerate(voicing):
            note(pitch, beat + hit + i * .025, 1.7, strength, 'keys', (i - 1.5) * .16)
    note(root + 12, beat, 1.3, .095, 'bass')
    note(root + (19 if bar % 2 else 24), beat + 2.5, .7, .058, 'bass')
    for i, (offset, pitch, length) in enumerate(phrases[bar]):
        note(pitch, beat + offset + (0.035 if offset % 1 else 0), length,
             .105 * (1 - .07 * (i % 3)), 'wood', .12 + np.sin(bar) * .07)
    # Deliberately light percussion and a quieter, spacious third section.
    if not 16 <= bar < 20:
        tap(beat + 1, .014); tap(beat + 3, .011)
        for offset in [.55, 1.55, 2.55, 3.55]:
            brush(beat + offset, .013 if bar < 8 else .017, .4)
    if bar in [5, 13, 21, 29]:
        note(voicing[-1] + 12, beat + 3.5, .5, .025, 'keys', -.42)

# Circular, damped reflections preserve the loop; no long noisy reverb wash.
dry = mix.copy()
room = signal.sosfilt(signal.butter(2, 3100, fs=SR, output='sos'), np.tile(dry, (2, 1)), axis=0)[N:]
for delay, level in [(.117, .12), (.223, .08), (.347, .05)]:
    mix += np.roll(room[:, ::-1], round(delay * SR), axis=0) * level
mix -= mix.mean(axis=0)
mix *= .50 / np.max(np.abs(mix))
destination = Path(__file__).resolve().parents[1] / 'dist/audio/light-bounce.mp3'
destination.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as temp:
    wav = Path(temp) / 'light-bounce.wav'
    wavfile.write(wav, SR, (mix * 32767).astype(np.int16))
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                    '-codec:a', 'libmp3lame', '-b:a', '112k', '-metadata', 'title=轻轻弹',
                    '-metadata', 'artist=球球了 Original Soundtrack', str(destination)], check=True)
print(f'{destination.name}: {SECONDS:.3f}s, peak {np.max(np.abs(mix)):.3f}, RMS {np.sqrt(np.mean(mix**2)):.4f}, seam {np.max(np.abs(mix[0]-mix[-1])):.6f}')
