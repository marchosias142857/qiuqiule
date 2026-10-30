// Local music and synthesized effects share a master mute, with independent buses.
export const MUSIC_SECONDS = 32 * 4 * 60 / 88;
export const audioLevel = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
export const volumeGain = value => audioLevel(value) ** 1.5;

export class GameAudio {
  constructor({createContext = () => new (window.AudioContext || window.webkitAudioContext)(), loadMusic} = {}) {
    this.createContext = createContext;
    this.loadMusic = loadMusic || (async context => {
      const response = await fetch(new URL('./audio/light-bounce.mp3', import.meta.url));
      if (!response.ok || response.redirected) throw new Error('Music unavailable');
      return context.decodeAudioData(await response.arrayBuffer());
    });
    this.enabled = true; this.bgmVolume = .55; this.sfxVolume = .75;
    this.hidden = false; this.context = null; this.source = null;
    this.loading = null; this.suspendTimer = null; this.voices = new Set();
  }
  setLevels({sound = this.enabled, bgmVolume = this.bgmVolume, sfxVolume = this.sfxVolume}) {
    this.enabled = sound; this.bgmVolume = audioLevel(bgmVolume, .55); this.sfxVolume = audioLevel(sfxVolume, .75);
    this.applyLevels();
  }
  ramp(param, value, time = .04) {
    param.cancelScheduledValues(this.context.currentTime);
    param.setTargetAtTime(value, this.context.currentTime, time);
  }
  applyLevels() {
    if (!this.context) return;
    this.ramp(this.master.gain, this.enabled && !this.hidden ? 1 : 0);
    this.ramp(this.music.gain, volumeGain(this.bgmVolume));
    this.ramp(this.effects.gain, volumeGain(this.sfxVolume));
  }
  async unlock() {
    try {
      if (!this.context) {
        const c = this.context = this.createContext();
        this.master = c.createGain(); this.music = c.createGain(); this.effects = c.createGain();
        this.master.gain.value = 0; this.music.gain.value = 0;
        this.music.connect(this.master); this.effects.connect(this.master); this.master.connect(c.destination);
        this.applyLevels();
      }
      if (!this.hidden && this.context.state !== 'running') await this.context.resume();
      if (!this.source && !this.loading) {
        this.loading = this.loadMusic(this.context).then(buffer => {
          const source = this.context.createBufferSource();
          source.buffer = buffer; source.loop = true; source.loopStart = 0;
          source.loopEnd = Math.min(MUSIC_SECONDS, buffer.duration);
          source.connect(this.music); this.source = source;
          this.music.gain.cancelScheduledValues(this.context.currentTime);
          this.music.gain.setValueAtTime(0, this.context.currentTime);
          this.ramp(this.music.gain, volumeGain(this.bgmVolume), .45);
          source.start();
        }).catch(() => {}).finally(() => { this.loading = null; });
      }
    } catch { /* A later touch retries if this browser has not unlocked audio yet. */ }
  }
  setHidden(hidden) {
    this.hidden = hidden; clearTimeout(this.suspendTimer); this.applyLevels();
    if (!this.context) return;
    if (hidden) this.suspendTimer = setTimeout(() => {
      if (this.hidden) this.context.suspend().catch(() => {});
    }, 180);
    else this.unlock();
  }
  tone(freq = 300, duration = .09, type = 'sine', volume = .06, slide = .5) {
    const c = this.context;
    if (!this.enabled || this.hidden || !this.sfxVolume || !c || c.state !== 'running') return;
    const at = c.currentTime, osc = c.createOscillator(), gain = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + .003);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(gain); gain.connect(this.effects); this.voices.add(osc);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); this.voices.delete(osc); };
    osc.start(at); osc.stop(at + duration + .01);
  }
}
