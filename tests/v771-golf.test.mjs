import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld} from '../dist/campaign.js';
import {GOLF_LEVELS,golfRoute} from '../dist/classes/golf.js';
import {staticContact} from '../dist/campaign-collision.js';

const screens=[[390,844],[844,390],[320,568],[568,320]];
const fresh=(rank,width=390,height=844,upgradeId='rubber')=>new CampaignWorld(width,height,7+rank%2+10*(rank>>1),()=>.5,{upgradeId});
const finishShot=world=>{
  for(let frame=0;frame<1800 && world.shotActive && world.phase==='battle';frame++) {
    const scale=world.presentationTimeScale;world.step(scale/120,false,{timeScale:scale});
  }
  assert.equal(world.shotActive,false,'each real shot reaches a normal finish');
};
const putt=(world,target,power)=>{
  const angle=Math.atan2(target.y-world.player.y,target.x-world.player.x);
  assert.equal(world.shoot(-Math.cos(angle)*world.maxPull*power,-Math.sin(angle)*world.maxPull*power),true);
  finishShot(world);
};
function futureHole(world,time) {
  const hole=world.zones[0],board=world.golfLayout,axis=board.vertical?'x':'y',centre=board.hole[axis],amplitude=board.excursion;
  if(!amplitude)return {...hole};
  let offset=hole[axis]-centre+(axis==='x'?hole.vx:hole.vy)*time;
  // A player can lead the short, visibly bouncing track. This is only an
  // input decision: the real zone and all physical actors remain untouched.
  while(offset>amplitude || offset< -amplitude)offset=offset>amplitude?2*amplitude-offset:-2*amplitude-offset;
  return {...hole,[axis]:centre+offset};
}
function choosePutt(world) {
  const route=golfRoute(world);assert.ok(route.length,'there is an open route through the course');
  let target=route[0];const final=route.length===1;
  if(final && world.config.movingHole)for(let i=0;i<4;i++) {
    const d=Math.hypot(target.x-world.player.x,target.y-world.player.y)/world.unit;
    target=futureHole(world,Math.log((.6*d+6)/6)/.6);
  }
  const d=Math.hypot(target.x-world.player.x,target.y-world.player.y)/world.unit;
  const speed=.6*d+(final?6:3*Math.exp(-.6*.4));
  const power=Math.max(6.01/world.maxPull,Math.min(1,speed/40*Math.sqrt(world.density/world.energy)));
  return {target,power};
}

test('twenty authored golf courses have distinct geometry, strategy and increasing par',()=>{
  assert.equal(GOLF_LEVELS.length,20);
  assert.equal(new Set(GOLF_LEVELS.map(l=>l.id)).size,20);
  assert.equal(new Set(GOLF_LEVELS.map(l=>l.name)).size,20);
  assert.equal(new Set(GOLF_LEVELS.map(l=>JSON.stringify([l.start,l.hole,l.walls]))).size,20);
  for(const [rank,level] of GOLF_LEVELS.entries()) {
    assert.ok(level.strategy.length>=12);
    if(rank)assert.ok(level.par>=GOLF_LEVELS[rank-1].par);
    for(const [width,height] of [...screens,[1280,720]]) {
      const world=fresh(rank,width,height),route=golfRoute(world),b=world.arenaBounds;
      assert.ok(route.length,`${level.id} ${width}×${height} has a connected fairway`);
      for(const actor of [world.player,...world.zones]) {
        assert.ok(actor.x-actor.r>=b.left && actor.x+actor.r<=b.right);
        assert.ok(actor.y-actor.r>=b.top && actor.y+actor.r<=b.bottom);
        for(const wall of world.statics)assert.equal(staticContact(actor,wall),null,`${level.id}: start and hole clear`);
      }
      let previous=world.player;
      for(const waypoint of route) {
        for(let i=1;i<=64;i++) {
          const probe={...world.player,x:previous.x+(waypoint.x-previous.x)*i/64,y:previous.y+(waypoint.y-previous.y)*i/64};
          for(const wall of world.statics)assert.equal(staticContact(probe,wall),null,`${level.id}: route clears the ball radius`);
        }
        previous=waypoint;
      }
    }
  }
});

test('all twenty first-shot instructions are usable real pulls in portrait and landscape',()=>{
  for(const [width,height] of screens)for(let rank=0;rank<20;rank++)for(const upgrade of ['density','rubber','bank','steady']) {
    const world=fresh(rank,width,height,upgrade),target={...world.teachingTarget};
    putt(world,target,world.tutorialPullRatio);
    assert.equal(world.events.some(e=>e.type==='hit'),false,`${rank} ${width} ${upgrade}: hint clears the obstacle`);
    if(rank<3)assert.equal(world.completed,true,`${rank}: opening putt reaches the hole`);
    else assert.ok(Math.hypot(world.player.x-target.x,world.player.y-target.y)<world.unit*.35,`${rank} ${width} ${upgrade}: pull stops near the suggested turn`);
  }
});

test('160 complete golf runs use only real shots across every course, phone orientation and feedback setting',()=>{
  for(const strength of [0,.6])for(const [width,height] of screens)for(let rank=0;rank<20;rank++) {
    const world=fresh(rank,width,height).setFeedbackOptions({strength,reducedMotion:false});
    const originalTargets=world.statics.map(s=>[s.x,s.y,s.hp]),initialBudget=world.budget;
    while(world.ready) {const {target,power}=choosePutt(world);putt(world,target,power);}
    assert.equal(world.completed,true,`${rank} ${width}×${height}, feedback ${strength}`);
    assert.ok(world.shotsUsed<=initialBudget);assert.equal(world.remaining,initialBudget-world.shotsUsed);
    assert.deepEqual(world.statics.map(s=>[s.x,s.y,s.hp]),originalTargets,'play never relocates or destroys course geometry');
    assert.equal(world.score,100);assert.equal(world.targetsRemaining,0);
    assert.equal(world.events.filter(e=>e.type==='campaignGolfCapture').length,1);
    assert.equal(world.events.filter(e=>e.type==='campaignPeak').length,1);
    const par=world.config.par;
    assert.equal(world.resultRating,world.shotsUsed<=par-1?3:world.shotsUsed<=par?2:1);
    for(let frame=0;frame<360 && world.phase!=='over';frame++) {const scale=world.presentationTimeScale;world.step(scale/120,false,{timeScale:scale});}
    assert.equal(world.phase,'over');assert.equal(world.events.filter(e=>e.type==='over').length,1);
  }
});
