import test from 'node:test';
import assert from 'node:assert/strict';
import {CometTrails} from '../dist/comet-trail.js';
import {StarParticles} from '../dist/star-particles.js';

function savedTrail(){
  const body={x:100,y:100,r:18,vx:720,vy:0,isPlayer:true,hp:1};
  const trails=new CometTrails();
  for(let i=0;i<24;i++){body.x+=6;trails.step([body],1/120,{unit:18});}
  return {body,entry:JSON.parse(JSON.stringify(trails.getState(body)))};
}

test('a v11.1 saved ribbon is preserved while restored particle metadata starts finite',()=>{
  const {body,entry}=savedTrail();
  delete entry.generation;delete entry.mileage;delete entry.frameDistance;
  const before=structuredClone(entry.points),trails=new CometTrails(),particles=new StarParticles();
  trails.entries=new Map([[body,entry]]);
  trails.step([body],0,{unit:18});particles.step([body],0,{unit:18,trails});
  assert.deepEqual(entry.points,before,'resuming must retain the saved thin-tail geometry');
  assert.equal(entry.active,true);assert.ok(Number.isSafeInteger(entry.generation));
  assert.equal(entry.mileage,0);assert.equal(entry.frameDistance,0);
  let births=0;
  for(let i=0;i<120;i++){
    body.x+=6;trails.step([body],1/120,{unit:18});particles.step([body],1/120,{unit:18,trails});
    births=Math.max(births,particles.emissionCount);
    for(const p of particles.particles)for(const [key,value] of Object.entries(p)){
      if(typeof value==='number')assert.ok(Number.isFinite(value),`restored particle ${key} must be finite`);
    }
  }
  assert.ok(births>5,'restored flight really produces successive particle births');
  assert.ok(particles.count>0);assert.equal(particles.count+particles.free.length,24);
});

test('restored generations cannot be reused by another emitter or a later reset',()=>{
  const {body,entry}=savedTrail(),newBody={...body,x:20},trails=new CometTrails();
  entry.generation=812;entry.mileage=144;
  trails.entries=new Map([[body,entry]]);
  // The new body precedes the restored one, so ordering cannot create a clash.
  trails.step([newBody,body],0,{unit:18});
  assert.equal(entry.generation,812);assert.equal(entry.mileage,144);
  assert.ok(trails.getState(newBody).generation>812);
  const used=trails.getState(newBody).generation;
  body.x+=5000;trails.step([newBody,body],1/120,{unit:18});
  assert.ok(entry.generation>used);assert.equal(entry.mileage,0);
  const resetGeneration=entry.generation;
  trails.clear();trails.step([body],0,{unit:18});
  assert.ok(trails.getState(body).generation>resetGeneration);
});
