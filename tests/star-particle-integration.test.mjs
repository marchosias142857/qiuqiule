import test from 'node:test';
import assert from 'node:assert/strict';
import {World} from '../dist/physics.js';
import {CometTrails} from '../dist/comet-trail.js';
import {StarParticles,STAR_PARTICLE_LIMITS} from '../dist/star-particles.js';

const HZ=120,STRENGTH=.6;
const scenarios=[
  {name:'base',shape:'star'},
  {name:'boosted',boosted:true,shape:'sun'},
  {name:'large',large:true,shape:'moon'},
  {name:'base slow .3',timeScale:.3,shape:'moon'},
  {name:'boosted large slow .25',boosted:true,large:true,timeScale:.25,shape:'star'},
  {name:'clone and enemy collisions',boosted:true,collisions:true,shape:'moon'},
];

function setup(options){
  let seed=19461107,calls=0;
  const random=()=>{calls++;seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const world=new World(390,600,random,{spawnInitial:false});
  world.stage=10;world.spawnTimer=world.floorTimer=world.introTimer=Infinity;
  Object.defineProperty(world,'killTarget',{get:()=>Infinity});
  if(options.boosted)for(const id of ['energy','energy','energy','energy','density','density','rubber','rubber','overspeed','overspeed'])world.applyUpgrade(id);
  if(options.large){world.applyUpgrade('growth');world.applyUpgrade('growth');}
  world.setFeedbackOptions({strength:STRENGTH});world.player.x=80;world.player.y=310;
  const state={world,randomState:()=>[seed,calls],cloneTargetPlaced:false,peakAuxiliaries:0,hits:0,auxiliaryHits:0,walls:0,shots:0};
  if(options.collisions){world.applyUpgrade('split');enemyAt(world,170,310);}
  return state;
}

function enemyAt(world,x,y){
  const enemy=world.spawnEnemy(null,'normal');assert.ok(enemy,'collision setup must spawn an enemy');
  Object.assign(enemy,{x,y,vx:0,vy:0,hp:1,maxHp:1,born:1,solid:true});
  return enemy;
}

function simulateStep(state,options,index,dt){
  const world=state.world,time=index*dt;
  // Identical player input in both runs. The first shot crosses the seeded
  // target; subsequent shots also exercise arena rebounds and retargeting.
  if(index===0||time>=state.shots*1.4){
    const angle=[0,-.62,-2.28,.79,2.5,-1.02][state.shots%6];
    assert.equal(world.shoot(-Math.cos(angle)*world.maxPull,-Math.sin(angle)*world.maxPull),true);
    state.shots++;
  }
  if(options.collisions&&!state.cloneTargetPlaced&&world.auxiliaries.length){
    const child=world.auxiliaries[0],speed=Math.hypot(child.vx,child.vy),ahead=world.unit*3.7;
    enemyAt(world,child.x+child.vx/speed*ahead,child.y+child.vy/speed*ahead);
    state.cloneTargetPlaced=true;
  }
  world.step(dt,false,{timeScale:options.timeScale??1});
  state.peakAuxiliaries=Math.max(state.peakAuxiliaries,world.auxiliaries.length);
  for(const event of world.events){
    if(event.type==='hit'){state.hits++;if(event.auxiliary)state.auxiliaryHits++;}
    if(event.type==='wall')state.walls++;
  }
}

function worldSnapshot(world){
  // Include full body/event data and gameplay clocks, not just the final pose:
  // particles must not perturb contacts, hits, clone creation, or RNG use.
  return{player:{...world.player},auxiliaries:world.auxiliaries.map(b=>({...b})),enemies:world.enemies.map(b=>({...b})),
    events:world.events,phase:world.phase,time:world.time,feedbackTime:world.feedbackTime,
    score:world.score,totalKills:world.totalKills,stageKills:world.stageKills,totalShots:world.totalShots,
    fragmentQueue:world.fragmentQueue,shotHistory:world.shotHistory,shotSplitUsed:world.shotSplitUsed};
}

function finiteParticles(fx,world){
  for(const body of [world.player,...world.auxiliaries,...world.enemies]){
    for(const key of ['x','y','vx','vy','r'])assert.ok(Number.isFinite(body[key]),`nonfinite world body ${key}`);
  }
  assert.ok(fx.count<=STAR_PARTICLE_LIMITS.main);
  assert.equal(fx.count+fx.free.length,STAR_PARTICLE_LIMITS.total);
  assert.equal(new Set([...fx.particles,...fx.free]).size,STAR_PARTICLE_LIMITS.total,'the pool has no aliased entries');
  for(const particle of fx.particles){
    assert.strictEqual(particle.owner,world.player,'only the real main player may own particles');
    for(const[key,value]of Object.entries(particle))if(typeof value==='number')assert.ok(Number.isFinite(value),`nonfinite particle ${key}`);
    assert.ok(particle.age>=0&&particle.age<particle.life);
    assert.ok(particle.distanceOpacity>=0&&particle.distanceOpacity<=1);
  }
}

for(const options of scenarios)test(`real World stays identical with particles enabled/disabled: ${options.name}`,()=>{
  const enabled=setup(options),disabled=setup(options),trails=new CometTrails(),offTrails=new CometTrails();
  const particles=new StarParticles({seed:42}),offParticles=new StarParticles({seed:42});
  const dt=(options.timeScale??1)/HZ,steps=Math.ceil(4/dt);let peak=0;
  if(options.large)assert.ok(Math.abs(enabled.world.player.r/enabled.world.unit-1.4)<1e-12);
  for(let index=0;index<steps;index++){
    simulateStep(enabled,options,index,dt);simulateStep(disabled,options,index,dt);
    const onWorld=enabled.world,offWorld=disabled.world;
    // Give both effects the actual player + clone list, so module filtering is
    // checked independently of the lab's additional main-player filter.
    const bodies=[onWorld.player,...onWorld.auxiliaries],offBodies=[offWorld.player,...offWorld.auxiliaries];
    trails.step(bodies,dt,{unit:onWorld.unit});offTrails.step(offBodies,dt,{unit:offWorld.unit});
    particles.step(bodies,dt,{unit:onWorld.unit,bounds:onWorld.arenaBounds,strength:STRENGTH,trails,shape:options.shape});
    offParticles.step(offBodies,dt,{unit:offWorld.unit,bounds:offWorld.arenaBounds,strength:STRENGTH,trails:offTrails,enabled:false});
    finiteParticles(particles,onWorld);peak=Math.max(peak,particles.count);
    assert.equal(offParticles.count,0);
    assert.deepEqual(enabled.randomState(),disabled.randomState(),`world RNG differs at step ${index}`);
    assert.deepEqual(worldSnapshot(onWorld),worldSnapshot(offWorld),`world trajectory differs at step ${index}`);
    onWorld.events=[];offWorld.events=[];
  }
  assert.ok(peak>0,'the comparison must actually emit particles');
  assert.ok(enabled.walls>0,'the trajectory must include real wall rebounds');
  assert.ok(particles.emissionCount>peak*2,'the trace must emit through multiple pool reuse cycles');
  if(options.collisions){
    assert.equal(enabled.peakAuxiliaries,2,'a real kill must create two clone balls');
    assert.ok(enabled.hits>=2,'main and clone should both hit enemies');
    assert.ok(enabled.auxiliaryHits>0,'at least one actual clone/enemy collision must occur');
    assert.ok(enabled.randomState()[1]>0,'enemy creation must exercise World randomness');
  }
});
