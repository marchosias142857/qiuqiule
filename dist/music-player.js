// One resident source carries the endless clock through menus, battles and crossfades.
// Decoded music-time loop points; Boss includes an offline-blended return bridge.
const CROSSFADE = .65;
export const MUSIC_TRACKS = Object.freeze({
  endless: {title: '绕星', url: './audio/endless.mp3', loopStart: 9.1393, loopEnd: 118.8490, trimDB: 0},
  boss: {title: '冠冕', url: './audio/boss.mp3', loopStart: 11.51721088435374, loopEnd: 93.30421768707484, trimDB: -3},
});

const menu = {gain: .72, cutoff: 8000, duration: .6};
const play = {gain: 1, cutoff: 20000, duration: .6};
const result = {gain: .68, cutoff: 20000, duration: .45};
const failed = {gain: .55, cutoff: 20000, duration: .45};
export const MUSIC_SCENES = Object.freeze({
  home: {...menu, track: 'endless'}, endless: {...play, track: 'endless'},
  boss: {...play, track: 'boss'},
  resultEndless: {...result, track: 'endless'},
  failedEndless: {...failed, track: 'endless'},
});

// Keep the same linear segments in memory and on the AudioParam so an interrupted
// automation resumes at its actual instantaneous gain, even on older WebViews.
function valueAt(points, time) {
  if (time <= points[0].time) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1], right = points[i];
    if (time <= right.time) return left.value + (right.value - left.value) * (time - left.time) / (right.time - left.time);
  }
  return points[points.length - 1].value;
}
function schedule(param, points) {
  const first = points[0];
  param.cancelScheduledValues(first.time);
  param.setValueAtTime(first.value, first.time);
  for (const point of points.slice(1)) param.linearRampToValueAtTime(point.value, point.time);
  return points;
}

export class MusicPlayer {
  constructor(context, destination, load, scene) {
    this.context = context;
    this.load = load;
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = .707;
    this.sceneGain = context.createGain();
    this.filter.connect(this.sceneGain);
    this.sceneGain.connect(destination);
    this.buffers = new Map();
    this.loads = new Map();
    this.voices = new Map();
    this.starts = Object.fromEntries(Object.keys(MUSIC_TRACKS).map(name => [name, 0]));
    this.resident = null;
    this.track = null;
    this.pending = null;
    this.activationAllowed = false;
    this.switchAt = this.fadeEnd = 0;
    this.scene = scene;
    this.wanted = MUSIC_SCENES[scene].track;
    const mix = MUSIC_SCENES[scene];
    this.filter.frequency.value = mix.cutoff;
    this.sceneGain.gain.value = mix.gain;
    this.levelPoints = [{time: 0, value: mix.gain}];
    this.filterPoints = [{time: 0, value: mix.cutoff}];
  }
  ensure(name) {
    if (this.buffers.has(name)) return Promise.resolve(this.buffers.get(name));
    if (this.loads.has(name)) return this.loads.get(name);
    const work = Promise.resolve().then(() => this.load(name)).then(buffer => {
      if (!Number.isFinite(buffer?.duration) || buffer.duration < MUSIC_TRACKS[name].loopEnd) {
        throw new Error('Incomplete music track: ' + name);
      }
      if (name === 'endless' || this.wanted === name) this.buffers.set(name, buffer);
      return buffer;
    }).finally(() => this.loads.delete(name));
    this.loads.set(name, work);
    return work;
  }
  spawn(name, buffer, time, gainValue) {
    const track = MUSIC_TRACKS[name], source = this.context.createBufferSource(), gain = this.context.createGain();
    const trim = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = track.loopStart;
    source.loopEnd = track.loopEnd;
    gain.gain.value = gainValue;
    // Apply the track balance before playback, independently of the normalized
    // crossfade. Reversing a fade must never normalize the Boss trim back to 1.
    trim.gain.value = 10 ** (track.trimDB / 20);
    source.connect(trim);
    trim.connect(gain);
    gain.connect(this.filter);
    source.start(time);
    const voice = {name, source, trim, gain, time, points: [{time, value: gainValue}]};
    this.starts[name]++;
    this.voices.set(name, voice);
    return voice;
  }
  setScene(scene, {activate = true} = {}) {
    this.activationAllowed = activate;
    if (scene !== this.scene) {
      this.scene = scene;
      this.wanted = MUSIC_SCENES[scene].track;
      const now = this.context.currentTime, mix = MUSIC_SCENES[scene], end = now + mix.duration;
      this.levelPoints = schedule(this.sceneGain.gain, [
        {time: now, value: valueAt(this.levelPoints, now)}, {time: end, value: mix.gain},
      ]);
      this.filterPoints = schedule(this.filter.frequency, [
        {time: now, value: valueAt(this.filterPoints, now)}, {time: end, value: mix.cutoff},
      ]);
    }
    this.retireSilent();
    if (!this.retirement && this.fadeEnd > this.context.currentTime) this.queueRetirement();
    for (const name of this.buffers.keys()) if (name !== 'endless' && name !== this.wanted) this.buffers.delete(name);
    if (!activate) return null;
    if (this.wanted === this.track && this.resident) return null;
    if (this.pending?.name === this.wanted) return this.pending.work;
    const name = this.wanted;
    const work = this.activate(name).catch(() => {}).finally(() => {
      if (this.pending?.work === work) this.pending = null;
    });
    this.pending = {name, work};
    return work;
  }
  async activate(name) {
    if (!this.resident) {
      try {
        const buffer = await this.ensure('endless');
        if (!this.activationAllowed) return;
        if (!this.resident) {
          const now = this.context.currentTime;
          this.resident = this.spawn('endless', buffer, now, this.track ? 0 : 1);
          if (!this.track) this.track = 'endless';
        }
      } catch (error) {
        // A secondary track can still play offline if it was cached separately.
        if (name === 'endless') throw error;
      }
    }
    if (!this.activationAllowed || this.wanted !== name) return;
    if (this.track === name) return;
    const buffer = this.voices.get(name)?.source.buffer || await this.ensure(name);
    if (!this.activationAllowed || this.wanted !== name || this.track === name) return;
    this.crossfade(name, buffer);
  }
  crossfade(name, buffer) {
    const now = this.context.currentTime;
    this.retireSilent();
    const target = this.voices.get(name) || this.spawn(name, buffer, now, 0);
    if (name !== 'endless') this.buffers.set(name, buffer);
    // Rotate the entire current mix towards one target when a fade reverses.
    // Its sampled radius can be just below
    // one between linear automation points; recover it without a gain jump.
    const current = new Map([...this.voices.values()].map(voice => [voice, valueAt(voice.points, now)]));
    const targetGain = current.get(target);
    const otherWeight = Math.hypot(...[...current].filter(([voice]) => voice !== target).map(([, value]) => value));
    const radius = Math.hypot(targetGain, otherWeight), targetAngle = Math.atan2(otherWeight, targetGain);
    for (const [voice, from] of current) {
      const points = [{time: now, value: from}];
      for (let i = 1; i <= 12; i++) {
        const progress = i / 12, angle = targetAngle * (1 - progress), powerRadius = radius + (1 - radius) * progress;
        const value = voice === target ? powerRadius * Math.cos(angle) : otherWeight > 1e-8 ? from * powerRadius * Math.sin(angle) / otherWeight : 0;
        points.push({time: now + CROSSFADE * i / 12, value});
      }
      voice.points = schedule(voice.gain.gain, points);
    }
    this.track = name;
    this.switchAt = now;
    this.fadeEnd = now + CROSSFADE;
    this.queueRetirement();
  }
  retireSilent() {
    const now = this.context.currentTime;
    for (const [name, voice] of this.voices) {
      if (voice === this.resident || name === this.track || valueAt(voice.points, now) > 0) continue;
      voice.source.stop(now);
      voice.source.disconnect();
      voice.trim.disconnect();
      voice.gain.disconnect();
      this.voices.delete(name);
    }
  }
  queueRetirement() {
    clearTimeout(this.retirement);
    this.retirement = null;
    if (![...this.voices.values()].some(v => v !== this.resident && v.name !== this.track)) return;
    // Audio time freezes in the background. Recheck after resume via setScene;
    // only retire nodes once their audio-clock fade has really reached zero.
    const delay = Math.max(.025, this.fadeEnd - this.context.currentTime + .025);
    this.retirement = setTimeout(() => {
      this.retirement = null;
      this.retireSilent();
      if (this.context.state === 'running' && this.context.currentTime < this.fadeEnd) this.queueRetirement();
    }, delay * 1000);
    this.retirement.unref?.();
  }
  status() {
    const now = this.context.currentTime, voice = this.voices.get(this.track);
    const track = MUSIC_TRACKS[this.track];
    const elapsed = voice ? Math.max(0, now - voice.time) : 0;
    const span = track ? track.loopEnd - track.loopStart : 1;
    const loopAge = track ? Math.max(0, elapsed - track.loopStart) : 0;
    const position = loopAge > 0 ? track.loopStart + loopAge % span : elapsed;
    return {scene: this.scene, track: this.track, title: track?.title || null, position, loops: Math.floor(loopAge / span),
      switching: now < this.fadeEnd, switchAt: this.switchAt, fadeEnd: this.fadeEnd,
      startedAt: voice?.time ?? null, starts: {...this.starts}, cached: [...this.buffers.keys()]};
  }
}
