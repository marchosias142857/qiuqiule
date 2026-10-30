import test from 'node:test';
import assert from 'node:assert/strict';
import {GameAudio, MUSIC_SECONDS, audioLevel, volumeGain} from '../dist/audio.js';

function context() {
  const param = () => ({value:1,cancelScheduledValues(){},setTargetAtTime(value){this.value=value;},setValueAtTime(value){this.value=value;},linearRampToValueAtTime(value){this.value=value;},exponentialRampToValueAtTime(value){this.value=value;}});
  const node = () => ({gain:param(),frequency:param(),connect(target){this.target=target;},disconnect(){this.disconnected=true;},start(){this.starts=(this.starts||0)+1;},stop(){this.onended?.();}});
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
