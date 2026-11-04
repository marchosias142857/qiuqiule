import test from 'node:test';
import assert from 'node:assert/strict';
import {World,BOSS_TIMING,length} from '../dist/physics.js';
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
function world(width=390,height=844,stage=5){const w=new World(width,height,()=>.4,{spawnInitial:false});w.stage=stage;w.spawnTimer=w.floorTimer=w.introTimer=Infinity;return w;}
function enter(w=world()){w.beginBoss();w.step(BOSS_TIMING.entry);assert.equal(w.phase,'boss');return w;}
function enemy(w,values={}){const b=w.makeBody(w.width/2,w.height/3,w.unit*.7,1);Object.assign(b,{hp:100,maxHp:100,born:1,solid:true,enemyType:'normal'},values);w.enemies.push(b);return b;}
function fit(w){const p=w.player,g=w.arenaGeometry,copy={...p};w.clampBodyToArena(copy);near(p.x,copy.x,1e-6);near(p.y,copy.y,1e-6);if(w.boss?.solid&&w.bossControl)assert.ok(Math.hypot(p.x-w.boss.x,p.y-w.boss.y)>=w.bossRadius+p.r-1e-6);assert.ok(p.x-p.r>=g.left-1e-6&&p.x+p.r<=g.right+1e-6&&p.y-p.r>=g.top-1e-6&&p.y+p.r<=g.bottom+1e-6);}

test('every encounter is the same inflation Boss and withdrawn type overrides cannot revive another mode',()=>{
 for(const stage of [5,10,15,20,50]){const w=world(390,844,stage);w.beginBoss({type:stage%10?'magnet':'splitter'});assert.equal(w.boss.bossType,'inflation');assert.equal(w.boss.hp,Infinity);assert.equal(w.boss.index,stage/5);assert.equal(w.spawnBossChild,undefined);assert.equal(w.bossAcceleration,undefined);}
});

test('the real Boss route sweeps every survivor once before entry and preserves clearing score semantics',()=>{
 const w=world();w.applyUpgrade('risk');for(let i=0;i<3;i++)enemy(w,{x:80+i*80,y:150+i*100});w.stageKills=w.killTarget;w.pendingClearing={x:80,y:150};w.auxiliaries=[{hp:Infinity,isPlayer:true,isAuxiliary:true,r:w.unit*.7,x:50,y:50,vx:0,vy:0}];w.beginClearing();
 assert.equal(w.phase,'clearing');assert.equal(w.boss,null);assert.equal(w.auxiliaries.length,0);const target=w.stageKills;
 for(let i=0;i<240&&w.phase==='clearing';i++)w.step(1/120);
 assert.equal(w.phase,'boss-entry');assert.equal(w.enemies.length,0);assert.equal(w.score,45);assert.equal(w.stageKills,target);assert.equal(w.totalKills,0);assert.equal(w.shotKills,0);assert.equal(w.events.filter(e=>e.type==='clearKill').length,3);assert.equal(w.events.filter(e=>e.type==='bossEntry').length,1);
});

test('direct Boss entry clears enemy, auxiliary and queued children without adding a second clearing award',()=>{
 const w=world();enemy(w);w.fragmentQueue=[{x:100,y:100}];w.auxiliaries=[{isAuxiliary:true}];w.wave={size:4};w.beginBoss();assert.equal(w.enemies.length,0);assert.equal(w.auxiliaries.length,0);assert.equal(w.fragmentQueue.length,0);assert.equal(w.wave,null);assert.equal(w.score,0);assert.equal(w.events.filter(e=>e.type==='clearKill').length,0);assert.equal(w.events.filter(e=>e.type==='shatter').length,1);
});

test('entry and reward restoration keep straight walls and end in a real centered square',()=>{
 const w=world();w.beginBoss();w.step(.3);assert.equal(w.arenaGeometry.shape,'rect');assert.equal(w.arenaGeometry.cornerRadius,0);fit(w);w.step(BOSS_TIMING.entry-.3);assert.equal(w.arenaGeometry.shape,'square');near(w.arenaGeometry.cornerRadius,0);near(w.arenaBounds.width,w.arenaBounds.height);fit(w);
 w.boss.stunned=true;w.boss.r=w.boss.minRadius;w.boss.hp=1;w.damageBoss(w.unit*40);w.step(.125,false,{timeScale:.25});w.step(BOSS_TIMING.brake+BOSS_TIMING.spin+BOSS_TIMING.hold+BOSS_TIMING.fade+.001);assert.equal(w.phase,'transition');
 for(let i=0;i<240&&w.phase==='transition';i++){w.step(1/120);fit(w);}assert.equal(w.phase,'choose');assert.equal(w.arenaGeometry.shape,'rect');assert.equal(w.arenaGeometry.blend,0);assert.equal(w.choices.length,3);
});

test('square walls reflect each normal with .985 retention while preserving tangential motion',()=>{
 for(const [nx,ny] of [[-1,0],[1,0],[0,-1],[0,1]]){
  const w=enter(),p=w.player,g=w.arenaGeometry,normal=w.unit*20,tangent=w.unit*7;
  p.x=g.x+nx*(g.r-p.r+2);p.y=g.y+ny*(g.r-p.r+2);p.vx=nx*normal-ny*tangent;p.vy=ny*normal+nx*tangent;w.wall(p);
  near(p.vx*nx+p.vy*ny,-normal*.985);near(-p.vx*ny+p.vy*nx,tangent);fit(w);
  const e=w.events.filter(e=>e.type==='wall').at(-1);near(e.nx,nx);near(e.ny,ny);near(nx?e.contactX:e.contactY,nx?g.x+nx*g.r:g.y+ny*g.r);assert.equal(w.shotBanked,true);
 }
 const w=enter(),p=w.player,g=w.arenaGeometry;Object.assign(p,{x:g.right-p.r+1,y:g.bottom-p.r+1,vx:100,vy:70});w.wall(p);near(p.vx,-98.5);near(p.vy,-68.95);fit(w);
 // The square's corners are usable; a diagonal point outside the old circle
 // remains untouched rather than being projected radially inward.
 Object.assign(p,{x:g.right-p.r,y:g.bottom-p.r,vx:0,vy:0});const corner={x:p.x,y:p.y};w.clampBodyToArena(p);near(p.x,corner.x);near(p.y,corner.y);assert.ok(Math.hypot(p.x-g.x,p.y-g.y)+p.r>g.r);
});

test('Boss contact retains the legacy .985 normal bounce and its tangent component',()=>{
 const w=enter(),p=w.player,b=w.boss;p.x=b.x;p.y=b.y+w.bossRadius+p.r-.01;p.vx=w.unit*6;p.vy=-w.unit*20;w.collideBoss();near(p.vx,w.unit*6);near(p.vy,w.unit*20*.985);assert.ok(w.events.some(e=>e.type==='bossHit'));
});

test('Boss flight restores .04 drag without aim braking while normal battle retains the new drag law',()=>{
 for(const dragging of [false,true]){const w=enter();w.boss.solid=false;const p=w.player,g=w.arenaGeometry;p.x=g.x+(g.r+w.boss.r)/2;p.y=g.y;p.vx=0;p.vy=w.unit*5;const speed=length(p);w.step(.02,dragging);near(length(p),speed*Math.exp(-.04*.02));}
 for(const [speed,rate] of [[5,1.2],[30,.35]]){const w=world(2000,2000,1);w.player.x=w.player.y=1000;w.player.vx=w.unit*speed;w.step(.02,true);near(length(w.player),w.unit*speed*Math.exp(-rate*.02));}
});

test('Boss launches add bounded captured speed without reopening unlimited repeated acceleration',()=>{
 const w=enter(),p=w.player;p.vx=w.unit*100;p.vy=0;assert.ok(w.beginPull());assert.ok(w.shoot(-w.maxPull,0));near(length(p),w.baseSpeed+w.readySpeed);
 for(let i=0;i<100;i++)w.shoot(-w.maxPull,0);near(length(p),w.baseSpeed+w.readySpeed);
 for(let i=0;i<4;i++)w.applyUpgrade('energy');w.applyUpgrade('overspeed');w.applyUpgrade('overspeed');w.energy=100;w.shoot(-w.maxPull,0);near(length(p),w.launchCap+w.readySpeed);
 p.vx=w.unit*5;p.vy=0;w.beginPull();p.vx=w.unit*20;w.shoot(-w.maxPull,0);near(length(p),w.launchCap+w.unit*5);
});

test('fitted radii leave a real square corridor for two growth layers on narrow and rotated screens',()=>{
 for(const [width,height] of [[200,400],[320,568],[390,844],[844,390],[1364,936]]){const w=world(width,height);w.applyUpgrade('growth');w.applyUpgrade('growth');enter(w);const b=w.boss,R=w.arenaGeometry.r;near(b.maxRadius,Math.min(.75*R,R-2*w.player.r-.1*w.unit));assert.ok(b.minRadius<b.initialRadius&&b.initialRadius<b.maxRadius);assert.ok(R-b.maxRadius-2*w.player.r>0);b.r=b.maxRadius-.01;w.separateBossPlayer();fit(w);}
});

test('resize preserves both shrinking and inflation progress and keeps actors in the square corridor',()=>{
 for(const inflated of [false,true]){const w=enter();const b=w.boss;const fraction=.64;b.r=inflated?b.initialRadius+(b.maxRadius-b.initialRadius)*fraction:b.initialRadius-(b.initialRadius-b.minRadius)*fraction;w.separateBossPlayer();
 for(const [width,height] of [[320,568],[936,1364],[844,390]]){w.resize(width,height);const actual=inflated?(b.r-b.initialRadius)/(b.maxRadius-b.initialRadius):(b.initialRadius-b.r)/(b.initialRadius-b.minRadius);near(actual,fraction);fit(w);assert.equal(w.phase,'boss');}}
});

test('adaptive steps preserve repeated high-speed contacts in the thinnest supported side corridor',()=>{
 const w=world(320,568);w.applyUpgrade('growth');w.applyUpgrade('growth');enter(w);const b=w.boss,p=w.player;b.r=b.maxRadius-.2*w.unit;b.minRadius=b.r;b.stunned=true;b.hp=b.maxHp=1e9;b.thresholds=[];w.separateBossPlayer();p.vx=0;p.vy=-w.unit*180;
 for(let i=0;i<30;i++){w.step(1/60);fit(w);}assert.ok(w.events.filter(e=>e.type==='wall').length>10);assert.ok(w.events.filter(e=>e.type==='bossHit').length>10);assert.ok(Number.isFinite(length(p)));
});

test('one ordinary full launch repeatedly rebounds without the former high-drag collapse',()=>{
 const w=enter();w.setFeedbackOptions({strength:.6});w.player.x=w.boss.x;w.player.y=w.arenaGeometry.y+w.arenaGeometry.r-w.player.r;w.player.vx=w.player.vy=0;w.shoot(0,w.maxPull);
 for(let i=0;i<1200&&w.phase==='boss';i++)w.step(1/120);assert.ok(w.events.filter(e=>e.type==='wall').length>=15);assert.ok(w.events.filter(e=>e.type==='bossHit').length>=15);assert.ok(length(w.player)>w.unit*8);
});

test('stunned HP includes the legal wall multiplier and leaves a second full-strength impact',()=>{
 for(const upgrades of [[],['density'],['density','density','bank'],['bank'],['energy','energy','energy','energy','boomerang','bank','density','density']]){const w=enter();for(const id of upgrades)w.applyUpgrade(id);w.boss.r=w.boss.minRadius+.001;w.damageBoss(w.unit*30);assert.equal(w.boss.stunned,true);const hp=w.boss.hp;
 const speed=(Math.min(w.launchCap,w.baseSpeed*Math.sqrt(w.energy))+w.readySpeed)*(w.buffs.boomerang?1.3:1);w.shotBanked=true;w.bank=w.buffs.bank?2:0;w.damageBoss(speed);assert.ok(w.boss.hp>0&&w.boss.hp<hp);w.bank=w.buffs.bank?2:0;w.damageBoss(speed);assert.equal(w.phase,'boss-celebrate');}
});

test('bossKills persists through later play and defeat but resets with a fresh run',()=>{
 const w=enter();assert.equal(w.bossKills,0);assert.equal(w.hasDefeatedBoss,false);w.boss.stunned=true;w.boss.r=w.boss.minRadius;w.boss.hp=1;w.damageBoss(w.unit*40);assert.equal(w.bossKills,1);w.defeatBoss();assert.equal(w.bossKills,1);assert.equal(w.hasDefeatedBoss,true);w.phase='battle';w.endRun('capacity');assert.equal(w.bossKills,1);assert.equal(new World(390,844,()=>.4,{spawnInitial:false}).bossKills,0);
});

test('a final real Boss collision retains its incoming contact for a directional defeat burst',()=>{
 for(const [nx,ny] of [[1,0],[0,1],[-1,0],[0,-1]]){
  const w=enter(),p=w.player,b=w.boss;
  Object.assign(b,{r:b.minRadius,stunned:true,hp:1,maxHp:1,feedbackFreeze:0});
  Object.assign(p,{x:b.x-nx*(b.r+p.r-.01),y:b.y-ny*(b.r+p.r-.01),vx:nx*w.baseSpeed,vy:ny*w.baseSpeed,feedbackFreeze:0});
  const incoming={vx:p.vx,vy:p.vy},position={x:b.x-nx*b.r,y:b.y-ny*b.r},r=b.r;
  w.events=[];w.collideBoss();
  const hit=w.events.find(event=>event.type==='bossHit'),defeat=w.events.find(event=>event.type==='bossDefeated');
  assert.ok(hit&&defeat);near(defeat.nx,nx);near(defeat.ny,ny);
  near(defeat.contactX,position.x);near(defeat.contactY,position.y);
  near(defeat.impactVx,incoming.vx);near(defeat.impactVy,incoming.vy);near(defeat.impactSpeed,w.baseSpeed);
  assert.ok(p.vx*nx+p.vy*ny<0,'the stored burst must not use the outgoing rebound');
  near(defeat.r,r);near(defeat.referenceRadius,w.unit*.8);near(defeat.r/defeat.referenceRadius,2.5);
  for(const key of ['contactX','contactY','nx','ny','impactVx','impactVy','impactSpeed'])near(defeat[key],hit[key]);
  w.defeatBoss();assert.equal(w.events.filter(event=>event.type==='bossDefeated').length,1);
 }
});

test('direct and non-contact Boss defeats retain a finite surface origin without consuming spawn randomness',()=>{
 for(const direct of [false,true]){
  const w=enter(),b=w.boss,p=w.player;
  Object.assign(b,{r:b.minRadius,stunned:true,hp:1,maxHp:1});
  Object.assign(p,{x:b.x,y:b.y+b.r+p.r,vx:0,vy:-w.baseSpeed});
  w.random=()=>{throw new Error('defeat feedback must not roll enemy sizes');};w.events=[];
  if(direct)w.defeatBoss();else w.damageBoss(w.baseSpeed,{source:'shockwave'});
  const e=w.events.find(event=>event.type==='bossDefeated');assert.ok(e);
  for(const key of ['contactX','contactY','nx','ny','impactVx','impactVy','impactSpeed','referenceRadius'])assert.ok(Number.isFinite(e[key]),key);
  near(Math.hypot(e.contactX-b.x,e.contactY-b.y),b.r);near(e.nx,0);near(e.ny,-1);
  if(!direct)assert.equal(e.source,'shockwave');
 }
});
