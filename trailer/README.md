# 球球了 v2.2.6 介绍视频

32 seconds, portrait 1080 × 1920, 30 fps, H.264 + AAC. Built from the shipped game assets and production physics at commit bc29ba201693dcfd854f6482ebbd22074147fa0d.

The renderer copies `dist/` into a temporary directory and appends a capture adapter there. Production files and the published game remain unchanged. A deterministic replay selects the last six seconds of a real first-stage run; enemy stats, scoring, spawning, upgrade rules, and entry/menu animations are unchanged. The edit jumps from the initial entry to that later gameplay excerpt at 7 seconds. Captions and the ending card are editorial layers. The optional drag expression is enabled for the footage.

## Reproduce

Install Node 22, Playwright 1.62.1 with Chromium, qrcode 1.5.4, FFmpeg, Noto Sans CJK, and Python with NumPy. Then run:

```sh
node trailer/render.mjs
python3 trailer/finish.py
```

Output: `trailer-output/qiuqiule-intro-v2.2.6-1080x1920.mp4`.

The original music `轻轻弹` comes from `dist/audio/light-bounce.mp3`. Gameplay effect events are recorded with frame timestamps, then synthesized using the game's frequency glides and amplitude envelope. No speech track is included.

## Validation

- 960 rendered frames; no browser errors.
- Real replay reaches 140 points at 13 seconds, selects energy +30%, and enters stage 2.
- Reviewed home, drag, entry, collision, upgrade, three palettes, and closing frames.
- Encoded MP4 decodes fully, 32 seconds at 1080 × 1920, 30 fps; stereo AAC 48 kHz.
- QR decoded from the encoded MP4 at 30 seconds and matches `https://marchosias142857.github.io/qiuqiule/`.
- Audio peak −5.8 dBFS; no clipping.

This isolated rendering branch does not update the game release or APK.
