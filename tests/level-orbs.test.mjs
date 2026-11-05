import test from 'node:test';
import assert from 'node:assert/strict';
import {LevelOrbView} from '../dist/level-orbs.js';
import {LevelSelector} from '../dist/levels.js';
import {normalizeProgress} from '../dist/campaign-progress.js';
import {createSvgNode} from './fixtures/svg-dom.mjs';

const namespace='http://www.w3.org/2000/svg';
const labelPosition=()=>({x:-.2,y:.32,size:.94});
globalThis.document={createElementNS:createSvgNode};
function setup(unlocked){
  const orbs=createSvgNode(namespace,'g'),home=createSvgNode(namespace,'g');
  const selector=new LevelSelector(390,844,unlocked,unlocked);
  const view=new LevelOrbView(orbs,home),progress=normalizeProgress({unlocked});
  const render=(state=progress,metrics=labelPosition,revision=0)=>{
    const balls=selector.visibleBalls;
    view.render(balls,selector.returnBall,state,metrics,revision);
    return new Map(balls.map((ball,i)=>[ball.level,orbs.children[i]]));
  };
  return {selector,home,orbs,render};
}

test('selection keeps overlapping orbs through scrolling in both directions and reshapes a locked orb in place',()=>{
  const {selector,home,orbs,render}=setup(10);
  let previous=render();
  const back=home.firstElementChild,icon=back.lastElementChild;
  const lock=previous.get(11),lockedIcon=lock.lastElementChild;
  const rest=lock.getAttribute('transform');
  selector.hitTimes.set(11,0);selector.clock=.05;
  render();
  assert.notEqual(lock.getAttribute('transform'),rest);
  assert.equal(lock.lastElementChild,lockedIcon);
  for(const delta of [.44,1.2,1,-1.1,-1.5,18,-8]){
    selector.offset+=delta;
    const next=render();
    for(const [level,node] of previous){
      if(next.has(level))assert.equal(next.get(level),node);
      else assert.equal(node.parentNode,null);
    }
    assert.equal(orbs.children.length,selector.visibleBalls.length);
    for(const [level,node] of next){
      const body=selector.visibleBalls.find(b=>b.level===level);
      assert.equal(node.getAttribute('transform'),`translate(${body.x} ${body.y}) scale(${body.r*body.sx} ${body.r*body.sy})`);
      if(body.unlocked)assert.equal(node.querySelector('text').textContent,String(level));
      else assert.equal(node.lastElementChild.tag,'svg');
    }
    previous=next;
  }
  assert.equal(home.firstElementChild,back);assert.equal(back.lastElementChild,icon);
});

test('retained selection updates scores, locks and loaded-font bounds even with frozen positions',()=>{
  const {selector,render}=setup(70);
  const state=rating=>normalizeProgress({version:3,unlocked:70,levels:{70:{cleared:true,rating}}});
  let nodes=render(state(1)),orb=nodes.get(70);
  const number=orb.querySelector('text'),dots=orb.querySelectorAll('circle[opacity]');
  assert.deepEqual(dots.map(dot=>dot.getAttribute('opacity')),['1','0.25','0.25']);
  const two=state(2);
  render(two);
  assert.equal(orb.querySelector('text'),number);
  assert.deepEqual(dots.map(dot=>dot.getAttribute('opacity')),['1','1','0.25']);
  render(two,()=>({x:-.42,y:.28,size:.94}),1);
  assert.equal(number.getAttribute('x'),'-0.42');assert.equal(number.getAttribute('y'),'0.28');
  nodes=render(state(3));assert.equal(nodes.get(70),orb);
  assert.match(orb.innerHTML,/r=".91"/);assert.match(orb.innerHTML,/r=".85"/);
  selector.unlocked=69;render(state(0));
  assert.equal(orb.querySelector('text'),null);assert.equal(orb.lastElementChild.tag,'svg');
  selector.unlocked=70;render(normalizeProgress({version:3,unlocked:70,levels:{70:{skipped:true}}}));
  assert.match(orb.innerHTML,/M-.13 .65h.26/);
});
