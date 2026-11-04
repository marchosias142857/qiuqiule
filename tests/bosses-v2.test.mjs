import test from 'node:test';
import assert from 'node:assert/strict';
import {World, BOSS_TIMING, length} from '../dist/physics.js';
import {UPGRADES, UPGRADE_DEFINITIONS} from '../dist/upgrades.js';
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function run(stage=1, random=()=>.4, width=1000,height=1000){const w=new World(width,height,random,{spawnInitial:false});w.stage=stage;w.spawnTimer=w.floorTimer=w.introTimer=Infinity;return w;}
function body(w, values={}) {const b=w.makeBody(w.inset+w.unit*2,w.inset+w.unit*2,w.unit*.7,1);Object.assign(b,{hp:100,maxHp:100,enemyType:'normal',born:1,solid:true},values);w.enemies.push(b);return b;}
function boss(stage=5,type){const w=run(stage);w.beginBoss({type});w.step(BOSS_TIMING.entry);assert.equal(w.phase,'boss');return w;}
function contact(w,actor=w.player){const b=w.boss;Object.assign(actor,{x:b.x-w.bossRadius-actor.r+.01,y:b.y,vx:w.unit*30,vy:0,feedbackFreeze:0});w.collideBoss(actor);}
function separate(w,actor=w.player){actor.x=w.boss.x-w.bossRadius-actor.r-w.unit;actor.y=w.boss.y;w.collideBoss(actor);}
function victory(w){Object.assign(w.boss,{stunned:true,r:w.boss.minRadius,hp:.5,maxHp:.5});w.damageBoss(w.unit*30,{source:'shockwave'});assert.equal(w.phase,'boss-celebrate');w.step(.125,false,{timeScale:.25});near(w.bossVictorySlowTime,0);w.step(BOSS_TIMING.brake+BOSS_TIMING.spin+BOSS_TIMING.hold+BOSS_TIMING.fade+.001);}
function pick(w,id){w.step(2);assert.equal(w.phase,'choose');const c=id?UPGRADES[id]:w.choices[0];assert.ok(w.choose(c));w.step(1.001);}

test('every Boss stage uses inflation and removed type overrides cannot consume a type-selection random draw',()=>{
 for(const stage of [5,10,15,20,50])for(const forced of [undefined,'splitter','magnet']){
  let calls=0;const w=run(stage,()=>{calls++;return .8;});const before=calls;w.beginBoss({type:forced});
  assert.equal(w.boss.bossType,'inflation');assert.equal(w.boss.index,stage/5);assert.equal(calls,before);
 }
});

test('a Boss quota completes the ordinary scored clearing wave before entering an empty square arena',()=>{
 const w=run(5,()=>.4,900,1200);body(w);body(w,{x:500,y:600});
 const ally=w.makeBody(100,100,w.unit*.7,1);Object.assign(ally,{isPlayer:true,isAuxiliary:true,hp:Infinity,born:1,sourceMass:w.player.mass,vx:w.unit*8});w.auxiliaries=[ally];
 w.stageKills=w.killTarget;w.beginClearing();assert.equal(w.phase,'clearing');assert.equal(w.auxiliaries.length,0);
 for(let frame=0;w.phase==='clearing'&&frame<1200;frame++)w.step(1/120);
 assert.equal(w.phase,'boss-entry');assert.equal(w.score,20);assert.equal(w.totalKills,0);assert.equal(w.stageKills,w.killTarget);
 assert.equal(w.events.filter(e=>e.type==='clearKill').length,2);assert.equal(w.events.filter(e=>e.type==='bossEntry').length,1);
 assert.deepEqual(w.enemies,[]);assert.deepEqual(w.fragmentQueue,[]);assert.equal(w.wave,null);
 w.step(BOSS_TIMING.entry);assert.equal(w.phase,'boss');assert.equal(w.arenaGeometry.shape,'square');assert.ok(w.ready);
 assert.ok(w.player.x-w.player.r>=w.arenaBounds.left-1e-6&&w.player.x+w.player.r<=w.arenaBounds.right+1e-6&&w.player.y-w.player.r>=w.arenaBounds.top-1e-6&&w.player.y+w.player.r<=w.arenaBounds.bottom+1e-6);
});

test('direct Boss entry removes enemies and pending children without inventing a second clearing score',()=>{
 const w=run(10);body(w);w.fragmentQueue=[{x:100,y:100}];w.wave={timer:0};w.score=73;w.stageKills=4;
 w.beginBoss();assert.equal(w.score,73);assert.equal(w.stageKills,4);assert.equal(w.totalKills,0);
 assert.deepEqual(w.enemies,[]);assert.deepEqual(w.fragmentQueue,[]);assert.deepEqual(w.auxiliaries,[]);assert.equal(w.wave,null);
 assert.equal(w.events.filter(e=>e.type==='clearKill').length,0);assert.equal(w.events.filter(e=>e.type==='shatter').length,1);
 for(let i=0;i<600;i++)w.step(1/120);assert.equal(w.enemies.length,0);assert.equal(w.phase,'boss');
});

test('inflation contacts require separation to shrink again and auxiliary hits retain the same collision contract',()=>{
 const w=boss(10);const original=w.boss.r;contact(w);const once=w.boss.r;assert.ok(once<original);contact(w);near(w.boss.r,once);
 separate(w);contact(w);assert.ok(w.boss.r<once);
 const a=w.makeBody(0,0,w.unit*.7,1);Object.assign(a,{isPlayer:true,isAuxiliary:true,hp:Infinity,sourceMass:w.player.mass});w.auxiliaries.push(a);
 const before=w.boss.r;contact(w,a);assert.ok(w.boss.r<before);
 const radius=w.boss.r;separate(w);Object.assign(w.player,{x:w.boss.x-w.bossRadius-w.player.r+.01,y:w.boss.y,vx:w.unit*2.4,vy:0});w.collideBoss();near(w.boss.r,radius);
});











test('Boss hit-stop is local, respects strength zero and reduced motion, and entering stun keeps the old grace',()=>{
 for(const [strength,reduced,max] of [[0,false,0],[1,false,.1],[1,true,.05]]){const w=boss(10);w.setFeedbackOptions({strength,reducedMotion:reduced});contact(w);near(w.player.feedbackFreeze,max);near(w.boss.feedbackFreeze,max);}
 const w=boss(5);w.setFeedbackOptions({strength:1});w.boss.r=w.boss.minRadius+.001;w.damageBoss(w.unit*30);near(w.player.feedbackFreeze,.15);assert.equal(w.boss.stunned,true);assert.equal(w.boss.stunDeadline,undefined);
});

test('victory has half a real second of slow motion before the old crown and two reward rounds',()=>{
 const w=boss(10);w.gamblerRewardPending=true;const e=body(w);w.player.vx=w.unit*10;
 Object.assign(w.boss,{stunned:true,r:w.boss.minRadius,hp:1,maxHp:1});w.damageBoss(w.unit*30);assert.equal(w.phase,'boss-celebrate');assert.ok(w.enemies.includes(e));
 w.step(.124,false,{timeScale:.25});assert.ok(w.bossVictorySlowTime>0);assert.equal(w.events.some(e=>e.type==='bossCelebrate'),false);
 w.step(.001,false,{timeScale:.25});assert.equal(w.bossVictorySlowTime,0);near(w.phaseTime,0);w.step(BOSS_TIMING.brake+BOSS_TIMING.spin+BOSS_TIMING.hold+BOSS_TIMING.fade+.001);
 assert.equal(w.rewardSelectionsRemaining,2);assert.equal(w.choices.length,5);assert.equal(w.enemies.length,0);assert.equal(w.stage,10);
 pick(w);assert.equal(w.stage,10);assert.equal(w.rewardSelectionsRemaining,1);assert.equal(w.choices.length,3);pick(w);assert.equal(w.stage,11);assert.equal(w.phase,'battle');
});

test('both exhausted Boss reward rounds finish without a fake upgrade or multiple stage increments',()=>{
 const w=boss(10);for(const d of UPGRADE_DEFINITIONS)w.buffs[d.id]=d.maxStacks;victory(w);assert.equal(w.phase,'reward');w.step(1.001);assert.equal(w.stage,10);assert.equal(w.phase,'reward');w.step(1.001);assert.equal(w.stage,11);assert.equal(w.phase,'battle');assert.equal(w.events.filter(e=>e.type==='upgradeSkipped').length,2);
});

test('one regular starting choice immediately starts stage one with six enemies and the next-shot boost',()=>{
 const w=run();assert.ok(w.beginStartingUpgrades());assert.equal(w.enemies.length,0);assert.equal(w.rewardSelectionsRemaining,1);assert.equal(w.upgradeRoundTotal,1);assert.ok(w.choices.every(c=>c.pool==='regular'));pick(w);
 assert.equal(w.stage,1);assert.equal(w.phase,'battle');assert.equal(w.startingUpgrades,false);assert.equal(w.rewardSelectionsRemaining,0);assert.equal(w.liveCount,6);assert.equal(w.pendingUpgradeBoost,true);assert.equal(w.totalShots,0);near(w.time,0);near(w.elapsed,0);w.shoot(-w.maxPull,0);assert.equal(w.shotUpgradeBoost,true);assert.equal(w.totalShots,1);
 const campaign=run();campaign.mode='campaign';const phase=campaign.phase;assert.equal(campaign.beginStartingUpgrades(),false);assert.equal(campaign.phase,phase);
});

test('pre-Boss respite adds two seconds once to the full wave cycle and never changes floor timing',()=>{
 for(const stage of [2,3,4,5,8,9,10]){const w=run(stage);const extra=[3,4].includes(stage%5)?2:0;near(w.waveInterval,w.waveSize*w.spawnInterval+extra);w.applyUpgrade('frenzy');near(w.waveInterval,w.waveSize*w.spawnInterval*.7+extra);}
});

test('stats count only successful combat shots and real kills, excluding clearing and rescue',()=>{
 const w=run();w.shoot(1,1);assert.equal(w.totalShots,0);w.shoot(-w.maxPull,0);w.damage(body(w,{hp:1}),1);w.damage(body(w,{hp:1}),1);assert.equal(w.maxCombo,2);assert.equal(w.totalKills,2);
 const e=body(w);w.pendingClearing={x:e.x,y:e.y};w.beginClearing();w.step(.01);assert.equal(w.totalKills,2);assert.equal(w.totalShots,1);const elapsed=w.elapsed;w.step(.3);near(w.elapsed,elapsed);
 const b=boss(10);Object.assign(b.boss,{stunned:true,r:b.boss.minRadius,hp:1,maxHp:1});b.damageBoss(b.unit*30);assert.equal(b.totalKills,1);assert.equal(b.maxCombo,1);
});


test('time spent choosing starting upgrades does not age the first battle enemies',()=>{
 const w=run();w.beginStartingUpgrades();w.step(80);assert.equal(w.phase,'choose');near(w.elapsed,0);w.choose(w.choices[0]);w.step(1);
 assert.equal(w.stage,1);near(w.time,0);for(const b of w.enemies){near(b.hp,19);near(b.density,.71);}
});


test('Boss entry collision radius shares the visible 600 ms smooth growth and local hold clock',()=>{
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
 for(const time of [.1,.3,.6]){const w=run(5);w.beginBoss();Object.assign(w.player,{x:50,y:50});w.step(time);near(w.bossRadius,w.boss.r*smooth(time/.6));}
 const w=run(5);w.beginBoss();Object.assign(w.player,{x:50,y:50});w.step(.3);w.setFeedbackOptions({strength:1});w.damageBoss(w.unit*30);
 const entry=w.boss.entryElapsed, radius=w.bossRadius;w.step(.1);near(w.boss.entryElapsed,entry);near(w.bossRadius,radius);assert.ok(w.phaseTime>entry);w.step(.05);assert.ok(w.bossRadius>radius);
});


test('a pending gambler cannot spend a second layer in the same Boss reward sequence',()=>{
 const w=boss(10);victory(w);pick(w,'gambler');assert.equal(w.buffs.gambler,1);assert.equal(w.nextGambler,true);assert.ok(!w.choices.some(c=>c.id==='gambler'));
 w.step(2);assert.equal(w.phase,'choose');assert.equal(w.choose(UPGRADES.gambler),false);assert.equal(w.buffs.gambler,1);assert.ok(w.choose(w.choices[0]));w.step(1.001);
 assert.equal(w.stage,11);assert.equal(w.nextGambler,false);assert.equal(w.killTarget,Math.ceil((14+4*10)*1.5));w.beginUpgrade();assert.ok(w.choices.some(c=>c.id==='gambler'));w.step(2);assert.ok(w.choose(UPGRADES.gambler));assert.equal(w.buffs.gambler,2);
});


test('inflation shell contracts 1.5 times as far after an actual wall rebound in the same shot',()=>{
 const plain=boss(5), banked=boss(5);const before=plain.boss.r;
 Object.assign(banked.player,{x:0,y:50,vx:-banked.unit*30,vy:0});banked.wall(banked.player);assert.equal(banked.shotBanked,true);assert.equal(banked.buffs.bank,undefined);
 contact(plain);contact(banked);near(before-banked.boss.r,(before-plain.boss.r)*1.5);
 banked.shoot(-banked.maxPull,0);assert.equal(banked.shotBanked,false);
});

test('inflation stun damage stacks the shared wall bonus with bank charges for both main and auxiliary collisions',()=>{
 for(const auxiliary of [false,true]){
  const w=boss(5);Object.assign(w.boss,{stunned:true,r:w.boss.minRadius,hp:1e6,maxHp:1e6});w.shotBanked=true;
  let actor=w.player;if(auxiliary){actor=w.makeBody(0,0,w.unit*.7,1.5);Object.assign(actor,{isPlayer:true,isAuxiliary:true,hp:Infinity,sourceMass:w.player.mass,bank:2});w.auxiliaries.push(actor);}else w.bank=2;
  const reference=auxiliary?30/.6:30;const expected=Math.round(.5*w.player.mass*reference**2*.31*2.2*(auxiliary?.6:1)*1.5);
  contact(w,actor);assert.equal(1e6-w.boss.hp,expected);assert.equal(auxiliary?actor.bank:w.bank,0);
 }
});

test('the banked-collision weakness never changes a shockwave',()=>{
 const plain=boss(5), banked=boss(5);banked.shotBanked=true;const r=plain.boss.r;
 plain.damageBoss(plain.unit*30,{source:'shockwave'});banked.damageBoss(banked.unit*30,{source:'shockwave'});near(r-banked.boss.r,r-plain.boss.r);
 Object.assign(banked.boss,{stunned:true,r:banked.boss.minRadius,hp:1000,maxHp:1000});banked.bank=2;banked.damageBoss(banked.unit*30,{source:'shockwave',damageOverride:17,preserveBank:true});assert.equal(banked.boss.hp,983);assert.equal(banked.bank,2);
});
