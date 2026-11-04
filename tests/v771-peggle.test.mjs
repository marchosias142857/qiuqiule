import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld} from '../dist/campaign.js';
import {PEGGLE_LEVELS, peggleLevel} from '../dist/classes/peggle-levels.js';
import {peggleParams} from '../dist/classes/peggle.js';
const level = rank => Math.floor(rank / 2) * 10 + 9 + rank % 2;
const fresh = (rank, width = 390, height = 844, upgradeId = 'energy') => new CampaignWorld(width,height,level(rank),()=>.5,{upgradeId});
const shootAt = (w, point) => {
  const a=Math.atan2(point.y-w.player.y,point.x-w.player.x);
  assert.ok(w.shoot(-Math.cos(a)*w.maxPull,-Math.sin(a)*w.maxPull));
  for(let f=0;f<850&&w.shotActive&&w.phase==='battle';f++)w.step(1/120);
};
const signature = pegs => {
  const transforms=[(x,y)=>[x,y],(x,y)=>[-x,y],(x,y)=>[x,-y],(x,y)=>[-x,-y],(x,y)=>[y,x],(x,y)=>[-y,x],(x,y)=>[y,-x],(x,y)=>[-y,-x]];
  return transforms.map(fn=>{
    const points=pegs.map(p=>fn(p.column,p.row)),xmin=Math.min(...points.map(p=>p[0])),ymin=Math.min(...points.map(p=>p[1]));
    return points.map(([x,y])=>`${x-xmin},${y-ymin}`).sort().join(';');
  }).sort()[0];
};

test('twenty authored peg topologies are unique even after translation, rotation and reflection',()=>{
  assert.equal(PEGGLE_LEVELS.length,20);assert.equal(new Set(PEGGLE_LEVELS.map(x=>x.id)).size,20);
  assert.equal(new Set(PEGGLE_LEVELS.map(x=>signature(x.pegs))).size,20,'new targets or mirrored old masks cannot count as new boards');
  let targetCount=0,bucket=Infinity;
  for(let rank=0;rank<20;rank++){
    const spec=peggleLevel(rank),p=peggleParams(Math.floor(rank/2),rank%2),w=fresh(rank);
    assert.equal(p.layoutId,spec.id);assert.equal(p.layoutName,spec.name);assert.ok(p.layoutLesson.length>5);
    assert.equal(w.statics.length,spec.pegs.length);assert.equal(w.targetsRemaining,spec.pegs.filter(p=>p.target).length);
    assert.ok(p.targetPegs>=targetCount);targetCount=p.targetPegs;
    assert.ok(p.bucketWidth<bucket);bucket=p.bucketWidth;
    assert.equal(w.player.r/w.unit,.42);assert.ok(w.statics.every(pin=>Math.abs(pin.r/w.unit-.36)<1e-12));
  }
});

test('all authored pegs fit and remain separated on five screens before and after rotation',()=>{
 for(const [width,height]of [[320,568],[390,844],[844,390],[568,320],[1440,900]])for(let rank=0;rank<20;rank++){
  const w=fresh(rank,width,height),check=()=>{
    const b=w.arenaBounds,live=w.statics.filter(p=>p.active!==false);
    for(const p of live){assert.ok(p.x-p.r>=b.left&&p.x+p.r<=b.right);assert.ok(p.y-p.r>=b.top&&p.y+p.r<=b.bottom);}
    for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++)assert.ok(Math.hypot(live[i].x-live[j].x,live[i].y-live[j].y)>=live[i].r+live[j].r-1e-6);
  };
  check();w.rules.onTick(.8);check();w.resize(height,width);check();
  assert.equal(w.targetsRemaining,w.config.targetPegs);assert.equal(w.shotsUsed,0);
  assert.ok(Math.abs(w.player.r/w.unit-.42)<1e-12);
 }
});

test('all twenty first-shot targets genuinely hit for every offer on four phone viewports',()=>{
 for(const [width,height]of [[390,844],[844,390],[320,568],[568,320]])for(let rank=0;rank<20;rank++)for(const upgrade of ['rubber','energy','bank','pierce']){
  const w=fresh(rank,width,height,upgrade),target=w.teachingTarget;shootAt(w,target);
  assert.ok(w.targetsRemaining<w.config.targetPegs,`${width}x${height} rank${rank} ${upgrade}`);
  assert.equal(w.tutorialVisible,false);assert.equal(w.shotsUsed,1);
 }
});
