import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio, MUSIC_TRACKS, MAX_EFFECT_VOICES, audioLevel, volumeGain} from '../dist/audio.js';

function context() {
  const param = () => ({value:1,events:[],cancelScheduledValues(at){this.events.push({type:'cancel',at});},setTargetAtTime(value,at){this.value=value;this.events.push({type:'target',value,at});},setValueAtTime(value,at){this.value=value;this.events.push({type:'set',value,at});},linearRampToValueAtTime(value,at){this.value=value;this.events.push({type:'linear',value,at});},exponentialRampToValueAtTime(value,at){this.value=value;this.events.push({type:'exponential',value,at});}});
  const node = () => ({gain:param(),frequency:param(),Q:param(),connect(target){this.target=target;},disconnect(){this.disconnected=true;},start(at=0,offset=0){this.offset=offset;this.starts=(this.starts||0)+1;this.startTime=at;},stop(at){this.stopTime=at;},finish(){this.onended?.();}});
  return {state:'suspended',currentTime:0,sampleRate:48000,destination:{},sources:[],oscillators:[],createGain:node,createBiquadFilter:node,
    createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/sampleRate,length,sampleRate,getChannelData:channel=>data[channel]};},
    createBufferSource(){const n=node();this.sources.push(n);return n;},createOscillator(){const n=node();this.oscillators.push(n);return n;},
    async resume(){this.state='running';},async suspend(){this.state='suspended';}};
}

test('constructing the engine is silent, and repeated unlocks keep one continuous loop', async () => {
  const c=context(); let loads=0, contexts=0;
  const audio=new GameAudio({createContext:()=>{contexts++;return c;},loadMusic:async()=>{loads++;return{duration:122};}});
  audio.setLevels({sound:true,bgmVolume:.55,sfxVolume:.75});
  assert.equal(contexts,0);
  await Promise.all([audio.unlock(),audio.unlock()]);await audio.loading;
  await audio.unlock();
  assert.equal(contexts,1);assert.equal(loads,1);assert.equal(c.sources.length,1);
  assert.equal(audio.source.starts,1);assert.equal(audio.source.loop,true);assert.equal(audio.source.loopEnd,MUSIC_TRACKS.endless.loopEnd);
});

test('volume buses are independent; master mute preserves levels and suppresses effects', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;
  audio.setLevels({sound:true,bgmVolume:0,sfxVolume:.7});
  assert.equal(audio.music.gain.value,0);assert.equal(audio.effects.gain.value,volumeGain(.7));
  audio.tone();assert.equal(c.oscillators.length,1);assert.equal(c.oscillators[0].target.target,audio.effects);
  assert.equal(audio.source.target.target,audio.player.filter);assert.equal(audio.player.sceneGain.target,audio.music);
  audio.setLevels({sound:false,bgmVolume:.42,sfxVolume:.7});audio.tone();
  assert.equal(audio.master.gain.value,0);assert.equal(c.oscillators.length,1);
  audio.setLevels({sound:true});assert.equal(audio.music.gain.value,volumeGain(.42));assert.equal(audio.effects.gain.value,volumeGain(.7));
  audio.setLevels({sfxVolume:0});audio.tone();assert.equal(c.oscillators.length,1);
  assert.equal(audioLevel(-1),0);assert.equal(audioLevel(2),1);assert.equal(audioLevel(NaN,.55),.55);
});

test('backgrounding suspends after rendered silence and returning resumes the same source; failed loads retry', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const c=context();let loads=0;
  const audio=new GameAudio({createContext:()=>c,loadMusic:async()=>{if(++loads===1)throw Error('offline miss');return{duration:122};}});
  await audio.unlock();await audio.loading;assert.equal(audio.source,null);
  await audio.unlock();await audio.loading;assert.equal(c.sources.length,1);
  c.currentTime=1;audio.setHidden(true);audio.tone();assert.equal(c.oscillators.length,0);
  assert.deepEqual(audio.master.gain.events.at(-1),{type:'linear',value:0,at:1.05});
  t.mock.timers.tick(65);assert.equal(c.state,'running','a delayed audio thread still needs to render the fade');
  c.currentTime=1.07;t.mock.timers.tick(65);assert.equal(c.state,'suspended');
  audio.setHidden(false);await audio.unlock();assert.equal(c.state,'running');assert.equal(c.sources.length,1);
  assert.equal(audio.source.starts,1);assert.equal(audio.master.gain.value,1);
});

test('immediate return reverses the master fade at the audible level and cancels suspension', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;
  c.currentTime=2;audio.setHidden(true);
  const events=audio.master.gain.events, count=events.length;
  c.currentTime=2.025;audio.setHidden(true);
  assert.equal(events.length,count,'visibilitychange and pagehide share one fade');
  audio.setHidden(false);
  assert.ok(Math.abs(events.at(-2).value-.5)<1e-8);
  assert.equal(events.at(-2).at,c.currentTime);
  assert.deepEqual(events.at(-1),{type:'linear',value:1,at:c.currentTime+.05});
  c.currentTime=2.1;t.mock.timers.tick(500);
  assert.equal(c.state,'running');assert.equal(audio.source.starts,1);
});

test('return during an outstanding audio-thread suspend waits for it before resuming audibly', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;
  let finishSuspend;
  c.suspend=()=>new Promise(resolve=>{finishSuspend=()=>{c.state='suspended';resolve();};});
  c.currentTime=1;audio.setHidden(true);c.currentTime=1.07;t.mock.timers.tick(70);
  assert.equal(typeof finishSuspend,'function');
  audio.setHidden(false);const restored=audio.unlock();
  assert.equal(audio.master.gain.events.at(-1).value,0);
  finishSuspend();await restored;
  assert.equal(c.state,'running');assert.equal(audio.master.gain.events.at(-1).value,1);
  assert.equal(audio.source.starts,1);
});

test('boss victory schedules five rising notes on the effects bus and cleans up every voice', async () => {
  const c=context();let contexts=0,loads=0;
  const audio=new GameAudio({createContext:()=>{contexts++;return c;},loadMusic:async()=>{loads++;return{duration:122};}});
  await audio.unlock();await audio.loading;c.currentTime=12;
  const music=audio.source;
  assert.equal(audio.bossVictory(),undefined);
  const fundamentals=c.oscillators.filter(o=>o.type==='triangle'),harmonics=c.oscillators.filter(o=>o.type==='sine');
  assert.equal(fundamentals.length,5);assert.equal(harmonics.length,5);
  const pitch=o=>o.frequency.events.find(e=>e.type==='set').value;
  assert.equal(fundamentals[0].startTime,12);
  assert.ok(Math.abs(pitch(fundamentals[4])/pitch(fundamentals[0])-2)<.00001);
  for(let i=0;i<fundamentals.length;i++){
    const note=fundamentals[i],harmonic=harmonics[i];
    if(i){assert.ok(pitch(note)>pitch(fundamentals[i-1]));assert.ok(note.startTime>fundamentals[i-1].startTime);}
    assert.equal(harmonic.startTime,note.startTime);assert.equal(pitch(harmonic),pitch(note)*2);
    assert.equal(note.frequency.events.at(-1).value,pitch(note),'reward notes sustain their pitch rather than sliding down');
  }
  assert.ok(fundamentals.at(-1).stopTime-12>=.75&&fundamentals.at(-1).stopTime-12<=.85);
  assert.equal(audio.voices.size,10);
  for(const oscillator of c.oscillators){
    const gain=oscillator.target,attack=gain.gain.events.find(e=>e.type==='linear');
    assert.equal(gain.target,audio.effects);
    assert.ok(attack.value>0&&attack.value<.05);assert.ok(attack.at-oscillator.startTime>=.014);
    assert.ok(oscillator.stopTime>attack.at);
    oscillator.finish();assert.equal(oscillator.disconnected,true);assert.equal(gain.disconnected,true);
  }
  assert.equal(audio.voices.size,0);
  assert.equal(contexts,1);assert.equal(loads,1);assert.equal(c.sources.length,1);
  assert.equal(audio.source,music);assert.equal(music.starts,1);assert.equal(music.target.target,audio.player.filter);
});

test('boss victory respects master mute, effects volume and background state without restarting music', async () => {
  const c=context();let contexts=0;
  const audio=new GameAudio({createContext:()=>{contexts++;return c;},loadMusic:async()=>({duration:122})});
  audio.bossVictory();assert.equal(contexts,0,'reward cannot create or unlock an audio context');
  await audio.unlock();await audio.loading;
  audio.setLevels({sound:false,sfxVolume:.7});audio.bossVictory();assert.equal(c.oscillators.length,0);
  audio.setLevels({sound:true,bgmVolume:0});audio.bossVictory();assert.equal(c.oscillators.length,10);
  assert.equal(audio.music.gain.value,0);assert.equal(audio.effects.gain.value,volumeGain(.7));
  audio.setLevels({sfxVolume:0});audio.bossVictory();assert.equal(c.oscillators.length,10);
  audio.setLevels({sfxVolume:.7});audio.setHidden(true);audio.bossVictory();
  assert.equal(c.oscillators.length,10);assert.equal(audio.master.gain.value,0);
  audio.setHidden(false);await audio.unlock();
  c.state='suspended';audio.bossVictory();assert.equal(c.oscillators.length,10);
  assert.equal(contexts,1);assert.equal(c.sources.length,1);assert.equal(audio.source.starts,1);
});

test('boss defeat starts its transient, body, low end and short tail on one immediate audio-clock origin', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;
  const music=audio.source;let clockReads=0;
  Object.defineProperty(c,'currentTime',{get(){return 12+clockReads++*.001;}});
  audio.bossDefeat({strength:1});
  assert.equal(clockReads,1,'all layers capture a single time rather than reading the moving clock separately');
  const voices=[...audio.voices],noise=c.sources.find(source=>source!==music);
  assert.equal(voices.length,4);assert.equal(c.oscillators.length,3);assert.ok(noise);
  assert.equal(noise.buffer.length,480);assert.equal(noise.stopTime,12.009);
  assert.equal(noise.buffer.getChannelData(0).some(value=>value!==0),true);
  const bass=c.oscillators.find(oscillator=>oscillator.frequency.events[0].value===90);
  assert.ok(bass);assert.equal(bass.frequency.events.at(-1).value,45);
  assert.equal(bass.frequency.events.at(-1).at,12.13);
  for(const voice of voices){
    assert.equal(voice.startTime,12);assert.equal(voice.target.target,audio.effects);
    const envelope=voice.target.gain.events,attack=envelope.find(event=>event.type==='linear');
    assert.deepEqual(envelope[0],{type:'set',value:0,at:12});
    assert.ok(attack.at>12&&attack.at<=12.008);assert.ok(attack.value>0&&attack.value<=.04);
    assert.equal(envelope.at(-1).value,.0001);
    assert.ok(voice.stopTime>attack.at&&voice.stopTime<=12.17+1e-10,'all voices end within the 170 ms cue');
  }
  assert.equal(audio.source,music);assert.equal(music.starts,1);assert.equal(music.target.target,audio.player.filter);
});

test('boss defeat releases every node without disrupting the later victory melody or continuous music', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;c.currentTime=4;audio.bossDefeat();
  const impact=[...audio.voices],music=audio.source;
  c.currentTime=4.2;audio.bossVictory();const celebration=[...audio.voices].filter(voice=>!impact.includes(voice));
  assert.equal(celebration.length,10);assert.ok(celebration.some(voice=>voice.startTime>4.2));
  for(const voice of impact){const gain=voice.target;voice.finish();assert.equal(voice.disconnected,true);assert.equal(gain.disconnected,true);}
  assert.equal(audio.voices.size,10);assert.ok(celebration.every(voice=>!voice.disconnected));
  for(const voice of celebration)voice.finish();
  assert.equal(audio.voices.size,0);assert.equal(music.stopTime,undefined);assert.equal(music.disconnected,undefined);
});

test('boss defeat reserves all layers atomically and attenuates overlaps within the shared voice budget', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;
  let totalPeak=0;
  for(let event=0;event<MAX_EFFECT_VOICES/4;event++){
    const before=new Set(audio.voices);audio.bossDefeat({strength:1});
    const added=[...audio.voices].filter(voice=>!before.has(voice));assert.equal(added.length,4);
    const peak=added.reduce((sum,voice)=>sum+voice.target.gain.events.find(item=>item.type==='linear').value,0);
    assert.ok(Math.abs(peak-.109/Math.sqrt(1+event))<1e-12);totalPeak+=peak;
  }
  assert.ok(totalPeak<.5,'even a burst of only defeat voices has a bounded conservative peak sum');
  const nodes=c.oscillators.length+c.sources.length;
  audio.bossDefeat({strength:1});assert.equal(audio.voices.size,MAX_EFFECT_VOICES);assert.equal(c.oscillators.length+c.sources.length,nodes);
  // Three free slots must not create an incomplete four-layer event.
  for(const voice of [...audio.voices].slice(0,3))voice.finish();
  audio.bossDefeat({strength:1});assert.equal(audio.voices.size,MAX_EFFECT_VOICES-3);assert.equal(c.oscillators.length+c.sources.length,nodes);
  for(const voice of [...audio.voices])voice.finish();assert.equal(audio.voices.size,0);
  audio.bossDefeat({strength:1});assert.equal(audio.voices.size,4);
});

test('boss defeat honors locked, muted, zero-volume, hidden and suspended states without restarting or replaying audio', async () => {
  const c=context();let contexts=0;
  const audio=new GameAudio({createContext:()=>{contexts++;return c;},loadMusic:async()=>({duration:122})});
  audio.bossDefeat();assert.equal(contexts,0);
  await audio.unlock();await audio.loading;
  const initialSources=c.sources.length;
  audio.setLevels({sound:false});audio.bossDefeat();
  audio.setLevels({sound:true,sfxVolume:0});audio.bossDefeat();
  audio.setLevels({sfxVolume:.5});audio.setHidden(true);audio.bossDefeat();
  assert.equal(c.oscillators.length,0);assert.equal(c.sources.length,initialSources);
  audio.setHidden(false);await audio.unlock();
  for(const state of ['suspended','closed']){c.state=state;audio.bossDefeat();assert.equal(c.oscillators.length,0);}
  c.state='running';audio.setLevels({bgmVolume:0});audio.bossDefeat();const voices=[...audio.voices];
  assert.equal(voices.length,4);assert.equal(audio.effects.gain.value,volumeGain(.5));assert.equal(audio.music.gain.value,0);
  audio.setLevels({sound:false});assert.equal(audio.master.gain.value,0);
  for(const voice of voices)voice.finish();
  audio.setLevels({sound:true});audio.setHidden(false);await audio.unlock();
  assert.equal(audio.voices.size,0);assert.equal(c.oscillators.length,3);assert.equal(contexts,1);assert.equal(audio.source.starts,1);
});

test('zero-strength boss defeat keeps only a quiet short cue and enhanced defeats reuse deterministic local noise', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>{throw Error('No music');}});
  await audio.unlock();await audio.loading;
  audio.bossDefeat({strength:0});
  assert.equal(c.oscillators.length,1);assert.equal(c.sources.length,0);assert.equal(audio.voices.size,1);
  assert.equal(c.oscillators[0].target.gain.events.find(event=>event.type==='linear').value,.035);
  assert.ok(c.oscillators[0].stopTime<.09);c.oscillators[0].finish();
  const originalRandom=Math.random;
  Math.random=()=>{throw Error('boss defeat must not consume cosmetic or world randomness');};
  try{audio.bossDefeat({strength:1});audio.bossDefeat({strength:1});}finally{Math.random=originalRandom;}
  assert.equal(c.sources.length,2);assert.equal(c.sources[0].buffer,c.sources[1].buffer);
  assert.equal(audio.source,null,'a defeat never creates replacement music');
  for(const voice of [...audio.voices])voice.finish();assert.equal(audio.voices.size,0);
});

test('ordinary tones retain their immediate timing, pitch slide and short attack', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;c.currentTime=3;
  audio.tone(440,.2,'triangle',.04,1.5);
  const oscillator=c.oscillators[0];
  assert.equal(oscillator.startTime,3);assert.equal(oscillator.type,'triangle');
  assert.deepEqual(oscillator.frequency.events,[{type:'set',value:440,at:3},{type:'exponential',value:660,at:3.2}]);
  assert.deepEqual(oscillator.target.gain.events.find(e=>e.type==='linear'),{type:'linear',value:.04,at:3.003});
  assert.equal(oscillator.stopTime,3.21);oscillator.finish();assert.equal(audio.voices.size,0);
});

test('clear start ducks existing audio by 6 dB, schedules the chord at 80 ms and recovers without game timers', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;c.currentTime=12;
  const music=audio.source;
  audio.clearStart();
  const low=10**(-6/20),events=audio.feedbackDuck.gain.events;
  assert.deepEqual(events.slice(-4),[
    {type:'set',value:1,at:12},
    {type:'linear',value:low,at:12.006},
    {type:'set',value:low,at:12.08},
    {type:'linear',value:1,at:12.16},
  ]);
  assert.equal(audio.music.target,audio.feedbackDuck);assert.equal(audio.effects.target,audio.feedbackDuck);
  assert.equal(audio.feedbackDuck.target,audio.master);
  assert.equal(c.oscillators.length,3);assert.equal(audio.voices.size,3);
  const notes=c.oscillators.map(o=>o.frequency.events[0].value);
  assert.deepEqual(notes,[523.251,659.255,783.991]);
  const sequence=audio.clearSequence;
  for(const oscillator of c.oscillators){
    assert.equal(oscillator.type,'sine');assert.equal(oscillator.startTime,12.08);
    assert.equal(oscillator.frequency.events.length,1,'the chord sustains fixed pitches');
    assert.equal(oscillator.target.target,sequence.bus);assert.equal(sequence.bus.target,audio.effects);
    const peak=oscillator.target.gain.events.find(e=>e.type==='linear');
    assert.ok(peak.value>0&&peak.value<.022);assert.ok(peak.at-12.08>=.024);
    assert.ok(Math.abs(oscillator.target.gain.events.at(-1).at-12.68)<1e-9);
    oscillator.finish();
  }
  assert.equal(sequence.bus.disconnected,true);assert.equal(audio.clearSequence,null);assert.equal(audio.voices.size,0);
  assert.equal(audio.source,music);assert.equal(music.starts,1);assert.equal(c.sources.length,1);
});

test('clear anticipation and its recovery remain independent of music and effects volume changes', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;audio.clearStart();
  const automation=audio.feedbackDuck.gain.events.slice();
  c.currentTime=.03;audio.setLevels({bgmVolume:.2,sfxVolume:.3});
  assert.deepEqual(audio.feedbackDuck.gain.events,automation);
  assert.equal(audio.music.gain.value,volumeGain(.2));assert.equal(audio.effects.gain.value,volumeGain(.3));
  audio.clearEnd();
  assert.equal(audio.music.gain.value,volumeGain(.2));assert.equal(audio.effects.gain.value,volumeGain(.3));
  assert.deepEqual(audio.feedbackDuck.gain.events.at(-1),{type:'target',value:1,at:.03});
});

test('clear end cancels a not-yet-started chord and never stops unrelated audio', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;audio.tone(300,.4);
  const unrelated=c.oscillators[0],unrelatedStop=unrelated.stopTime,music=audio.source;
  audio.clearStart();const sequence=audio.clearSequence,notes=[...sequence.voices];
  c.currentTime=.025;audio.clearEnd();audio.clearEnd();
  assert.equal(audio.clearSequence,null);
  for(const note of notes){assert.ok(note.stopTime<note.startTime);note.finish();}
  assert.equal(sequence.bus.gain.events.at(-1).value,0);assert.equal(sequence.bus.disconnected,true);
  assert.equal(audio.feedbackDuck.gain.events.at(-1).value,1);
  assert.equal(unrelated.stopTime,unrelatedStop);assert.equal(audio.voices.size,1);
  assert.equal(audio.source,music);assert.equal(music.stopTime,undefined);
});

test('canceling one millisecond before the chord begins still prevents every scheduled note', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;audio.clearStart();
  const notes=[...audio.clearSequence.voices];
  c.currentTime=.079;audio.clearEnd();
  for(const note of notes){assert.equal(note.stopTime,.079);assert.ok(note.stopTime<note.startTime);note.finish();}
  assert.equal(audio.voices.size,0);
});

test('mute, zero effects volume and hiding cancel clear notes; re-enabling sound does not replay them', async () => {
  for(const action of ['mute','effects','hidden']){
    const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
    await audio.unlock();await audio.loading;audio.clearStart();const sequence=audio.clearSequence;
    c.currentTime=.02;
    if(action==='mute')audio.setLevels({sound:false});
    else if(action==='effects')audio.setLevels({sfxVolume:0});
    else audio.setHidden(true);
    assert.equal(audio.clearSequence,null);assert.equal(audio.feedbackDuck.gain.events.at(-1).value,1);
    for(const note of [...sequence.voices]){assert.ok(note.stopTime<note.startTime);note.finish();}
    audio.setLevels({sound:true,sfxVolume:.75});audio.setHidden(false);await audio.unlock();
    assert.equal(c.oscillators.length,3);assert.equal(audio.voices.size,0);assert.equal(audio.source.starts,1);
  }
});

test('resetting a playing clear chord releases it softly and late completion cannot clear the next chord', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;audio.clearStart();const old=audio.clearSequence;
  c.currentTime=.2;audio.clearEnd();
  assert.deepEqual(old.bus.gain.events.at(-1),{type:'target',value:0,at:.2});
  for(const voice of old.voices)assert.equal(voice.stopTime,.22);
  audio.clearStart({strength:1});const next=audio.clearSequence;
  for(const voice of [...old.voices])voice.finish();
  assert.equal(audio.clearSequence,next);assert.equal(next.voices.size,3);assert.equal(audio.voices.size,3);
  audio.clearEnd();for(const voice of [...next.voices])voice.finish();
  assert.equal(audio.voices.size,0);assert.equal(next.bus.disconnected,true);
});

test('clear feedback cannot unlock audio, is optional, is bounded, and does not invent a music source', async () => {
  const c=context();let contexts=0;
  const audio=new GameAudio({createContext:()=>{contexts++;return c;},loadMusic:async()=>{throw Error('No music');}});
  audio.clearStart();audio.clearEnd();assert.equal(contexts,0);
  await audio.unlock();await audio.loading;
  audio.clearStart({strength:0});assert.equal(c.oscillators.length,0);assert.equal(audio.clearSequence,null);
  audio.setLevels({sound:false});audio.clearStart();assert.equal(c.oscillators.length,0);
  audio.setLevels({sound:true});audio.clearStart();assert.equal(c.oscillators.length,3);
  assert.equal(c.sources.length,0);assert.equal(audio.source,null);
  for(let i=0;i<100;i++)audio.clearStart();
  assert.ok(audio.voices.size<=32);
  audio.clearEnd();for(const voice of [...audio.voices])voice.finish();assert.equal(audio.voices.size,0);
});

test('reward contact starts a crisp short chink on one audio-clock origin without a bass tail', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;
  const music=audio.source;let reads=0;
  Object.defineProperty(c,'currentTime',{get(){return 8+reads++*.001;}});
  audio.rewardHit({strength:1,power:1});
  assert.equal(reads,1,'all contact layers begin on the same clock sample');
  const voices=[...audio.voices],noise=c.sources.find(source=>source!==music);
  assert.equal(voices.length,3);assert.equal(c.oscillators.length,2);assert.ok(noise);
  assert.ok(noise.stopTime-8<=.006);
  for(const oscillator of c.oscillators){
    assert.ok(oscillator.frequency.events[0].value>=1000,'reward timbre has a bright body and upper partial, not a low thud');
    assert.ok(oscillator.stopTime-8<=.13);
  }
  for(const voice of voices){
    assert.equal(voice.startTime,8);assert.equal(voice.target.target,audio.effects);
    const envelope=voice.target.gain.events,attack=envelope.find(event=>event.type==='linear');
    assert.deepEqual(envelope[0],{type:'set',value:0,at:8});
    assert.ok(attack.at>8&&attack.at<=8.003);assert.ok(attack.value>0&&attack.value<=.032);
    assert.equal(envelope.at(-1).value,.0001);assert.ok(voice.stopTime>attack.at);
  }
  assert.equal(audio.source,music);assert.equal(music.starts,1);assert.equal(music.target.target,audio.player.filter);
});

test('reward contact keeps a quiet basic cue at zero strength and releases all nodes without affecting music', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;const music=audio.source;
  audio.rewardHit({strength:0,power:0});
  assert.equal(audio.voices.size,1);assert.equal(c.sources.length,1);
  const basic=c.oscillators[0];
  assert.ok(basic.target.gain.events.find(event=>event.type==='linear').value<.03);
  assert.ok(basic.stopTime<=.13);basic.finish();
  assert.equal(audio.voices.size,0);
  audio.rewardHit();
  for(const voice of [...audio.voices]){
    const gain=voice.target;voice.finish();assert.equal(voice.disconnected,true);assert.equal(gain.disconnected,true);
  }
  assert.equal(audio.voices.size,0);assert.equal(audio.source,music);assert.equal(music.stopTime,undefined);
});

test('reward contact reserves its layers atomically and bounds overlapping peak gain', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:122})});
  await audio.unlock();await audio.loading;
  let lastPeak=Infinity,totalPeak=0;
  for(let index=0;index<Math.floor(MAX_EFFECT_VOICES/3);index++){
    const before=new Set(audio.voices);audio.rewardHit({strength:1,power:1});
    const added=[...audio.voices].filter(voice=>!before.has(voice));assert.equal(added.length,3);
    const peak=added.reduce((sum,voice)=>sum+voice.target.gain.events.find(event=>event.type==='linear').value,0);
    assert.ok(peak<lastPeak);lastPeak=peak;totalPeak+=peak;
  }
  assert.ok(totalPeak<.3,'even simultaneous reward events stay below ordinary full-scale output');
  const nodes=c.oscillators.length+c.sources.length,occupied=audio.voices.size;
  audio.rewardHit({strength:1});
  assert.equal(audio.voices.size,occupied);assert.equal(c.oscillators.length+c.sources.length,nodes,'two remaining slots must not play a partial event');
  audio.rewardHit({strength:0});audio.rewardHit({strength:0});
  assert.equal(audio.voices.size,MAX_EFFECT_VOICES);
  audio.rewardHit({strength:0});assert.equal(audio.voices.size,MAX_EFFECT_VOICES);
  for(const voice of [...audio.voices])voice.finish();
  audio.rewardHit({strength:1});assert.equal(audio.voices.size,3,'completed nodes free the budget for later rewards');
});

test('reward contact honors locked, muted, hidden, zero-volume and suspended states without queued replay', async () => {
  const c=context();let contexts=0;
  const audio=new GameAudio({createContext:()=>{contexts++;return c;},loadMusic:async()=>({duration:122})});
  audio.rewardHit();assert.equal(contexts,0);
  await audio.unlock();await audio.loading;
  audio.setLevels({sound:false});audio.rewardHit();
  audio.setLevels({sound:true,sfxVolume:0});audio.rewardHit();
  audio.setLevels({sfxVolume:.5});audio.setHidden(true);audio.rewardHit();
  assert.equal(audio.voices.size,0);assert.equal(c.oscillators.length,0);
  audio.setHidden(false);await audio.unlock();
  for(const state of ['suspended','closed']){c.state=state;audio.rewardHit();assert.equal(c.oscillators.length,0);}
  c.state='running';assert.equal(audio.voices.size,0,'restoring sound alone never replays a missed contact');
  audio.setLevels({bgmVolume:0});audio.rewardHit();
  assert.equal(audio.voices.size,3);assert.equal(audio.effects.gain.value,volumeGain(.5));assert.equal(audio.music.gain.value,0);
  assert.equal(contexts,1);assert.equal(audio.source.starts,1);
});

test('reward impact power stays bounded and repeated timbres reuse deterministic local noise', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>{throw Error('No music');}});
  await audio.unlock();await audio.loading;
  const originalRandom=Math.random;
  Math.random=()=>{throw Error('reward sound must not consume gameplay randomness');};
  try{
    for(const power of [-10,10,NaN,Infinity]){
      audio.rewardHit({strength:10,power});
      for(const voice of [...audio.voices]){
        const peak=voice.target.gain.events.find(event=>event.type==='linear').value;
        assert.ok(Number.isFinite(peak)&&peak>0&&peak<=.032);voice.finish();
      }
    }
  }finally{Math.random=originalRandom;}
  assert.equal(c.sources.length,4);assert.ok(c.sources.every(source=>source.buffer===c.sources[0].buffer));
  assert.equal(audio.source,null);assert.equal(audio.voices.size,0);
});

const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} vs ${b}`);
function staged() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function musicSetup(loadMusic = async () => ({duration: 122})) {
  const c = context(), audio = new GameAudio({createContext: () => c, loadMusic});
  await audio.unlock(); await audio.loading;
  return {c, audio};
}

test('first gesture decodes only the resident music; levels selected before unlock are respected', async () => {
  const c = context(), loads = [], initial = staged(), campaign = staged();
  const audio = new GameAudio({createContext: () => c, loadMusic: async (_, name) => {
    loads.push(name); return name === 'endless' ? initial.promise : campaign.promise;
  }});
  audio.setMusicScene('levels');
  assert.equal(audio.context, null); assert.deepEqual(loads, []);
  await audio.unlock(); assert.deepEqual(loads, ['endless']);
  initial.resolve({duration: 122});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loads, ['endless', 'campaign']);
  assert.equal(audio.musicStatus().track, 'endless');
  assert.equal(audio.player.resident.gain.gain.value, 1, 'the original stays audible throughout a slow decode');
  const pending = audio.loading;
  campaign.resolve({duration: 86.6}); await pending;
  const status = audio.musicStatus(), campaignVoice = audio.player.voices.get('campaign');
  assert.equal(status.track, 'campaign'); assert.equal(status.title, '跳格子');
  assert.equal(audio.source.loopStart, 9.1393); assert.equal(audio.source.loopEnd, 118.849);
  assert.equal(campaignVoice.source.loopStart, 4.9465); assert.equal(campaignVoice.source.loopEnd, 84.1214);
  assert.equal(campaignVoice.source.offset, 0);
  near(status.fadeEnd - status.switchAt, .65);
  await audio.setMusicScene('campaign');
  assert.equal(audio.player.voices.get('campaign'), campaignVoice);
  assert.deepEqual(audio.musicStatus().starts, {endless: 1, campaign: 1});
  assert.deepEqual(loads, ['endless', 'campaign']);
});

test('abandoned campaign fetches neither activate nor retain a decoded track; retries can reuse an in-flight request', async () => {
  const first = staged(), second = staged(), calls = [];
  let attempts = 0;
  const {audio} = await musicSetup(async (_, name) => {
    calls.push(name);
    if (name === 'campaign') return ++attempts === 1 ? first.promise : second.promise;
    return {duration: 122};
  });
  const abandoned = audio.setMusicScene('levels');
  audio.setMusicScene('home'); first.resolve({duration: 86.6}); await abandoned;
  assert.deepEqual(audio.musicStatus().cached, ['endless']);
  assert.equal(audio.musicStatus().starts.campaign, 0);
  const inFlight = audio.setMusicScene('levels');
  audio.setMusicScene('home'); const reopened = audio.setMusicScene('levels');
  second.resolve({duration: 86.6}); await Promise.all([inFlight, reopened]);
  assert.equal(audio.musicStatus().starts.campaign, 1);
  assert.deepEqual(calls, ['endless', 'campaign', 'campaign']);
});

test('an entire endless run and its results keep the resident track without preloading another file', async () => {
  const calls = [];
  const {c, audio} = await musicSetup(async (_, name) => {calls.push(name); return {duration: 122};});
  const resident = audio.source;
  await audio.setMusicScene('endless');
  c.currentTime = MUSIC_TRACKS.endless.loopEnd + 3;
  await audio.setMusicScene('failedEndless');
  near(audio.musicStatus().position, MUSIC_TRACKS.endless.loopStart + 3);
  near(audio.player.levelPoints.at(-1).value, .55);
  await audio.setMusicScene('endless');
  await audio.setMusicScene('resultEndless');
  await audio.setMusicScene('home');
  assert.deepEqual(calls, ['endless']);
  assert.equal(audio.source, resident);
  assert.equal(resident.starts, 1);
  assert.equal(resident.stopTime, undefined);
  near(audio.player.levelPoints.at(-1).value, .72);
});

test('reversing halfway holds the equal-power mix at its audible gains and reuses the still-running sources', async () => {
  const {c, audio} = await musicSetup(); c.currentTime = 12;
  await audio.setMusicScene('campaign');
  const campaign = audio.player.voices.get('campaign'), initial = audio.musicStatus();
  c.currentTime = (initial.switchAt + initial.fadeEnd) / 2;
  const previous = [audio.player.resident, campaign];
  await audio.setMusicScene('endless');
  for (const v of previous) near(v.points[0].value, Math.SQRT1_2);
  const backing = audio.player.resident.points, overlay = campaign.points;
  for (let i = 0; i < backing.length; i++) near(backing[i].value ** 2 + overlay[i].value ** 2, 1);
  const returning = audio.musicStatus(); c.currentTime = (returning.switchAt + returning.fadeEnd) / 2;
  await audio.setMusicScene('campaign');
  assert.equal(audio.player.voices.get('campaign'), campaign); assert.equal(campaign.source.stopTime, undefined);
  assert.equal(audio.musicStatus().starts.campaign, 1);
});

test('a corrupt decoded cue leaves the current source playing; the next interaction can retry', async () => {
  let attempts = 0;
  const {audio} = await musicSetup(async (_, name) => ({duration: name === 'campaign' && !attempts++ ? 60 : 122}));
  await audio.setMusicScene('levels');
  assert.equal(audio.musicStatus().track, 'endless');
  assert.deepEqual(audio.musicStatus().cached, ['endless']);
  await audio.unlock(); await audio.loading;
  assert.equal(audio.musicStatus().track, 'campaign'); assert.equal(attempts, 2);
});

test('returning home drops campaign PCM after each crossfade and a resumed retirement follows the audio clock', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {c, audio} = await musicSetup();
  for (let i = 0; i < 10; i++) {
    await audio.setMusicScene('levels');
    c.currentTime += 1;
    const outgoing = audio.player.voices.get('campaign');
    await audio.setMusicScene('home');
    assert.ok(!audio.musicStatus().cached.includes('campaign'));
    c.currentTime += .1;
    audio.setHidden(true); c.currentTime += .06; t.mock.timers.tick(1000);
    assert.equal(c.state, 'suspended'); assert.equal(outgoing.source.stopTime, undefined);
    audio.setHidden(false); await audio.unlock(); c.currentTime += .6; t.mock.timers.tick(1000);
    assert.equal(outgoing.source.disconnected, true); assert.equal(audio.player.voices.size, 1);
  }
  assert.equal(audio.musicStatus().starts.endless, 1); assert.equal(audio.musicStatus().starts.campaign, 10);
  assert.equal(audio.source.stopTime, undefined);
});

test('home music can be prepared before a gesture without opening the audio device or fetching twice',async t=>{
  const c=context(), bytes=new Uint8Array([7,8,9]).buffer, prepared={duration:122};
  let fetches=0, decodes=0, outputs=0;
  t.mock.method(globalThis,'fetch',async url=>{
    assert.match(url.pathname,/\/audio\/endless\.mp3$/); fetches++;
    return {ok:true,arrayBuffer:async()=>bytes};
  });
  const decoder=globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext=class{
    async decodeAudioData(data){assert.deepEqual(data,bytes);decodes++;return prepared;}
  };
  t.after(()=>{if(decoder)globalThis.OfflineAudioContext=decoder;else delete globalThis.OfflineAudioContext;});
  const audio=new GameAudio({createContext:()=>{outputs++;return c;}});
  await Promise.all([audio.prepareMusic(),audio.prepareMusic()]);
  assert.equal(outputs,0);assert.equal(audio.source,null);assert.equal(audio.needsUnlock,true);
  await audio.unlock();await audio.loading;
  assert.equal(audio.source.buffer,prepared);assert.equal(fetches,1);assert.equal(decodes,1);
  assert.equal(outputs,1);assert.equal(audio.needsUnlock,false);
});

test('fallback decoding shares the warm MP3 while saved mute and zero music volume skip warm-up',async t=>{
  const c=context(), bytes=new Uint8Array([9,6,3]).buffer;
  let fetches=0, liveDecodes=0;
  t.mock.method(globalThis,'fetch',async()=>{
    fetches++;return {ok:true,arrayBuffer:async()=>bytes};
  });
  const decoder=globalThis.OfflineAudioContext;
  globalThis.OfflineAudioContext=class{async decodeAudioData(){throw Error('decoder unavailable');}};
  t.after(()=>{if(decoder)globalThis.OfflineAudioContext=decoder;else delete globalThis.OfflineAudioContext;});
  c.decodeAudioData=async data=>{liveDecodes++;assert.equal(data,bytes);return {duration:122};};
  const audio=new GameAudio({createContext:()=>c});
  audio.setLevels({sound:false});await audio.prepareMusic();
  audio.setLevels({sound:true,bgmVolume:0});await audio.prepareMusic();
  assert.equal(fetches,0);
  audio.setLevels({bgmVolume:.55});const warm=audio.prepareMusic();
  const firstTap=audio.unlock();
  await Promise.all([warm,firstTap]);await audio.loading;
  assert.equal(fetches,1);assert.equal(liveDecodes,1);assert.ok(audio.source);
});

test('a gesture retries a pending autoplay resume; an independent running event starts prepared music only once',async()=>{
  const c=context(), first=staged(), second=staged();
  let resumeCalls=0, loads=0, stateChanged;
  c.addEventListener=(type,fn)=>{assert.equal(type,'statechange');stateChanged=fn;};
  c.resume=()=>++resumeCalls===1?first.promise:second.promise;
  const audio=new GameAudio({createContext:()=>c,loadMusic:async()=>{loads++;return {duration:122};}});
  const autoplay=audio.tryAutoplay();
  assert.equal(resumeCalls,1);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(audio.source,null);assert.equal(loads,1);assert.equal(audio.needsUnlock,true);
  audio.tryAutoplay();audio.setHidden(true);audio.setHidden(false);
  assert.equal(resumeCalls,1,'lifecycle events cannot retry a blocked autoplay');
  c.state='interrupted';const firstGesture=audio.unlock();
  assert.equal(resumeCalls,2);
  c.state='running';stateChanged();await audio.loading;
  assert.equal(c.sources.length,1);assert.equal(audio.needsUnlock,false);
  first.resolve();second.resolve();await Promise.all([autoplay,firstGesture]);
  assert.equal(audio.musicStatus().starts.endless,1);assert.equal(loads,1);
});

test('a gesture under saved mute silently unlocks the device; unmuting starts music and retries a warm-up miss',async t=>{
  const c=context();let fetches=0;
  t.mock.method(globalThis,'fetch',async()=>{
    if(++fetches===1)throw Error('cache not ready');
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};
  });
  c.decodeAudioData=async()=>({duration:122});
  const audio=new GameAudio({createContext:()=>c});
  await audio.prepareMusic();
  audio.setLevels({sound:false});
  await audio.unlock();await audio.loading;
  assert.equal(audio.source,null);assert.equal(fetches,1);assert.equal(c.state,'running');
  assert.equal(audio.master.gain.value,0);assert.equal(audio.needsUnlock,false);
  audio.setLevels({sound:true});await audio.loading;
  assert.ok(audio.source);assert.equal(fetches,2);
  assert.equal(audio.master.gain.value,1);assert.equal(audio.musicStatus().starts.endless,1);
});

test('entry plays immediately when allowed, using a single preparation, output and loop', async t => {
  const c = context(), bytes = new ArrayBuffer(16);
  let outputs = 0, fetches = 0, decodes = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++;
    return {ok: true, arrayBuffer: async () => bytes};
  });
  c.decodeAudioData = async data => {
    decodes++; assert.equal(data, bytes);
    return {duration: 122};
  };
  const audio = new GameAudio({createContext: () => {outputs++; return c;}});
  await audio.tryAutoplay(); await audio.loading;
  const source = audio.source;
  assert.ok(source?.loop); assert.equal(audio.master.gain.value, 1);
  assert.equal(audio.needsUnlock, false);
  await audio.tryAutoplay(); await audio.unlock();
  assert.deepEqual([outputs, fetches, decodes, c.sources.length, source.starts], [1, 1, 1, 1, 1]);
});

test('a rejected autoplay waits for the next actual gesture; no scene or lifecycle event retries it', async () => {
  const c = context();
  let attempts = 0, outputs = 0;
  c.resume = async () => {
    if (++attempts === 1) throw Error('NotAllowedError');
    c.state = 'running';
  };
  const audio = new GameAudio({createContext: () => {outputs++; return c;}, loadMusic: async () => ({duration: 122})});
  await audio.tryAutoplay();
  assert.equal(audio.source, null); assert.equal(audio.needsUnlock, true);
  audio.setMusicScene('endless'); audio.setHidden(true); await audio.setHidden(false); await audio.tryAutoplay();
  assert.equal(attempts, 1);
  const gesture = audio.unlock();
  assert.equal(attempts, 2, 'resume runs synchronously on the gesture stack');
  await gesture; await audio.loading;
  assert.equal(outputs, 1); assert.equal(audio.source.starts, 1);
});

test('autoplay skips saved mute and zero BGM, and a page opened in the background waits until visible', async t => {
  const c = context();
  let outputs = 0, fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches++;
    return {ok: true, arrayBuffer: async () => new ArrayBuffer(8)};
  });
  c.decodeAudioData = async () => ({duration: 122});
  const audio = new GameAudio({createContext: () => {outputs++; return c;}});
  audio.setLevels({sound: false}); await audio.tryAutoplay(); audio.setHidden(true); await audio.setHidden(false);
  audio.setLevels({sound: true, bgmVolume: 0}); await audio.tryAutoplay();
  audio.setHidden(true); audio.setLevels({bgmVolume: .55}); await audio.tryAutoplay();
  assert.deepEqual([outputs, fetches, c.sources.length], [0, 0, 0]);
  await audio.setHidden(false); await audio.loading;
  assert.deepEqual([outputs, fetches, c.sources.length], [1, 1, 1]);
});
