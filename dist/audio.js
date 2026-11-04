// Local music and synthesized effects share a master mute, with independent buses.
export const MUSIC_SECONDS = 32 * 4 * 60 / 88;
export const audioLevel = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
export const volumeGain = value => audioLevel(value) ** 1.5;
export const IMPACT_NOTES = Object.freeze([523.251, 659.255, 783.991, 1046.502, 1318.51, 1567.982]);
export const MAX_EFFECT_VOICES = 32;

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
    this.charge = null; this.impactNoise = null; this.chargeNoise = null;
    this.clearSequence = null;
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
    if (!this.enabled || this.hidden || !this.sfxVolume) { this.stopCharge(); this.clearEnd(); }
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
        this.feedbackDuck = c.createGain();
        this.master.gain.value = 0; this.music.gain.value = 0;
        this.music.connect(this.feedbackDuck); this.effects.connect(this.feedbackDuck);
        this.feedbackDuck.connect(this.master); this.master.connect(c.destination);
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
  impact({kind = 'kill', level = 0, power = .5, strength = .6, upgradeBoost = false} = {}) {
    if (!this.canPlayEffects) return;
    const c = this.context, at = c.currentTime;
    const amount = audioLevel(strength, .6), energy = audioLevel(power, .5);
    const index = Math.min(IMPACT_NOTES.length - 1, Math.max(0, Math.floor(Number.isFinite(level) ? level : 0)));
    const hit = kind === 'hit', boss = kind === 'boss';
    const killIndex=index+(kind==='kill'&&upgradeBoost&&amount>0?1:0);
    const pitch = hit ? 180 + 70 * energy : boss ? 260 + 220 * energy : (IMPACT_NOTES[killIndex]??IMPACT_NOTES[3]*2);
    const layers = amount > 0 ? 4 : 1;
    if (this.voices.size + layers > MAX_EFFECT_VOICES) return;
    // Keep rapid multi-kills readable without a large sum of low-frequency tails.
    const overlap = 1 / Math.sqrt(1 + this.voices.size / 4);
    const gain = overlap * (hit ? .38 : boss ? 1.12 : 1);
    this.toneAt(at, pitch, hit ? .065 : .11, 'sine', .045 * gain, hit ? .65 : 1, .003);
    if (!amount) return;
    this.noiseAt(at, .008, .016 * gain * amount);
    this.toneAt(at, 60 + 20 * energy, .12, 'sine', (.007 + .023 * energy) * gain * amount, .75, .004);
    this.toneAt(at, pitch, .15, 'sine', .012 * gain * amount, 1, .012);
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
  launch(power = .5) {
    if (!this.canPlayEffects) return;
    this.stopCharge();
    this.toneAt(this.context.currentTime, 600, .06, 'sine', .018 + .008 * audioLevel(power, .5), 1 / 3);
  }
  wall(power = .5) {
    if (!this.canPlayEffects) return;
    const cents = (Math.random() * 2 - 1) * 4;
    this.toneAt(this.context.currentTime, (100 + audioLevel(power, .5) * 80) * 2 ** (cents / 1200), .055, 'sine', .0175, .65);
  }
  setCharge(amount) {
    const value = audioLevel(amount);
    if (!value || !this.canPlayEffects) { this.stopCharge(); return; }
    const c = this.context, at = c.currentTime;
    if (!this.charge) {
      if (value < .004 || this.voices.size + 2 > MAX_EFFECT_VOICES) return;
      const osc = c.createOscillator(), noise = c.createBufferSource();
      const gain = c.createGain(), bodyGain = c.createGain(), filter = c.createBiquadFilter();
      osc.type = 'triangle'; osc.frequency.setValueAtTime(105 + 170 * value ** .65, at);
      bodyGain.gain.value = .32;
      filter.type = 'bandpass'; filter.Q.value = 1.35;
      filter.frequency.setValueAtTime(360 + 520 * value, at);
      noise.buffer = this.chargeNoiseBuffer(); noise.loop = true;
      gain.gain.setValueAtTime(0, at);
      osc.connect(bodyGain); bodyGain.connect(gain); noise.connect(filter); filter.connect(gain); gain.connect(this.effects);
      const charge = this.charge = {osc, noise, gain, bodyGain, filter, amount: 0, lastAt: at - 1 / 60,
        envelope: {at, from: 0, peak: 0, duration: .18}, ended: new Set()};
      for (const source of [osc, noise]) {
        this.voices.add(source);
        source.onended = () => {
          source.disconnect(); this.voices.delete(source); charge.ended.add(source);
          if (charge.ended.size === 2) {
            gain.disconnect(); bodyGain.disconnect(); filter.disconnect();
            if (this.charge === charge) this.charge = null;
          }
        };
        source.start(at);
      }
    }
    const charge = this.charge, delta = value - charge.amount;
    // Anchor to the last audible change: tiny back-and-forth pointer noise does
    // not keep exciting the sound, while a genuinely slow pull still accumulates.
    if (Math.abs(delta) < .004) return;
    const velocity = Math.min(1, Math.abs(delta) / Math.max(1 / 240, at - charge.lastAt) / 2.5);
    const peak = (.0035 + .011 * velocity) * (.4 + .6 * value) * (delta < 0 ? .55 : 1);
    charge.osc.frequency.setTargetAtTime((105 + 170 * value ** .65) * (1 + velocity * .06), at, .025);
    charge.filter.frequency.setTargetAtTime(360 + 520 * value + 140 * velocity, at, .025);
    const from = this.chargeEnvelopeAt(charge, at);
    charge.gain.gain.cancelScheduledValues(at);
    charge.gain.gain.setValueAtTime(from, at);
    charge.gain.gain.linearRampToValueAtTime(peak, at + .025);
    charge.gain.gain.linearRampToValueAtTime(0, at + .18);
    charge.envelope = {at, from, peak, duration: .18};
    charge.amount = value; charge.lastAt = at;
  }
  stopCharge() {
    const charge = this.charge, c = this.context;
    if (!charge || !c) return;
    this.charge = null;
    const at = c.currentTime, from = this.chargeEnvelopeAt(charge, at);
    charge.gain.gain.cancelScheduledValues(at);
    charge.gain.gain.setValueAtTime(from, at);
    charge.gain.gain.linearRampToValueAtTime(0, at + .035);
    charge.envelope = {at, from, peak: from, duration: .035, releasing: true};
    charge.osc.stop(at + .04); charge.noise.stop(at + .04);
  }
  chargeEnvelopeAt(charge, at) {
    const envelope = charge.envelope, age = Math.max(0, at - envelope.at);
    if (envelope.releasing) return envelope.from * Math.max(0, 1 - age / envelope.duration);
    if (age < .025) return envelope.from + (envelope.peak - envelope.from) * age / .025;
    return envelope.peak * Math.max(0, 1 - (age - .025) / (envelope.duration - .025));
  }
  chargeNoiseBuffer() {
    if (this.chargeNoise) return this.chargeNoise;
    const c = this.context, count = Math.ceil(c.sampleRate * .8);
    const buffer = c.createBuffer(1, count, c.sampleRate), samples = buffer.getChannelData(0);
    let seed = 0x73e1, low = 0;
    for (let i = 0; i < count; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const white = seed / 4294967296 * 2 - 1;
      low = .76 * low + .24 * white;
      // Softened texture with a quiet loop seam; the envelope, not the source,
      // controls movement. Holding still always reaches exact silence in 180 ms.
      const edge = Math.min(1, i / (c.sampleRate * .012), (count - 1 - i) / (c.sampleRate * .012));
      samples[i] = (low * .8 + white * .1) * edge;
    }
    return this.chargeNoise = buffer;
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
