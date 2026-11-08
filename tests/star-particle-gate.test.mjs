import test from 'node:test';
import assert from 'node:assert/strict';
import {CometTrails,COMET_TRAIL,cometGrowth,cometProfile} from '../dist/comet-trail.js';
import {StarParticles} from '../dist/star-particles.js';

function scene({radius=18,unit=18,timeScale=1,strength=.6}={}){
  const b={x:0,y:0,r:radius,vx:0,vy:0,hp:1,isPlayer:true},trails=new CometTrails(),fx=new StarParticles();
  const dt=timeScale/120;
  const options={unit,trails,strength};
  trails.step([b],0,{unit});fx.step([b],0,options);
  return {b,fx,trails,run(speed,seconds){b.vx=speed*unit;for(let i=0;i<Math.ceil(seconds/dt);i++){b.x+=b.vx*dt;trails.step([b],dt,{unit});fx.step([b],dt,options);}},active:()=>fx.trackers.get(b).active};
}

test('20–27u/s keeps the thin trail and never starts particle emission',()=>{
  assert.equal(COMET_TRAIL.startSpeed,20);assert.equal(COMET_TRAIL.endSpeed,18);
  for(const speed of [20,23,26.9,27,29.9]){
    const s=scene();s.run(speed,2);
    assert.equal(s.trails.getState(s.b).active,true);
    assert.ok(s.trails.getState(s.b).points.length>1);
    assert.equal(s.active(),false);assert.equal(s.fx.emissionCount,0);
  }
  const s=scene();s.run(20,.1);s.run(19,.1);assert.equal(s.trails.getState(s.b).active,true);
  s.run(17.9,.1);assert.equal(s.trails.getState(s.b).active,false);
});

test('growth hysteresis retains its state in the middle band and never banks disabled travel',()=>{
  for(const setup of [{},{radius:25.2},{unit:30,radius:30,timeScale:.25},{strength:.2}]){
    const s=scene(setup);s.run(28,2);assert.equal(s.active(),false);assert.equal(s.fx.emissionCount,0);
    s.run(30.1,1);assert.equal(s.active(),true);assert.ok(s.fx.emissionCount>0);
    const on=s.fx.emissionCount;s.run(28,1);assert.equal(s.active(),true);assert.ok(s.fx.emissionCount>on);
    s.run(27,1/120);assert.equal(s.active(),false);
    const off=s.fx.emissionCount;s.run(28,1);assert.equal(s.active(),false);assert.equal(s.fx.emissionCount,off);
    s.run(30.1,1/120);assert.equal(s.active(),true);assert.ok(s.fx.emissionCount-off<=1);
  }
});

test('stopping emission lets existing particles age and fade instead of clearing them',()=>{
  const s=scene();s.run(40,.5);assert.ok(s.fx.count>0);
  const survivor=s.fx.particles.at(-1),age=survivor.age,births=s.fx.emissionCount;
  // Just below the generation gate, but above the new speed-alpha zero at 27.
  s.run(27.05,1/120);
  assert.equal(s.active(),false);assert.equal(s.fx.emissionCount,births);
  assert.ok(s.fx.particles.includes(survivor));assert.ok(survivor.age>age);
  s.run(27.05,.5);assert.equal(s.fx.count,0);assert.equal(s.fx.emissionCount,births);
});

test('particle gate shares the actual length curve and follows future curve changes',()=>{
  assert.ok(Math.abs(cometProfile(30,1,1).length-4.4)<.02);
  assert.ok(Math.abs(cometProfile(27,1,1).length-3.2)<.02);
  assert.ok(cometGrowth(30,1)<.57&&cometGrowth(30.1,1)>.57);
  assert.ok(cometGrowth(27,1)<.37&&cometGrowth(27.1,1)>.37);
  const original=COMET_TRAIL.fullSpeed;
  try{
    COMET_TRAIL.fullSpeed=50;
    const s=scene();s.run(32,1);assert.equal(s.active(),false,'32u/s is below the opening growth on a longer speed curve');
    s.run(36,1);assert.equal(s.active(),true);assert.ok(s.fx.emissionCount>0);
    s.run(32,1);assert.equal(s.active(),true,'the same 32u/s stays active inside hysteresis after opening');
    s.run(30,1);assert.equal(s.active(),false);
    assert.equal(COMET_TRAIL.startSpeed,20);assert.equal(COMET_TRAIL.endSpeed,18);
  }finally{COMET_TRAIL.fullSpeed=original;}
});
