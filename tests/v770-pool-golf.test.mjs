import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld, levelConfig} from '../dist/campaign.js';
import {poolParams} from '../dist/classes/pool.js';
import {golfParams} from '../dist/classes/golf.js';
import {staticContact} from '../dist/campaign-collision.js';

const level = (kind, rank) => (kind === 'pool' ? 3 : 7) + rank % 2 + Math.floor(rank / 2) * 10;
const fresh = (kind, rank = 0, width = 390, height = 844, upgradeId = 'rubber') =>
  new CampaignWorld(width, height, level(kind, rank), () => .5, {upgradeId});
const playShot = (world, target = world.teachingTarget, ratio = world.tutorialPullRatio) => {
  const angle = Math.atan2(target.y - world.player.y, target.x - world.player.x);
  assert.equal(world.shoot(-Math.cos(angle) * world.maxPull * ratio, -Math.sin(angle) * world.maxPull * ratio), true);
  for (let i = 0; i < 1800 && world.shotActive && world.phase === 'battle'; i++) {
    const scale = world.presentationTimeScale;
    world.step(scale / 120, false, {timeScale: scale});
  }
  assert.equal(world.shotActive, false);
};

test('pool and golf retain twenty ordered slots with distinct authored layouts', () => {
  for (const kind of ['pool', 'golf']) {
    const ids=new Set(),geometry=new Set(); let previous;
    for (let rank=0;rank<20;rank++) {
      const w=fresh(kind,rank),c=w.config;
      assert.equal(c.type,kind);assert.equal(c.rank20,rank);assert.equal(c.variant,rank%2);
      assert.ok(c.layoutName);ids.add(c.layoutId);
      geometry.add(JSON.stringify([w.player.x,w.player.y,w.statics.map(s=>[s.x,s.y,s.width,s.height]),w.enemies.map(b=>[b.x,b.y]),w.zones.map(z=>[z.x,z.y])]));
      if(previous)assert.ok(kind==='pool'?c.pocketRadius<previous.pocketRadius:c.par>=previous.par);
      if(kind==='golf')assert.equal(w.enemies.length,0);
      previous=c;
    }
    assert.equal(ids.size,20);assert.equal(geometry.size,20);
  }
});

test('all forty layouts fit phone, landscape and desktop bounds without starting overlaps', () => {
  for (const [width, height] of [[320,568],[390,844],[568,320],[844,390],[1280,720]])
    for (const kind of ['pool','golf']) for (let rank=0;rank<20;rank++) {
      const w=fresh(kind,rank,width,height), b=w.arenaBounds;
      for (const body of [w.player,...w.enemies,...w.zones]) {
        assert.ok(Number.isFinite(body.x+body.y+body.r));
        assert.ok(body.x-body.r>=b.left-1e-6 && body.x+body.r<=b.right+1e-6,`${kind} ${rank} horizontal`);
        assert.ok(body.y-body.r>=b.top-1e-6 && body.y+body.r<=b.bottom+1e-6,`${kind} ${rank} vertical`);
      }
      for(const s of w.statics) {
        assert.equal(staticContact(w.player,s),null,`${kind} ${rank} cue clear`);
        for(const z of w.zones)assert.equal(staticContact(z,s),null,`${kind} ${rank} hole clear`);
        for(const e of w.enemies)assert.equal(staticContact(e,s),null,`${kind} ${rank} walker clear`);
      }
      const bodies=[w.player,...w.enemies];
      for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)
        assert.ok(Math.hypot(bodies[i].x-bodies[j].x,bodies[i].y-bodies[j].y)>=bodies[i].r+bodies[j].r-1e-6,`${kind} ${rank} separated`);
    }
});

test('pool rating counts scratches and retains all three attainable score bands in all twenty tiers',()=>{
  for(let rank=0;rank<20;rank++) {
    const w=fresh('pool',rank),p=poolParams(rank>>1,rank%2);
    assert.ok(p.threePointShots<p.twoPointShots && p.twoPointShots<p.budget);
    w.enemies=[];w.shotsUsed=p.threePointShots;w.poolScratches=0;assert.equal(w.rules.rating(),3);
    w.poolScratches=1;assert.equal(w.rules.rating(),2);
    w.shotsUsed=p.twoPointShots;assert.equal(w.rules.rating(),1);
    assert.ok(w.rules.ratingStatus().summary.includes('自己落袋1次'));
  }
  assert.equal(poolParams(9,1).budget,14);
});

test('golf middle and late chapters add one tolerance stroke while preserving the three-dot target',()=>{
  for(let rank=0;rank<20;rank++) {
    const p=golfParams(rank>>1,rank%2);
    assert.equal(p.budget,p.par+(rank>=6?3:2));
    assert.equal(p.threePointShots,p.par-1);assert.equal(p.twoPointShots,p.par);
    const w=fresh('golf',rank);w.shotsUsed=p.par-1;assert.equal(w.rules.ratingStatus().rating,3);
    w.shotsUsed++;assert.equal(w.rules.ratingStatus().rating,2);
    w.shotsUsed++;assert.equal(w.rules.ratingStatus().rating,1);
  }
});

test('the pool cue and target balls apply the same drag while rolling',()=>{
  const w=fresh('pool'),ball=w.enemies[0];w.enemies=[ball];
  Object.assign(w.player,{x:100,y:500});Object.assign(ball,{x:250,y:500});
  w.shoot(8,0);w.player.feedbackFreeze=0;w.player.vx=ball.vx=8*w.unit;w.player.vy=ball.vy=0;
  w.step(.05);assert.ok(Math.abs(w.player.vx-ball.vx)<1e-8);
  assert.equal(w.rules.physics.playerDrag,ball.drag);
});

test('both opening pairs teach a real useful shot with every offer in portrait and landscape',()=>{
  for(const strength of [0,.6])for(const kind of ['pool','golf'])for(const rank of [0,1])
    for(const [width,height]of[[390,844],[844,390],[320,568],[568,320]])for(const upgrade of ['density','rubber','bank','steady']) {
      const w=fresh(kind,rank,width,height,upgrade).setFeedbackOptions({strength,reducedMotion:false});
      assert.ok(w.tutorialPullRatio>0&&w.tutorialPullRatio<1);
      playShot(w);
      if(kind==='golf')assert.equal(w.completed,true,`${kind} ${rank} ${width} ${upgrade} ${strength}`);
      else assert.ok(w.poolPotted>=1,`${kind} ${rank} ${width} ${upgrade} ${strength}`);
    }
});
