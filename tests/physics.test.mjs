import test from 'node:test';
import assert from 'node:assert/strict';
import {World, BUFFS, length} from '../dist/physics.js';

function world(){const w=new World(900,700,()=>.5);w.enemies=[];w.spawnTimer=999;w.events=[];return w;}
function enemy(w,x,y,options={}){const b=w.makeBody(x,y,w.unit,.8);Object.assign(b,{born:1,solid:true,hp:100,maxHp:100},options);w.enemies.push(b);return b;}
function advance(w,seconds){for(let i=0;i<Math.ceil(seconds*120);i++)w.step(1/120);}
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} ≠ ${b}`);

test('slingshot launches opposite to the drag, caps deformation energy, and gates fast re-shots',()=>{
  const w=world();assert.ok(w.shoot(60,80));assert.ok(w.player.vx<0&&w.player.vy<0);near(w.player.vx/w.player.vy,.75);
  assert.equal(w.shoot(100,0),false);
  w.player.vx=w.player.vy=0;w.shoot(10000,0);near(length(w.player),w.baseSpeed);
});
test('energy and density obey v = sqrt(2E/m)',()=>{
  const a=world(),b=world();a.shoot(170,0);b.energy=1.3;b.density=1.35;b.shoot(170,0);
  near(length(b.player)/length(a.player),Math.sqrt(1.3/1.35));
});
test('ordinary circle collision conserves momentum and dissipates energy',()=>{
  const w=world(),a=w.player;Object.assign(a,{x:300,y:300,vx:500,vy:0});const b=enemy(w,300+w.unit*1.9,300);
  const p0=a.mass*a.vx+b.mass*b.vx,e0=.5*a.mass*a.vx**2;
  w.collide(a,b);near(a.mass*a.vx+b.mass*b.vx,p0);assert.ok(b.vx>0);assert.ok(.5*a.mass*a.vx**2+.5*b.mass*b.vx**2<e0);assert.ok(b.hp<100);
});
test('glancing collision changes player direction',()=>{
  const w=world();Object.assign(w.player,{x:300,y:300,vx:600,vy:0});const b=enemy(w,340,320);
  w.collide(w.player,b);assert.ok(w.player.vy<0&&b.vy>0);
});
test('larger relative impact deals more damage',()=>{
  const hits=[200,600].map(v=>{const w=world();Object.assign(w.player,{x:300,y:300,vx:v,vy:0});const b=enemy(w,350,300,{hp:999,maxHp:999});w.collide(w.player,b);return 999-b.hp;});
  assert.ok(hits[1]>hits[0]*5);
});
test('growing enemies push other enemies but cannot collide with the player',()=>{
  const w=world();Object.assign(w.player,{x:300,y:300,vx:0,vy:0});enemy(w,310,300,{born:.25,solid:false});
  const x=w.player.x;w.step(1/120);near(w.player.x,x);
  const a=enemy(w,500,350,{born:.5,solid:false}),b=enemy(w,505,350);const distance=Math.abs(a.x-b.x);w.step(1/120);assert.ok(Math.abs(a.x-b.x)>distance);
});
test('wall contact reverses velocity with a smaller speed and visible squash',()=>{
  const w=world(),p=w.player;Object.assign(p,{x:1,y:300,vx:-500,vy:0});w.wall(p);near(p.vx,460);assert.ok(p.squash>0);assert.ok(p.x>=p.r+w.inset);
});
test('potential score stops spawns without stopping the battle',()=>{
  const w=world();w.score=w.target-10;enemy(w,500,300,{value:10});w.spawnTimer=0;advance(w,5);assert.equal(w.enemies.length,1);assert.equal(w.phase,'battle');assert.equal(w.potential,w.target);
});
test('kill credit is awarded once even if multiple hits arrive in one frame',()=>{
  const w=world(),b=enemy(w,500,300,{hp:5,value:10});w.damage(b,9);w.damage(b,9);assert.equal(w.score,10);assert.equal(w.events.filter(e=>e.type==='kill').length,1);
});
test('clear -> automated placement -> choice -> exactly one buff -> next stage',()=>{
  const w=world();w.score=w.target;w.step(1/120);assert.equal(w.phase,'transition');assert.equal(w.ready,false);assert.equal(w.choices.length,2);
  advance(w,1.9);assert.equal(w.phase,'choose');near(w.player.x,w.width*.5);near(w.player.y,w.height*.72);assert.ok(w.choices.every(c=>c.born===1));
  const choice=w.choices[0];Object.assign(w.player,{x:choice.x,y:choice.y,vx:100,vy:0});w.step(1/120);
  assert.equal(w.phase,'reward');assert.equal(w.buffs.density,1);assert.equal(w.choices.length,0);assert.ok(w.player.vx>95);
  advance(w,.9);assert.equal(w.phase,'reward');advance(w,.12);assert.equal(w.phase,'battle');assert.equal(w.stage,2);assert.equal(w.target,380);
});
test('reaching the population threshold ends the game',()=>{
  const w=world();w.target=9999;for(let i=0;i<18;i++)enemy(w,80+i%6*120,150+Math.floor(i/6)*130);w.step(1/120);assert.equal(w.phase,'over');assert.ok(w.events.some(e=>e.type==='over'));
});
test('pierce preserves incoming direction but loses speed',()=>{
  const w=world();w.buffs.pierce=1;Object.assign(w.player,{x:300,y:300,vx:600,vy:0});const b=enemy(w,340,320);w.collide(w.player,b);
  near(w.player.vy,0);assert.ok(w.player.vx>0&&w.player.vx<600);assert.ok(length(b)>0);
});
test('pulse deals nearby area damage, and breath delays future spawns',()=>{
  const w=world();w.buffs.pulse=1;w.buffs.breath=1;Object.assign(w.player,{x:300,y:300,vx:900,vy:0});const b=enemy(w,350,300,{hp:1}),nearby=enemy(w,420,300);w.collide(w.player,b);
  assert.ok(nearby.hp<100);near(w.spawnHold,1.2);assert.ok(w.events.some(e=>e.type==='pulse'));
});
test('bank charges on walls and is consumed by the next collision',()=>{
  const w=world();w.buffs.bank=1;Object.assign(w.player,{x:0,y:300,vx:-300,vy:0});w.wall(w.player);assert.equal(w.bank,1);
  Object.assign(w.player,{x:300,y:300,vx:500,vy:0});w.collide(w.player,enemy(w,350,300));assert.equal(w.bank,0);
});
test('rotation keeps all bodies inside the resized playable bounds',()=>{
  const w=world();enemy(w,850,650);w.resize(390,844);for(const b of [w.player,...w.enemies]){assert.ok(b.x>=b.r+w.inset&&b.x<=390-b.r-w.inset);assert.ok(b.y>=b.r+w.inset&&b.y<=844-b.r-w.inset);}
});
test('difficulty increases health, density and stage population budget',()=>{
  const w=world();w.spawnEnemy();const a=w.enemies[0];w.enemies=[];w.stage=8;w.time=180;w.spawnEnemy();const b=w.enemies[0];assert.ok(b.hp>a.hp&&b.density>a.density);
});

test('player can re-aim while moving at speeds previously locked out',()=>{
  const w=world();w.player.vx=w.unit*7;assert.equal(w.ready,true);assert.equal(w.shoot(0,120),true);
  assert.ok(w.player.vy<0);w.player.vx=w.unit*9;w.player.vy=0;assert.equal(w.ready,false);
});
test('head-on enemy hit retains more player speed than the previous tuning without adding energy',()=>{
  const w=world(),p=w.player;Object.assign(p,{x:300,y:300,vx:500,vy:0});const b=enemy(w,350,300,{mass:.74});
  const oldPlayerSpeed=(1-.78*.74)/(1+.74)*500;
  const energyBefore=.5*p.mass*500**2;w.collide(p,b);
  assert.ok(length(p)>oldPlayerSpeed*1.4);assert.ok(.5*p.mass*length(p)**2+.5*b.mass*length(b)**2<energyBefore);
});
test('faster maximum shots cannot tunnel through an enemy or wall',()=>{
  const w=world();Object.assign(w.player,{x:180,y:300,vx:w.unit*60,vy:0});const b=enemy(w,300,300,{hp:9999,maxHp:9999});
  advance(w,.08);assert.ok(b.hp<9999);
  Object.assign(w.player,{x:w.width-w.player.r-w.inset-1,y:200,vx:w.unit*60,vy:0});w.step(1/120);
  assert.ok(w.player.vx<0);assert.ok(w.player.x<=w.width-w.player.r-w.inset);
});

test('battle tuning is restored to v1.1.1',()=>{
  const w=new World(900,700,()=>.5);
  assert.equal(w.enemies.length,2);assert.equal(w.target,140);assert.equal(w.limit,18);
  assert.equal(w.enemies[0].hp,19);near(w.spawnTimer,.45);near(w.baseSpeed,w.unit*40);
  advance(w,.46);assert.equal(w.enemies.length,3);assert.ok(w.spawnTimer>2.4&&w.spawnTimer<2.45);
});
const growth=BUFFS.find(b=>b.id==='growth');
function gainGrowth(w){w.phase='choose';w.choose(growth);w.phase='battle';}
test('growth changes only collision/display radius, with absolute 1.2 and 1.4 scales',()=>{
  const a=world(),b=world();gainGrowth(b);
  near(b.player.r,a.player.r*1.2);near(b.player.mass,a.player.mass);near(b.player.density,a.player.density);
  near(b.energy,a.energy);near(b.density,a.density);near(b.baseSpeed,a.baseSpeed);near(b.maxPull,a.maxPull);
  a.shoot(170,0);b.shoot(170,0);near(length(a.player),length(b.player));
  gainGrowth(b);near(b.player.r,a.player.r*1.4);near(b.player.mass,a.player.mass);
  gainGrowth(b);near(b.player.r,a.player.r*1.4);assert.equal(b.buffs.growth,2);
  b.resize(390,844);near(b.player.r,b.unit*1.4);near(b.player.mass,a.player.mass);
});
test('growth increases reach without changing equal-normal-impact damage or velocity response',()=>{
  const hits=[false,true].map(grown=>{
    const w=world();if(grown)gainGrowth(w);const p=w.player;
    Object.assign(p,{x:300,y:300,vx:500,vy:0});const b=enemy(w,300+p.r+w.unit-1,300,{hp:999});
    w.collide(p,b);return {damage:999-b.hp,pvx:p.vx,bvx:b.vx};
  });assert.deepEqual(hits[0],hits[1]);
  const w=world();gainGrowth(w);Object.assign(w.player,{x:300,y:300,vx:500,vy:0});const b=enemy(w,300+w.unit*2.1,300,{hp:999});
  w.collide(w.player,b);assert.ok(b.hp<999);
});
test('growth can appear at most twice, including offers the player skips',()=>{
  const w=world();w.stage=2;w.random=()=>.65;
  for(let offer=1;offer<=2;offer++){
    w.beginUpgrade();assert.ok(w.choices.some(c=>c.id==='growth'));assert.equal(w.buffOffers.growth,offer);
    w.phase='choose';w.choose(w.choices.find(c=>c.id!=='growth'));w.stage=2;
  }
  for(let i=0;i<12;i++){w.beginUpgrade();assert.ok(!w.choices.some(c=>c.id==='growth'));w.stage=2;}
  assert.equal(w.buffs.growth,undefined);
});
