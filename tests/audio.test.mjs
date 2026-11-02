import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio, MUSIC_SECONDS, audioLevel, volumeGain} from '../dist/audio.js';

function context() {
  const param = () => ({value:1,events:[],cancelScheduledValues(at){this.events.push({type:'cancel',at});},setTargetAtTime(value,at){this.value=value;this.events.push({type:'target',value,at});},setValueAtTime(value,at){this.value=value;this.events.push({type:'set',value,at});},linearRampToValueAtTime(value,at){this.value=value;this.events.push({type:'linear',value,at});},exponentialRampToValueAtTime(value,at){this.value=value;this.events.push({type:'exponential',value,at});}});
  const node = () => ({gain:param(),frequency:param(),connect(target){this.target=target;},disconnect(){this.disconnected=true;},start(at=0){this.starts=(this.starts||0)+1;this.startTime=at;},stop(at){this.stopTime=at;},finish(){this.onended?.();}});
  return {state:'suspended',currentTime:0,destination:{},sources:[],oscillators:[],createGain:node,
    createBufferSource(){const n=node();this.sources.push(n);return n;},createOscillator(){const n=node();this.oscillators.push(n);return n;},
    async resume(){this.state='running';},async suspend(){this.state='suspended';}};
}

test('music starts only after interaction, and repeated unlocks keep one continuous loop', async () => {
  const c=context(); let loads=0, contexts=0;
  const audio=new GameAudio({createContext:()=>{contexts++;return c;},loadMusic:async()=>{loads++;return{duration:MUSIC_SECONDS};}});
  audio.setLevels({sound:true,bgmVolume:.55,sfxVolume:.75});
  assert.equal(contexts,0);
  await Promise.all([audio.unlock(),audio.unlock()]);await audio.loading;
  await audio.unlock();
  assert.equal(contexts,1);assert.equal(loads,1);assert.equal(c.sources.length,1);
  assert.equal(audio.source.starts,1);assert.equal(audio.source.loop,true);assert.equal(audio.source.loopEnd,MUSIC_SECONDS);
});

test('volume buses are independent; master mute preserves levels and suppresses effects', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:MUSIC_SECONDS})});
  await audio.unlock();await audio.loading;
  audio.setLevels({sound:true,bgmVolume:0,sfxVolume:.7});
  assert.equal(audio.music.gain.value,0);assert.equal(audio.effects.gain.value,volumeGain(.7));
  audio.tone();assert.equal(c.oscillators.length,1);assert.equal(c.oscillators[0].target.target,audio.effects);
  assert.equal(audio.source.target,audio.music);
  audio.setLevels({sound:false,bgmVolume:.42,sfxVolume:.7});audio.tone();
  assert.equal(audio.master.gain.value,0);assert.equal(c.oscillators.length,1);
  audio.setLevels({sound:true});assert.equal(audio.music.gain.value,volumeGain(.42));assert.equal(audio.effects.gain.value,volumeGain(.7));
  audio.setLevels({sfxVolume:0});audio.tone();assert.equal(c.oscillators.length,1);
  assert.equal(audioLevel(-1),0);assert.equal(audioLevel(2),1);assert.equal(audioLevel(NaN,.55),.55);
});

test('backgrounding suspends audio and returning resumes the same source; failed loads retry', async () => {
  const c=context();let loads=0;
  const audio=new GameAudio({createContext:()=>c,loadMusic:async()=>{if(++loads===1)throw Error('offline miss');return{duration:MUSIC_SECONDS};}});
  await audio.unlock();await audio.loading;assert.equal(audio.source,null);
  await audio.unlock();await audio.loading;assert.equal(c.sources.length,1);
  audio.setHidden(true);audio.tone();assert.equal(c.oscillators.length,0);
  await new Promise(resolve=>setTimeout(resolve,200));assert.equal(c.state,'suspended');
  audio.setHidden(false);await audio.unlock();assert.equal(c.state,'running');assert.equal(c.sources.length,1);
  assert.equal(audio.source.starts,1);assert.equal(audio.master.gain.value,1);
});

test('boss victory schedules five rising notes on the effects bus and cleans up every voice', async () => {
  const c=context();let contexts=0,loads=0;
  const audio=new GameAudio({createContext:()=>{contexts++;return c;},loadMusic:async()=>{loads++;return{duration:MUSIC_SECONDS};}});
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
  assert.equal(audio.source,music);assert.equal(music.starts,1);assert.equal(music.target,audio.music);
});

test('boss victory respects master mute, effects volume and background state without restarting music', async () => {
  const c=context();let contexts=0;
  const audio=new GameAudio({createContext:()=>{contexts++;return c;},loadMusic:async()=>({duration:MUSIC_SECONDS})});
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

test('ordinary tones retain their immediate timing, pitch slide and short attack', async () => {
  const c=context(),audio=new GameAudio({createContext:()=>c,loadMusic:async()=>({duration:MUSIC_SECONDS})});
  await audio.unlock();await audio.loading;c.currentTime=3;
  audio.tone(440,.2,'triangle',.04,1.5);
  const oscillator=c.oscillators[0];
  assert.equal(oscillator.startTime,3);assert.equal(oscillator.type,'triangle');
  assert.deepEqual(oscillator.frequency.events,[{type:'set',value:440,at:3},{type:'exponential',value:660,at:3.2}]);
  assert.deepEqual(oscillator.target.gain.events.find(e=>e.type==='linear'),{type:'linear',value:.04,at:3.003});
  assert.equal(oscillator.stopTime,3.21);oscillator.finish();assert.equal(audio.voices.size,0);
});
