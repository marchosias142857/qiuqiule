import test from 'node:test';
import assert from 'node:assert/strict';
import {faceTarget,smoothFace,transferPose} from '../dist/motion.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);
test('reversing a tiny rebound displacement cannot flip the eyes by a fixed amount',()=>{
  const body={vx:0,vy:0};let state={x:0,y:0},maxJump=0;
  for(let i=0;i<120;i++){
    const pull={dx:Math.sin(i/120*Math.PI*6)*100*(1-i/120)**2,dy:0};
    const next=smoothFace(state,faceTarget(body,pull,100),1/120);maxJump=Math.max(maxJump,Math.abs(next.x-state.x));state=next;
  }
  assert.ok(maxJump<.01);near(faceTarget(body,{dx:0,dy:0},100).x,0);
  assert.ok(Math.abs(faceTarget(body,{dx:.0001,dy:0},100).x-faceTarget(body,{dx:-.0001,dy:0},100).x)<.000001);
});
test('UI transfers preserve exact endpoints and ease position and size to rest',()=>{
  const a={x:100,y:200,r:40},b={x:500,y:600,r:19},start=transferPose(a,b,0),end=transferPose(a,b,1);
  near(start.x,a.x);near(start.y,a.y);near(start.r,a.r);near(end.x,b.x);near(end.y,b.y);near(end.r,b.r);
  const almost=transferPose(a,b,.999);assert.ok(Math.hypot(end.x-almost.x,end.y-almost.y)<.0001);assert.ok(Math.abs(end.r-almost.r)<.00001);
});
