import test from 'node:test';
import assert from 'node:assert/strict';
import {aimGuide,AimGesture} from '../dist/aim.js';

const near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const player=Object.freeze({x:180,y:300,r:20,vx:0,vy:0});
const guide=overrides=>aimGuide({player,drag:{dx:60,dy:80},maxPull:100,unit:20,...overrides});

test('low-speed guide retains seven points, original spacing, fade and launch arrow',()=>{
  const {points,arrow}=guide();
  assert.equal(points.length,7);
  for(const [index,p] of points.entries()){
    const distance=player.r+12+(index+1)*16;
    near(p.x,player.x-.6*distance);near(p.y,player.y-.8*distance);
    near(p.alpha,.36*(1-(index+1)/9));assert.equal(p.r,1.7);assert.equal(p.direction,'aim');
  }
  assert.deepEqual(arrow.tip,{x:points[6].x,y:points[6].y});
  near(Math.hypot(arrow.left.x-arrow.right.x,arrow.left.y-arrow.right.y),8);
  const base={x:(arrow.left.x+arrow.right.x)/2,y:(arrow.left.y+arrow.right.y)/2};
  near(arrow.tip.x-base.x,-.6*6);near(arrow.tip.y-base.y,-.8*6);
  assert.equal(arrow.width,1.4);assert.equal(arrow.alpha,.35);
});

test('only speeds above twenty units redirect and fade the first three points',()=>{
  for(const speed of [0,399.999,400]){
    const result=guide({player:{...player,vx:speed,vy:0}});
    assert.ok(result.points.every(p=>p.direction==='aim'));
  }
  const slow=guide(),fast=guide({player:{...player,vx:300,vy:400.1}});
  const speed=Math.hypot(300,400.1);
  for(let index=0;index<7;index++){
    const point=fast.points[index];
    if(index<3){
      const distance=player.r+12+(index+1)*16;
      near(point.x,player.x+300/speed*distance);near(point.y,player.y+400.1/speed*distance);
      near(point.alpha,slow.points[index].alpha*.45);assert.equal(point.direction,'velocity');
    }else assert.deepEqual(point,slow.points[index]);
  }
  assert.deepEqual(fast.arrow,slow.arrow,'momentum never turns the actual launch arrow');
});

test('guide handles short drags, power cap, arbitrary headings and never mutates inputs',()=>{
  assert.deepEqual(guide({drag:null}),{points:[],arrow:null});
  assert.deepEqual(guide({drag:{dx:3,dy:0}}),{points:[],arrow:null});
  for(const turn of [0,.4,Math.PI/2,Math.PI,5.7]){
    const drag=Object.freeze({dx:Math.cos(turn)*200,dy:Math.sin(turn)*200});
    const result=guide({drag});
    assert.equal(result.points.length,7);
    near(Math.hypot(result.arrow.tip.x-player.x,result.arrow.tip.y-player.y),player.r+12+7*16);
    const dot=(result.arrow.tip.x-player.x)*drag.dx+(result.arrow.tip.y-player.y)*drag.dy;
    assert.ok(dot<0,'arrow points opposite the pull');
  }
});

test('a short sub-six-pixel tap never slows or shoots',()=>{
  const gesture=new AimGesture({x:100,y:200,startedAt:10});
  assert.deepEqual(gesture.sample(10),{active:false,scale:1,dx:0,dy:0,distance:0});
  const moving=gesture.move(105.9,200,10.119);
  assert.equal(moving.active,false);assert.equal(moving.scale,1);
  const release=gesture.release(105.9,200,10.119);
  assert.equal(release.shouldShoot,false);assert.equal(release.scale,1);
  assert.equal(gesture.sample(20).active,false,'release cannot later become a hold');
});

test('movement activates at six pixels and pulling back never restarts or cancels the allowance',()=>{
  const gesture=new AimGesture({x:10,y:20,startedAt:5});
  assert.equal(gesture.move(15.999,20,5.03).active,false);
  const active=gesture.move(16,20,5.04);assert.equal(active.active,true);near(active.scale,.3);
  near(gesture.activatedAt,5.04);
  const pulledBack=gesture.move(10,20,5.1);assert.equal(pulledBack.active,true);near(pulledBack.scale,.3);
  near(gesture.sample(6.49).scale,.65);
  assert.equal(gesture.release(10,20,6.5).shouldShoot,false,'an activated hold still needs enough launch distance');
  const launch=new AimGesture({startedAt:0});
  assert.equal(launch.release(6,0,.04).shouldShoot,true,'six-pixel quick flick is an intentional launch');
});

test('hold activates at the deadline and recovers linearly after 1.2 seconds of slow aim',()=>{
  const gesture=new AimGesture({startedAt:3,strength:1});
  assert.equal(gesture.sample(3.119).active,false);
  assert.equal(gesture.sample(3.12).active,true);near(gesture.activatedAt,3.12);
  near(gesture.sample(3.12).scale,.3);
  near(gesture.sample(4.32).scale,.3);
  near(gesture.sample(4.445).scale,.475);
  near(gesture.sample(4.57).scale,.65);
  near(gesture.sample(4.82).scale,1);
  near(gesture.sample(8).scale,1);
  assert.equal(gesture.release(0,0,8).shouldShoot,false,'a stationary hold does not shoot');
});

test('large frames use real elapsed time and stale timestamps cannot regain slow aim',()=>{
  const delayed=new AimGesture({startedAt:10,strength:1});
  const state=delayed.sample(12);
  assert.equal(state.active,true);assert.equal(state.scale,1);near(delayed.activatedAt,10.12);
  const gesture=new AimGesture({startedAt:10,strength:1});gesture.move(8,0,10.02);
  const middle=gesture.sample(11.47);near(middle.scale,.65);
  near(gesture.sample(10.5).scale,.65);
  near(gesture.move(12,0,10.6).scale,.65);
  near(gesture.activatedAt,10.02);
  assert.equal(gesture.sample(12).scale,1);
  assert.equal(gesture.sample(11).scale,1);
});

test('visual strength never changes aiming and reduced motion keeps gentler slow aim',()=>{
  const gesture=new AimGesture({startedAt:0});gesture.move(8,0,.02);
  near(gesture.sample(.1).scale,.3);
  near(gesture.sample(.2,{strength:1}).scale,.3);
  near(gesture.sample(.3,{strength:0}).scale,.3);
  near(gesture.sample(.4,{strength:2}).scale,.3);
  near(gesture.sample(.5,{strength:-1}).scale,.3);
  near(gesture.sample(.6,{strength:.6,reducedMotion:true}).scale,.6);
  near(gesture.sample(1.47,{reducedMotion:false}).scale,.65);
  near(gesture.sample(1.6,{strength:NaN}).scale,1-.7*(1-(1.58-1.2)/.5));
  near(gesture.activatedAt,.02);
  const reduced=new AimGesture({reducedMotion:true,strength:1});
  assert.equal(reduced.move(10,0,.02).active,true);near(reduced.sample(.3).scale,.6);
  near(reduced.sample(1.47).scale,.8);near(reduced.sample(1.72).scale,1);
  assert.equal(reduced.release(10,0,.4).shouldShoot,true);
});

test('cancellation and release immediately restore normal time and cannot reactivate',()=>{
  for(const finish of [gesture=>gesture.cancel(),gesture=>gesture.release(12,0,.1)]){
    const gesture=new AimGesture();gesture.move(10,0,.03);near(gesture.sample(.05).scale,.3);
    const end=finish(gesture);assert.equal(end.scale,1);assert.equal(end.active,false);
    assert.equal(gesture.sample(3).scale,1);assert.equal(gesture.move(100,0,4).active,false);
    assert.equal(gesture.release(100,0,5).shouldShoot,false);
  }
});

test('calibrated aiming preserves the full recovery and records only real slow time',()=>{
  for(const reducedMotion of [false,true]){
    const gesture=new AimGesture({startedAt:5,holdDuration:.9,reducedMotion});
    gesture.move(8,0,5.02);
    near(gesture.sample(5.92).scale,reducedMotion?.6:.3);
    near(gesture.sample(6.17).scale,reducedMotion?.8:.65);
    near(gesture.sample(6.42).scale,1);
    const release=gesture.release(8,0,10);
    near(release.slowSeconds,1.4);
    assert.equal(release.shouldShoot,true);
    assert.equal(gesture.release(8,0,11).slowSeconds,0,'a finished gesture cannot be counted twice');
  }
  const defaultWindow=new AimGesture({holdDuration:NaN});defaultWindow.move(8,0,0);
  near(defaultWindow.sample(1.2).scale,.3);
  near(defaultWindow.release(8,0,2).slowSeconds,1.7);
});

test('quick intentional flicks and shorter holds expose unbiased duration samples',()=>{
  const flick=new AimGesture({startedAt:10});
  const release=flick.release(8,0,10.04);
  assert.equal(release.shouldShoot,true);near(release.slowSeconds,0);
  const hold=new AimGesture({startedAt:10});
  hold.sample(10.3);
  const held=hold.release(8,0,10.5);
  assert.equal(held.shouldShoot,true);near(held.slowSeconds,.38);
  const cancelled=new AimGesture({startedAt:10});cancelled.move(8,0,10.04);cancelled.cancel();
  assert.equal(cancelled.release(8,0,10.8).shouldShoot,false);near(cancelled.release(8,0,10.8).slowSeconds,0);
});
