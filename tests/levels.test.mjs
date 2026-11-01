import test from 'node:test';
import assert from 'node:assert/strict';
import {LevelSelector,levelLayout,trackPath} from '../dist/levels.js';
import {HomeWorld} from '../dist/home.js';
import {usesStrainedEyes} from '../dist/motion.js';
const near=(a,b,t=1e-5)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const advance=(s,seconds)=>{for(let i=0;i<seconds*120;i++)s.step(1/120);};
const dragTangent=(s,slots,duration=.2)=>{
  const l=s.layout,x=l.cx,y=l.cy-l.radius;
  assert.equal(s.startTrack(x,y,0),true);
  s.moveTrack(x-slots*l.radius*l.stepAngle,y,duration);
  s.endTrack(duration);
};

test('300 degree ring fits both orientations; player centered and return shares centreline circle',()=>{
  for(const [w,h] of [[320,568],[390,844],[844,390],[1363,936]]){
    const l=levelLayout(w,h),s=new LevelSelector(w,h,100);
    near(l.endAngle-l.startAngle,Math.PI*5/3);near(s.player.x,w/2);near(s.player.y,h/2);
    near(l.returnBall.x,l.cx);near(l.returnBall.y-l.cy,l.radius);
    near(Math.PI*2-(l.endAngle-l.startAngle),Math.PI/3);
    assert.ok(Math.asin(l.returnBall.r/l.radius)<Math.PI/6);
    assert.ok(l.cx-l.outer>15&&l.cx+l.outer<w-15&&l.cy-l.outer>15&&l.cy+l.outer<h-15);
    assert.ok(l.radius-l.ballRadius>l.inner&&l.radius+l.ballRadius<l.outer);
    assert.equal(s.visibleBalls.length,l.count);
    assert.ok(s.visibleBalls.every(b=>b.fullyVisible));
    for(let i=1;i<s.visibleBalls.length;i++)assert.ok(Math.hypot(s.visibleBalls[i].x-s.visibleBalls[i-1].x,s.visibleBalls[i].y-s.visibleBalls[i-1].y)>l.ballRadius*2+8);
    const path=trackPath(l);assert.equal((path.match(/ A /g)||[]).length,6);assert.ok(path.endsWith('Z'));assert.ok(!/NaN|Infinity/.test(path));
  }
});

test('first and last pages show 1 lower-left and 100 lower-right without wrapping',()=>{
  const s=new LevelSelector(390,844,1),l=s.layout;
  assert.equal(s.visibleBalls[0].level,1);assert.ok(s.visibleBalls[0].x<l.cx&&s.visibleBalls[0].y>l.cy);
  s.offset=s.maxOffset;s.snapTarget=s.offset;
  assert.equal(s.visibleBalls.at(-1).level,100);assert.ok(s.visibleBalls.at(-1).x>l.cx&&s.visibleBalls.at(-1).y>l.cy);
  assert.equal(s.visibleBalls.length,l.count);assert.ok(s.visibleBalls.every(b=>b.level>=1&&b.level<=100));
});

test('slow precise drag snaps to integer slots and fast flick continues with inertia',()=>{
  const slow=new LevelSelector(390,844,100);slow.offset=20;slow.snapTarget=20;
  dragTangent(slow,.38,1);const released=slow.offset;advance(slow,3);
  assert.ok(released>20&&released<21);near(slow.offset,20);assert.equal(slow.visibleBalls.length,slow.layout.count);
  const fast=new LevelSelector(390,844,100);fast.offset=20;fast.snapTarget=20;
  dragTangent(fast,3,.1);const before=fast.offset;advance(fast,.2);assert.ok(fast.offset>before+1);
  advance(fast,5);near(fast.offset,Math.round(fast.offset));assert.equal(fast.visibleBalls.length,fast.layout.count);
});

test('clockwise at top reduces offset; endpoints rubber-band without nonexistent levels',()=>{
  const s=new LevelSelector(390,844,100);dragTangent(s,-10,.1);
  assert.ok(s.offset<0&&s.offset>-.91);assert.ok(s.visibleBalls.every(b=>b.level>=1));advance(s,4);near(s.offset,0);
  s.offset=s.maxOffset;s.snapTarget=s.offset;dragTangent(s,10,.1);
  assert.ok(s.offset>s.maxOffset&&s.offset<s.maxOffset+.91);assert.ok(s.visibleBalls.every(b=>b.level<=100));advance(s,4);near(s.offset,s.maxOffset);
});

test('gesture starting radial line controls direction even after pointer crosses centre',()=>{
  const s=new LevelSelector(390,844,100);s.offset=20;s.snapTarget=20;
  const l=s.layout;assert.equal(s.startTrack(l.cx+l.radius,l.cy,0),true);
  s.moveTrack(l.cx-l.radius,l.cy+50,.2);assert.ok(s.offset<20);
  s.cancelTrack();advance(s,3);near(s.offset,Math.round(s.offset));
  assert.equal(s.startTrack(l.cx,l.cy,1),false);assert.equal(s.isTrackPoint(l.cx,l.cy+l.radius),false);
});

test('unlocked collision emits exactly one level action; locked collision bounces',()=>{
  for(const unlocked of [1,100]){
    const s=new LevelSelector(390,844,unlocked),b=s.visibleBalls[2],p=s.player,d=Math.hypot(b.x-p.x,b.y-p.y);
    s.shoot((p.x-b.x)/d*s.maxPull,(p.y-b.y)/d*s.maxPull);advance(s,.8);
    if(unlocked===100){assert.deepEqual(s.action,{type:'level',level:b.level});assert.equal(s.phase,'external');}
    else{assert.equal(s.action,null);assert.ok(s.events.some(e=>e.type==='locked'));assert.equal(s.phase,'idle');}
  }
});

test('return collision leaves selection and resize preserves a valid integer page',()=>{
  const s=new LevelSelector(390,844,100,98);s.shoot(0,-s.maxPull);advance(s,.6);assert.deepEqual(s.action,{type:'home'});
  s.resize(844,390);assert.ok(s.offset>=0&&s.offset<=s.maxOffset);near(s.offset,Math.round(s.offset));near(s.player.x,422);near(s.player.y,195);
});

test('player, level and return balls share the same enlarged diameter',()=>{
  for(const [w,h] of [[320,568],[390,844],[844,390],[1363,936]]){
    const old=Math.max(18,Math.min(34,Math.min(w,h)*.047));
    const s=new LevelSelector(w,h),l=s.layout;
    near(s.player.r,old*1.7);near(l.ballRadius,old*1.7);
    near(l.returnBall.r,s.player.r);
    assert.ok(l.count<13);assert.ok(l.inner>s.player.r);
    const all=[s.returnBall,...s.visibleBalls];
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
      assert.ok(Math.hypot(all[i].x-all[j].x,all[i].y-all[j].y)>all[i].r+all[j].r+8);
    }
  }
});

test('an off-target shot rebounds in place with the same alternating home pull',()=>{
  const s=new LevelSelector(390,844,100);
  // The overscroll's blank edge is real empty space, not a wrapped phantom ball.
  s.offset=-.89;
  const angle=Math.PI*.75;
  assert.equal(s.shoot(-Math.cos(angle)*s.maxPull,-Math.sin(angle)*s.maxPull),true);
  assert.equal(s.phase,'wobble');assert.equal(s.ready,false);
  const signs=new Set(),x=s.player.x,y=s.player.y;
  for(let i=0;i<99;i++){
    s.step(1/120);near(s.player.x,x);near(s.player.y,y);
    if(s.pull)signs.add(Math.sign(s.pull.dx));
  }
  assert.ok(signs.has(1)&&signs.has(-1));assert.equal(s.phase,'idle');assert.equal(s.pull,null);
  assert.equal(s.action,null);assert.equal(s.player.vx,0);assert.equal(s.player.vy,0);
});

test('a weak aimed shot never drifts halfway towards a level',()=>{
  const s=new LevelSelector(390,844,100),b=s.visibleBalls[2],p=s.player;
  const d=Math.hypot(b.x-p.x,b.y-p.y),x=p.x,y=p.y;
  assert.equal(s.shoot((p.x-b.x)/d*7,(p.y-b.y)/d*7),true);
  assert.equal(s.phase,'wobble');advance(s,.9);
  near(p.x,x);near(p.y,y);assert.equal(s.ready,true);assert.equal(s.action,null);
});

test('a locked hit freezes target geometry, returns to center, and emits once',()=>{
  const s=new LevelSelector(390,844,1),b=s.visibleBalls[2],p=s.player;
  const d=Math.hypot(b.x-p.x,b.y-p.y),x=p.x,y=p.y;
  s.velocity=12;
  assert.equal(s.shoot((p.x-b.x)/d*s.maxPull,(p.y-b.y)/d*s.maxPull),true);
  assert.equal(s.phase,'flight');const offset=s.offset;
  let n=0;while(s.phase==='flight'&&n++<240)s.step(1/120);
  assert.equal(s.phase,'returning');near(s.offset,offset);
  near(Math.hypot(p.x-b.x,p.y-b.y),p.r+b.r);
  assert.equal(s.startTrack(s.layout.cx,s.layout.cy-s.layout.radius,0),false);
  advance(s,.8);near(p.x,x);near(p.y,y);
  assert.equal(s.ready,true);assert.equal(s.action,null);
  assert.equal(s.events.filter(e=>e.type==='locked').length,1);
});

test('resizing an unfinished shot safely resets player and selection control',()=>{
  const s=new LevelSelector(390,844,100);s.shoot(0,-s.maxPull);
  assert.equal(s.phase,'flight');s.resize(844,390);
  assert.equal(s.phase,'idle');assert.equal(s.ready,true);assert.equal(s.action,null);
  near(s.player.x,422);near(s.player.y,195);
});


test('selection rebound matches homepage deformation and expression lifetime',()=>{
  const s=new LevelSelector(390,844),home=new HomeWorld(390,844);
  assert.equal(s.shoot(0,-7),true);assert.equal(home.shoot(0,-7),true);
  assert.equal(s.phase,'wobble');assert.equal(home.phase,'wobble');
  for(let i=0;i<110;i++){
    s.step(1/120);home.step(1/120);
    assert.equal(s.phase,home.phase);
    assert.deepEqual(s.pull,home.pull);
    assert.equal(usesStrainedEyes(true,null,s.phase),usesStrainedEyes(true,null,home.phase));
    assert.equal(usesStrainedEyes(false,s.pull,s.phase),false);
  }
});


test('a partly clipped level can be hit on its visible end-cap chord',()=>{
  const s=new LevelSelector(390,844,100);s.offset=.65;
  const angle=Math.PI*2/3;
  s.shoot(-Math.cos(angle)*s.maxPull,-Math.sin(angle)*s.maxPull);
  assert.equal(s.phase,'flight');assert.equal(s.target.level,1);
  const travel=s.remaining;assert.ok(travel>68&&travel<69);
  advance(s,.3);assert.deepEqual(s.action,{type:'level',level:1});
  near(Math.hypot(s.player.x-s.layout.cx,s.player.y-s.layout.cy),travel);
});

test('fractional and overscrolled rails resume integer snapping after locked return',()=>{
  for(const offset of [-.7,4.35,93.7]){
    const s=new LevelSelector(390,844,1);s.offset=offset;s.velocity=15;
    const b=s.visibleBalls.find(b=>b.fullyVisible&&b.level>1),p=s.player;
    const d=Math.hypot(b.x-p.x,b.y-p.y);
    s.shoot((p.x-b.x)/d*s.maxPull,(p.y-b.y)/d*s.maxPull);
    assert.equal(s.phase,'flight');advance(s,.4);near(s.offset,offset);
    advance(s,4);assert.equal(s.phase,'idle');near(s.offset,Math.max(0,Math.min(s.maxOffset,Math.round(offset))));
    assert.equal(s.visibleBalls.length,s.layout.count);assert.ok(s.visibleBalls.every(b=>b.fullyVisible));
  }
});
