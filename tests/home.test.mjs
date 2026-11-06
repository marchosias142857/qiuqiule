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

test('wardrobe is the largest function target and holds at contact for its UI transfer',()=>{
  for(const [width,height] of [[390,844],[844,390],[768,1024],[1363,936]]){
    const h=new HomeWorld(width,height),target=h.targets.find(c=>c.id==='wardrobe');
    assert.deepEqual(h.targets.map(c=>c.id),['play','settings','wardrobe','sound']);
    assert.ok(h.layout.others.every(c=>c.r<=target.r));
    assert.equal(h.launchTo('wardrobe'),true);
    while(h.phase==='flight')h.step(1/120);
    assert.equal(h.phase,'external');assert.equal(h.action,'wardrobe');
    near(Math.hypot(h.player.x-target.x,h.player.y-target.y),h.player.r+target.r);
    const {x,y}=h.player;advance(h,.5);near(h.player.x,x);near(h.player.y,y);
    h.reset();assert.equal(h.ready,true);
  }
});

test('the historical three-function coordinates and radii survive portrait, landscape and resize',()=>{
  // Recorded base coordinates from v4.2.2 e32f94f, normalized by its base radius.
  const portrait=[[1.538832528521386,-1.6334198700828841,.611],[2.182,.81,.792],[-.8,-2.05,.43]];
  const landscape=[[1.3926857446696186,-1.573078196508274,.611],[2.02,1.026,.792],[-.55,-1.9,.43]];
  const h=new HomeWorld(390,844);
  for(const [width,height,expectedBase] of [[390,844,48.75],[360,640,45],[320,568,40],[844,390,50.7],[667,375,43.355],[1363,936,86],[768,1024,86],[1024,1024,86]]){
    h.resize(width,height);
    const layout=h.layout,base=layout.base,expected=width<=height?portrait:landscape;
    near(base,expectedBase);assert.equal(layout.others.length,3);
    layout.others.forEach((body,i)=>{
      near(body.x,layout.player.x+expected[i][0]*base);
      near(body.y,layout.player.y+expected[i][1]*base);
      near(body.r,expected[i][2]*base);assert.equal(body.seed,i+1);
    });
    near(layout.player.r,base*.84*.9);
    near(layout.player.x,width*(width<=height?.5:.66));
    near(layout.player.y,height*(width<=height?.48:.57));
    near(layout.others[0].r,(layout.others[1].r+layout.others[2].r)/2);
  }
});

test('legacy mode inputs cannot introduce a campaign route and every start lands in endless',()=>{
  const h=new HomeWorld(390,844,'campaign');
  assert.equal(h.mode,'endless');assert.equal(h.launchTo('mode'),false);assert.equal(h.phase,'idle');
  assert.throws(()=>{h.mode='campaign';},TypeError);
  h.launchToPlay();advance(h,3);assert.equal(h.phase,'done');
  near(h.player.x,195);near(h.player.y,844*.62);near(h.player.r,390*.047);
});
