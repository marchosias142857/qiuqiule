import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignWorld} from '../dist/campaign.js';
import {WALL_LEVELS,wallParams,wallCells} from '../dist/classes/wall.js';
import {staticContact} from '../dist/campaign-collision.js';
const level=rank=>10*Math.floor(rank/2)+1+rank%2;
const fresh=(rank,width=390,height=844,upgradeId='energy')=>new CampaignWorld(width,height,level(rank),()=>.5,{upgradeId});
const canonical=cells=>{
 const variants=[];
 for(const swap of [false,true])for(const sx of [-1,1])for(const sy of [-1,1]){
  const points=cells.map(c=>[sx*(swap?c.row:c.column),sy*(swap?c.column:c.row)]);
  const mx=Math.min(...points.map(p=>p[0])),my=Math.min(...points.map(p=>p[1]));
  variants.push(points.map(([x,y])=>`${x-mx},${y-my}`).sort().join(';'));
 }
 return variants.sort()[0];
};
test('twenty authored wall silhouettes are unique even after translation, reflection and rotation',()=>{
 const silhouettes=new Set(),names=new Set();let hp=0;
 for(let rank=0;rank<20;rank++){
  const p=wallParams(Math.floor(rank/2),rank%2),cells=wallCells(Math.floor(rank/2),rank%2);
  const signature=canonical(cells);assert.ok(!silhouettes.has(signature),`duplicate topology ${rank}`);silhouettes.add(signature);
  names.add(p.layoutName);assert.equal(p.layoutId,WALL_LEVELS[rank].id);assert.equal(p.playerRadius,.45);
  assert.equal(p.wanderers,0);assert.equal(cells.length,p.brickCount);assert.equal(cells.reduce((s,c)=>s+c.hp,0),p.totalHP);
  assert.ok(p.totalHP>hp);hp=p.totalHP;assert.ok(p.threePointShots<p.twoPointShots&&p.twoPointShots<p.budget);
 }
 assert.equal(names.size,20);
});
test('all walls keep the smaller actor, empty mover list and usable cell passages across five viewports',()=>{
 for(const [width,height]of [[320,568],[390,844],[568,320],[844,390],[1440,900]])for(let rank=0;rank<20;rank++){
  const w=fresh(rank,width,height),b=w.arenaBounds,l=w.wallLayout;
  assert.equal(w.enemies.length,0);assert.equal(w.player.r,w.unit*.45);
  assert.ok(l.brickHeight+2*l.gap>w.player.r*2,`vertical single-cell path ${width} ${rank}`);
  assert.ok(l.brickWidth+2*l.gap>w.player.r*2);
  for(const s of w.statics){
   assert.equal(s.kind,'brick');assert.ok(s.x-s.width/2>=b.left&&s.x+s.width/2<=b.right);
   assert.ok(s.y-s.height/2>=b.top&&s.y+s.height/2<=b.bottom);
   assert.equal(staticContact(w.player,s),null);
  }
  const ids=w.statics.map(s=>s.id),hp=w.statics.map(s=>s.hp);w.resize(height,width);
  assert.deepEqual(w.statics.map(s=>s.id),ids);assert.deepEqual(w.statics.map(s=>s.hp),hp);
  assert.equal(w.player.r,w.unit*.45);assert.equal(w.enemies.length,0);
 }
});
test('every authored wall teaching route hits a target with each offered upgrade in both phone orientations',()=>{
 for(const size of [[390,844],[844,390],[320,568],[568,320]])for(let rank=0;rank<20;rank++)for(const upgrade of ['rubber','energy','bank','density']){
  const w=fresh(rank,...size,upgrade),t=w.teachingTarget,p=w.player,dx=t.x-p.x,dy=t.y-p.y,d=Math.hypot(dx,dy);
  assert.equal(w.shoot(-dx/d*w.maxPull,-dy/d*w.maxPull),true);
  for(let f=0;f<240&&w.shotActive&&w.phase==='battle';f++)w.step(1/30);
  assert.ok(w.statics.reduce((n,b)=>n+Math.max(0,b.hp),0)<w.wallTotalHP,`${size} rank${rank} ${upgrade}`);
 }
});
