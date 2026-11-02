import test from 'node:test';
import assert from 'node:assert/strict';
import {World, bossConfig, length, BOSS_TIMING} from '../dist/physics.js';
import {CampaignWorld} from '../dist/campaign.js';

const near=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
const advance=(world,seconds)=>{let left=seconds;while(left>1e-10){const dt=Math.min(left,1/120);world.step(dt);left-=dt;}};
function entry(stage=5,width=900,height=700){
  const w=new World(width,height,()=>.5);w.stage=stage;w.score=w.target;w.events=[];w.step(1/120);return w;
}
function ready(stage=5,width=900,height=700){const w=entry(stage,width,height);advance(w,BOSS_TIMING.entry);assert.equal(w.phase,'boss');w.events=[];return w;}
function strike(w,speed=w.baseSpeed*.5){
  const p=w.player,b=w.boss;
  Object.assign(p,{x:b.x,y:b.y+b.r+p.r-.01,vx:0,vy:-speed});w.collideBoss();
}
function defeat(w){let hits=0;while(w.phase==='boss'&&hits++<200)strike(w,w.baseSpeed);assert.equal(w.phase,'boss-celebrate');return hits;}

test('stages 5 and 10 clear survivors without credit, then place the player before boss attacks',()=>{
  for(const stage of [5,10]){
    const w=new World(390,844,()=>.5);w.stage=stage;w.score=w.target;
    const originalScore=w.score,survivors=w.enemies.length,original={x:w.player.x,y:w.player.y};w.events=[];
    w.step(1/120);assert.equal(w.phase,'boss-entry');assert.equal(w.enemies.length,0);assert.equal(w.choices.length,0);
    assert.equal(w.score,originalScore);assert.equal(w.events.filter(e=>e.type==='kill').length,0);
    assert.equal(w.events.filter(e=>e.type==='shatter').length,survivors);assert.equal(w.events.filter(e=>e.type==='bossEntry').length,1);
    assert.equal(w.events.filter(e=>e.type==='upgrade').length,0);assert.equal(w.boss.born,0);assert.equal(w.ready,false);
    near(w.player.x,original.x);near(w.player.y,original.y);
    const initial=w.boss.r;advance(w,.4);assert.ok(w.boss.born>0&&w.boss.born<1);near(w.boss.r,initial);
    assert.equal(w.shoot(0,100),false);assert.equal(w.damageBoss(w.baseSpeed),false);
    advance(w,.45);assert.equal(w.phase,'boss');assert.equal(w.boss.born,1);assert.equal(w.boss.solid,true);
    near(w.player.x,w.width*.5);assert.ok(w.player.y>w.boss.y+w.boss.r+w.player.r);near(w.boss.r,initial);
    near(w.arenaBounds.width,w.arenaBounds.height);near(w.boss.x,w.width*.5);near(w.boss.y,w.height*.5);
    assert.equal(w.ready,true);assert.equal(w.events.filter(e=>e.type==='bossReady').length,1);
    assert.equal(w.stage,stage);assert.equal(w.choices.length,0);
  }
  for(const stage of [1,4,6,9]){const w=entry(stage);assert.equal(w.phase,'transition');assert.equal(w.boss,null);assert.equal(w.choices.length,2);}
});

test('a winning stage-five normal collision takes precedence over a full board and cannot damage cleared survivors',()=>{
  const w=new World(900,700,()=>.5);w.stage=5;w.score=w.target-10;w.enemies=[];w.events=[];w.buffs.pulse=1;
  Object.assign(w.player,{x:300,y:300,vx:900,vy:0});
  for(let i=0;i<18;i++){
    const b=w.makeBody(350+i*3,300,w.unit,.8);Object.assign(b,{hp:1,value:10,born:1,solid:true});w.enemies.push(b);
  }
  w.step(1/120);assert.equal(w.phase,'boss-entry');assert.equal(w.score,w.target);assert.equal(w.enemies.length,0);
  assert.equal(w.events.filter(e=>e.type==='kill').length,1);assert.equal(w.events.filter(e=>e.type==='over').length,0);
});

test('boss dimensions match reward-ball minimum and square limits independently of player growth',()=>{
  const first=bossConfig(5,20,400),second=bossConfig(10,20,400),fourth=bossConfig(20,20,400);
  near(first.initialRadius,96);near(first.minRadius,40);near(first.maxRadius,150);
  assert.equal(first.segmentValue,100);assert.equal(first.killValue,500);
  assert.equal(second.segmentValue,110);assert.equal(second.killValue,550);
  assert.ok(second.inflationRate>first.inflationRate&&fourth.inflationRate>second.inflationRate);
  assert.ok(second.shrinkDivisor>first.shrinkDivisor&&fourth.shrinkDivisor>second.shrinkDivisor);
  const w=new World(390,844,()=>.5);w.player.r*=1.4;w.stage=5;w.score=w.target;w.step(1/120);
  near(w.boss.minRadius,w.unit*2);near(w.boss.initialRadius,w.unit*4.8);assert.notEqual(w.boss.minRadius,w.player.r);
  assert.equal(w.boss.thresholds.length,5);near(w.boss.thresholds.at(-1),w.unit*2);
});

test('boss inflates only after entry and loses at 75 percent of the square side',()=>{
  const w=ready(),b=w.boss,start=b.r,deadline=(b.maxRadius-start)/b.inflationRate;
  near(b.maxRadius*2,w.arenaBounds.width*.75);advance(w,10);near(b.r,start+b.inflationRate*10);assert.equal(w.enemies.length,0);assert.equal(w.choices.length,0);
  advance(w,deadline-10-.1);assert.equal(w.phase,'boss');assert.ok(b.r<b.maxRadius);
  advance(w,.2);assert.equal(w.phase,'over');near(b.r,b.maxRadius);
  assert.equal(w.events.filter(e=>e.type==='over').length,1);assert.equal(w.damageBoss(w.baseSpeed),false);
  const radius=b.r;advance(w,5);near(b.r,radius);assert.equal(w.events.filter(e=>e.type==='over').length,1);
});

test('actual anchored collision reverses the normal speed, keeps the tangent and does not rehit while separating',()=>{
  const w=ready(),p=w.player,b=w.boss,initial=b.r,x=b.x,y=b.y;
  Object.assign(p,{x:b.x+b.r+p.r-.1,y:b.y,vx:-w.unit*20,vy:w.unit*3});
  w.collideBoss();near(p.vx,w.unit*20*.985);near(p.vy,w.unit*3);near(b.x,x);near(b.y,y);
  assert.ok(b.r<initial);assert.equal(w.events.filter(e=>e.type==='bossHit').length,1);
  p.x=b.x+b.r+p.r-.01;const radius=b.r;w.collideBoss();near(b.r,radius);
  assert.equal(w.events.filter(e=>e.type==='bossHit').length,1);
  Object.assign(p,{x:b.x+b.r+p.r-.01,y:b.y,vx:-w.unit*2,vy:0});w.collideBoss();
  assert.ok(p.vx>0);near(b.r,radius);assert.equal(w.events.filter(e=>e.type==='bossHit').length,1);
});

test('boss collisions ignore ordinary enemy knock-through and area-damage buffs',()=>{
  const w=ready(),b=w.boss,p=w.player;w.buffs.pierce=1;w.buffs.pulse=1;
  Object.assign(p,{x:b.x,y:b.y+b.r+p.r-.01,vx:0,vy:-w.baseSpeed});w.collideBoss();
  assert.ok(p.vy>0);assert.equal(w.events.filter(e=>e.type==='pulse').length,0);near(b.vx,0);near(b.vy,0);
});

test('boss flight retains speed with lower drag and adaptive steps catch high speed without a cap',()=>{
  const w=ready(5,10000,10000),p=w.player;
  Object.assign(p,{x:8000,y:7000,vx:w.maxPhysicsSpeed*2,vy:0});const speed=length(p);
  w.step(.02);near(length(p),speed*Math.exp(-.04*.02));assert.ok(length(p)>w.maxPhysicsSpeed);
  for(const [width,height] of [[390,844],[844,390],[1440,900]]){
    const run=ready(5,width,height),boss=run.boss;
    Object.assign(run.player,{x:boss.x,y:boss.y+boss.r+run.player.r+run.unit*2,vx:0,vy:-run.unit*120});
    const radius=boss.r;run.step(.03);assert.ok(boss.r<radius);assert.ok(run.player.vy>0);
    assert.ok(Math.hypot(run.player.x-boss.x,run.player.y-boss.y)>=run.player.r+boss.r-1e-5);
  }
});

test('a genuine hit on the inflation-limit frame saves the run before failure is decided',()=>{
  const w=ready(),b=w.boss,p=w.player;b.r=b.maxRadius-.001;
  Object.assign(p,{x:b.x,y:b.y+b.r+p.r+.01,vx:0,vy:-w.baseSpeed});w.step(1/120);
  assert.equal(w.phase,'boss');assert.ok(b.r<b.maxRadius);assert.equal(w.events.filter(e=>e.type==='over').length,0);
});

test('each of five score segments is credited once across shrink-regrow crossings and the kill adds its own bonus',()=>{
  for(const stage of [5,10]){
    const w=ready(stage),b=w.boss,startScore=w.score,startTarget=w.target;
    while(b.scoredSegments<1)strike(w);
    assert.equal(w.score-startScore,b.segmentValue);assert.equal(w.target-startTarget,b.segmentValue);
    b.r=b.initialRadius;
    while(b.r>b.thresholds[0])strike(w);
    assert.equal(b.scoredSegments,1);assert.equal(w.events.filter(e=>e.type==='bossScore').length,1);
    defeat(w);
    const credits=w.events.filter(e=>e.type==='bossScore');assert.deepEqual(credits.map(e=>e.segment),[1,2,3,4,5]);
    assert.ok(credits.every(e=>e.value===b.segmentValue));assert.equal(w.events.filter(e=>e.type==='bossDefeated').length,1);
    assert.equal(w.events.find(e=>e.type==='bossDefeated').value,b.killValue);
    assert.equal(w.score-startScore,b.segmentValue*5+b.killValue);assert.equal(w.target-startTarget,b.segmentValue*5+b.killValue);
    assert.equal(w.damageBoss(w.baseSpeed),false);assert.equal(b.scoredSegments,5);assert.equal(w.stage,stage);
  }
});

test('ordinary half-speed incoming hits need sustained shrinking followed by a distinct finishing hit',()=>{
  const w=ready(),start=w.boss.r;let hits=0,shrinkHits=null;
  while(w.phase==='boss'&&hits<100){strike(w,w.baseSpeed*.5);hits++;if(w.boss.stunned&&shrinkHits===null)shrinkHits=hits;if(w.phase==='boss'){w.player.vx=w.player.vy=0;advance(w,.6);}}
  assert.equal(w.phase,'boss-celebrate');assert.ok(shrinkHits>=30&&shrinkHits<=40,`shrink hits=${shrinkHits}`);
  assert.ok(hits-shrinkHits>=2&&hits-shrinkHits<=12,`finishing half-speed hits=${hits-shrinkHits}`);
  assert.ok(w.boss.r<start);assert.equal(w.events.filter(e=>e.type==='bossHit').length,hits);
});

test('minimum-size boss locks its radius, becomes stunned, then needs ordinary impact damage to die',()=>{
  const w=ready(),boss=w.boss;boss.r=boss.minRadius+.001;
  w.damageBoss(w.baseSpeed);
  assert.equal(w.phase,'boss');assert.equal(boss.stunned,true);near(boss.r,w.unit*2);
  assert.equal(boss.hp,boss.maxHp);assert.ok(Number.isFinite(boss.hp));assert.equal(boss.stunnedTime,0);
  assert.equal(w.events.filter(e=>e.type==='bossStunned').length,1);
  assert.equal(w.events.filter(e=>e.type==='bossDefeated').length,0);
  const radius=boss.r,hp=boss.hp;w.player.vx=w.player.vy=0;advance(w,2);
  near(boss.r,radius);near(boss.stunnedTime,2);assert.equal(boss.hp,hp);
  const incoming=w.baseSpeed,damage=Math.round(.5*w.player.mass*(incoming/w.unit)**2*.31);
  w.damageBoss(incoming);assert.equal(boss.hp,hp-damage);assert.equal(w.phase,'boss');near(boss.r,radius);
  w.damageBoss(incoming);assert.equal(w.phase,'boss');assert.equal(boss.hp,hp-damage*2);
  w.damageBoss(incoming);assert.equal(w.phase,'boss-celebrate');assert.equal(boss.hp,0);
  assert.equal(w.events.filter(e=>e.type==='bossDefeated').length,1);
});

test('defeat preserves velocity, brakes smoothly, then spins and holds before restoring the original arena for rewards',()=>{
  const w=ready(),boss=w.boss;
  boss.r=boss.minRadius+.001;w.damageBoss(w.baseSpeed);
  Object.assign(w.player,{x:w.width*.5,y:w.height*.5,vx:w.unit*8,vy:-w.unit*3});
  const start={x:w.player.x,y:w.player.y,vx:w.player.vx,vy:w.player.vy};
  while(w.phase==='boss')w.damageBoss(w.baseSpeed);
  assert.equal(w.phase,'boss-celebrate');near(w.player.x,start.x);near(w.player.y,start.y);
  near(w.player.vx,start.vx);near(w.player.vy,start.vy);assert.equal(w.ready,false);assert.equal(w.choices.length,0);
  w.step(1/120);const retained=(1-(1/120)/BOSS_TIMING.brake)**2;
  near(w.player.vx,start.vx*retained);near(w.player.vy,start.vy*retained);
  assert.ok(length(w.player)>Math.hypot(start.vx,start.vy)*.97,'the first frame does not abruptly stop or reset velocity');
  advance(w,BOSS_TIMING.brake-1/120);assert.equal(w.player.vx,0);assert.equal(w.player.vy,0);
  near(w.player.x,start.x+start.vx*BOSS_TIMING.brake/3);near(w.player.y,start.y+start.vy*BOSS_TIMING.brake/3);
  assert.equal(w.events.filter(e=>e.type==='bossCelebrate').length,1);
  const stop={x:w.player.x,y:w.player.y};
  advance(w,BOSS_TIMING.spin/2);near(w.player.roll,Math.PI);near(w.player.x,stop.x);near(w.player.y,stop.y);
  advance(w,BOSS_TIMING.spin/2);near(w.player.roll,Math.PI*2);
  advance(w,BOSS_TIMING.hold);assert.equal(w.phase,'boss-celebrate');near(w.player.x,stop.x);near(w.player.y,stop.y);
  assert.equal(w.choices.length,0);near(w.arenaBounds.width,w.arenaBounds.height);
  advance(w,BOSS_TIMING.fade);assert.equal(w.phase,'transition');assert.equal(w.player.roll,undefined);assert.equal(w.boss,null);
  near(w.arenaBounds.width,w.arenaBounds.height);assert.equal(w.stage,5);assert.equal(w.choices.length,2);
  const square=w.arenaBounds;advance(w,BOSS_TIMING.entry/2);
  assert.ok(w.arenaBounds.width>square.width&&w.arenaBounds.width<w.width-2*w.inset);
  advance(w,BOSS_TIMING.entry/2);near(w.arenaBounds.left,w.inset);near(w.arenaBounds.top,w.inset);
  advance(w,1.01);assert.equal(w.phase,'choose');const score=w.score,target=w.target;
  w.choose(w.choices[0]);advance(w,1.01);assert.equal(w.stage,6);assert.equal(w.phase,'battle');
  assert.equal(w.score,score);assert.equal(w.target,target+140+6*50);assert.equal(w.boss,null);
});

test('braking near a wall uses real rebound without a clamped-endpoint velocity jump',()=>{
  const w=ready(),boss=w.boss;boss.r=boss.minRadius+.001;w.damageBoss(w.baseSpeed);
  const bounds=w.arenaBounds,p=w.player;
  Object.assign(p,{x:bounds.right-p.r-.5,y:w.height*.5,vx:w.unit*30,vy:w.unit*2});
  const velocity=p.vx;while(w.phase==='boss')w.damageBoss(w.baseSpeed);near(p.vx,velocity);
  w.step(.002);assert.ok(p.vx<0);assert.ok(Math.abs(p.vx)>velocity*.9);
  for(let i=0;i<100;i++){
    w.step(1/120);assert.ok(p.x>=bounds.left+p.r&&p.x<=bounds.right-p.r);assert.ok(p.y>=bounds.top+p.r&&p.y<=bounds.bottom-p.r);
  }
  assert.equal(p.vx,0);assert.equal(p.vy,0);const stop={x:p.x,y:p.y};advance(w,.2);near(p.x,stop.x);near(p.y,stop.y);
});

test('boss resize preserves entry, square geometry, thresholds, stunned health, and celebration timing',()=>{
  const w=entry();advance(w,.4);const clock=w.phaseTime,born=w.boss.born;w.resize(390,844);
  assert.equal(w.phase,'boss-entry');near(w.phaseTime,clock);near(w.boss.born,born);near(w.boss.r,w.unit*4.8);
  advance(w,.45);assert.equal(w.phase,'boss');while(w.boss.scoredSegments<2)strike(w);
  const boss=w.boss,ratios=['r','initialRadius','minRadius','inflationRate'].map(key=>boss[key]/w.unit),segments=boss.scoredSegments;
  const relative={x:w.player.x-w.width/2,y:w.player.y-w.height/2};w.resize(844,390);
  assert.equal(w.phase,'boss');assert.equal(boss.scoredSegments,segments);near(w.arenaBounds.width,w.arenaBounds.height);
  ['r','initialRadius','minRadius','inflationRate'].forEach((key,i)=>near(boss[key]/w.unit,ratios[i]));
  near(boss.maxRadius,w.arenaBounds.width*.375);near(w.player.x-w.width/2,relative.x);near(w.player.y-w.height/2,relative.y);
  while(!boss.stunned)strike(w);advance(w,.3);const hp=boss.hp,stunTime=boss.stunnedTime;w.resize(320,568);
  near(boss.r,w.unit*2);assert.equal(boss.hp,hp);near(boss.stunnedTime,stunTime);near(boss.maxRadius,w.arenaBounds.width*.375);
  defeat(w);advance(w,BOSS_TIMING.brake+.2);const elapsed=w.phaseTime,roll=w.player.roll;w.resize(390,844);
  near(w.phaseTime,elapsed);near(w.player.roll,roll);assert.equal(w.player.vx,0);assert.equal(w.player.vy,0);
  const stop={x:w.player.x,y:w.player.y};advance(w,.1);near(w.player.x,stop.x);near(w.player.y,stop.y);
  advance(w,BOSS_TIMING.spin+BOSS_TIMING.hold+BOSS_TIMING.fade-.3);assert.equal(w.phase,'transition');
});

test('campaign levels never gain boss phases and a fresh endless run has no boss residue',()=>{
  for(const level of [5,10,100]){
    const w=new CampaignWorld(390,844,level,()=>.5);assert.equal(w.boss,null);
    while(w.phase==='battle'){
      if(!w.enemies.some(b=>b.hp>0))w.spawnEnemy();
      const b=w.enemies.find(b=>b.hp>0);w.damage(b,1e9);w.enemies=w.enemies.filter(b=>b.hp>0);
    }
    assert.equal(w.completed,true);assert.equal(w.boss,null);assert.ok(!w.events.some(e=>e.type.startsWith('boss')));
  }
  const w=new World(390,844,()=>.5);assert.equal(w.boss,null);assert.equal(w.bossCelebration,null);assert.equal(w.player.roll,undefined);
});

test('near-limit bosses keep grown players outside the boss and inside every square wall',()=>{
  for(const [width,height] of [[320,568],[390,844],[844,390]])for(const side of ['top','bottom','left','right']){
    const w=ready(5,width,height),boss=w.boss,p=w.player,bounds=w.arenaBounds;p.r=w.unit*1.4;
    boss.r=boss.maxRadius-.1;
    Object.assign(p,{x:side==='left'?bounds.left+p.r:side==='right'?bounds.right-p.r:boss.x,
      y:side==='top'?bounds.top+p.r:side==='bottom'?bounds.bottom-p.r:boss.y,vx:0,vy:0});
    for(let frame=0;frame<10&&w.phase==='boss';frame++){
      w.step(1/120);
      assert.ok(Math.hypot(p.x-boss.x,p.y-boss.y)>=p.r+boss.r-1e-7);
      assert.ok(p.x>=bounds.left+p.r&&p.x<=bounds.right-p.r);
      assert.ok(p.y>=bounds.top+p.r&&p.y<=bounds.bottom-p.r);
    }
    assert.equal(w.events.filter(e=>e.type==='bossHit').length,0);
  }
});

test('a normal stage-five build wins through real shots and rebounds in under 20 seconds without an instant kill',()=>{
  for(const [width,height] of [[390,844],[844,390]]){
    const w=new World(width,height,()=>.5);
    w.stage=5;w.score=w.target;w.density=1.35**2;w.energy=1.3**2;
    w.player.density=1.5*w.density;w.player.mass=w.player.density;
    while(w.phase!=='boss')w.step(1/120);
    w.events=[];const startScore=w.score;
    let hits=0,shots=0,elapsed=0,pulling=0;
    while(w.phase==='boss'&&elapsed<20){
      if(pulling===0&&w.ready){assert.equal(w.beginPull(),true);pulling=.12;shots++;}
      if(pulling>0){
        pulling-=1/120;
        if(pulling<=0){
          pulling=0;
          const dx=w.player.x-w.boss.x,dy=w.player.y-w.boss.y,distance=Math.hypot(dx,dy);
          assert.equal(w.shoot(dx/distance*w.maxPull,dy/distance*w.maxPull),true);
        }
      }
      // Only normal input and integration: no repositioning or direct damage.
      w.step(1/120,pulling>0);elapsed+=1/120;
      hits+=w.events.splice(0).filter(e=>e.type==='bossHit').length;
    }
    assert.equal(w.phase,'boss-celebrate',`${width}x${height}: ${elapsed}s, ${hits} hits`);
    assert.ok(elapsed<20&&elapsed>2);assert.ok(hits>=25&&hits<=35&&shots>=1);
    assert.equal(w.score-startScore,1000);
  }
});

test('arena contraction, physical walls, and the extra re-aim threshold apply only to the boss',()=>{
  for(const [width,height] of [[390,844],[844,390]]){
    const w=new World(width,height,()=>.5);w.stage=5;const ordinary=w.readySpeed,full=w.arenaBounds;
    w.score=w.target;w.step(1/120);assert.deepEqual(w.arenaBounds,full);
    advance(w,BOSS_TIMING.entry/2);const halfway=w.arenaBounds;
    assert.ok(halfway.width<full.width||halfway.height<full.height);
    assert.ok(halfway.width!==halfway.height);advance(w,BOSS_TIMING.entry/2);
    const bounds=w.arenaBounds;near(bounds.width,Math.min(width,height)-2*w.inset);near(bounds.width,bounds.height);
    near((bounds.left+bounds.right)/2,width/2);near((bounds.top+bounds.bottom)/2,height/2);
    near(w.readySpeed,ordinary+w.unit*12);
    w.player.vx=w.unit*19;w.player.vy=0;assert.equal(w.ready,true);
    for(const side of ['left','right','top','bottom']){
      const p=w.player;Object.assign(p,{x:width/2,y:height/2,vx:0,vy:0});
      if(side==='left'){p.x=bounds.left+p.r-1;p.vx=-100;}
      if(side==='right'){p.x=bounds.right-p.r+1;p.vx=100;}
      if(side==='top'){p.y=bounds.top+p.r-1;p.vy=-100;}
      if(side==='bottom'){p.y=bounds.bottom-p.r+1;p.vy=100;}
      w.wall(p);assert.ok(p.x>=bounds.left+p.r&&p.x<=bounds.right-p.r&&p.y>=bounds.top+p.r&&p.y<=bounds.bottom-p.r);
      near(length(p),92);
    }
    const campaign=new CampaignWorld(width,height,5,()=>.5);assert.deepEqual(campaign.arenaBounds,full);near(campaign.readySpeed,campaign.unit*8);
  }
});

test('reward placement stays inside the physically restoring arena on a tall viewport',()=>{
  const w=ready(5,390,1000),boss=w.boss,p=w.player;
  boss.r=boss.minRadius+.001;w.damageBoss(w.baseSpeed);
  const square=w.arenaBounds;Object.assign(p,{x:square.right-p.r,y:square.bottom-p.r,vx:0,vy:0});
  while(w.phase==='boss')w.damageBoss(w.baseSpeed);
  advance(w,BOSS_TIMING.brake+BOSS_TIMING.spin+BOSS_TIMING.hold+BOSS_TIMING.fade);
  assert.equal(w.phase,'transition');
  for(let frame=0;frame<230&&w.phase==='transition';frame++){
    w.step(1/120);const bounds=w.arenaBounds;
    assert.ok(p.x>=bounds.left+p.r&&p.x<=bounds.right-p.r);
    assert.ok(p.y>=bounds.top+p.r&&p.y<=bounds.bottom-p.r);
  }
  assert.equal(w.phase,'choose');near(w.arenaBounds.top,w.inset);near(w.arenaBounds.bottom,w.height-w.inset);
});

test('resizing a swollen boss preserves its remaining growth allowance instead of failing at a smaller square',()=>{
  const w=ready(5,1440,900),boss=w.boss;
  boss.r=boss.initialRadius+.7*(boss.maxRadius-boss.initialRadius);
  w.resize(320,568);
  near((boss.r-boss.initialRadius)/(boss.maxRadius-boss.initialRadius),.7);
  near(boss.maxRadius,(320-2*w.inset)*.375);assert.ok(boss.r<boss.maxRadius);
  w.step(1/120);assert.equal(w.phase,'boss');
});

test('stunned health is a one-time build snapshot and ordinary damage remains uncapped',()=>{
  for(const [density,energy,bank] of [[1,1,false],[1.35**2,1.3**2,false],[1,1.3**4,false],[1,1,true]]){
    const w=ready(),boss=w.boss;w.density=density;w.energy=energy;w.player.mass=1.5*density;
    if(bank)w.buffs.bank=1;
    boss.r=boss.minRadius+.001;w.damageBoss(w.baseSpeed);
    const hp=boss.hp,maximumLaunch=Math.min(w.unit*60,w.baseSpeed*Math.sqrt(energy/density))+w.readySpeed;
    w.bank=bank?2:0;
    const strongestDamage=Math.round(.5*w.player.mass*(maximumLaunch/w.unit)**2*.31*(bank?2.2:1));
    w.damageBoss(maximumLaunch);
    assert.equal(w.phase,'boss');assert.ok(boss.hp>0,'a legal maximum-strength first hit leaves the stunned boss alive');
    assert.equal(boss.hp,hp-strongestDamage);assert.equal(boss.maxHp,hp);
    const remaining=boss.hp;w.energy*=10;w.density*=2;advance(w,.2);
    assert.equal(boss.hp,remaining);assert.equal(boss.maxHp,hp,'health is not recomputed after entering stun');
    w.damageBoss(maximumLaunch*10);
    assert.equal(w.phase,'boss-celebrate','a sufficiently large damage value can finish immediately; there is no hit-count or damage cap');
  }
});

test('bank builds retain multiple real finishing impacts without extending the stunned fight beyond a few seconds',()=>{
  for(const [width,height] of [[390,844],[320,568],[1440,900]])for(const stage of [5,10]){
    for(const [densityStacks,energyStacks,growth] of [[2,2,1],[0,4,1],[4,0,1.4]]){
      const w=new World(width,height,()=>.5);
      w.stage=stage;w.score=w.target;w.density=1.35**densityStacks;w.energy=1.3**energyStacks;
      w.player.mass=w.player.density=1.5*w.density;w.player.r*=growth;w.buffs.bank=1;
      while(w.phase!=='boss')w.step(1/120);
      w.events=[];const startScore=w.score;
      let elapsed=0,pulling=0,stunAt=null,finishingHits=0,aliveAfterFirst=false;
      while(w.phase==='boss'&&elapsed<60){
        if(pulling===0&&w.ready){assert.equal(w.beginPull(),true);pulling=.12;}
        if(pulling>0){
          pulling-=1/120;
          if(pulling<=0){
            pulling=0;const dx=w.player.x-w.boss.x,dy=w.player.y-w.boss.y,distance=Math.hypot(dx,dy);
            assert.equal(w.shoot(dx/distance*w.maxPull,dy/distance*w.maxPull),true);
          }
        }
        w.step(1/120,pulling>0);elapsed+=1/120;
        for(const event of w.events.splice(0)){
          if(event.type==='bossStunned')stunAt=elapsed;
          if(event.type==='bossHit'&&event.damage>0){
            finishingHits++;
            if(finishingHits===1)aliveAfterFirst=w.phase==='boss'&&w.boss.hp>0;
          }
        }
      }
      assert.equal(w.phase,'boss-celebrate');assert.equal(aliveAfterFirst,true);
      assert.ok(finishingHits>=2);assert.ok(stunAt!==null&&elapsed-stunAt<5,`${width}x${height}, stage ${stage}: ${elapsed-stunAt}s`);
      assert.equal(w.score-startScore,stage===5?1000:1100);
    }
  }
});
