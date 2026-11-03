import test from 'node:test';
import assert from 'node:assert/strict';
import {World, BUFFS, BLACK_HOLE_GRAVITY, regularBuffBonus, length} from '../dist/physics.js';
import {CampaignWorld, levelConfig} from '../dist/campaign.js';

const near=(a,b,epsilon=1e-8)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function world(){
  const w=new World(900,900,()=>.5,{spawnInitial:false});
  w.spawnTimer=999;Object.assign(w.player,{x:450,y:450});
  return w;
}
function enemy(w,dx,dy=0,options={}){
  const b=w.makeBody(w.player.x+dx*w.unit,w.player.y+dy*w.unit,w.unit,.8);
  Object.assign(b,{born:1,solid:true,hp:100,maxHp:100},options);w.enemies.push(b);return b;
}
function gain(w,id){w.phase='choose';w.choose(BUFFS.find(b=>b.id===id));w.phase='battle';}

test('black-hole attraction points toward the player with equal strength at every in-range distance and mass',()=>{
  const w=world();gain(w,'gravity');
  for(const [dx,dy,mass] of [[2.1,0,.5],[-4.8,0,8],[0,-3,1],[3,4,2]]){
    const b=enemy(w,dx,dy,{mass}),a=w.gravityAcceleration(b);
    assert.ok(a);near(Math.hypot(a.x,a.y),w.unit*BLACK_HOLE_GRAVITY.acceleration);
    near(a.x*dy-a.y*dx,0);assert.ok(a.x*dx+a.y*dy<0);
  }
  assert.equal(w.gravityAcceleration(enemy(w,5.01)),null);
  assert.equal(w.gravityAcceleration(enemy(w,0)),null);
});

test('resting enemies actually move under gravity across real step calls and frame partitions',()=>{
  const samples=[];
  for(const hz of [30,60,120,240]){
    const w=world();gain(w,'gravity');const b=enemy(w,4),start=b.x;
    for(let frame=0;frame<hz*.8;frame++)w.step(1/hz);
    assert.ok(b.x<start-10);near(b.vy,0);near(w.player.x,450);
    near(b.vx,-w.unit*BLACK_HOLE_GRAVITY.acceleration/1.2*(1-Math.exp(-1.2*.8)),1e-7);
    samples.push(b.x);
  }
  assert.ok(Math.max(...samples)-Math.min(...samples)<.12);
  const single=world();gain(single,'gravity');const b=enemy(single,4);
  single.step(.8);near(b.x,samples[0],1e-7);
});

test('gravity preserves spawn protection, pauses at zero dt, and ignores dead enemies and non-battle phases',()=>{
  const w=world();gain(w,'gravity');
  const growing=enemy(w,3,0,{born:0,solid:false}),dead=enemy(w,-3,0,{hp:0});
  assert.equal(w.gravityAcceleration(growing),null);assert.equal(w.gravityAcceleration(dead),null);
  w.step(.2);near(growing.vx,0);near(growing.x,450+3*w.unit);
  const active=enemy(w,0,4),before={x:active.x,y:active.y,vx:active.vx,vy:active.vy};
  w.step(0);assert.deepEqual({x:active.x,y:active.y,vx:active.vx,vy:active.vy},before);
  for(const phase of ['transition','choose','reward','boss-entry','boss','boss-celebrate','over']){
    w.phase=phase;assert.equal(w.gravityAcceleration(active),null);
  }
});

test('gravity leaves the anchored boss fixed and survives resize in proportional units',()=>{
  const w=world();gain(w,'gravity');const b=enemy(w,4);
  w.resize(450,450);
  near(w.gravityRadius,w.unit*5);
  near(Math.hypot(w.gravityAcceleration(b).x,w.gravityAcceleration(b).y),w.unit*2.4);
  w.stage=5;w.beginBoss();w.step(1);
  const boss=w.boss,before={x:boss.x,y:boss.y};
  assert.equal(w.gravityAcceleration(boss),null);w.step(.5);
  assert.deepEqual({x:boss.x,y:boss.y},before);near(length(boss),0);
});

test('black-hole special appears through the upgrade pool, is not reoffered after acquisition, and resets with a new run',()=>{
  const w=world();w.stage=2;w.random=()=>.999;w.beginUpgrade();
  const gravity=w.choices.find(c=>c.id==='gravity');assert.ok(gravity);
  w.phase='choose';w.choose(gravity);assert.equal(w.buffs.gravity,1);
  w.phase='battle';w.beginUpgrade();assert.ok(w.choices.every(c=>c.id!=='gravity'));
  assert.equal(world().buffs.gravity,undefined);
});

test('ordinary endless upgrades gain 15 percentage points per completed five-stage band and freeze acquired values',()=>{
  const w=world();
  for(const [stage,density,energy] of [[1,.35,.30],[5,.35,.30],[6,.50,.45],[10,.50,.45],[11,.65,.60],[15,.65,.60],[16,.80,.75],[20,.80,.75],[21,.95,.90],[51,1.85,1.80]]){
    near(regularBuffBonus('density',stage),density);near(regularBuffBonus('energy',stage),energy);
  }
  gain(w,'density');gain(w,'energy');near(w.density,1.35);near(w.energy,1.30);
  w.stage=21;w.step(1/120);near(w.density,1.35);near(w.energy,1.30);
  gain(w,'density');gain(w,'energy');near(w.density,1.35*1.95);near(w.energy,1.30*1.90);
  near(w.player.mass,1.5*w.density);near(w.player.density,1.5*w.density);
  w.stage=51;w.step(1/120);near(w.density,1.35*1.95);near(w.energy,1.30*1.90);
});

test('offered percentages match the awarded values and keep existing enemy difficulty progression',()=>{
  const w=world();w.stage=7;w.beginUpgrade();
  assert.deepEqual(w.choices.map(c=>c.short),['密度 +50%','弹射能量 +45%']);
  const choice=w.choices[1];w.phase='choose';w.choose(choice);near(w.energy,1+choice.bonus);
  const profiles=[];
  for(const stage of [1,11,21]){const run=world();run.stage=stage;profiles.push({profile:run.enemyProfile(),spawn:run.spawnInterval});}
  assert.ok(profiles[1].profile.hp>profiles[0].profile.hp*4);
  assert.ok(profiles[2].profile.hp>profiles[1].profile.hp);
  assert.ok(profiles[2].profile.density>profiles[1].profile.density);
  assert.ok(profiles[2].spawn<=profiles[1].spawn&&profiles[1].spawn<profiles[0].spawn);
});

test('campaign attribute upgrades keep their existing fixed values and do not acquire endless specials',()=>{
  const w=new CampaignWorld(900,900,100,()=>.5);w.stage=51;
  w.gainAttribute();w.gainAttribute();
  near(w.energy,levelConfig(100).playerEnergy*1.14);near(w.density,1.12);
  assert.equal(w.buffs.gravity,undefined);assert.equal(w.choices.length,0);
});
