import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio, MUSIC_TRACKS} from '../dist/audio.js';

// Deterministic load/device stalls test the dependency graph, not device latency.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const music = name => ({duration: 122, name});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} vs ${expected}`);

function audioContext() {
  const param = () => ({
    value: 1, events: [],
    cancelScheduledValues(at) { this.events.push({kind: 'cancel', at}); },
    setTargetAtTime(value, at) { this.value = value; this.events.push({kind: 'target', value, at}); },
    setValueAtTime(value, at) { this.value = value; this.events.push({kind: 'set', value, at}); },
    linearRampToValueAtTime(value, at) { this.value = value; this.events.push({kind: 'linear', value, at}); },
  });
  const node = () => ({
    gain: param(), frequency: param(), Q: param(),
    connect(target) { this.target = target; }, disconnect() { this.disconnected = true; },
    start(at = 0) { this.starts = (this.starts || 0) + 1; this.startTime = at; },
    stop(at) { this.stopTime = at; },
  });
  return {
    state: 'suspended', currentTime: 0, destination: {}, sources: [],
    createGain: node, createBiquadFilter: node,
    createBufferSource() { const source = node(); this.sources.push(source); return source; },
    async resume() { this.state = 'running'; },
    async suspend() { this.state = 'suspended'; },
    async decodeAudioData(bytes) { return music(new Uint8Array(bytes)[0] === 2 ? 'boss' : 'endless'); },
  };
}

function replaceGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
  t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
}

function fakeFetch(t, responder) {
  const calls = [];
  replaceGlobal(t, 'fetch', async url => {
    const name = String(url).endsWith('/boss.mp3') ? 'boss' : 'endless';
    calls.push(name);
    return responder ? responder(name, calls) : {
      ok: true, redirected: false,
      arrayBuffer: async () => new Uint8Array([name === 'boss' ? 2 : 1, 0, 0, 0]).buffer,
    };
  });
  return calls;
}

async function playing(loadMusic = async (_, name) => music(name)) {
  const c = audioContext();
  const audio = new GameAudio({createContext: () => c, loadMusic});
  await audio.unlock(); await audio.loading;
  return {c, audio};
}

test('a ready Boss starts while resident loading remains indefinitely pending', async () => {
  const c = audioContext(), never = deferred(), calls = [];
  const audio = new GameAudio({createContext: () => c, loadMusic: async (_, name) => {
    calls.push(name); return name === 'endless' ? never.promise : music(name);
  }});
  audio.setMusicScene('boss');
  await audio.unlock(); await settle();
  assert.equal(calls.filter(name => name === 'boss').length, 1, 'Boss loading must not depend on endless completion');
  assert.equal(calls.filter(name => name === 'endless').length, 1);
  assert.equal(audio.musicStatus().track, 'boss');
  assert.deepEqual(audio.musicStatus().starts, {endless: 0, boss: 1});
  assert.equal(audio.player.resident, null);
});

test('a late resident stays silent under Boss, is unique, and retains its clock on return', async () => {
  const c = audioContext(), residentReady = deferred(), calls = [];
  const audio = new GameAudio({createContext: () => c, loadMusic: async (_, name) => {
    calls.push(name); return name === 'endless' ? residentReady.promise : music(name);
  }});
  audio.setMusicScene('boss'); await audio.unlock(); await settle();
  assert.equal(audio.musicStatus().track, 'boss');
  const boss = audio.player.voices.get('boss');
  c.currentTime = 19; residentReady.resolve(music('endless')); await settle();
  const resident = audio.player.resident;
  assert.ok(resident);
  assert.equal(audio.musicStatus().track, 'boss');
  assert.equal(audio.player.voices.get('boss'), boss);
  assert.equal(resident.gain.gain.value, 0);
  assert.ok(resident.points.every(point => point.value === 0), 'no transient resident gain may cover Boss');
  await Promise.all([audio.setMusicScene('boss'), audio.unlock(), audio.unlock()]);
  assert.deepEqual(audio.musicStatus().starts, {endless: 1, boss: 1});
  assert.equal(calls.filter(name => name === 'endless').length, 1);
  c.currentTime = 34; await audio.setMusicScene('home');
  assert.equal(audio.player.resident, resident);
  assert.equal(audio.source, resident.source);
  assert.equal(resident.source.starts, 1);
  assert.equal(resident.source.stopTime, undefined);
  near(audio.musicStatus().startedAt, 19);
  near(audio.musicStatus().position, 15);
  assert.equal(audio.musicStatus().track, 'endless');
});

test('selected Boss bytes and decode prepare while the first device resume is still pending', async t => {
  const calls = fakeFetch(t), c = audioContext(), resumed = deferred(), decodes = [];
  c.resume = () => resumed.promise.then(() => { c.state = 'running'; });
  c.decodeAudioData = async bytes => {
    const name = new Uint8Array(bytes)[0] === 2 ? 'boss' : 'endless';
    decodes.push({name, state: c.state}); return music(name);
  };
  const audio = new GameAudio({createContext: () => c});
  audio.setMusicScene('boss'); const opening = audio.unlock(); await settle();
  assert.equal(c.state, 'suspended');
  assert.ok(calls.includes('boss'), 'download must start before another gesture/device resume');
  assert.ok(decodes.some(item => item.name === 'boss' && item.state === 'suspended'));
  assert.equal(c.sources.length, 0, 'preparation never starts an audible source');
  resumed.resolve(); await opening; await audio.loading;
  assert.equal(audio.musicStatus().track, 'boss');
  assert.equal(audio.musicStatus().starts.boss, 1);
  assert.equal(calls.filter(name => name === 'boss').length, 1);
});

test('upcoming Boss bytes can prefetch before a context exists and decode silently during resume', async t => {
  const calls = fakeFetch(t), c = audioContext(), resumed = deferred(), decoded = [];
  let contexts = 0;
  c.resume = () => resumed.promise.then(() => { c.state = 'running'; });
  c.decodeAudioData = async bytes => {
    const name = new Uint8Array(bytes)[0] === 2 ? 'boss' : 'endless';
    decoded.push(name); return music(name);
  };
  const audio = new GameAudio({createContext: () => { contexts++; return c; }});
  audio.setMusicScene('endless');
  await Promise.all([audio.prepareBossMusic(), audio.prepareBossMusic(), audio.prepareBossMusic()]);
  assert.equal(contexts, 0); assert.equal(decoded.length, 0);
  assert.deepEqual(calls, ['boss']);
  const opening = audio.unlock(); await settle();
  assert.ok(decoded.includes('boss'));
  assert.equal(c.sources.length, 0);
  resumed.resolve(); await opening; await audio.loading; await settle();
  assert.equal(audio.musicStatus().track, 'endless');
  assert.equal(audio.musicStatus().starts.boss, 0);
  await audio.setMusicScene('boss');
  assert.equal(audio.musicStatus().track, 'boss');
  assert.equal(calls.filter(name => name === 'boss').length, 1);
  assert.equal(decoded.filter(name => name === 'boss').length, 1);
});

test('first music never waits for an OfflineAudioContext decoder and reuses prefetched bytes', async t => {
  const calls = fakeFetch(t), c = audioContext(), offlineStall = deferred();
  let offlineContexts = 0, liveDecodes = 0;
  replaceGlobal(t, 'OfflineAudioContext', class {
    constructor() { offlineContexts++; }
    decodeAudioData() { return offlineStall.promise; }
  });
  c.decodeAudioData = async () => { liveDecodes++; return music('endless'); };
  const audio = new GameAudio({createContext: () => c});
  const preparation = audio.prepareMusic();
  await audio.unlock(); await settle();
  assert.equal(audio.musicStatus().track, 'endless', 'an unrelated offline decoder cannot hold the output silent');
  assert.equal(offlineContexts, 0);
  assert.equal(liveDecodes, 1);
  assert.deepEqual(calls, ['endless']);
  await preparation; await audio.loading;
});

test('failed byte preparation retries and concurrent preparation shares one successful fetch', async t => {
  const response = deferred();
  const calls = fakeFetch(t, async (_, list) => {
    if (list.length === 1) throw new Error('temporary network failure');
    return response.promise;
  });
  const audio = new GameAudio({createContext: audioContext});
  await audio.prepareMusic();
  const retries = [audio.prepareMusic(), audio.prepareMusic(), audio.prepareMusic()];
  await settle(); assert.deepEqual(calls, ['endless', 'endless']);
  response.resolve({ok: true, redirected: false, arrayBuffer: async () => new Uint8Array([1, 0]).buffer});
  await Promise.all(retries); await audio.unlock(); await audio.loading;
  assert.equal(audio.musicStatus().track, 'endless');
  assert.deepEqual(calls, ['endless', 'endless']);
});

test('a failed live decode retries intact bytes even when the decoder detaches its input', async t => {
  const original = new Uint8Array([1, 0, 0, 0]).buffer, c = audioContext(), inputs = [];
  const calls = fakeFetch(t, async () => ({ok: true, redirected: false, arrayBuffer: async () => original}));
  c.decodeAudioData = async bytes => {
    assert.equal(new Uint8Array(bytes)[0], 1, 'every retry receives intact MP3 bytes');
    inputs.push(bytes); structuredClone(bytes, {transfer: [bytes]});
    if (inputs.length === 1) throw new Error('temporary decoder failure');
    return music('endless');
  };
  const audio = new GameAudio({createContext: () => c});
  await audio.unlock(); await audio.loading;
  assert.equal(audio.musicStatus().track, null);
  assert.equal(original.byteLength, 4, 'the shared cache must never be passed directly to a consuming decoder');
  await audio.unlock(); await audio.loading;
  assert.equal(audio.musicStatus().track, 'endless');
  assert.equal(inputs.length, 2); assert.notEqual(inputs[0], inputs[1]);
  assert.deepEqual(calls, ['endless', 'endless'], 'a corrupt or undecodable resource is eligible for a fresh download');
});

test('a timed-out response body cannot poison later preparation or overwrite a fresh result', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const stalledBody = deferred(), c = audioContext(); let decodedMarker;
  const calls = fakeFetch(t, async (_, list) => ({
    ok: true, redirected: false,
    arrayBuffer: async () => list.length === 1 ? stalledBody.promise : new Uint8Array([1, 7]).buffer,
  }));
  c.decodeAudioData = async bytes => { decodedMarker = new Uint8Array(bytes)[1]; return music('endless'); };
  const audio = new GameAudio({createContext: () => c});
  const stalled = audio.prepareMusic(); await settle();
  t.mock.timers.tick(60_000); await stalled;
  await audio.prepareMusic();
  // The obsolete body may complete after a successful retry, but must not
  // replace the successfully cached bytes with its abandoned payload.
  stalledBody.resolve(new Uint8Array([1, 3]).buffer); await settle();
  await audio.unlock(); await audio.loading;
  assert.deepEqual(calls, ['endless', 'endless']);
  assert.equal(decodedMarker, 7);
  assert.equal(audio.musicStatus().track, 'endless');
});

test('selecting Boss after a first resume is already pending prepares its decode immediately', async t => {
  const calls = fakeFetch(t), c = audioContext(), resumed = deferred(), decoded = [];
  c.resume = () => resumed.promise.then(() => { c.state = 'running'; });
  c.decodeAudioData = async bytes => {
    const name = new Uint8Array(bytes)[0] === 2 ? 'boss' : 'endless';
    decoded.push(name); return music(name);
  };
  const audio = new GameAudio({createContext: () => c});
  const opening = audio.unlock(); await settle();
  audio.setMusicScene('boss'); await settle();
  assert.ok(calls.includes('boss'), 'changing intent cannot wait behind a pending resume');
  assert.ok(decoded.includes('boss'));
  assert.equal(c.state, 'suspended'); assert.equal(c.sources.length, 0);
  resumed.resolve(); await opening; await audio.loading;
  assert.equal(audio.musicStatus().track, 'boss');
  assert.equal(calls.filter(name => name === 'boss').length, 1);
});

test('later Boss encounters reuse compressed bytes after cancelled PCM is released', async t => {
  const calls = fakeFetch(t), c = audioContext(), decodedInputs = [];
  c.decodeAudioData = async bytes => {
    const name = new Uint8Array(bytes)[0] === 2 ? 'boss' : 'endless';
    if (name === 'boss') decodedInputs.push(bytes);
    structuredClone(bytes, {transfer: [bytes]});
    return music(name);
  };
  const audio = new GameAudio({createContext: () => c});
  await audio.unlock(); await audio.loading;
  for (let run = 0; run < 3; run++) {
    await audio.setMusicScene('endless'); await audio.prepareBossMusic();
    assert.equal(audio.musicStatus().starts.boss, 0);
    await audio.setMusicScene('home');
    assert.ok(!audio.musicStatus().cached.includes('boss'));
  }
  assert.equal(calls.filter(name => name === 'boss').length, 1);
  assert.equal(decodedInputs.length, 3);
  assert.equal(new Set(decodedInputs).size, 3);
});

test('preparation, scene entry, and repeated gestures share one pending Boss decode', async () => {
  const bossReady = deferred(), calls = [];
  const {audio, c} = await playing(async (_, name) => {
    calls.push(name); return name === 'boss' ? bossReady.promise : music(name);
  });
  await audio.setMusicScene('endless');
  const preparations = [audio.prepareBossMusic(), audio.prepareBossMusic()];
  await settle();
  assert.equal(c.sources.length, 1); assert.equal(audio.musicStatus().starts.boss, 0);
  const entering = audio.setMusicScene('boss');
  const reentering = audio.setMusicScene('boss'); await audio.unlock(); await settle();
  assert.equal(calls.filter(name => name === 'boss').length, 1);
  bossReady.resolve(music('boss')); await Promise.all([...preparations, entering, reentering]);
  assert.equal(audio.musicStatus().track, 'boss');
  assert.equal(audio.musicStatus().starts.boss, 1);
});

test('home cancellation and run reset discard late prepared Boss PCM without starting it', async () => {
  const waits = [deferred(), deferred()]; let attempts = 0;
  const {audio} = await playing(async (_, name) => name === 'boss' ? waits[attempts++].promise : music(name));
  await audio.setMusicScene('endless');
  const oldRun = audio.prepareBossMusic(); await settle();
  await audio.setMusicScene('home'); waits[0].resolve(music('boss')); await oldRun;
  assert.equal(audio.musicStatus().starts.boss, 0);
  assert.ok(!audio.musicStatus().cached.includes('boss'));
  await audio.setMusicScene('endless');
  const newRun = audio.prepareBossMusic(); await settle();
  await audio.setMusicScene('endless', {resetPreparation: true});
  waits[1].resolve(music('boss')); await newRun;
  assert.equal(attempts, 2);
  assert.equal(audio.musicStatus().starts.boss, 0);
  assert.ok(!audio.musicStatus().cached.includes('boss'));
});

test('rapid home to Boss to home cannot resurrect a late selected Boss decode', async () => {
  const bossReady = deferred();
  const {audio} = await playing(async (_, name) => name === 'boss' ? bossReady.promise : music(name));
  const entering = audio.setMusicScene('boss'); await settle();
  await audio.setMusicScene('home');
  bossReady.resolve(music('boss')); await entering;
  assert.equal(audio.musicStatus().scene, 'home');
  assert.equal(audio.musicStatus().track, 'endless');
  assert.equal(audio.musicStatus().starts.boss, 0);
  assert.ok(!audio.musicStatus().cached.includes('boss'));
});

for (const mode of ['master mute', 'music mute', 'background']) {
  test(`a late Boss decode stays silent during ${mode} and resumes only when permitted`, async () => {
    const bossReady = deferred();
    const {audio, c} = await playing(async (_, name) => name === 'boss' ? bossReady.promise : music(name));
    const entering = audio.setMusicScene('boss'); await settle();
    if (mode === 'master mute') audio.setLevels({sound: false});
    else if (mode === 'music mute') audio.setLevels({bgmVolume: 0});
    else audio.setHidden(true);
    bossReady.resolve(music('boss')); await entering;
    assert.equal(audio.musicStatus().starts.boss, 0);
    assert.equal(c.sources.length, 1);
    if (mode === 'master mute') audio.setLevels({sound: true});
    else if (mode === 'music mute') audio.setLevels({bgmVolume: .55});
    else await audio.setHidden(false);
    await audio.loading;
    assert.equal(audio.musicStatus().track, 'boss');
    assert.equal(audio.musicStatus().starts.boss, 1);
  });
}

test('muted or backgrounded preparation neither opens a device nor downloads music', async t => {
  const calls = fakeFetch(t); let contexts = 0;
  for (const mode of ['master mute', 'music mute', 'background']) {
    const audio = new GameAudio({createContext: () => { contexts++; return audioContext(); }});
    if (mode === 'master mute') audio.setLevels({sound: false});
    else if (mode === 'music mute') audio.setLevels({bgmVolume: 0});
    else audio.setHidden(true);
    await audio.prepareMusic(); await audio.prepareBossMusic();
  }
  assert.equal(contexts, 0); assert.deepEqual(calls, []);
});

test('an existing suspended context prepares Boss without emitting a new source', async () => {
  const calls = [];
  const {audio, c} = await playing(async (_, name) => { calls.push(name); return music(name); });
  await audio.setMusicScene('endless'); c.state = 'suspended';
  await audio.prepareBossMusic();
  assert.deepEqual(calls, ['endless', 'boss']);
  assert.equal(c.sources.length, 1);
  assert.equal(audio.musicStatus().starts.boss, 0);
  await audio.unlock(); await audio.setMusicScene('boss');
  assert.equal(audio.musicStatus().track, 'boss');
  assert.equal(calls.filter(name => name === 'boss').length, 1);
  near(audio.player.voices.get('boss').source.loopEnd, MUSIC_TRACKS.boss.loopEnd);
});

test('resident decode releases duplicate endless MP3 bytes without refetching or decoding on scene changes',async t=>{
  const calls=fakeFetch(t),c=audioContext(),decoded=[];
  c.decodeAudioData=async bytes=>{
    const name=new Uint8Array(bytes)[0]===2?'boss':'endless';decoded.push(name);return music(name);
  };
  const audio=new GameAudio({createContext:()=>c});
  await audio.prepareMusic();assert.ok(audio.musicByteCache.has('endless'));
  await audio.unlock();await audio.loading;
  assert.equal(audio.musicByteCache.has('endless'),false);
  const resident=audio.source;
  for(const scene of ['endless','boss','home','resultEndless','endless']){
    await audio.setMusicScene(scene);await audio.prepareMusic();
  }
  assert.equal(audio.source,resident);assert.equal(resident.starts,1);
  assert.equal(calls.filter(name=>name==='endless').length,1);
  assert.equal(decoded.filter(name=>name==='endless').length,1);
  assert.ok(audio.musicByteCache.has('boss'),'Boss bytes remain available after its temporary PCM is released');
});
