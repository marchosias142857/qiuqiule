"""Prepare the user-supplied v8.4.0 Boss.mp3 as the seamless BGM '冠冕'.

Usage: python scripts/prepare-boss-bgm.py /path/to/original/Boss.mp3
Requires numpy, scipy and ffmpeg with libmp3lame; no runtime dependencies.
Never overwrite the uploaded original. Re-encoding can change quiet sample
positions: copy loopStart/loopEnd from the generated JSON into music-player.js
and update service-worker integrity metadata whenever rebuilding the asset.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA256 = 'b97f2d9172299c406419f5eaa242d140e66888e33c4a55f900b36c1e4c001b50'
SR = 44100
BASE_START = round(11.52 * SR)
BASE_END = round(93.307 * SR)
BRIDGE = round(.180 * SR)
COPY_BEFORE = round(.060 * SR)
PADDING = round(.600 * SR)
GAIN_DB = -3.34


def run(*args):
    return subprocess.run(args, check=True, capture_output=True)


def decode(path, rate):
    pcm = run('ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le',
              '-ac', '2', '-ar', str(rate), '-').stdout
    return np.frombuffer(pcm, '<f4').reshape(-1, 2)


def db_rms(pcm):
    return float(20 * np.log10(max(np.sqrt(np.mean(pcm ** 2)), 1e-12)))


def loudness(path, start=None, end=None):
    prefix = '' if start is None else f'atrim=start={start}:end={end},'
    result = run('ffmpeg', '-hide_banner', '-nostats', '-i', str(path),
                 '-af', prefix + 'loudnorm=print_format=json', '-f', 'null', '-')
    log = result.stderr.decode()
    values = json.loads(log[log.rindex('{'):log.rindex('}') + 1])
    return {key: float(values[value]) for key, value in [
        ('integratedLUFS', 'input_i'), ('truePeakDBTP', 'input_tp'),
        ('loudnessRangeLU', 'input_lra')]}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(source, output, report_path, audition):
    if sha256(source) != SOURCE_SHA256:
        raise ValueError('Different source audio: analyze new musical loop points before processing.')
    if source.resolve() == output.resolve():
        raise ValueError('The original upload must not be overwritten.')
    original = decode(source, 48000)
    # Keep the original usable intro. Resample once, before editing boundaries.
    pcm = signal.resample_poly(original, 147, 160).astype('float32')
    edited = pcm[:BASE_END + PADDING].copy()
    fade_start, fade_end = BASE_END - COPY_BEFORE - BRIDGE, BASE_END - COPY_BEFORE
    incoming = pcm[BASE_START - COPY_BEFORE - BRIDGE:BASE_START - COPY_BEFORE]
    # An eased equal-power bridge preserves energy; neither side fades to silence.
    progress = .5 - .5 * np.cos(np.linspace(0, np.pi, BRIDGE))
    edited[fade_start:fade_end] = (
        edited[fade_start:fade_end] * np.cos(progress * np.pi / 2)[:, None]
        + incoming * np.sin(progress * np.pi / 2)[:, None])
    # Identical context around both loop boundaries limits MP3 transform artifacts.
    edited[fade_end:] = pcm[BASE_START - COPY_BEFORE:BASE_START + PADDING]
    # This small file-end fade is entirely OUTSIDE the playback loop.
    tail = round(.040 * SR)
    edited[-tail:] *= np.linspace(1, 0, tail)[:, None]
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        wav = Path(temporary) / 'bridge.wav'
        wavfile.write(wav, SR, edited)
        run('ffmpeg', '-v', 'error', '-i', str(wav), '-af', f'volume={GAIN_DB}dB',
            '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', str(SR), '-write_xing', '1',
            '-map_metadata', '-1', '-metadata', 'title=冠冕', '-metadata', 'artist=球球了',
            '-y', str(output))
    decoded = {rate: decode(output, rate) for rate in (44100, 48000)}
    # Shift BOTH endpoints by <=10ms, preserving the exact musical loop span.
    # Minimize the worse stereo sample step across common browser output rates.
    def discontinuity(offset):
        start, end = (BASE_START + offset) / SR, (BASE_END + offset) / SR
        return max(float(np.max(abs(x[round(start * rate)] - x[round(end * rate) - 1])))
                   for rate, x in decoded.items())
    offset = min(range(-441, 442), key=discontinuity)
    start, end = (BASE_START + offset) / SR, (BASE_END + offset) / SR
    measurements = {}
    for rate, x in decoded.items():
        s, e, window = round(start * rate), round(end * rate), round(.25 * rate)
        adjacent = np.diff(np.concatenate((x[e-window:e], x[s:s+window])), axis=0)
        step = float(np.max(abs(x[s] - x[e-1])))
        measurements[str(rate)] = {
            'durationSeconds': len(x) / rate,
            'seamMaxChannelStep': step,
            'seamStepDBFS': float(20 * np.log10(max(step, 1e-12))),
            'localAdjacentStepRMS': float(np.sqrt(np.mean(adjacent ** 2))),
            'beforeSeam250msRMSDBFS': db_rms(x[e-window:e]),
            'afterSeam250msRMSDBFS': db_rms(x[s:s+window]),
            'loopRMSDBFS': db_rms(x[s:e]),
            'lastLoopSecondRMSDBFS': db_rms(x[e-rate:e]),
            'first650msRMSDBFS': db_rms(x[:round(.65 * rate)]),
        }
        assert step < .005, 'Codec output needs a new seam review.'
    report = {
        'title': '冠冕', 'sourceFile': 'Boss.mp3', 'sourceSHA256': SOURCE_SHA256,
        'sourceDecodedDurationSeconds': len(original) / 48000,
        'sourceLoudness': loudness(source),
        'outputFile': 'dist/audio/boss.mp3', 'outputSHA256': sha256(output),
        'outputBytes': output.stat().st_size,
        'codec': 'MP3 192 kbps stereo 44100 Hz',
        'encoderVersion': run('ffmpeg', '-version').stdout.decode().splitlines()[0],
        'loopStart': start, 'loopEnd': end, 'loopDurationSeconds': end - start,
        'recipe': {'gainDB': GAIN_DB, 'normalization': 'fixed gain; no dynamic compression',
                   'introRetained': True, 'nominalLoopStart': BASE_START / SR,
                   'nominalLoopEnd': BASE_END / SR, 'bridgeSeconds': BRIDGE / SR,
                   'copiedContextBeforeSeamSeconds': COPY_BEFORE / SR,
                   'unusedTailSeconds': PADDING / SR, 'quietPointOffsetSamples': offset,
                   'reason': 'Approx. 36 bars of steady music; source weak outro starts around 94s.'},
        'outputLoudness': loudness(output), 'loopLoudness': loudness(output, start, end),
        'existingTracksLoudness': {name: loudness(ROOT / 'dist/audio' / f'{name}.mp3')
                                   for name in ('endless',)},
        'decodedMeasurements': measurements,
        'verificationScope': 'Decoded PCM and signal analysis; no claim of human listening.',
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if audition:
        x = decoded[SR]
        s, e = round(start * SR), round(end * SR)
        boundary = np.concatenate((x[e - 3 * SR:e], x[s:s + 3 * SR]))
        wavfile.write(audition, SR, boundary)
    print(json.dumps({'loopStart': start, 'loopEnd': end,
                      'sha256': report['outputSHA256'], 'loopLoudness': report['loopLoudness']}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/audio/boss.mp3')
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/V8.4.0-BOSS-AUDIO.json')
    parser.add_argument('--audition', type=Path, help='Optional six-second loop-boundary WAV.')
    args = parser.parse_args()
    prepare(args.source, args.output, args.report, args.audition)
