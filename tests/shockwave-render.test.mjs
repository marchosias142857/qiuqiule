import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOCKWAVE_DURATION,shockwaveFrame} from '../dist/shockwave-render.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ≈ ${b}`);

test('shockwave fronts keep the gameplay radius, 70 ms spacing and independent 320 ms envelopes',()=>{
  const first=shockwaveFrame(0,80,.6);assert.equal(first.rings.length,1);
  near(first.rings[0].r,28);near(first.rings[0].alpha,.3);near(first.rings[0].width,2.5);
  assert.equal(shockwaveFrame(.069,80).rings.length,1);
  const second=shockwaveFrame(.07,80);assert.equal(second.rings.length,2);near(second.rings[1].r,28);
  assert.equal(shockwaveFrame(.32,80).rings.length,1);
  assert.equal(shockwaveFrame(.389,80).rings.length,1);
  for(let age=0;age<.39;age+=.001){
    const frame=shockwaveFrame(age,80);
    for(const front of frame.rings){assert.ok(front.r>=28&&front.r<=80);assert.ok(front.alpha>=0&&front.alpha<=.5);assert.ok(front.width>=1&&front.width<=2.5);}
  }
  near(SHOCKWAVE_DURATION,.39);
  for(const age of [.39,.4,.5,.59,1])assert.deepEqual(shockwaveFrame(age,80),{rings:[]},'the second front leaves no range afterimage');
});

test('reduced motion holds one fixed radius without echoes or dots; zero feedback draws nothing',()=>{
  let previous=1;
  for(const age of [0,.07,.16,.31]){
    const frame=shockwaveFrame(age,60,.8,true);assert.equal(frame.rings.length,1);
    near(frame.rings[0].r,60);assert.ok(frame.rings[0].alpha<previous);previous=frame.rings[0].alpha;
  }
  assert.deepEqual(shockwaveFrame(.32,60,1,true),{rings:[]});
  assert.deepEqual(shockwaveFrame(.1,60,0),{rings:[]});
});
