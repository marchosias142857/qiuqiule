import test from 'node:test';
import assert from 'node:assert/strict';
import {CometTrails} from '../dist/comet-trail.js';
import {StarParticles} from '../dist/star-particles.js';
import {particleVisualStyle} from '../dist/particle-appearance.js';

function scene(shape='star'){
  const body={x:0,y:100,r:18,vx:720,vy:0,isPlayer:true,hp:1,active:true};
  const trails=new CometTrails(),fx=new StarParticles({seed:123});
  const options={unit:18,trails,shape,strength:.6};
  trails.step([body],0,{unit:18});fx.step([body],0,options);
  const births=[],seen=new Set();
  const step=(dt=1/120,overrides={})=>{
    body.x+=body.vx*dt;body.y+=body.vy*dt;
    trails.step([body],dt,{unit:18});fx.step([body],dt,{...options,...overrides});
    for(const p of fx.particles)if(!seen.has(p.sequence)){
      seen.add(p.sequence);births.push({shape:p.shape,sequence:p.sequence,bornAt:p.bornAt,
        x:p.x,y:p.y,r:p.r,life:p.life,rotation:p.rotation,side:p.birthSide});
    }
  };
  return{body,trails,fx,options,step,births};
}
function graphics(){
  return{paths:[],points:[],fillStyle(color,alpha){this.color=color;this.alpha=alpha;},
    beginPath(){this.points=[];},moveTo(x,y){this.points.push({x,y});},lineTo(x,y){this.points.push({x,y});},
    closePath(){},fillPath(){this.paths.push({color:this.color,alpha:this.alpha,points:this.points});}};
}

test('mixed cosmetics choose each primitive once at birth without affecting timing or motion randomness',()=>{
  const single=scene('star'),triple=scene('triple'),galaxy=scene('galaxy');
  const stripShape=({shape,...birth})=>birth;
  for(let i=0;i<1200;i++)for(const s of [single,triple,galaxy])s.step();
  assert.ok(single.births.length>100);
  assert.deepEqual(triple.births.map(stripShape),single.births.map(stripShape));
  assert.deepEqual(galaxy.births.map(stripShape),single.births.map(stripShape));
  assert.deepEqual(new Set(triple.births.map(p=>p.shape)),new Set(['triangle','square','diamond']));
  assert.deepEqual(new Set(galaxy.births.map(p=>p.shape)),new Set(['sun','moon','star']));
  assert.equal(single.fx.seed,triple.fx.seed);assert.equal(single.fx.seed,galaxy.fx.seed);
  const p=triple.fx.particles.at(-1),sequence=p.sequence,shape=p.shape;
  triple.step(1/120,{shape:'moon'});
  assert.equal(p.sequence,sequence);assert.equal(p.shape,shape,'an equipped-shape change only changes new births');
  const snapshot=structuredClone(triple.fx.particles),seed=triple.fx.seed,shapeSeed=triple.fx.shapeSeed;
  const first=graphics(),second=graphics();triple.fx.draw(first,0x123456);triple.fx.draw(second,0x123456);
  assert.deepEqual(first.paths,second.paths);assert.deepEqual(triple.fx.particles,snapshot);
  assert.equal(triple.fx.seed,seed);assert.equal(triple.fx.shapeSeed,shapeSeed);
});

test('zero-dt render refresh cannot change fixed-step emission or spend randomness',()=>{
  const plain=scene('galaxy'),refreshed=scene('galaxy');
  for(let i=0;i<480;i++){
    plain.step();refreshed.step();
    if(i%2===0){
      const seed=refreshed.fx.seed,phase=refreshed.fx.trackers.get(refreshed.body).phase;
      refreshed.trails.step([refreshed.body],0,{unit:18});
      refreshed.fx.step([refreshed.body],0,refreshed.options);
      assert.equal(refreshed.fx.seed,seed);assert.equal(refreshed.fx.trackers.get(refreshed.body).phase,phase);
    }
  }
  assert.deepEqual(refreshed.births,plain.births);
});

test('shrinking Boss walls contain each birth shape and Phaser drawing cannot mutate it',()=>{
  for(const shape of ['triangle','square','diamond','snowflake','sun','moon','star']){
    const s=scene(shape);for(let i=0;i<24;i++)s.step();
    const p=s.fx.particles.at(-1);assert.ok(p);
    Object.assign(p,{x:98,y:98,r:5,age:.08,life:.4,nx:1,ny:0,forward:100,lateral:100,vx:100,vy:100});
    s.fx.particles=[p];s.body.feedbackFreeze=1;
    const bounds={left:20,top:20,right:60,bottom:60};
    s.step(.001,{bounds});
    const style=particleVisualStyle(shape),extent=p.r*style.sizeScale*style.extent;
    assert.ok(p.x<=60-extent+1e-7&&p.y<=60-extent+1e-7);
    assert.equal(p.vx,0);assert.equal(p.vy,0);
    const before={...p},g=graphics();s.fx.draw(g,0x123456);
    assert.deepEqual(p,before);assert.equal(g.paths.length,1);assert.equal(g.paths[0].color,0x123456);
    assert.ok(g.paths[0].alpha>0&&g.paths[0].alpha<1);
    for(const point of g.paths[0].points)assert.ok(point.x>=20&&point.x<=60&&point.y>=20&&point.y<=60);
  }
});

test('unequipping or invalid cosmetics clear visual state and never emit for an enemy or clone',()=>{
  const s=scene();for(let i=0;i<24;i++)s.step();assert.ok(s.fx.count>0);
  s.step(1/120,{shape:null});assert.equal(s.fx.count,0);assert.equal(s.fx.free.length,24);
  for(let i=0;i<24;i++)s.step();assert.ok(s.fx.count>0);
  s.step(1/120,{shape:'unknown'});assert.equal(s.fx.count,0);assert.equal(s.fx.free.length,24);
  const enemy={...s.body,isPlayer:false},clone={...s.body,isAuxiliary:true};
  for(let i=0;i<120;i++){
    for(const b of [enemy,clone])b.x+=6;
    s.trails.step([enemy,clone],1/120,{unit:18});
    s.fx.step([enemy,clone],1/120,s.options);
  }
  assert.equal(s.fx.count,0);assert.equal(s.fx.trackers.size,0);
});
