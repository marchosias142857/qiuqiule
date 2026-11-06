// Local music and synthesized effects share a master mute, with independent buses.
import {MusicPlayer, MUSIC_SCENES, MUSIC_TRACKS} from './music-player.js';
export {MUSIC_TRACKS} from './music-player.js';
export const audioLevel = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
export const volumeGain = value => audioLevel(value) ** 1.5;
const LEGACY_IMPACT_NOTES = Object.freeze([523.251, 659.255, 783.991, 1046.502, 1318.51, 1567.982]);
const MASTER_FADE_SECONDS = .05;
export const IMPACT_NOTES = Object.freeze([...LEGACY_IMPACT_NOTES, 2093.004, 2637.02]);
export const MAX_EFFECT_VOICES = 32;

async function musicBytes(name) {
  const response = await fetch(new URL(MUSIC_TRACKS[name].url, import.meta.url));
  if (!response.ok || response.redirected) throw new Error('Music unavailable');
  return response.arrayBuffer();
}

async function prepareHomeMusic() {
  const bytes = await musicBytes('endless');
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (Offline) {
    try {
      // This decoder has no device output. Keep the original MP3 until decoding
      // succeeds, since decodeAudioData takes ownership of the passed bytes.
      const decoder = new Offline(2, 1, 44100);
      return {buffer: await decoder.decodeAudioData(bytes.slice(0))};
    } catch { /* The playback context can still decode the original bytes. */ }
  }
  return {bytes};
}

export class GameAudio {
  constructor({createContext = () => new (window.AudioContext || window.webkitAudioContext)(), loadMusic} = {}) {
    this.createContext = createContext;
    this.preparedHome = null;
    this.prepareHome = loadMusic ? null : prepareHomeMusic;
    this.loadMusic = loadMusic || (async (context, name) => {
      const prepared = name === 'endless' ? await this.preparedHome : null;
      if (name === 'endless') this.preparedHome = null;
      return prepared?.buffer || context.decodeAudioData(prepared?.bytes || await musicBytes(name));
    });
    this.enabled = true; this.bgmVolume = .55; this.sfxVolume = .75;
    this.hidden = false; this.context = null; this.player = null; this.musicScene = 'home';
    this.loading = null; this.suspendTimer = null; this.voices = new Set();
    this.masterFade = null; this.suspending = null;
    this.autoplayAttempted = false; this.hasRunAudio = false;
    this.charge = null; this.chargeWave = null; this.impactNoise = null;
    this.clearSequence = null;
  }
  setLevels({sound = this.enabled, bgmVolume = this.bgmVolume, sfxVolume = this.sfxVolume}) {
    const hadMusic = this.enabled && this.bgmVolume;
    this.enabled = sound; this.bgmVolume = audioLevel(bgmVolume, .55); this.sfxVolume = audioLevel(sfxVolume, .75);
    this.applyLevels();
    if (!hadMusic && this.enabled && this.bgmVolume) this.setMusicScene(this.musicScene);
  }
  ramp(param, value, time = .04) {
    param.cancelScheduledValues(this.context.currentTime);
    param.setTargetAtTime(value, this.context.currentTime, time);
  }
  fadeMaster() {
    const now = this.context.currentTime, param = this.master.gain;
    const target = this.enabled && !this.hidden ? 1 : 0;
    const old = this.masterFade;
    if (!target && this.context.state !== 'running') {
      // The browser already silenced the device. Start the next resume at zero.
      param.cancelScheduledValues(now); param.setValueAtTime(0, now);
      this.masterFade = {start: now, end: now, from: 0, to: 0};
      return;
    }
    if (target === old?.to || this.suspending) return;
    const end = now + MASTER_FADE_SECONDS;
    let from = old?.to ?? 0;
    param.cancelScheduledValues(now);
    if (old && now > old.start && now <= old.end) {
      // Restore the unfinished segment before reversing direction. This also
      // works in WebViews without AudioParam.cancelAndHoldAtTime.
      from = old.from + (old.to - old.from) * (now - old.start) / (old.end - old.start);
      param.linearRampToValueAtTime(from, now);
    } else {
      if (old && now === old.start) from = old.from;
      param.setValueAtTime(from, now);
    }
    param.linearRampToValueAtTime(target, end);
    this.masterFade = {start: now, end, from, to: target};
  }
  applyLevels() {
    if (!this.enabled || this.hidden || !this.sfxVolume) { this.stopCharge(); this.clearEnd(); }
    if (!this.context) return;
    this.fadeMaster();
    this.ramp(this.music.gain, volumeGain(this.bgmVolume));
    this.ramp(this.effects.gain, volumeGain(this.sfxVolume));
    if (this.player && (!this.enabled || this.hidden || !this.bgmVolume)) {
      this.loading = this.player.setScene(this.musicScene, {activate: false});
    }
  }
  prepareMusic() {
    if (this.hidden || !this.enabled || !this.bgmVolume || this.player || !this.prepareHome) return;
    this.preparedHome ??= this.prepareHome().catch(() => null);
    return this.preparedHome;
  }
  tryAutoplay() {
    if (this.autoplayAttempted || this.hidden || !this.enabled || !this.bgmVolume) return;
    this.autoplayAttempted = true;
    this.prepareMusic();
    return this.unlock();
  }
  get source() { return this.player?.resident?.source || null; }
  get needsUnlock() {
    if (this.hidden) return false;
    if (this.context?.state !== 'running' || this.suspending) return true;
    return !!(this.enabled && this.bgmVolume && !this.player.pending &&
      (!this.source || this.player.track !== MUSIC_SCENES[this.musicScene].track));
  }
  setMusicScene(scene) {
    if (!Object.hasOwn(MUSIC_SCENES, scene)) return;
    this.musicScene = scene;
    if (this.player) {
      // Update intent even while silent so a slow, obsolete decode cannot start
      // a Boss track after the run has already ended or returned home.
      const activate = this.context.state === 'running' && !this.hidden && this.enabled && this.bgmVolume > 0;
      this.loading = this.player.setScene(scene, {activate});
    }
    return this.loading;
  }
  musicStatus() {
    return this.player?.status() || {scene: this.musicScene, track: null, title: null, switching: false};
  }
  async unlock() {
    try {
      if (this.hidden) return;
      if (!this.context) {
        const c = this.context = this.createContext();
        this.master = c.createGain(); this.music = c.createGain(); this.effects = c.createGain();
        this.feedbackDuck = c.createGain();
        this.master.gain.value = 0; this.music.gain.value = 0;
        this.music.connect(this.feedbackDuck); this.effects.connect(this.feedbackDuck);
        this.feedbackDuck.connect(this.master); this.master.connect(c.destination);
        this.player = new MusicPlayer(c, this.music, name => this.loadMusic(c, name), this.musicScene);
        c.addEventListener?.('statechange', () => this.syncRunningAudio());
        this.applyLevels();
      }
      const c = this.context;
      if (this.suspending) {
        // Submit this request while the gesture is valid, even if the previous
        // suspend is still queued. Some engines report 'running' until it lands.
        c.resume().catch(() => {});
        await this.suspending;
        if (this.hidden) return;
      }
      if (c.state !== 'running') {
        const resumed = c.resume();
        if (this.enabled && this.bgmVolume && !this.source) this.player.ensure('endless').catch(() => {});
        await resumed;
      }
      this.syncRunningAudio();
    } catch { /* A later touch retries if this browser has not unlocked audio yet. */ }
  }
  syncRunningAudio() {
    if (this.context.state !== 'running' || this.suspending) return;
    this.hasRunAudio = true;
    if (this.hidden) { this.suspendAfterFade(); return; }
    this.fadeMaster();
    this.setMusicScene(this.musicScene);
  }
  setHidden(hidden) {
    if (this.hidden === hidden) return;
    this.hidden = hidden; clearTimeout(this.suspendTimer); this.suspendTimer = null;
    if (!this.context) {
      if (!hidden) return this.tryAutoplay();
      return;
    }
    this.applyLevels();
    if (hidden) this.suspendAfterFade();
    // A policy-blocked first attempt must wait for a real gesture. Once the
    // context has run, normal foreground resume can restore the same source.
    else if (this.hasRunAudio || this.context.state === 'running') return this.unlock();
  }
  suspendAfterFade() {
    const c = this.context;
    if (!this.hidden || c.state !== 'running' || this.suspending || this.suspendTimer !== null) return;
    const silentAt = this.masterFade.end;
    const waitMs = 10 + 1000 * Math.max(0, silentAt - c.currentTime);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      if (!this.hidden || c.state !== 'running') return;
      if (c.currentTime < silentAt) { this.suspendAfterFade(); return; }
      this.suspending = c.suspend().catch(() => {}).finally(() => { this.suspending = null; });
    }, Math.ceil(waitMs));
    this.suspendTimer.unref?.();
  }
  tone(freq = 300, duration = .09, type = 'sine', volume = .06, slide = .5) {
    this.toneAt(this.context?.currentTime, freq, duration, type, volume, slide);
  }
  get canPlayEffects() {
    return !!(this.enabled && !this.hidden && this.sfxVolume && this.context?.state === 'running');
  }
  clearStart({strength = .6} = {}) {
    this.clearEnd();
    const amount = audioLevel(strength, .6);
    if (!amount || !this.canPlayEffects || this.voices.size + 3 > MAX_EFFECT_VOICES) return;
    const c = this.context, at = c.currentTime, chordAt = at + .08;
    const bus = c.createGain(), sequence = this.clearSequence = {bus, voices: new Set(), startsAt: chordAt};
    bus.connect(this.effects);
    // Keep the volume preferences on their own buses. An audio-clock envelope
    // makes the anticipation and recovery independent of game/world time.
    const duck = this.feedbackDuck.gain, low = 10 ** (-6 / 20);
    duck.cancelScheduledValues(at); duck.setValueAtTime(1, at);
    duck.linearRampToValueAtTime(low, at + .006);
    duck.setValueAtTime(low, chordAt);
    duck.linearRampToValueAtTime(1, chordAt + .08);
    const volume = (.009 + .012 * amount) / Math.sqrt(1 + this.voices.size / 8);
    for (const frequency of IMPACT_NOTES.slice(0, 3)) {
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, chordAt);
      gain.gain.setValueAtTime(0, chordAt);
      gain.gain.linearRampToValueAtTime(volume, chordAt + .025);
      gain.gain.linearRampToValueAtTime(volume * .68, chordAt + .18);
      gain.gain.exponentialRampToValueAtTime(.0001, chordAt + .6);
      osc.connect(gain); gain.connect(bus);
      this.voices.add(osc); sequence.voices.add(osc);
      osc.onended = () => {
        osc.disconnect(); gain.disconnect(); this.voices.delete(osc); sequence.voices.delete(osc);
        if (!sequence.voices.size) {
          bus.disconnect();
          if (this.clearSequence === sequence) this.clearSequence = null;
        }
      };
      osc.start(chordAt); osc.stop(chordAt + .61);
    }
  }
  clearEnd() {
    const c = this.context, sequence = this.clearSequence;
    this.clearSequence = null;
    if (!c) return;
    const at = c.currentTime;
    if (this.feedbackDuck) this.ramp(this.feedbackDuck.gain, 1, .01);
    if (!sequence) return;
    sequence.bus.gain.cancelScheduledValues(at);
    sequence.bus.gain.setTargetAtTime(0, at, .004);
    // A stop before the scheduled 80 ms start cancels the note entirely. No
    // setTimeout callback can resurrect it after pause, reset, mute or hiding.
    const stopAt = at < sequence.startsAt ? at : at + .02;
    for (const voice of sequence.voices) voice.stop(stopAt);
  }
  // A single event captures the audio clock once: its attack, body and bass
  // arrive together even when several collisions are handled in the same frame.
  impact({kind = 'kill', level = 0, power = .5, strength = .6, upgradeBoost = false,
    endless = false, frenzy = false, hitTier = 'heavy'} = {}) {
    if (!this.canPlayEffects || endless && kind === 'hit' && hitTier === 'light') return false;
    const c = this.context, at = c.currentTime;
    const amount = audioLevel(strength, .6), energy = audioLevel(power, .5);
    const hit = kind === 'hit', boss = kind === 'boss';
    const medium = endless && hit && hitTier === 'medium';
    const step = Math.max(0, Math.floor(Number.isFinite(level) ? level : 0));
    const boost = kind === 'kill' && upgradeBoost && amount > 0 ? 1 : 0;
    // Keep the campaign's six-note scale and historical boosted top note.
    // Only endless kills use eight notes, with Frenzy alternating its last two.
    const index = endless && kind === 'kill'
      ? Math.min(7, (frenzy && step >= 8 ? 6 + (step - 8) % 2 : Math.min(7, step)) + boost)
      : Math.min(LEGACY_IMPACT_NOTES.length - 1, step) + boost;
    const notes = endless && kind === 'kill' ? IMPACT_NOTES : LEGACY_IMPACT_NOTES;
    const pitch = hit ? 180 + 70 * energy : boss ? 260 + 220 * energy : (notes[index] ?? LEGACY_IMPACT_NOTES[3] * 2);
    const layers = medium || !amount ? 1 : 4;
    if (this.voices.size + layers > MAX_EFFECT_VOICES) return false;
    // Keep rapid multi-kills readable without a large sum of low-frequency tails.
    const overlap = 1 / Math.sqrt(1 + this.voices.size / 4);
    const gain = overlap * (hit ? .38 : boss ? 1.12 : 1);
    this.toneAt(at, pitch, medium ? .05 : hit ? .065 : .11, 'sine', .045 * gain * (medium ? .4 : 1), hit ? .65 : 1, .003);
    if (medium || !amount) return true;
    this.noiseAt(at, .008, .016 * gain * amount);
    this.toneAt(at, 60 + 20 * energy, .12, 'sine', (.007 + .023 * energy) * gain * amount, .75, .004);
    this.toneAt(at, pitch, .15, 'sine', .012 * gain * amount, 1, .012);
    return true;
  }
  bossDefeat({strength = .6} = {}) {
    if (!this.canPlayEffects) return;
    const amount = audioLevel(strength, .6), layers = amount > 0 ? 4 : 1;
    if (this.voices.size + layers > MAX_EFFECT_VOICES) return;
    const at = this.context.currentTime, gain = 1 / Math.sqrt(1 + this.voices.size / 4);
    // A compact downward impact marks the kill now; the later rising victory
    // phrase remains a separate celebration. Weight comes from the low end,
    // with bounded summed gain instead of making the whole mix much louder.
    this.toneAt(at, 196, .075, 'sine', .035 * gain, .75, .003);
    if (!amount) return;
    this.noiseAt(at, .009, .022 * gain * amount);
    this.toneAt(at, 90, .13, 'sine', .04 * gain * amount, .5, .005);
    this.toneAt(at, 392, .16, 'sine', .012 * gain * amount, .5, .008);
  }
  rewardHit({strength = .6, power = .5} = {}) {
    if (!this.canPlayEffects) return;
    const amount = audioLevel(strength, .6), energy = audioLevel(power, .5);
    const layers = amount > 0 ? 3 : 1;
    if (this.voices.size + layers > MAX_EFFECT_VOICES) return;
    const at = this.context.currentTime, gain = 1 / Math.sqrt(1 + this.voices.size / 4);
    // A bright, compact chink belongs to the reward's contact frame. Its short
    // upper partial and light attack leave the body clear without bass or a
    // second celebration phrase; strength zero keeps the basic selection cue.
    const pitch = IMPACT_NOTES[3];
    this.toneAt(at, pitch, .115, 'sine', (.026 + .006 * energy) * gain, .99, .002);
    if (!amount) return;
    this.noiseAt(at, .005, .007 * gain * amount);
    this.toneAt(at, pitch * 2.5, .065, 'sine', (.005 + .003 * energy) * gain * amount, .98, .0015);
  }
  shockwave({hit = false, strength = .6} = {}) {
    const amount = audioLevel(strength, .6);
    if (!amount || !this.canPlayEffects || this.voices.size >= MAX_EFFECT_VOICES) return false;
    const gain = .028 * amount * (hit ? 1.3 : 1) / Math.sqrt(1 + this.voices.size / 4);
    this.toneAt(this.context.currentTime, 85, .18, 'sine', gain, 55 / 85, .006);
    return true;
  }
  launch(power = .5) {
    if (!this.canPlayEffects) return;
    this.stopCharge();
    this.toneAt(this.context.currentTime, 600, .06, 'sine', .018 + .008 * audioLevel(power, .5), 1 / 3);
  }
  wall(power = .5, {endless = false} = {}) {
    const energy = audioLevel(power, .5);
    if (!this.canPlayEffects || this.voices.size >= MAX_EFFECT_VOICES || endless && energy < .25) return false;
    const cents = (Math.random() * 2 - 1) * 4;
    this.toneAt(this.context.currentTime, (100 + energy * 80) * 2 ** (cents / 1200), .055, 'sine', .0175 * (endless ? energy ** 2 : 1), .65);
    return true;
  }
  setCharge(amount) {
    const value = audioLevel(amount);
    if (!value || !this.canPlayEffects) { this.stopCharge(); return; }
    const c = this.context, at = c.currentTime, pitch = 130 + 200 * value ** .65;
    if (!this.charge) {
      if (value < .004 || this.voices.size >= MAX_EFFECT_VOICES) return;
      const osc = c.createOscillator(), gain = c.createGain();
      this.chargeWave ??= c.createPeriodicWave(new Float32Array(3), Float32Array.of(0, 1, .25));
      osc.setPeriodicWave(this.chargeWave);
      osc.frequency.setValueAtTime(pitch, at);
      gain.gain.value = 0;
      osc.connect(gain); gain.connect(this.effects);
      const charge = this.charge = {osc, gain, amount: 0, lastAt: at - 1 / 60, speed: 0};
      this.voices.add(osc);
      osc.onended = () => {
        osc.disconnect(); gain.disconnect(); this.voices.delete(osc);
        if (this.charge === charge) this.charge = null;
      };
      osc.start(at);
    }
    const charge = this.charge, delta = value - charge.amount;
    // Accumulate small moves until they exceed stationary pointer jitter.
    if (Math.abs(delta) < .004) return;
    const dt = Math.max(0, at - charge.lastAt);
    const speed = Math.min(1, Math.abs(delta) / (2.5 * Math.max(dt, 1 / 240)));
    charge.speed += (speed - charge.speed) * -Math.expm1(-dt / .08);
    charge.amount = value; charge.lastAt = at;
    const level = (.0028 + .0095 * charge.speed) * (.4 + .6 * value) * (delta < 0 ? .55 : 1);
    charge.osc.frequency.setTargetAtTime(pitch, at, .025);
    // The previous target continues up to this instant. Only future idle events
    // are replaced, so coalesced pointer moves never restart an attack from zero.
    const volume = charge.gain.gain;
    volume.cancelScheduledValues(at);
    volume.setTargetAtTime(level, at, .04);
    volume.setTargetAtTime(0, at + .12, .05);
    volume.setValueAtTime(0, at + .52);
  }
  stopCharge() {
    const charge = this.charge;
    if (!charge) return;
    this.charge = null;
    const at = this.context.currentTime, volume = charge.gain.gain;
    volume.cancelScheduledValues(at);
    volume.setTargetAtTime(0, at, .006);
    charge.osc.stop(at + .06);
  }
  noiseAt(at, duration, volume) {
    const c = this.context;
    if (!this.canPlayEffects || this.voices.size >= MAX_EFFECT_VOICES) return;
    // The same short waveform is reused for every impact. Noise is a transient
    // timbre, not a randomly varying reward sound.
    if (!this.impactNoise) {
      const count = Math.max(1, Math.ceil(c.sampleRate * .01));
      const buffer = c.createBuffer(1, count, c.sampleRate), samples = buffer.getChannelData(0);
      let seed = 0x51a7;
      for (let i = 0; i < count; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        samples[i] = (seed / 4294967296 * 2 - 1) * (1 - i / count);
      }
      this.impactNoise = buffer;
    }
    const source = c.createBufferSource(), gain = c.createGain();
    source.buffer = this.impactNoise;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + .001);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    source.connect(gain); gain.connect(this.effects); this.voices.add(source);
    source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(source); };
    source.start(at); source.stop(at + duration);
  }
  // All note starts use one audio-clock origin, independent of frame/timer jitter.
  // This original ascending reward phrase uses only locally synthesized voices.
  bossVictory() {
    const c = this.context;
    if (!this.enabled || this.hidden || !this.sfxVolume || !c || c.state !== 'running') return;
    const at = c.currentTime;
    const notes = [[523.251,.00,.13],[659.255,.115,.13],[783.991,.23,.13],[880,.345,.17],[1046.502,.48,.30]];
    for (const [freq, delay, duration] of notes) {
      this.toneAt(at + delay, freq, duration, 'triangle', .035, 1, .015);
      this.toneAt(at + delay, freq * 2, duration, 'sine', .008, 1, .02);
    }
  }
  toneAt(at, freq, duration, type, volume, slide, attack = .003) {
    const c = this.context;
    if (!this.canPlayEffects || this.voices.size >= MAX_EFFECT_VOICES) return;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(gain); gain.connect(this.effects); this.voices.add(osc);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); this.voices.delete(osc); };
    osc.start(at); osc.stop(at + duration + .01);
  }
}
