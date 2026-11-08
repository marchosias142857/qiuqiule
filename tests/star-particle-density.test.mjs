import test from 'node:test';
import assert from 'node:assert/strict';
import {CometTrails} from '../dist/comet-trail.js';
import {StarParticles} from '../dist/star-particles.js';
const UNIT=18;
const near=(a,b,epsilon=1e-7)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function scene(speed=40){
  const body={x:0,y:0,r:UNIT,vx:speed*UNIT,vy:0,hp:1,isPlayer:true},trails=new CometTrails(),fx=new StarParticles({seed:42});
  const options={unit:UNIT,trails,strength:.6},births=[];
  const push=fx.particles.push;
  fx.particles.push=function(...particles){for(const p of particles)births.push({mileage:p.birthMileage,opacity:p.opacity});return push.apply(this,particles);};
  trails.step([body],0,{unit:UNIT});fx.step([body],0,options);
  const step=(speed,dt=1/120)=>{body.vx=speed*UNIT;body.x+=body.vx*dt;trails.step([body],dt,{unit:UNIT});fx.step([body],dt,options);};
  return{body,trails,fx,births,step,run(speed,seconds){for(let i=0;i<Math.round(seconds*120);i++)step(speed);}};
}
function nextParticle(s,speed){
  const before=s.fx.emissionCount;
  for(let i=0;i<120&&s.fx.emissionCount===before;i++)s.step(speed);
  const particle=s.fx.particles.find(p=>p.sequence===s.fx.emissionCount);
  assert.ok(particle&&s.fx.emissionCount>before,'observe a fresh birth, not an arbitrarily aged pool entry');
  return particle;
}

test('above the gate, identical travelled distance has identical particle spacing at 30.1, 33 and 40u/s',()=>{
  const scenes=[30.1,33,40].map(speed=>{const s=scene(speed);s.run(speed,12);return s;});
  const count=Math.min(...scenes.map(s=>s.births.length));assert.ok(count>100);
  for(let i=0;i<count;i++){
    near(scenes[0].births[i].mileage,scenes[1].births[i].mileage);
    near(scenes[0].births[i].mileage,scenes[2].births[i].mileage);
  }
  assert.ok(scenes[0].births.every(p=>p.opacity>.5&&p.opacity<.53));
  assert.ok(scenes[1].births.every(p=>p.opacity===1));
  assert.ok(scenes[2].births.every(p=>p.opacity===1));
});

test('deceleration dims particles already in flight and acceleration never relights old particles',()=>{
  const s=scene();s.run(40,.4);const p=s.fx.particles.at(-1);assert.ok(p);near(p.opacity,1);
  s.step(30);assert.ok(s.fx.particles.includes(p));near(p.opacity,.5);
  s.step(33);assert.ok(s.fx.particles.includes(p));near(p.opacity,.5);
  s.step(28);assert.ok(s.fx.particles.includes(p));near(p.opacity,2/27);
  const count=s.fx.emissionCount;s.step(27);
  assert.equal(s.fx.count,0,'fully transparent particles immediately release their pool slots');
  assert.equal(s.fx.free.length,24);assert.equal(s.fx.emissionCount,count);
});

test('a suddenly shorter current trail retracts the distance fade and subsequent acceleration cannot revive it',()=>{
  const s=scene();s.run(40,.4);const p=nextParticle(s,40),length=p.birthTrailLength;
  s.run(40,.17);assert.ok(s.fx.particles.includes(p));near(p.distanceOpacity,1);
  s.step(31);assert.ok(s.fx.particles.includes(p));assert.ok(p.distanceOpacity<.8,'distance fade must follow the shorter current trail');
  const faded=p.distanceOpacity;s.step(40);
  assert.ok(p.distanceOpacity<=faded,'lengthening the current trail cannot restore faded ink');near(p.birthTrailLength,length);
});

test('a short birth trail still limits particles after accelerating into a longer current trail',()=>{
  const s=scene(30.1);s.run(30.1,.4);const p=nextParticle(s,30.1);
  const birthLength=p.birthTrailLength;assert.ok(birthLength<5*UNIT);
  s.run(40,.16);assert.ok(s.fx.particles.includes(p));assert.ok(p.distanceOpacity<1,'birth length must cap the expanded current trail');
  near(p.birthTrailLength,birthLength);
  assert.ok(!('fadeStart' in p)&&!('fadeEnd' in p),'old radius-floor windows are not retained');
});
