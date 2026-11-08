import test from 'node:test';
import assert from 'node:assert/strict';
import {CometTrails,cometRibbon} from '../dist/comet-trail.js';
import {StarParticles,STAR_PARTICLE_LIMITS} from '../dist/star-particles.js';
import {particleVisualStyle} from '../dist/particle-appearance.js';

const near=(a,b,epsilon=1e-7)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} ≉ ${b}`);
const createBody=(options={})=>({x:0,y:0,r:18,vx:720,vy:0,hp:1,isPlayer:true,active:true,feedbackFreeze:0,...options});
function setup({speed=40,r=18,seed=123,shape='star'}={}){
  const body=createBody({r,vx:speed*18}),trails=new CometTrails(),fx=new StarParticles({seed});
  const options={unit:18,strength:.6,trails,shape};
  trails.step([body],0,{unit:18});fx.step([body],0,options);
  const births=[],seen=new Set();
  function step(dt,{move=true,...overrides}={}){
    if(move){body.x+=body.vx*dt;body.y+=body.vy*dt;}
    trails.step([body],dt,{unit:18});fx.step([body],dt,{...options,...overrides});
    for(const p of fx.particles)if(!seen.has(p.sequence)){
      seen.add(p.sequence);births.push({sequence:p.sequence,at:p.bornAt,side:p.birthSide,phase:p.lateralPhase,initialLateral:p.lateral*Math.exp(2.5*p.age)});
    }
  }
  return{body,trails,fx,options,births,step};
}
function run({fps=120,duration=6,...options}={}){
  const scene=setup(options);for(let i=0;i<Math.round(fps*duration);i++)scene.step(1/fps);return scene;
}

// These expectations derive from shared rendered geometry and public motion,
// rather than mirroring private emitter scheduling implementation.
test('shared sampler follows the visible corner-cutting ribbon and rejects missing history',()=>{
  const body=createBody(),trails=new CometTrails();trails.step([body],0,{unit:18});
  for(const [x,y] of [[6,0],[12,0],[18,0],[18,6],[18,12],[18,18]]){body.x=x;body.y=y;trails.step([body],1/120,{unit:18});}
  const state=trails.getState(body),ribbon=cometRibbon(state.points,{length:1e6,width:1});
  let distance=0;
  for(const segment of ribbon){
    const span=Math.hypot(segment.end.x-segment.start.x,segment.end.y-segment.start.y);
    const sample=trails.sample(body,distance+span*.5,{});
    assert.equal(sample.valid,true);near(sample.x,(segment.start.x+segment.end.x)/2);near(sample.y,(segment.start.y+segment.end.y)/2);
    near(sample.nx,(segment.start.x-segment.end.x)/span);near(sample.ny,(segment.start.y-segment.end.y)/span);distance+=span;
  }
  const missing=trails.sample(body,distance+10,{});assert.equal(missing.valid,false);near(missing.available,distance);
  assert.ok(!('x' in missing),'missing history has no oldest-point fallback');
});

test('world-time history remains long enough at .3 and .25 slow motion with 1.4r growth',()=>{
  for(const scale of [.3,.25]){
    const scene=setup({speed:20,r:25.2});
    for(let i=0;i<1200;i++)scene.step(scale/120);
    const state=scene.trails.getState(scene.body),origin=scene.trails.sample(scene.body,scene.body.r*1.4,{});
    assert.equal(origin.valid,true);assert.ok(state.points.length<=48);assert.equal(scene.fx.emissionCount,0,'20u/s keeps thin history without emitting particles');
    scene.body.vx=30.1*18;
    for(let i=0;i<600;i++)scene.step(scale/120);
    assert.ok(scene.fx.emissionCount>0,'particle history also works above its separate threshold');
    assert.ok(!('path' in scene.fx.trackers.get(scene.body)),'particles do not retain a duplicate frame-sampled history');
  }
});

test('steady emission preserves phase across frame rates and never exceeds the time cap',()=>{
  for(const speed of [40,68,120]){
    const scenes=[30,60,120,240].map(fps=>run({fps,speed}));
    const counts=scenes.map(s=>s.births.length);
    assert.ok(Math.max(...counts)-Math.min(...counts)<=1,`${speed}u/s counts: ${counts}`);
    const rate=STAR_PARTICLE_LIMITS.rate*(.65+.35*.6)*STAR_PARTICLE_LIMITS.emissionScale;
    for(const scene of scenes){
      assert.ok(scene.births.length<=Math.ceil(rate*6));
      for(let i=1;i<scene.births.length;i++)assert.ok(scene.births[i].at-scene.births[i-1].at>=1/rate-1e-8,'distance jitter must not bypass time limiting');
      assert.ok(scene.fx.count<=12);assert.equal(scene.fx.count+scene.fx.free.length,24);
    }
  }
});

test('spacing scales with ball radius and each interval keeps its random multiplier',()=>{
  const normal=run({duration:30}),grown=run({duration:30,r:25.2});
  const ratio=grown.births.length/normal.births.length;assert.ok(ratio>.65&&ratio<.78,`grown emission ratio ${ratio}`);
  const scene=setup({speed:20}),track=scene.fx.trackers.get(scene.body),jitter=track.jitter;
  for(let i=0;i<20;i++)scene.step(1/120);
  assert.equal(scene.fx.emissionCount,0);assert.equal(track.jitter,jitter);
  const before=scene.fx.emissionCount;scene.body.vx=2160;scene.step(1/120);
  assert.ok(scene.fx.emissionCount-before<=1,'acceleration cannot release accumulated births');
});

test('golden-ratio birth positions keep small independent jitter and no directional bias',()=>{
  const scene=run({duration:80}),births=scene.births;assert.ok(births.length>800);
  let sum=0,centerPositive=0,centerNegative=0;
  for(let i=0;i<births.length;i++){
    const p=births[i],normalized=p.side/18,nominal=(2*p.phase-1)*.4;
    assert.ok(Math.abs(normalized)<=.45+1e-9);assert.ok(Math.abs(normalized-nominal)<=.05+1e-9);
    if(i)near(p.phase,(births[i-1].phase+.618033988749895)%1);
    if(Math.abs(normalized)<.05){if(p.initialLateral>0)centerPositive++;else centerNegative++;}
    else assert.equal(Math.sign(p.initialLateral),Math.sign(normalized));
    assert.ok(Math.abs(p.initialLateral)>=18*.8-1e-7&&Math.abs(p.initialLateral)<=18*1.4+1e-7);sum+=normalized;
  }
  assert.ok(births.some(p=>Math.abs(p.side/18)>.4),'micro-jitter is not clipped back to the main range');
  assert.ok(Math.abs(sum/births.length)<.015);assert.ok(centerPositive>20&&centerNegative>20,'near-center drift selects either side');
});

test('path fade keeps fading through a rebound even as Euclidean separation closes',()=>{
  const scene=setup({speed:40});while(!scene.fx.count)scene.step(1/120);
  const p=scene.fx.particles[0];p.life=10;
  let previous=1,observedFade=false;
  for(let i=0;i<70&&scene.fx.particles.includes(p);i++){
    if(i===32)scene.body.vx=-scene.body.vx;
    scene.step(1/120);assert.ok(p.distanceOpacity<=previous+1e-12);observedFade||=p.distanceOpacity<1;previous=p.distanceOpacity;
  }
  assert.ok(observedFade);assert.ok(!scene.fx.particles.includes(p),'travel eventually consumes the distance window');
});

test('missing history, freezes, and resets never queue a catch-up burst',()=>{
  const scene=setup(),sample=scene.trails.sample.bind(scene.trails);
  scene.trails.sample=(_body,_distance,out)=>{out.valid=false;return out;};
  for(let i=0;i<120;i++)scene.step(1/120);
  assert.equal(scene.fx.count,0);assert.equal(scene.fx.emissionCount,0);
  scene.trails.sample=sample;scene.step(1/120);assert.ok(scene.fx.emissionCount<=1);
  for(let i=0;i<50;i++)scene.step(1/120);
  const before=scene.fx.emissionCount;scene.body.feedbackFreeze=.2;
  for(let i=0;i<40;i++)scene.step(1/120,{move:false});
  assert.equal(scene.fx.emissionCount,before);assert.equal(scene.fx.count,0);
  scene.body.feedbackFreeze=0;scene.step(1/120);assert.equal(scene.fx.emissionCount,before,'restarting with insufficient history skips birth');
  for(let i=0;i<30;i++)scene.step(1/120);assert.ok(scene.fx.count>0);
  const generation=scene.trails.getState(scene.body).generation;scene.body.x+=5000;scene.step(1/120,{move:false});
  assert.ok(scene.trails.getState(scene.body).generation>generation);assert.equal(scene.fx.count,0);assert.equal(scene.trails.getState(scene.body).mileage,0);
  for(let i=0;i<30;i++)scene.step(1/120);assert.ok(scene.fx.count>0);
  scene.trails.clear();scene.step(1/120);assert.equal(scene.fx.count,0);
});

test('independent directional drag integrates consistently across timestep subdivisions',()=>{
  const fx=new StarParticles(),base={age:0,x:0,y:0,nx:.6,ny:.8,forward:200,lateral:-20,rotation:0,spin:.2};
  const whole={...base},parts={...base};fx.advanceParticle(whole,.2);for(let i=0;i<20;i++)fx.advanceParticle(parts,.01);
  for(const key of ['x','y','vx','vy','age','rotation'])near(whole[key],parts[key]);
  near(whole.forward/200,Math.exp(-2));near(whole.lateral/-20,Math.exp(-.5));
});

test('standalone fallback shares the same history class and never emits for clones',()=>{
  const fx=new StarParticles(),main=createBody(),clone=createBody({isAuxiliary:true});
  for(let i=0;i<120;i++){
    main.x+=6;clone.x+=6;fx.step([main,clone],1/120,{unit:18});
  }
  assert.ok(fx.fallbackTrails instanceof CometTrails);assert.ok(fx.count>0);
  assert.ok(fx.particles.every(p=>p.owner===main));assert.equal(fx.trackers.has(clone),false);
  fx.step([main,clone],.2,{unit:18});assert.equal(fx.count,0);
});
