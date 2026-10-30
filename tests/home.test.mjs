import test from 'node:test';
import assert from 'node:assert/strict';
import {HomeWorld,homeLayout,contactDistance} from '../dist/home.js';
const advance=(h,t)=>{for(let i=0;i<Math.ceil(t*120);i++)h.step(1/120);};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} ≠ ${b}`);

test('portrait and landscape keep the play route clear and all five balls inside the border',()=>{
  for(const [w,h] of [[390,844],[360,640],[320,568],[844,390],[667,375],[1363,936],[768,1024]]){
    const l=homeLayout(w,h),p=l.player,c=l.play;
    if(w<=h){assert.ok(c.y>p.y);near(c.x,p.x);}else{assert.ok(c.x<p.x);near(c.y,p.y);}
    for(const b of [p,c,...l.others]){assert.ok(b.x-b.r>15&&b.x+b.r<w-15);assert.ok(b.y-b.r>15&&b.y+b.r<h-15);}
    const dx=c.x-p.x,dy=c.y-p.y,d=Math.hypot(dx,dy);
    for(const b of l.others)assert.equal(contactDistance(p,b,dx/d,dy/d),Infinity);
  }
});
test('a missed shot oscillates in both directions but keeps the center fixed and returns to idle',()=>{
  const h=new HomeWorld(390,844),x=h.player.x,y=h.player.y;
  h.shoot(h.maxPull,0);assert.equal(h.phase,'wobble');
  const signs=new Set();
  for(let i=0;i<100;i++){h.step(1/120);near(h.player.x,x);near(h.player.y,y);if(h.pull)signs.add(Math.sign(h.pull.dx));}
  assert.ok(signs.has(1)&&signs.has(-1));assert.equal(h.phase,'idle');
});
test('a weak on-target shot stays in place instead of stopping halfway to play',()=>{
  const h=new HomeWorld(390,844);h.shoot(0,-7);assert.equal(h.phase,'wobble');
  advance(h,.9);near(h.player.x,h.layout.player.x);near(h.player.y,h.layout.player.y);
});
test('a correct shot physically contacts play, locks input, fades home and shrinks into the game position',()=>{
  for(const [w,height] of [[390,844],[844,390],[1363,936]]){
    const h=new HomeWorld(w,height),r=h.player.r;
    h.launchToPlay();assert.equal(h.phase,'flight');assert.equal(h.shoot(1,100),false);
    while(h.phase==='flight')h.step(1/120);
    const c=h.layout.play;near(Math.hypot(h.player.x-c.x,h.player.y-c.y),r+c.r);
    assert.equal(h.phase,'entering');advance(h,.5);
    assert.ok(h.player.r<r&&h.fade<1&&h.hudOpacity>0&&!h.ready);
    advance(h,1);assert.equal(h.phase,'done');near(h.player.x,w*.5);near(h.player.y,height*.62);near(h.player.r,Math.max(18,Math.min(34,Math.min(w,height)*.047)));
  }
});
test('rotation during flight resets safely; rotation during entry ends at the new initial position',()=>{
  const h=new HomeWorld(390,844);h.launchToPlay();advance(h,.1);h.resize(844,390);assert.equal(h.phase,'idle');near(h.player.x,h.layout.player.x);
  h.launchToPlay();while(h.phase==='flight')h.step(1/120);advance(h,.3);h.resize(390,844);advance(h,1.2);
  assert.equal(h.phase,'done');near(h.player.x,195);near(h.player.y,844*.62);near(h.player.r,390*.047);
});

test('sound collision triggers once and rebounds exactly to the home anchor',()=>{
  const h=new HomeWorld(390,844);h.launchTo('sound');assert.equal(h.phase,'flight');
  while(h.phase==='flight')h.step(1/120);
  assert.equal(h.action,'sound');assert.equal(h.phase,'returning');assert.equal(h.ready,false);
  h.action=null;advance(h,.7);assert.equal(h.phase,'idle');assert.equal(h.action,null);
  near(h.player.x,h.layout.player.x);near(h.player.y,h.layout.player.y);
});
test('settings collision holds the player at contact for the UI transfer',()=>{
  const h=new HomeWorld(844,390);h.launchTo('settings');
  while(h.phase==='flight')h.step(1/120);
  assert.equal(h.phase,'external');assert.equal(h.action,'settings');const {x,y}=h.player;
  advance(h,.5);near(h.player.x,x);near(h.player.y,y);h.reset();assert.equal(h.ready,true);
});
