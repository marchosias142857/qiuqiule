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

test('entry centres the highest unlocked level at the top, choosing the left middle slot only when needed',()=>{
  for(const [w,h] of [[320,568],[390,844],[844,390],[1363,936]]){
    for(const unlocked of [12,50,80]){
      const s=new LevelSelector(w,h,unlocked),l=s.layout;
      const target=s.visibleBalls.find(b=>b.level===unlocked);
      assert.ok(target?.fullyVisible&&target.unlocked);
      // Compare actual rendered positions rather than repeating the index
      // formula: focus must be nearest to the top of the centreline.
      const distance=b=>Math.hypot(b.x-l.cx,b.y-(l.cy-l.radius));
      for(const b of s.visibleBalls)assert.ok(distance(target)<=distance(b)+1e-8);
      if(l.count%2===1){
        near(target.x,l.cx);near(target.y,l.cy-l.radius);
      }else{
        assert.ok(target.x<l.cx);
        const next=s.visibleBalls.find(b=>b.level===target.level+1);
        assert.ok(next.x>l.cx);near(next.y,target.y);near(distance(next),distance(target));
      }
      assert.equal(s.visibleBalls.length,l.count);
      assert.ok(s.visibleBalls.every(b=>b.fullyVisible));
      assert.equal(s.offset,Math.round(s.offset));
      assert.equal(s.snapTarget,s.offset);assert.equal(s.velocity,0);
      advance(s,.5);assert.equal(s.visibleBalls.find(b=>b.level===unlocked).x,target.x);
    }
  }
});

test('default entry clamps at the first and last pages and retains explicit focus support',()=>{
  for(const [w,h] of [[320,568],[390,844],[844,390],[1363,936]]){
    const first=new LevelSelector(w,h,1),last=new LevelSelector(w,h,100);
    assert.equal(first.offset,0);assert.equal(first.visibleBalls[0].level,1);
    assert.equal(last.offset,last.maxOffset);assert.equal(last.visibleBalls.at(-1).level,100);
    for(const s of [first,last]){
      assert.equal(s.visibleBalls.length,s.layout.count);
      assert.ok(s.visibleBalls.every(b=>b.fullyVisible&&b.level>=1&&b.level<=100));
    }
    const explicit=new LevelSelector(w,h,100,1);
    assert.equal(explicit.offset,0);assert.equal(explicit.unlocked,100);
    assert.equal(explicit.visibleBalls[0].level,1);
  }
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
  const s=new LevelSelector(390,844,100,1);dragTangent(s,-10,.1);
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

test('clicking an unlocked level emits one tap and enters it once',()=>{
  const s=new LevelSelector(390,844,100),b=s.visibleBalls[2];
  assert.equal(s.targetAt(b.x,b.y).level,b.level);
  assert.equal(s.activateAt(b.x,b.y),true);
  assert.deepEqual(s.action,{type:'level',level:b.level});assert.equal(s.phase,'external');
  assert.equal(s.events.filter(e=>e.type==='tap').length,1);
  assert.equal(s.events[0].id,b.id);assert.equal(s.events[0].target.level,b.level);
  assert.equal(s.activateAt(b.x,b.y),false);assert.equal(s.shoot(20,0),false);
  assert.equal(s.startTrack(s.layout.cx,s.layout.cy-s.layout.radius),false);
  assert.equal(s.events.filter(e=>e.type==='tap').length,1);
});


test('return ball is independently clickable outside the track and resize preserves a valid page',()=>{
  const s=new LevelSelector(390,844,100,98),b=s.returnBall;
  assert.equal(s.isTrackPoint(b.x,b.y),false);assert.equal(s.targetAt(b.x,b.y).id,'home');
  assert.equal(s.activateAt(b.x,b.y),true);assert.deepEqual(s.action,{type:'home'});
  assert.equal(s.phase,'external');assert.equal(s.events[0].type,'tap');
  assert.equal(s.events[0].id,'home');
  s.resize(844,390);assert.ok(s.offset>=0&&s.offset<=s.maxOffset);near(s.offset,Math.round(s.offset));near(s.player.x,422);near(s.player.y,195);
  assert.equal(s.phase,'idle');assert.equal(s.action,null);
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

test('every pull direction and strength rebounds in place without activating any ball',()=>{
  for(const unlocked of [1,100])for(const distance of [6.001,7,60,170,500]){
    const sample=new LevelSelector(390,844,unlocked);
    for(const target of [sample.returnBall,...sample.visibleBalls,{x:sample.player.x+1,y:sample.player.y}]){
      const s=new LevelSelector(390,844,unlocked),p=s.player,d=Math.hypot(target.x-p.x,target.y-p.y);
      assert.equal(s.shoot((p.x-target.x)/d*distance,(p.y-target.y)/d*distance),true);
      assert.equal(s.phase,'wobble');assert.equal(s.ready,false);
      const x=p.x,y=p.y;
      for(let i=0;i<99;i++){
        s.step(1/120);near(p.x,x);near(p.y,y);
        assert.equal(p.vx,0);assert.equal(p.vy,0);assert.equal(s.action,null);
      }
      assert.equal(s.phase,'idle');assert.equal(s.pull,null);
      assert.ok(!s.events.some(e=>['tap','locked'].includes(e.type)));
    }
  }
});

test('short taps do not start a rebound; accepted pulls keep their clamped strength',()=>{
  const s=new LevelSelector(390,844,100);
  for(const [dx,dy] of [[0,0],[5,0],[0,-5.99]])assert.equal(s.shoot(dx,dy),false);
  assert.equal(s.phase,'idle');assert.equal(s.events.length,0);
  assert.equal(s.shoot(6,0),true);advance(s,.9);
  assert.equal(s.shoot(0,-500),true);assert.equal(s.power,1);
  assert.deepEqual(s.direction,{x:-0,y:1});
  assert.equal(s.shoot(30,0),false,'a second player drag waits for the rebound');
});


test('a weak aimed shot never drifts halfway towards a level',()=>{
  const s=new LevelSelector(390,844,100),b=s.visibleBalls[2],p=s.player;
  const d=Math.hypot(b.x-p.x,b.y-p.y),x=p.x,y=p.y;
  assert.equal(s.shoot((p.x-b.x)/d*7,(p.y-b.y)/d*7),true);
  assert.equal(s.phase,'wobble');advance(s,.9);
  near(p.x,x);near(p.y,y);assert.equal(s.ready,true);assert.equal(s.action,null);
});

test('clicking a locked ball gives only lock feedback and leaves the player in place',()=>{
  const s=new LevelSelector(390,844,1),b=s.visibleBalls[2],x=s.player.x,y=s.player.y;
  s.clock=.1;
  assert.equal(s.activateAt(b.x,b.y),true);assert.equal(s.phase,'idle');assert.equal(s.action,null);
  assert.equal(s.hitTimes.get(b.level),.1);assert.deepEqual(s.events,[{type:'locked',level:b.level}]);
  near(s.player.x,x);near(s.player.y,y);assert.equal(s.ready,true);
  s.step(.04);assert.notEqual(s.visibleBalls.find(v=>v.level===b.level).sx,1);
  advance(s,.8);near(s.player.x,x);near(s.player.y,y);assert.equal(s.phase,'idle');
  assert.equal(s.events.filter(e=>e.type==='locked').length,1);
});

test('blank space and the central player cannot be activated',()=>{
  const s=new LevelSelector(390,844,100),l=s.layout;
  for(const [x,y] of [[0,0],[l.cx,l.cy],[l.cx+l.outer+5,l.cy],[l.cx,l.cy+l.radius+s.returnBall.r+2]]){
    assert.equal(s.targetAt(x,y),null);assert.equal(s.activateAt(x,y),false);
  }
  assert.equal(s.action,null);assert.equal(s.events.length,0);assert.equal(s.phase,'idle');
});

test('click hit regions follow the displayed locked-ball deformation',()=>{
  const s=new LevelSelector(390,844,1),b=s.visibleBalls[2];
  s.hitTimes.set(b.level,0);s.clock=.04;
  const shown=s.visibleBalls.find(v=>v.level===b.level);
  assert.ok(shown.sx>1.04&&shown.sy<.97);
  assert.equal(s.targetAt(b.x+b.r*1.04,b.y).level,b.level);
  assert.equal(s.targetAt(b.x,b.y+b.r*.97),null);
});


test('resizing an unfinished rebound safely resets player and selection control',()=>{
  const s=new LevelSelector(390,844,100);s.shoot(0,-s.maxPull);
  assert.equal(s.phase,'wobble');s.resize(844,390);
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


test('partly clipped balls can only be clicked on the visible side of either track cap',()=>{
  for(const side of ['start','end']){
    const s=new LevelSelector(390,844,100),l=s.layout;
    s.offset=side==='start'?.65:.35;
    const b=side==='start'?s.visibleBalls[0]:s.visibleBalls.at(-1);
    assert.equal(b.fullyVisible,false);assert.equal(s.isTrackPoint(b.x,b.y),false);
    assert.equal(s.targetAt(b.x,b.y),null);assert.equal(s.activateAt(b.x,b.y),false);
    const angle=side==='start'?l.startAngle+.02:l.endAngle-.02;
    const x=l.cx+Math.cos(angle)*l.radius,y=l.cy+Math.sin(angle)*l.radius;
    assert.ok(Math.hypot(x-b.x,y-b.y)<b.r);
    assert.equal(s.targetAt(x,y).level,b.level);assert.equal(s.activateAt(x,y),true);
    assert.deepEqual(s.action,{type:'level',level:b.level});
  }
});


test('locked taps preserve fractional and overscrolled track settling',()=>{
  for(const offset of [-.7,4.35,93.7]){
    const s=new LevelSelector(390,844,1);s.offset=offset;s.velocity=0;s.snapTarget=Math.max(0,Math.min(s.maxOffset,Math.round(offset)));
    const b=s.visibleBalls.find(b=>b.fullyVisible&&b.level>1);
    assert.equal(s.activateAt(b.x,b.y),true);assert.equal(s.phase,'idle');near(s.offset,offset);
    advance(s,4);near(s.offset,Math.max(0,Math.min(s.maxOffset,Math.round(offset))));
    assert.equal(s.visibleBalls.length,s.layout.count);assert.ok(s.visibleBalls.every(b=>b.fullyVisible));
  }
});

test('levels and return remain clickable during the player rebound',()=>{
  for(const kind of ['level','home','locked']){
    const s=new LevelSelector(390,844,kind==='locked'?1:100);
    assert.equal(s.shoot(40,0),true);s.step(.1);
    const b=kind==='home'?s.returnBall:s.visibleBalls[2];
    assert.equal(s.activateAt(b.x,b.y),true);
    if(kind==='locked'){
      assert.equal(s.phase,'wobble');assert.equal(s.action,null);assert.ok(s.pull);
      assert.equal(s.events.filter(e=>e.type==='locked').length,1);
    }else{
      assert.equal(s.phase,'external');assert.equal(s.pull,null);
      assert.deepEqual(s.action,kind==='home'?{type:'home'}:{type:'level',level:b.level});
    }
    near(s.player.x,s.layout.cx);near(s.player.y,s.layout.cy);
  }
});

test('track scrolling works throughout a rebound and track drags cannot activate balls',()=>{
  const s=new LevelSelector(390,844,100),l=s.layout;
  s.offset=20;s.snapTarget=20;assert.equal(s.shoot(40,0),true);
  assert.equal(s.startTrack(l.cx,l.cy-l.radius,0),true);
  assert.equal(s.startTrack(l.cx+l.radius,l.cy,0),false,'a drag cannot overwrite another drag');
  s.moveTrack(l.cx-l.radius*l.stepAngle,l.cy-l.radius,.2);assert.ok(s.offset>20);
  const b=s.visibleBalls.find(b=>b.fullyVisible);
  assert.equal(s.activateAt(b.x,b.y),false);assert.equal(s.activateAt(s.returnBall.x,s.returnBall.y),false);
  advance(s,.9);assert.equal(s.phase,'idle');assert.equal(s.ready,false);
  near(s.player.x,l.cx);near(s.player.y,l.cy);
  s.endTrack(1.1);assert.equal(s.ready,true);advance(s,4);
  near(s.offset,21);assert.equal(s.action,null);assert.ok(s.events.some(e=>e.type==='tick'));
});
