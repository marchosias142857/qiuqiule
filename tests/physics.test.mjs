import test from 'node:test';
import assert from 'node:assert/strict';
import {World, BUFFS, length, BREATH_DURATION} from '../dist/physics.js';
import {LegacyCampaignWorld as CampaignWorld} from '../dist/campaign.js';

function world(){const w=new World(900,700,()=>.5);w.enemies=[];w.spawnTimer=999;w.floorTimer=Infinity;w.introTimer=Infinity;w.events=[];return w;}
function campaignWorld(){const w=new CampaignWorld(900,700,1,()=>.5);w.enemies=[];w.spawnTimer=999;w.events=[];w.energy=1;return w;}
function enemy(w,x,y,options={}){const b=w.makeBody(x,y,w.unit,.8);Object.assign(b,{born:1,solid:true,hp:100,maxHp:100},options);w.enemies.push(b);return b;}
function advance(w,seconds){for(let i=0;i<Math.ceil(seconds*120);i++)w.step(1/120);}
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} ≠ ${b}`);

test('slingshot launches opposite to the drag, caps deformation energy, and allows fast endless re-shots',()=>{
  const w=world();assert.ok(w.shoot(60,80));assert.ok(w.player.vx<0&&w.player.vy<0);near(w.player.vx/w.player.vy,.75);
  assert.equal(w.shoot(100,0),true);
  w.player.vx=w.player.vy=0;w.shoot(10000,0);near(length(w.player),w.baseSpeed);
});
test('endless launch speed follows energy while density does not slow it',()=>{
  const a=world(),b=world();a.shoot(170,0);b.energy=1.3;b.density=1.35;b.shoot(170,0);
  near(length(b.player)/length(a.player),Math.sqrt(1.3));
});
test('campaign circle collision preserves momentum and dissipates energy',()=>{
  const w=campaignWorld(),a=w.player;Object.assign(a,{x:300,y:300,vx:500,vy:0});const b=enemy(w,300+w.unit*1.9,300);
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
  const w=world(),p=w.player;Object.assign(p,{x:1,y:300,vx:-500,vy:0});w.wall(p);near(p.vx,475);assert.ok(p.squash>0);assert.ok(p.x>=p.r+w.inset);
});
test('neither on-field values nor a high score gate waves or advance the stage',()=>{
  const w=world();w.score=1e6;enemy(w,500,300,{value:10000});w.spawnTimer=0;advance(w,1);
  assert.equal(w.enemies.length,5);assert.equal(w.phase,'battle');assert.equal(w.stageKills,0);
});
test('kill credit is awarded once even if multiple hits arrive in one frame',()=>{
  const w=world(),b=enemy(w,500,300,{hp:5,value:10});w.damage(b,9);w.damage(b,9);assert.equal(w.score,10);assert.equal(w.events.filter(e=>e.type==='kill').length,1);
});
test('clear -> automated placement -> choice -> exactly one buff -> next stage',()=>{
  const w=world();w.stageKills=w.killTarget-1;w.damage(enemy(w,500,300,{hp:1}),1);w.step(1/120);
  assert.equal(w.phase,'transition');assert.equal(w.ready,false);assert.equal(w.choices.length,3);
  advance(w,1.9);assert.equal(w.phase,'choose');near(w.player.x,w.width*.5);near(w.player.y,w.choicePlayerY);assert.ok(w.choices.every(c=>c.born===1));
  assert.ok(w.choices.every(c=>Math.hypot(c.x-w.player.x,c.y-w.player.y)>c.r+w.player.r),'placement cannot auto-select an overlapping reward');
  const choice=w.choices[0];Object.assign(w.player,{x:choice.x,y:choice.y,vx:100,vy:0});w.step(1/120);
  assert.equal(w.phase,'reward');assert.equal(w.buffs[choice.id],1);assert.equal(w.choices.length,0);assert.ok(w.player.vx>95);
  advance(w,w.rewardTiming.rest-.1);assert.equal(w.phase,'reward');advance(w,.12);assert.equal(w.phase,'battle');assert.equal(w.stage,2);assert.equal(w.killTarget,18);assert.equal(w.stageKills,0);assert.equal(w.enemies.length,7);
});
test('capacity gives a real-time grace period before spending the one rescue',()=>{
  const w=world();for(let i=0;i<28;i++)enemy(w,80+i%7*110,150+Math.floor(i/7)*130);
  advance(w,.79);assert.equal(w.phase,'battle');assert.equal(w.enemies.length,28);assert.equal(w.saveUsed,false);
  advance(w,.02);assert.equal(w.phase,'battle');assert.equal(w.enemies.length,25);assert.equal(w.saveUsed,true);
  assert.equal(w.events.filter(e=>e.type==='rescue').length,1);assert.equal(w.events.filter(e=>e.type==='shatter').length,3);assert.equal(w.score,0);assert.equal(w.stageKills,0);
});
test('pierce preserves incoming direction but loses speed',()=>{
  const w=world();w.buffs.pierce=1;Object.assign(w.player,{x:300,y:300,vx:600,vy:0});const b=enemy(w,340,320);w.collide(w.player,b);
  near(w.player.vy,0);assert.ok(w.player.vx>0&&w.player.vx<600);assert.ok(length(b)>0);
});
test('pulse deals nearby area damage, and breath starts a 1.5-second slowdown',()=>{
  const w=world();w.buffs.pulse=1;w.buffs.breath=1;Object.assign(w.player,{x:300,y:300,vx:900,vy:0});const b=enemy(w,350,300,{hp:1}),nearby=enemy(w,420,300);w.collide(w.player,b);
  assert.ok(nearby.hp<100);near(w.breathTime,BREATH_DURATION);assert.ok(w.events.some(e=>e.type==='pulse'));
});
test('bank charges on walls and is consumed by the next collision',()=>{
  const w=world();w.buffs.bank=1;Object.assign(w.player,{x:0,y:300,vx:-300,vy:0});w.wall(w.player);assert.equal(w.bank,1);
  Object.assign(w.player,{x:300,y:300,vx:500,vy:0});w.collide(w.player,enemy(w,350,300));assert.equal(w.bank,0);
});
test('rotation keeps all bodies inside the resized playable bounds',()=>{
  const w=world();enemy(w,850,650);w.resize(390,844);for(const b of [w.player,...w.enemies]){assert.ok(b.x>=b.r+w.inset&&b.x<=390-b.r-w.inset);assert.ok(b.y>=b.r+w.inset&&b.y<=844-b.r-w.inset);}
});
test('later stages use exponential health and new density while ordinary radius stays in its fixed range',()=>{
  const w=world();w.spawnEnemy();const a=w.enemies[0];w.enemies=[];w.stage=8;w.time=180;w.spawnEnemy();const b=w.enemies[0];
  near(b.hp,19*1.20**7+8);near(b.density,.65+.06*8+.0004*180);near(b.r/a.r,1);assert.equal(b.value,10);assert.ok(b.hp>a.hp);
});

test('player can re-aim while moving at speeds previously locked out',()=>{
  const w=world();w.player.vx=w.unit*7;assert.equal(w.ready,true);assert.equal(w.shoot(0,120),true);
  assert.ok(w.player.vy<0);w.player.vx=w.unit*9;w.player.vy=0;assert.equal(w.ready,true);
});
test('head-on endless enemy hit retains at least seventy percent of incoming player speed',()=>{
  const w=world(),p=w.player;Object.assign(p,{x:300,y:300,vx:500,vy:0});const b=enemy(w,350,300,{mass:.74});
  w.collide(p,b);near(length(p),500*.7);assert.ok(p.vx>0);assert.ok(b.vx>0);
});
test('faster maximum shots cannot tunnel through an enemy or wall',()=>{
  const w=world();Object.assign(w.player,{x:180,y:300,vx:w.unit*60,vy:0});const b=enemy(w,300,300,{hp:9999,maxHp:9999});
  advance(w,.08);assert.ok(b.hp<9999);
  Object.assign(w.player,{x:w.width-w.player.r-w.inset-1,y:200,vx:w.unit*60,vy:0});w.step(1/120);
  assert.ok(w.player.vx<0);assert.ok(w.player.x<=w.width-w.player.r-w.inset);
});

test('opening supplies six ordinary enemies while preserving the launch scale',()=>{
  const w=new World(900,700,()=>.5);
  assert.equal(w.enemies.length,6);assert.equal(w.killTarget,14);assert.equal(w.limit,28);
  assert.equal(w.enemies[0].hp,19);near(w.enemies[0].density,.71);near(w.spawnTimer,4);near(w.baseSpeed,w.unit*40);
  advance(w,.5);assert.equal(w.enemies.length,6);near(w.spawnTimer,3.5);
});
test('fresh opening keeps full birth protection and starts its first four-ball wave after four seconds',()=>{
  const w=new World(390,844,()=>.5),initial=w.enemies.slice();
  assert.ok(initial.every(b=>b.born===0&&!b.solid));
  const spawnedAt=Array(6).fill(0);w.events=[];
  for(let frame=1;frame<=720;frame++){
    w.step(1/120);
    for(const e of w.events.splice(0))if(e.type==='spawn')spawnedAt.push(frame/120);
    if(frame===48){assert.equal(w.enemies.length,6);assert.ok(initial.every(b=>!b.solid));}
    if(frame===60){assert.equal(w.enemies.length,6);assert.ok(w.enemies.every(b=>!b.solid));}
    if(frame===95)assert.ok(initial.every(b=>!b.solid));
    if(frame===97)assert.ok(initial.every(b=>b.born===1&&b.solid));
    if(frame===481){assert.equal(w.enemies.length,7);assert.equal(w.enemies[6].solid,false);}
  }
  const expected=[0,0,0,0,0,0,4,4.3,4.6,4.9];
  assert.equal(spawnedAt.length,expected.length);
  spawnedAt.forEach((t,i)=>near(t,expected[i],1/120+.000001));
});
const growth=BUFFS.find(b=>b.id==='growth');
function gainGrowth(w){w.phase='choose';w.choose(growth);w.phase='battle';}
test('growth uses absolute 1.2 and 1.4 radius scales while preserving mass and launch speed',()=>{
  const a=world(),b=world();gainGrowth(b);
  near(b.player.r,a.player.r*1.2);near(b.player.mass,a.player.mass);near(b.player.density,a.player.density);
  near(b.energy,a.energy);near(b.density,a.density);near(b.baseSpeed,a.baseSpeed);near(b.maxPull,a.maxPull);
  a.shoot(170,0);b.shoot(170,0);near(length(a.player),length(b.player));
  gainGrowth(b);near(b.player.r,a.player.r*1.4);near(b.player.mass,a.player.mass);
  gainGrowth(b);near(b.player.r,a.player.r*1.4);assert.equal(b.buffs.growth,2);
  b.resize(390,844);near(b.player.r,b.unit*1.4);near(b.player.mass,a.player.mass);
});
test('growth increases reach and damage ten percent per layer while preserving the velocity response',()=>{
  const hits=[0,1,2].map(layers=>{
    const w=world();for(let i=0;i<layers;i++)gainGrowth(w);const p=w.player;
    Object.assign(p,{x:300,y:300,vx:500,vy:0});const b=enemy(w,300+p.r+w.unit-1,300,{hp:999});
    const reference=.5/(1/p.mass+1/b.mass)*(500/w.unit)**2*.31;
    w.collide(p,b);assert.equal(999-b.hp,Math.round(reference*(1+.1*layers)));
    return {damage:999-b.hp,pvx:p.vx,bvx:b.vx};
  });
  for(const hit of hits.slice(1)){assert.ok(hit.damage>hits[0].damage);near(hit.pvx,hits[0].pvx);near(hit.bvx,hits[0].bvx);}
  const w=world();gainGrowth(w);Object.assign(w.player,{x:300,y:300,vx:500,vy:0});const b=enemy(w,300+w.unit*2.1,300,{hp:999});
  w.collide(w.player,b);assert.ok(b.hp<999);
});
test('growth remains offerable after skips and leaves the pool only after two acquired layers',()=>{
  const w=world();w.stage=2;
  // Leave growth as the only available regular upgrade, while real special
  // alternatives let the player decline it without acquiring a growth layer.
  for(const buff of BUFFS)if(buff.kind==='regular'&&buff.id!=='growth')w.buffs[buff.id]=buff.maxStacks;
  for(let offer=1;offer<=3;offer++){
    w.phase='battle';w.beginUpgrade();assert.ok(w.choices.some(c=>c.id==='growth'));
    w.phase='choose';w.choose(w.choices.find(c=>c.id!=='growth'));
    assert.equal(w.buffs.growth,undefined);
  }
  gainGrowth(w);gainGrowth(w);assert.equal(w.buffs.growth,2);
  w.phase='battle';w.beginUpgrade();assert.ok(w.choices.every(c=>c.id!=='growth'));
});

test('reaching the kill target sweeps survivors for ten points each without progress credit',()=>{
  const w=world();w.stageKills=w.killTarget-1;
  const final=enemy(w,500,300,{hp:1,value:10});
  enemy(w,620,300,{hp:300,value:500});enemy(w,700,450,{hp:300,born:.4,solid:false});
  w.damage(final,2);
  assert.equal(w.phase,'battle');assert.ok(w.pendingClearing);w.step(1/120);assert.equal(w.phase,'clearing');assert.equal(w.score,10);
  advance(w,.5);assert.equal(w.phase,'transition');assert.equal(w.enemies.length,0);assert.equal(w.score,30);assert.equal(w.stageKills,14);
  assert.equal(w.events.filter(e=>e.type==='kill').length,1);assert.equal(w.events.filter(e=>e.type==='clearKill').length,2);assert.equal(w.events.filter(e=>e.type==='shatter').length,0);
  assert.equal(w.events.filter(e=>e.type==='upgrade').length,1);
  w.beginUpgrade();w.damage(final,20);assert.equal(w.events.filter(e=>e.type==='upgrade').length,1);
});
test('the winning pulse batch takes priority over capacity and credits real excess kills before clearing',()=>{
  const w=world();w.stageKills=w.killTarget-1;w.buffs.pulse=1;
  Object.assign(w.player,{x:300,y:300,vx:900,vy:0});
  enemy(w,350,300,{hp:1});for(let i=0;i<27;i++)enemy(w,380+i*3,300,{hp:1});
  w.step(1/120);
  assert.equal(w.stageKills,41);assert.equal(w.score,2925);assert.equal(w.events.filter(e=>e.type==='kill').length,28);
  assert.equal(w.events.filter(e=>e.type==='over').length,0);assert.equal(w.events.filter(e=>e.type==='rescue').length,0);
  w.step(1/120);assert.equal(w.phase,'transition');assert.equal(w.enemies.length,0);
});
test('only excess real kills carry into the next stage, independently of accumulated score',()=>{
  const w=world();w.score=1e6;w.stageKills=w.killTarget-1;
  for(let i=0;i<3;i++)w.damage(enemy(w,600+i*50,300,{hp:1,value:20000}),2);
  w.step(1/120);advance(w,1.9);w.choose(w.choices[0]);advance(w,1.02);
  assert.equal(w.stage,2);assert.equal(w.killTarget,18);assert.equal(w.phase,'battle');assert.equal(w.stageKills,2);assert.equal(w.score,1000075);
});
test('breath makes wave starts 1.5 times farther apart and expires after 2.5 battle seconds',()=>{
  const w=world();w.buffs.breath=1;const b=enemy(w,600,300,{hp:1});w.damage(b,2);w.spawnTimer=.3;
  advance(w,.3);near(w.spawnTimer,.1);assert.equal(w.enemies.length,0);
  advance(w,.15);assert.equal(w.enemies.length,1);near(w.breathTime,2.05);
  w.spawnTimer=100;advance(w,2.35);near(w.breathTime,0);near(w.spawnTimer,100-2.05*2/3-.3,1e-5);
});
test('consecutive kills refresh breath to 2.5 seconds without stacking the reduction',()=>{
  const w=world();w.buffs.breath=1;w.damage(enemy(w,600,300,{hp:1}),2);advance(w,1);
  w.damage(enemy(w,600,300,{hp:1}),2);near(w.breathTime,2.5);w.spawnTimer=100;advance(w,1);near(w.spawnTimer,100-2/3);
  w.stageKills=w.killTarget-1;w.damage(enemy(w,600,300,{hp:1}),2);w.step(1/120);near(w.breathTime,0);
});
test('elapsed active time increases health and density without accelerating the stage wave schedule',()=>{
  const a=world(),b=world();b.time=180;a.stage=b.stage=3;
  a.spawnEnemy();b.spawnEnemy();
  near(b.enemies[0].hp-a.enemies[0].hp,8);near(b.enemies[0].density-a.enemies[0].density,.072);
  a.spawnTimer=b.spawnTimer=0;a.step(1/120);b.step(1/120);near(a.spawnTimer,b.spawnTimer);
});
test('wave start interval follows stage, wave size, teaching allowance and two-second pre-Boss rest',()=>{
  for(const [stage,time] of [[1,0],[4,60],[8,180],[40,3600]]){
    const w=world();w.stage=stage;w.time=time;w.spawnTimer=0;w.step(1/120);
    const interval=(.65+1.35*.86**(stage-1))*([3,6,8,10,12,13,16].includes(stage)?1.15:1),size=Math.min(8,4+Math.floor((stage-1)/3));
    near(w.spawnInterval,interval);near(w.spawnTimer,size*interval+([3,4].includes(stage%5)?2:0)-1/120);
  }
});
function gain(w,id){w.phase='choose';w.choose(BUFFS.find(b=>b.id===id));w.phase='battle';}
test('energy and density restore multiplicative stacks and physical impact damage',()=>{
  const w=world();for(let i=0;i<3;i++){gain(w,'energy');gain(w,'density');}
  near(w.energy,1.3**3);near(w.density,1.35**3);near(w.player.mass,1.5*1.35**3);
  Object.assign(w.player,{x:300,y:300,vx:0,vy:0});w.shoot(-w.maxPull,0);
  const speed=w.baseSpeed*Math.sqrt(w.energy);near(length(w.player),speed);
  const b=enemy(w,300+w.unit*1.9,300,{hp:10000});
  const reducedMass=1/(1/w.player.mass+1/b.mass);
  const expected=Math.max(1,Math.round(.5*reducedMass*(speed/w.unit)**2*.31));
  w.collide(w.player,b);assert.equal(10000-b.hp,expected);
});
test('battle remains capped and ends cleanly on both phone and desktop after a long idle run',()=>{
  for(const [width,height] of [[390,844],[844,390],[1440,900]]){
    const w=new World(width,height,()=>.63);for(let i=0;i<120*60&&w.phase!=='over';i++)w.step(1/120);
    assert.equal(w.phase,'over');assert.equal(w.enemies.length,28);assert.equal(w.saveUsed,true);assert.equal(w.events.filter(e=>e.type==='rescue').length,1);
    for(const b of [w.player,...w.enemies])for(const key of ['x','y','vx','vy','mass'])assert.ok(Number.isFinite(b[key]));
  }
});

test('pulse restores 30 percent damage to every nearby target',()=>{
  const w=world();w.buffs.pulse=1;Object.assign(w.player,{x:300,y:300,vx:900,vy:0});
  const b=enemy(w,350,300,{hp:10000}),others=[];
  for(let i=0;i<8;i++)others.push(enemy(w,390+i*5,300,{hp:10000}));
  w.collide(w.player,b);const direct=10000-b.hp,total=others.reduce((sum,b)=>sum+10000-b.hp,0);
  assert.equal(total,Math.round(direct*.3)*8);assert.ok(others.every(b=>10000-b.hp===Math.round(direct*.3)));
});
test('bank restores 60 or 120 percent bonus after one or two walls',()=>{
  const hits=[0,1,2].map(bank=>{const w=world();w.bank=bank;Object.assign(w.player,{x:300,y:300,vx:900,vy:0});const b=enemy(w,350,300,{hp:10000});w.collide(w.player,b);return 10000-b.hp;});
  assert.ok(Math.abs(hits[1]-hits[0]*1.6)<=1.3);assert.ok(Math.abs(hits[2]-hits[0]*2.2)<=1.6);
});

test('reward-choice capture threshold retains its stage bands and resets with a new run',()=>{
  const w=world();w.phase='choose';
  for(const [stage,multiple] of [[1,8],[5,8],[6,12],[10,12],[11,16],[15,16],[16,20]]){
    w.stage=stage;near(w.readySpeed/w.unit,multiple);
    w.player.vx=w.readySpeed-.001;assert.equal(w.ready,true);
    w.player.vx=w.readySpeed;assert.equal(w.ready,false);
  }
  w.stage=5;w.phase='reward';w.phaseTime=w.rewardTiming.rest-.01;w.player.vx=0;w.step(.02);
  assert.equal(w.stage,6);near(w.readySpeed/w.unit,12);
  gainGrowth(w);near(w.readySpeed/w.unit,12);
  near(world().readySpeed/world().unit,8);
});
test('campaign release still adds captured scalar speed after drag braking and follows the new aim',()=>{
  const w=campaignWorld();Object.assign(w.player,{vx:w.unit*3,vy:w.unit*4});
  assert.equal(w.beginPull(),true);near(w.pullStartSpeed,w.unit*5);
  for(let i=0;i<36;i++)w.step(1/120,true);
  assert.ok(length(w.player)<w.unit*.3);
  assert.equal(w.shoot(0,-w.maxPull),true);
  near(w.player.vx,0);near(w.player.vy,w.baseSpeed+w.unit*5);assert.equal(w.pullStartSpeed,null);
});
test('cancel, tiny gestures, rotation and stage transitions cannot bank stale speed',()=>{
  const w=world();w.player.vx=w.unit*5;assert.ok(w.beginPull());assert.equal(w.beginPull(),false);
  w.cancelPull();w.player.vx=0;w.shoot(w.maxPull,0);near(length(w.player),w.baseSpeed);
  w.player.vx=w.unit*4;w.beginPull();assert.equal(w.shoot(1,0),false);assert.equal(w.pullStartSpeed,null);
  w.beginPull();w.resize(390,844);assert.equal(w.pullStartSpeed,null);
  w.beginPull();w.beginUpgrade();assert.equal(w.pullStartSpeed,null);assert.equal(w.shoot(100,0),false);
});
test('campaign active pull keeps its original speed snapshot when a collision accelerates the ball',()=>{
  const w=campaignWorld();w.player.vx=w.unit*2;w.beginPull();w.player.vx=w.unit*20;
  assert.equal(w.ready,true);w.shoot(-w.maxPull,0);near(length(w.player),w.baseSpeed+w.unit*2);
});
test('campaign captured speed remains above the launch cap and survives the next physics frame',()=>{
  const w=new CampaignWorld(10000,10000,1,()=>.5);w.enemies=[];w.spawnTimer=999;w.floorTimer=Infinity;w.introTimer=Infinity;w.stage=101;w.energy=100;
  w.player.vx=w.unit*47;assert.ok(w.beginPull());w.player.vx=0;w.shoot(-w.maxPull,0);
  const speed=w.unit*107;near(length(w.player),speed);w.step(1/120);
  near(length(w.player),speed*Math.exp(-.6/120));assert.ok(length(w.player)>w.unit*60);
});
test('adaptive steps catch high-speed enemy and wall contacts on phone and desktop',()=>{
  for(const [width,height] of [[390,844],[844,390],[1440,900]]){
    const w=new World(width,height,()=>.5);w.enemies=[];w.spawnTimer=999;w.floorTimer=Infinity;w.introTimer=Infinity;w.stage=101;w.energy=100;
    Object.assign(w.player,{x:60,y:height/2,vx:w.unit*107,vy:0});
    const b=enemy(w,180,height/2,{hp:1e9,maxHp:1e9});w.step(.06);assert.ok(b.hp<1e9);
    w.enemies=[];Object.assign(w.player,{x:width-w.inset-w.player.r-1,y:height/2,vx:w.unit*107,vy:0});w.step(.02);
    assert.ok(w.player.vx<0);assert.ok(w.player.x<=width-w.inset-w.player.r);
  }
});
test('subdivision preserves elapsed time and the partial breath slowdown',()=>{
  const a=world(),b=world();a.stage=b.stage=101;a.breathTime=b.breathTime=.04;a.spawnTimer=b.spawnTimer=100;
  b.player.vx=b.unit*107;a.step(.08);b.step(.08);
  near(a.time,b.time);near(a.spawnTimer,100-.04*2/3-.04);near(a.spawnTimer,b.spawnTimer);near(b.breathTime,0);
});
