import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RunChoiceWorld,RUN_CHOICES,RUN_CHOICE_TIMING} from '../dist/run-choice.js';
import {iconGeometry,iconMarkup} from '../dist/icons.js';

function ready(width=390,height=844){
  const world=new RunChoiceWorld(width,height);
  world.step(RUN_CHOICE_TIMING.transition);
  assert.equal(world.phase,'choose');
  return world;
}
test('the run picker enters with two ordinary reward motions without inheriting a flight or consuming run state',()=>{
  const from={x:220,y:160,angle:.7,squash:.1,vx:800,vy:-600};
  const world=new RunChoiceWorld(390,844,{from});
  assert.equal(world.isRunChoice,true);assert.equal(world.phase,'transition');
  assert.equal(world.player.x,220);assert.equal(world.player.y,160);
  assert.equal(world.player.vx,0);assert.equal(world.player.vy,0);
  assert.deepEqual(world.choices.map(c=>[c.id,c.name,c.icon]),RUN_CHOICES.map(c=>[c.id,c.name,c.icon]));
  assert.ok(world.choices.every(c=>c.born===0&&c.runChoice));
  assert.equal(world.choose(world.choices[0]),false);
  world.step(RUN_CHOICE_TIMING.transition);
  assert.equal(world.phase,'choose');assert.ok(world.choices.every(c=>c.born===1));
  assert.equal(world.player.x,195);assert.equal(world.player.y,world.choicePlayerY);
  assert.deepEqual(world.enemies,[]);assert.deepEqual(world.buffs,{});
  assert.equal(world.totalShots,0);assert.equal(world.score,0);
});
test('both targets and their labels fit portrait, landscape and compact layouts without a passive selection',()=>{
  for(const [width,height] of [[390,844],[320,568],[844,390],[568,320],[1024,768],[320,240]]){
    const world=ready(width,height),bounds=world.arenaBounds;
    assert.equal(world.choices.length,2);
    for(const c of world.choices){
      assert.ok(c.x-c.r>=bounds.left&&c.x+c.r<=bounds.right,`${width}x${height} horizontal target`);
      assert.ok(c.y-c.r>=bounds.top&&c.y+c.r+24<=bounds.bottom,`${width}x${height} label fits`);
      assert.ok(Math.hypot(world.player.x-c.x,world.player.y-c.y)>world.player.r+c.r+4,`${width}x${height} player clear`);
    }
    world.step(10);
    assert.equal(world.phase,'choose');assert.equal(world.selectedRunChoice,null);
    assert.equal(world.enemies.length,0);assert.equal(world.fragmentQueue.length,0);
    assert.equal(world.score,0);assert.equal(world.stage,1);
  }
});
test('actual slingshot collisions choose either target exactly once and never award a buff or progress',()=>{
  for(const id of ['new-run','continue-run']){
    const world=ready(),choice=world.choices.find(c=>c.id===id),p=world.player;
    const dx=p.x-choice.x,dy=p.y-choice.y,d=Math.hypot(dx,dy);
    assert.equal(world.beginPull(),true);
    assert.equal(world.shoot(dx/d*world.maxPull,dy/d*world.maxPull),true);
    for(let i=0;i<1200&&world.phase!=='run-choice-done';i++)world.step(1/120);
    assert.equal(world.phase,'run-choice-done');assert.equal(world.selectedRunChoice,id);
    const picked=world.events.filter(e=>e.type==='runChoice'),completed=world.events.filter(e=>e.type==='runChoiceReady');
    assert.equal(picked.length,1);assert.equal(completed.length,1);
    assert.equal(picked[0].choiceId,id);assert.equal(picked[0].choice.icon,choice.icon);
    assert.equal(completed[0].choiceId,id);assert.ok(picked[0].bodySnapshot);
    assert.ok(!world.events.some(e=>['buff','stage','spawn','kill','over'].includes(e.type)));
    assert.deepEqual(world.buffs,{});assert.equal(world.enemies.length,0);
    assert.equal(world.score,0);assert.equal(world.totalShots,0);assert.equal(world.totalKills,0);
    const before={x:p.x,y:p.y,time:world.time,events:world.events.length};world.step(50);world.advance(5,false);
    assert.deepEqual({x:p.x,y:p.y,time:world.time,events:world.events.length},before);
  }
});
test('selection rejects foreign targets, cannot change its choice, and waits for the reward rest',()=>{
  const world=ready(),[first,second]=world.choices;
  assert.equal(world.choose({...first}),false);assert.equal(world.choose({id:'growth'}),false);
  assert.equal(world.choose(first),true);assert.equal(world.choose(second),false);assert.equal(world.choose(first),false);
  assert.equal(world.phase,'reward');assert.deepEqual(world.choices,[]);
  world.step(.399);assert.equal(world.phase,'reward');
  assert.equal(world.events.filter(e=>e.type==='runChoiceReady').length,0);
  world.step(.001);assert.equal(world.phase,'run-choice-done');
  assert.equal(world.events.filter(e=>e.type==='runChoiceReady').length,1);
  world.finishRewardRound();assert.equal(world.events.filter(e=>e.type==='runChoiceReady').length,1);
});
test('screen rotation cannot accidentally choose a target newly overlapping the player',()=>{
  const world=ready();Object.assign(world.player,{x:145,y:250,vx:0,vy:0});
  assert.ok(world.choices.every(c=>Math.hypot(world.player.x-c.x,world.player.y-c.y)>world.player.r+c.r));
  world.resize(844,390);world.step(1/120);
  assert.equal(world.phase,'choose');assert.equal(world.selectedRunChoice,null);
  assert.equal(world.player.x,422);assert.equal(world.player.y,world.choicePlayerY);
  assert.equal(world.player.vx,0);assert.equal(world.player.vy,0);
});
test('leaving uses a rounded arrow and bar while continue uses two filled rounded triangles',()=>{
  const leave=iconGeometry('leave');assert.equal(leave.fills.length,0);assert.equal(leave.strokes.length,3);
  assert.equal(leave.strokes[2][0][0],leave.strokes[2][1][0]);
  assert.ok(leave.strokes[2][0][0]>leave.strokes[0][1][0]);
  assert.match(iconMarkup('leave'),/stroke-linecap="round"/);
  assert.match(iconMarkup('leave'),/stroke-linejoin="round"/);
  const forward=iconGeometry('continue');assert.equal(forward.fills.length,2);assert.equal(forward.strokes.length,0);
  for(const points of forward.fills){assert.ok(points.length>3);assert.ok(points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&Math.hypot(x,y)<1));}
  assert.ok(Math.max(...forward.fills[0].map(([x])=>x))<Math.min(...forward.fills[1].map(([x])=>x)));
  assert.equal((iconMarkup('continue').match(/fill="#fff9ec"/g)||[]).length,2);
});
test('pause swaps settlement left and temporary leave right without replacing the result restart control',async()=>{
  const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const pause=html.slice(html.indexOf('<section id="pause-panel"'),html.indexOf('</section>',html.indexOf('<section id="pause-panel"')));
  assert.deepEqual([...pause.matchAll(/data-action="([^"]+)"/g)].map(m=>m[1]),['run-upgrades','resume','settings','home','leave']);
  assert.match(pause,/data-action="home"[^>]*aria-label="结束本局并结算"/);
  assert.match(pause,/class="function-ball leave-ball"[^>]*data-icon="leave"[^>]*aria-label="暂离并保存进度"/);
  assert.doesNotMatch(pause,/data-action="restart"/);
  assert.match(html.slice(html.indexOf('<section id="over-panel"')),/data-action="restart"/);
});
