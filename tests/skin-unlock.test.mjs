import test from 'node:test';
import assert from 'node:assert/strict';
import {unlockPose,unlockLeavePose,unlockTitleMarkup,UNLOCK_ENTER_DURATION,UNLOCK_LEAVE_DURATION} from '../dist/skin-unlock.js';

const from={x:62,y:440,r:19,roll:.25,squash:.12,lookX:.1,visualPull:{amount:.6,angle:.3},visualEyeMix:1};
const to={x:195,y:440,r:48};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('skin reveal preserves the starting ball and moves concurrently with the popup',()=>{
  const first=unlockPose({elapsed:0,from,to});
  for(const key of ['x','y','r','roll','squash','lookX'])close(first.pose[key],from[key]);
  assert.equal(first.panelAlpha,0);assert.equal(first.titleAlpha,0);assert.equal(first.glowAlpha,0);assert.equal(first.morph,0);
  const mid=unlockPose({elapsed:.24,from,to});
  assert.ok(mid.pose.x>from.x&&mid.pose.x<to.x);
  assert.ok(mid.panelAlpha>0&&mid.panelAlpha<1);
  assert.equal(mid.titleAlpha,0);assert.equal(mid.glowAlpha,0);assert.equal(mid.ready,false);
});

test('skin reveal completes three turns, rounds out its elastic pop, and holds until input',()=>{
  let largest=0;
  for(let elapsed=0;elapsed<UNLOCK_ENTER_DURATION;elapsed+=1/120){
    const state=unlockPose({elapsed,from,to});largest=Math.max(largest,state.pose.r);
    for(const key of ['panelAlpha','titleAlpha','glowAlpha','morph'])assert.ok(state[key]>=0&&state[key]<=1,key);
    if(state.glowAlpha>0)assert.equal(state.morph,1);
  }
  assert.ok(largest>to.r*1.1);
  const end=unlockPose({elapsed:UNLOCK_ENTER_DURATION,from,to});
  for(const key of ['x','y','r'])close(end.pose[key],to[key]);
  close(end.rotation-from.roll,6*Math.PI);assert.equal(end.morph,1);assert.equal(end.ready,true);assert.equal(end.glowAlpha,1);
  assert.deepEqual(unlockPose({elapsed:30,from,to}),end);
});

test('dismissal starts at the exact captured pose, restores old skin, and removes light quickly',()=>{
  const reveal=unlockPose({elapsed:2,from,to}),destination={x:130,y:370,r:36};
  const first=unlockLeavePose({elapsed:0,from:reveal.pose,to:destination});
  for(const key of ['x','y','r','roll'])close(first.pose[key],reveal.pose[key]);
  assert.equal(first.morph,1);assert.equal(first.glowAlpha,1);
  const early=unlockLeavePose({elapsed:.2,from:reveal.pose,to:destination});
  assert.equal(early.glowAlpha,0);assert.ok(early.morph>0&&early.morph<1);assert.equal(early.done,false);
  const end=unlockLeavePose({elapsed:UNLOCK_LEAVE_DURATION,from:reveal.pose,to:destination});
  for(const key of ['x','y','r'])close(end.pose[key],destination[key]);
  assert.equal(end.morph,0);assert.equal(end.glowAlpha,0);assert.equal(end.panelAlpha,0);assert.equal(end.done,true);
});

test('reduced motion removes spin and overshoot but still reveals then restores the skin',()=>{
  const half=unlockPose({elapsed:.3,from,to,reducedMotion:true});
  assert.equal(half.rotation,from.roll);assert.equal(half.panelScale,1);assert.ok(half.pose.r<=to.r);
  const end=unlockPose({elapsed:.56,from,to,reducedMotion:true});
  assert.equal(end.ready,true);assert.equal(end.morph,1);assert.equal(end.glowAlpha,1);
  const leave=unlockLeavePose({elapsed:.28,from:end.pose,to:from,reducedMotion:true});
  assert.equal(leave.done,true);assert.equal(leave.rotation,end.pose.roll);assert.equal(leave.morph,0);
});

test('reward heading is original rounded SVG lettering, independent of installed fonts',()=>{
  const markup=unlockTitleMarkup();assert.equal((markup.match(/<path/g)||[]).length,6);
  assert.ok(markup.includes('viewBox="0 0 528 100"'));assert.ok(!markup.includes('<text'));
});
