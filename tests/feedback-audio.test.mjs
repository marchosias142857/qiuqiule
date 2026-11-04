import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio, IMPACT_NOTES, MAX_EFFECT_VOICES} from '../dist/audio.js';

function audioContext() {
  const param = () => ({value: 1, events: [],
    cancelScheduledValues(at) { this.events.push({type: 'cancel', at}); },
    setTargetAtTime(value, at, time) { this.value = value; this.events.push({type: 'target', value, at, time}); },
    setValueAtTime(value, at) { this.value = value; this.events.push({type: 'set', value, at}); },
    linearRampToValueAtTime(value, at) { this.value = value; this.events.push({type: 'linear', value, at}); },
    exponentialRampToValueAtTime(value, at) { this.value = value; this.events.push({type: 'exponential', value, at}); }});
  const node = () => ({gain: param(), frequency: param(), Q: param(),
    connect(target) { this.target = target; }, disconnect() { this.disconnected = true; },
    start(at = 0) { this.starts = (this.starts || 0) + 1; this.startTime = at; },
    stop(at) { this.stopTime = at; this.stops = (this.stops || 0) + 1; },
    finish() { this.onended?.(); }});
  return {state: 'suspended', currentTime: 0, sampleRate: 48000, destination: {}, sources: [], oscillators: [], buffers: [], filters: [],
    createGain: node, createBiquadFilter() { const n = node(); this.filters.push(n); return n; },
    createBuffer(channels, count, rate) {
      const samples = new Float32Array(count), buffer = {duration: count / rate, getChannelData: () => samples};
      this.buffers.push(buffer); return buffer;
    },
    createBufferSource() { const n = node(); this.sources.push(n); return n; },
    createOscillator() { const n = node(); this.oscillators.push(n); return n; },
    async resume() { this.state = 'running'; }, async suspend() { this.state = 'suspended'; }};
}

async function setup() {
  const c = audioContext(), audio = new GameAudio({createContext: () => c, loadMusic: async () => ({duration: 90})});
  await audio.unlock(); await audio.loading;
  return {c, audio};
}
const firstPitch = voice => voice.frequency.events.find(event => event.type === 'set').value;
const peak = voice => voice.target.gain.events.find(event => event.type === 'linear').value;

test('an impact layers a fixed transient, body, energetic bass and tail on exactly one clock origin', async () => {
  const {c, audio} = await setup(); c.currentTime = 7;
  audio.impact({kind: 'kill', level: 0, power: 1, strength: 1});
  const [body, bass, tail] = c.oscillators, noise = c.sources[1];
  assert.equal(audio.voices.size, 4);
  for (const voice of [body, bass, tail, noise]) {
    assert.equal(voice.startTime, 7);
    assert.equal(voice.target.target, audio.effects);
  }
  assert.equal(firstPitch(body), IMPACT_NOTES[0]);
  assert.equal(firstPitch(bass), 80);
  assert.equal(firstPitch(tail), firstPitch(body));
  assert.ok(Math.abs(noise.stopTime - noise.startTime - .008) < 1e-9);
  assert.ok(Math.abs(tail.target.gain.events.at(-1).at - tail.startTime - .15) < 1e-9);
  assert.equal(c.sources[0], audio.source);
  assert.equal(audio.source.target, audio.music);
  assert.ok([body, bass, tail, noise].reduce((sum, voice) => sum + peak(voice), 0) < .11);
  for (const voice of [...audio.voices]) {
    const gain = voice.target; voice.finish();
    assert.equal(voice.disconnected, true); assert.equal(gain.disconnected, true);
  }
  assert.equal(audio.voices.size, 0);
});

test('kill pitches climb deterministically and impact noise is cached and repeatable', async () => {
  const {c, audio} = await setup();
  for (let level = 0; level <= 7; level++) {
    const previous = c.oscillators.length;
    audio.impact({level});
    assert.equal(firstPitch(c.oscillators[previous]), IMPACT_NOTES[Math.min(level, 5)]);
    for (const voice of [...audio.voices]) voice.finish();
  }
  assert.equal(c.buffers.length, 1);
  assert.ok(c.sources.slice(1).every(source => source.buffer === c.buffers[0]));
  const other = await setup(); other.audio.impact();
  assert.deepEqual(other.c.buffers[0].getChannelData(0), c.buffers[0].getChannelData(0));
});

test('weak impacts and walls stay below kills; feedback zero keeps only the immediate body', async () => {
  const hit = await setup(), kill = await setup(), boss = await setup();
  hit.audio.impact({kind: 'hit', power: .3});
  kill.audio.impact({kind: 'kill', power: .3});
  boss.audio.impact({kind: 'boss', power: .9});
  assert.ok(peak(hit.c.oscillators[0]) < peak(kill.c.oscillators[0]));
  assert.ok(peak(boss.c.oscillators[0]) > peak(kill.c.oscillators[0]));
  assert.ok(peak(boss.c.oscillators[1]) > peak(kill.c.oscillators[1]));
  const off = await setup(); off.c.currentTime = 2;
  off.audio.impact({strength: 0});
  assert.equal(off.c.oscillators.length, 1); assert.equal(off.c.sources.length, 1);
  assert.equal(off.c.oscillators[0].startTime, 2);
  off.audio.wall(1);
  assert.ok(peak(off.c.oscillators[1]) < peak(kill.c.oscillators[0]));
});

test('rapid impacts have a bounded voice count and new impact gain reduces with overlap', async () => {
  const {c, audio} = await setup();
  for (let i = 0; i < 100; i++) audio.impact({power: 1});
  assert.equal(audio.voices.size, MAX_EFFECT_VOICES);
  assert.ok(peak(c.oscillators[3]) < peak(c.oscillators[0]));
  audio.tone(); audio.wall(); audio.setCharge(1);
  assert.equal(audio.voices.size, MAX_EFFECT_VOICES);
  for (const voice of [...audio.voices]) voice.finish();
  audio.impact(); assert.equal(audio.voices.size, 4);
});

test('charge combines a soft elastic body and filtered texture; launch fades both sources without changing its own sound', async () => {
  const {c, audio} = await setup(); c.currentTime = 3;
  audio.setCharge(.25);
  const charge = audio.charge, initialPitch = charge.osc.frequency.events.at(-1).value;
  c.currentTime = 3.05; audio.setCharge(.5); c.currentTime = 3.1; audio.setCharge(1);
  assert.equal(c.oscillators.length, 1); assert.equal(charge.osc.starts, 1);
  assert.equal(charge.osc.type, 'triangle'); assert.equal(charge.noise.loop, true);
  assert.equal(charge.noise.target, charge.filter); assert.equal(charge.filter.type, 'bandpass');
  assert.equal(charge.filter.target, charge.gain); assert.equal(charge.gain.target, audio.effects);
  assert.equal(charge.osc.target, charge.bodyGain); assert.equal(charge.bodyGain.target, charge.gain);
  assert.ok(charge.osc.frequency.events.at(-1).value > initialPitch);
  assert.equal(audio.voices.size, 2);
  assert.ok(charge.envelope.peak <= .0145); assert.ok(charge.bodyGain.gain.value < .4);
  c.currentTime = 3.5; audio.launch(1);
  assert.equal(audio.charge, null); assert.equal(charge.osc.stopTime, 3.54); assert.equal(charge.noise.stopTime, 3.54);
  assert.equal(charge.gain.gain.events.at(-1).value, 0);
  assert.ok(Math.abs(charge.gain.gain.events.at(-1).at - 3.535) < 1e-9);
  const launch = c.oscillators[1];
  assert.equal(launch.startTime, 3.5); assert.equal(firstPitch(launch), 600);
  assert.equal(launch.frequency.events.at(-1).value, 200);
  assert.ok(Math.abs(launch.frequency.events.at(-1).at - 3.56) < 1e-9);
  audio.stopCharge(); assert.equal(charge.osc.stops, 1); assert.equal(charge.noise.stops, 1);
  charge.osc.finish(); charge.noise.finish();
  assert.equal(charge.osc.disconnected, true); assert.equal(charge.noise.disconnected, true);
  assert.equal(charge.filter.disconnected, true); assert.equal(charge.bodyGain.disconnected, true); assert.equal(charge.gain.disconnected, true);
});

test('charge is canceled by mute, zero effects volume, hiding and release; unmuting never restarts it', async () => {
  const {c, audio} = await setup();
  for (const cancel of [() => audio.setLevels({sound: false}), () => audio.setLevels({sfxVolume: 0}),
    () => audio.setHidden(true), () => audio.setCharge(0), () => audio.stopCharge()]) {
    audio.setLevels({sound: true, sfxVolume: .75}); audio.setHidden(false); await audio.unlock();
    audio.setCharge(.8); const charge = audio.charge;
    cancel(); assert.equal(audio.charge, null); assert.equal(charge.osc.stops, 1); assert.equal(charge.noise.stops, 1);
    charge.osc.finish(); charge.noise.finish();
  }
  audio.setLevels({sound: true, sfxVolume: .75}); audio.setHidden(false); await audio.unlock();
  assert.equal(audio.charge, null); assert.equal(audio.source.starts, 1);
});

test('holding a pull still reaches exact silence even when no more pointer events arrive', async () => {
  const {c, audio} = await setup(); c.currentTime = 1;
  audio.setCharge(.6); const charge = audio.charge;
  assert.ok(audio.chargeEnvelopeAt(charge, 1.025) > 0);
  assert.equal(audio.chargeEnvelopeAt(charge, 1.181), 0);
  assert.equal(audio.chargeEnvelopeAt(charge, 20), 0);
  assert.deepEqual(charge.gain.gain.events.at(-1), {type: 'linear', value: 0, at: 1.18});
  const events = charge.gain.gain.events.length, pitches = charge.osc.frequency.events.length;
  for (let i = 1; i < 120; i++) {
    c.currentTime = 1 + i / 60;
    audio.setCharge(.6 + (i % 2 ? .001 : -.001));
  }
  assert.equal(charge.gain.gain.events.length, events, 'small pointer jitter cannot retrigger the envelope');
  assert.equal(charge.osc.frequency.events.length, pitches);
  assert.equal(audio.voices.size, 2);
});

test('a slow deliberate pull accumulates past the jitter threshold, while faster movement is louder and relaxing is softer', async () => {
  const slow = await setup(), fast = await setup();
  slow.c.currentTime = fast.c.currentTime = 1;
  slow.audio.setCharge(.2); fast.audio.setCharge(.2);
  slow.c.currentTime = 1.5; slow.audio.setCharge(.4);
  fast.c.currentTime = 1.02; fast.audio.setCharge(.4);
  assert.ok(fast.audio.charge.envelope.peak > slow.audio.charge.envelope.peak);
  const charge = slow.audio.charge, before = charge.gain.gain.events.length;
  for (let i = 1; i <= 6; i++) { slow.c.currentTime += .05; slow.audio.setCharge(.4 + i * .001); }
  assert.ok(charge.gain.gain.events.length > before, 'subthreshold steps accumulate into a genuine pull');
  const outward = await setup(), inward = await setup();
  outward.audio.setCharge(.3); inward.audio.setCharge(.7);
  outward.c.currentTime = inward.c.currentTime = .1;
  outward.audio.setCharge(.5); inward.audio.setCharge(.5);
  assert.ok(Math.abs(inward.audio.charge.envelope.peak / outward.audio.charge.envelope.peak - .55) < 1e-9);
});

test('re-excitation and release anchor to the live envelope instead of resetting gain and creating a click', async () => {
  const {c, audio} = await setup(); c.currentTime = 1;
  audio.setCharge(.2); const charge = audio.charge;
  c.currentTime = 1.01;
  const current = audio.chargeEnvelopeAt(charge, c.currentTime);
  assert.ok(current > 0 && current < charge.envelope.peak);
  audio.setCharge(.4);
  assert.deepEqual(charge.gain.gain.events.at(-3), {type: 'set', value: current, at: 1.01});
  c.currentTime = 1.04;
  const released = audio.chargeEnvelopeAt(charge, c.currentTime);
  audio.stopCharge();
  assert.deepEqual(charge.gain.gain.events.at(-2), {type: 'set', value: released, at: 1.04});
  assert.equal(audio.chargeEnvelopeAt(charge, 1.081), 0);
});

test('texture is cached and late completion from a released gesture cannot clear a newer gesture', async () => {
  const {c, audio} = await setup(); audio.setCharge(.4);
  const old = audio.charge, texture = old.noise.buffer;
  audio.stopCharge(); c.currentTime = .1; audio.setCharge(.5);
  const next = audio.charge;
  assert.equal(next.noise.buffer, texture); assert.equal(c.buffers.length, 1);
  old.osc.finish(); old.noise.finish();
  assert.equal(audio.charge, next); assert.equal(audio.voices.size, 2);
  const samples = texture.getChannelData(0);
  assert.equal(samples[0], 0); assert.equal(Math.abs(samples.at(-1)), 0);
  assert.ok(samples.every(Number.isFinite));
  assert.ok(Math.max(...samples) <= 1 && Math.min(...samples) >= -1);
});

test('new feedback methods cannot unlock sound and respect all effects gates', async () => {
  const c = audioContext(); let created = 0;
  const audio = new GameAudio({createContext: () => { created++; return c; }, loadMusic: async () => ({duration: 90})});
  const sounds = () => { audio.impact(); audio.launch(); audio.wall(); audio.setCharge(1); };
  sounds(); assert.equal(created, 0);
  await audio.unlock(); await audio.loading;
  audio.setLevels({sound: false}); sounds(); assert.equal(c.oscillators.length, 0);
  audio.setLevels({sound: true, sfxVolume: 0}); sounds(); assert.equal(c.oscillators.length, 0);
  audio.setLevels({sfxVolume: 1}); audio.setHidden(true); sounds(); assert.equal(c.oscillators.length, 0);
  audio.setHidden(false); await audio.unlock(); c.state = 'suspended'; sounds(); assert.equal(c.oscillators.length, 0);
});

test('upgrade kill sound moves up one scale degree without adding voices or changing timing and volume',async()=>{
  for(const level of [0,1,4,5,20]){
    const normal=await setup(),boosted=await setup();
    normal.c.currentTime=boosted.c.currentTime=2;
    normal.audio.impact({kind:'kill',level});
    boosted.audio.impact({kind:'kill',level,upgradeBoost:true});
    const index=Math.min(level,5)+1;
    assert.equal(firstPitch(boosted.c.oscillators[0]),IMPACT_NOTES[index]??IMPACT_NOTES[3]*2);
    assert.equal(firstPitch(boosted.c.oscillators[2]),firstPitch(boosted.c.oscillators[0]));
    assert.equal(boosted.audio.voices.size,normal.audio.voices.size);
    for(let i=0;i<normal.c.oscillators.length;i++){
      assert.equal(boosted.c.oscillators[i].startTime,normal.c.oscillators[i].startTime);
      assert.equal(boosted.c.oscillators[i].stopTime,normal.c.oscillators[i].stopTime);
      assert.equal(peak(boosted.c.oscillators[i]),peak(normal.c.oscillators[i]));
    }
  }
});

test('upgrade tone respects zero feedback and effect gates and cannot raise nonlethal hit sounds',async()=>{
  for(const kind of ['hit','boss']){
    const normal=await setup(),boosted=await setup();
    normal.audio.impact({kind});boosted.audio.impact({kind,upgradeBoost:true});
    assert.equal(firstPitch(boosted.c.oscillators[0]),firstPitch(normal.c.oscillators[0]));
  }
  const {c,audio}=await setup();audio.impact({kind:'kill',upgradeBoost:true,strength:0});
  assert.equal(c.oscillators.length,1);assert.equal(firstPitch(c.oscillators[0]),IMPACT_NOTES[0]);
  for(const mute of [()=>audio.setLevels({sound:false}),()=>audio.setLevels({sound:true,sfxVolume:0}),()=>{audio.setLevels({sfxVolume:1});audio.setHidden(true);},()=>{audio.hidden=false;c.state='suspended';}]){
    mute();audio.impact({kind:'kill',upgradeBoost:true});assert.equal(c.oscillators.length,1);
  }
});

test('endless kills climb through eight notes while legacy kills keep their six-note ceiling', async () => {
  const scale = [523.251, 659.255, 783.991, 1046.502, 1318.51, 1567.982, 2093.004, 2637.02];
  assert.deepEqual(IMPACT_NOTES, scale);
  for (const endless of [false, true]) {
    const {c, audio} = await setup();
    for (let level = 0; level < 12; level++) {
      const before = c.oscillators.length;
      assert.equal(audio.impact({kind: 'kill', level, endless}), true);
      assert.equal(firstPitch(c.oscillators[before]), scale[Math.min(level, endless ? 7 : 5)]);
      assert.equal(audio.voices.size, 4);
      for (const voice of [...audio.voices]) voice.finish();
    }
  }
});

test('endless Frenzy alternates C7 and E7 after the eighth kill and boosts never lower the chosen note', async () => {
  for (const upgradeBoost of [false, true]) {
    const {c, audio} = await setup();
    for (let level = 0; level < 16; level++) {
      const before = c.oscillators.length;
      audio.impact({kind: 'kill', level, endless: true, frenzy: true, upgradeBoost});
      const expected = level < 8 ? level : 6 + level % 2;
      assert.equal(firstPitch(c.oscillators[before]), IMPACT_NOTES[Math.min(7, expected + Number(upgradeBoost))]);
      for (const voice of [...audio.voices]) voice.finish();
    }
  }
  const legacy = await setup();
  legacy.audio.impact({kind: 'kill', level: 12, frenzy: true, upgradeBoost: true});
  assert.equal(firstPitch(legacy.c.oscillators[0]), 2093.004, 'campaign boosted ceiling remains its old C7');
  const silentFeedback = await setup();
  silentFeedback.audio.impact({kind: 'kill', level: 6, endless: true, upgradeBoost: true, strength: 0});
  assert.equal(firstPitch(silentFeedback.c.oscillators[0]), 2093.004);
  assert.equal(silentFeedback.audio.voices.size, 1);
});

test('endless light hits allocate nothing while medium hits are one fifty-ms voice at forty-percent main gain', async () => {
  const quiet = await setup();
  assert.equal(quiet.audio.impact({kind: 'hit', endless: true, hitTier: 'light', power: 1}), false);
  assert.equal(quiet.c.oscillators.length, 0); assert.equal(quiet.c.sources.length, 1);
  assert.equal(quiet.c.buffers.length, 0); assert.equal(quiet.audio.voices.size, 0);
  for (const strength of [0, .6, 1]) {
    const heavy = await setup(), medium = await setup();
    heavy.c.currentTime = medium.c.currentTime = 7;
    heavy.audio.impact({kind: 'hit', endless: true, hitTier: 'heavy', power: .5, strength});
    assert.equal(medium.audio.impact({kind: 'hit', endless: true, hitTier: 'medium', power: .5, strength}), true);
    assert.equal(medium.c.oscillators.length, 1); assert.equal(medium.c.sources.length, 1);
    assert.equal(medium.c.buffers.length, 0); assert.equal(medium.audio.voices.size, 1);
    const voice = medium.c.oscillators[0];
    assert.equal(firstPitch(voice), firstPitch(heavy.c.oscillators[0]));
    assert.ok(Math.abs(peak(voice) / peak(heavy.c.oscillators[0]) - .4) < 1e-10);
    assert.ok(Math.abs(voice.target.gain.events.at(-1).at - 7 - .05) < 1e-10);
    voice.finish(); assert.equal(medium.audio.voices.size, 0);
  }
});

test('hit tiers do not silence Boss, lethal or legacy hit sounds', async () => {
  for (const options of [
    {kind: 'hit'}, {kind: 'boss', endless: true}, {kind: 'kill', endless: true},
  ]) for (const hitTier of ['light', 'medium']) {
    const reference = await setup(), other = await setup();
    reference.audio.impact(options); other.audio.impact({...options, hitTier});
    assert.equal(other.audio.voices.size, reference.audio.voices.size);
    assert.deepEqual(other.c.oscillators.map(firstPitch), reference.c.oscillators.map(firstPitch));
    assert.deepEqual(other.c.oscillators.map(peak), reference.c.oscillators.map(peak));
    assert.deepEqual(other.c.oscillators.map(v => v.stopTime), reference.c.oscillators.map(v => v.stopTime));
  }
});

test('endless walls use a strict quarter-power gate and quadratic gain without changing duration or legacy walls', async t => {
  const originalRandom = Math.random; let draws = 0;
  Math.random = () => { draws++; return .5; };
  t.after(() => { Math.random = originalRandom; });
  const muted = await setup();
  for (const power of [-1, 0, .249999]) assert.equal(muted.audio.wall(power, {endless: true}), false);
  assert.equal(muted.c.oscillators.length, 0); assert.equal(draws, 0);
  for (const power of [.25, .5, 1, 2]) {
    const {c, audio} = await setup(); c.currentTime = 3;
    assert.equal(audio.wall(power, {endless: true}), true);
    const voice = c.oscillators[0], bounded = Math.min(power, 1);
    assert.equal(firstPitch(voice), 100 + bounded * 80);
    assert.ok(Math.abs(peak(voice) - .0175 * bounded ** 2) < 1e-12);
    assert.ok(Math.abs(voice.target.gain.events.at(-1).at - 3 - .055) < 1e-12);
  }
  for (const power of [0, .1, .5, 1]) {
    const {c, audio} = await setup();
    assert.equal(audio.wall(power), true);
    assert.equal(peak(c.oscillators[0]), .0175);
  }
});

test('new endless audio keeps mute gates and reserves exactly the voices it needs', async () => {
  const c = audioContext(); let created = 0;
  const audio = new GameAudio({createContext: () => { created++; return c; }, loadMusic: async () => ({duration: 90})});
  const sounds = () => {
    assert.equal(audio.impact({kind: 'hit', endless: true, hitTier: 'medium'}), false);
    assert.equal(audio.impact({kind: 'kill', endless: true, frenzy: true, level: 11}), false);
    assert.equal(audio.wall(.5, {endless: true}), false);
  };
  sounds(); assert.equal(created, 0);
  await audio.unlock(); await audio.loading;
  audio.setLevels({sound: false}); sounds();
  audio.setLevels({sound: true, sfxVolume: 0}); sounds();
  audio.setLevels({sfxVolume: 1}); audio.setHidden(true); sounds();
  audio.setHidden(false); await audio.unlock(); c.state = 'suspended'; sounds();
  assert.equal(c.oscillators.length, 0);
  c.state = 'running';
  for (let i = 0; i < 31; i++) audio.tone();
  assert.equal(audio.impact({kind: 'hit', endless: true, hitTier: 'heavy'}), false);
  assert.equal(audio.impact({kind: 'hit', endless: true, hitTier: 'medium'}), true);
  assert.equal(audio.voices.size, 32);
  const allocated = c.oscillators.length + c.sources.length;
  assert.equal(audio.impact({kind: 'kill', endless: true}), false);
  assert.equal(audio.wall(1, {endless: true}), false);
  assert.equal(c.oscillators.length + c.sources.length, allocated);
  for (const voice of [...audio.voices]) voice.finish();
  assert.equal(audio.impact({kind: 'kill', endless: true, level: 7}), true);
  assert.equal(audio.voices.size, 4);
});
