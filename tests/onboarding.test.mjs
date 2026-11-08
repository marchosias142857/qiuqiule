import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnboarding} from '../dist/onboarding.js';

const KEY='qiuqiule-onboarding-v1';
const portrait={x:195,y:405,dx:0,dy:-88};

// Exercise the real controller against a tiny DOM boundary, keeping lifecycle
// assertions independent of the finger's SVG and the CSS animation frames.
function fixture({saved,experienced=false,blocked=false}={}){
  const values=new Map(saved===undefined?[]:[[KEY,saved]]),writes=[],nodes=[],events=new Map();
  let geometryWrites=0;
  function node(){
    const classes=new Set(),attributes=new Map(),style=new Map(),children=[];
    return {
      hidden:false,children,
      style:{setProperty(name,value){geometryWrites++;style.set(name,value);},getPropertyValue:name=>style.get(name)},
      classList:{add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},contains:name=>classes.has(name),toggle(name,force){const on=force??!classes.has(name);on?classes.add(name):classes.delete(name);return on;}},
      setAttribute(name,value){attributes.set(name,String(value));},getAttribute:name=>attributes.get(name)??null,
      querySelector(){return this.path??=node();},
      append(...items){children.push(...items);},
      remove(){this.removed=true;const index=body.children.indexOf(this);if(index>=0)body.children.splice(index,1);},
    };
  }
  const body=node();
  const document={body,hidden:false,documentElement:Object.assign(node(),{clientWidth:390,clientHeight:844}),createElement(){const element=node();nodes.push(element);return element;},
    addEventListener(type,listener){if(!events.has(type))events.set(type,new Set());events.get(type).add(listener);},
    removeEventListener(type,listener){events.get(type)?.delete(listener);}};
  const storage={read(key,fallback){if(blocked)throw Error('Storage is unavailable');return values.get(key)??fallback;},write(key,value){if(blocked)throw Error('Storage is unavailable');writes.push([key,value]);values.set(key,value);}};
  const guide=createOnboarding({document,storage,experienced});
  return {guide,document,body,nodes,events,values,writes,get geometryWrites(){return geometryWrites;},
    setHidden(hidden){document.hidden=hidden;for(const listener of events.get('visibilitychange')??[])listener();}};
}

test('first visit mounts a single passive guide only when the home is ready',()=>{
  const f=fixture();
  assert.equal(f.nodes.length,0);
  assert.equal(f.guide.done,false);
  f.guide.show(portrait);
  assert.equal(f.body.children.length,1);
  assert.equal(f.guide.active,true);
  assert.equal(f.nodes[0].hidden,false);
  assert.deepEqual([...f.events.keys()],['visibilitychange'],'the hint does not consume any pointer or keyboard events');
  const writes=f.geometryWrites;
  for(let frame=0;frame<120;frame++)f.guide.show(portrait);
  assert.equal(f.nodes.length,1,'steady home frames reuse the same DOM');
  assert.equal(f.geometryWrites,writes,'steady home frames do not rewrite animation geometry');
  assert.equal(f.writes.length,0,'seeing the guide is not completing it');
});

test('a tap or subthreshold movement never records completion',()=>{
  const f=fixture();f.guide.show(portrait);
  for(const distance of [0,7.99,NaN,Infinity])f.guide.previewDrag(distance);
  assert.equal(f.guide.active,true);
  assert.equal(f.guide.done,false);
  assert.equal(f.writes.length,0);
  f.guide.suspend();f.guide.show(portrait);
  assert.equal(f.guide.active,true);
  assert.equal(f.writes.length,0);
});

test('menus and hidden pages suspend the hint without completing or losing it',()=>{
  const f=fixture();f.guide.show(portrait);
  f.guide.suspend();
  assert.equal(f.guide.active,false);
  f.setHidden(true);f.setHidden(false);
  assert.equal(f.guide.active,false,'returning to a modal must not reopen the hint');
  f.guide.show(portrait);
  assert.equal(f.guide.active,true);
  f.setHidden(true);
  assert.equal(f.guide.active,false);
  assert.equal(f.nodes[0].hidden,true,'hidden pages do not keep the CSS demonstration active');
  f.setHidden(false);
  assert.equal(f.guide.active,true);
  assert.equal(f.writes.length,0);
});

test('the first valid drag fades the complete hint and cannot be undone by cancellation or suspension',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();f.guide.show(portrait);f.guide.previewDrag(8);
  assert.equal(f.guide.active,false);
  assert.equal(f.guide.done,true);
  assert.equal(f.values.get(KEY),true);
  assert.equal(f.body.children.length,1);
  assert.equal(f.nodes[0].hidden,false,'the overlay stays mounted and visible during its opacity transition');
  f.guide.suspend();f.guide.show(portrait);
  assert.equal(f.guide.active,false);
  assert.equal(f.nodes[0].hidden,false,'subsequent input cleanup must not cut the fade short');
  t.mock.timers.tick(179);
  assert.equal(f.body.children.length,1);
  t.mock.timers.tick(1);
  assert.equal(f.body.children.length,0);
});

test('completion persists once, survives reload, and cannot be revived during its fade',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();f.guide.show(portrait);f.guide.complete();
  assert.equal(f.guide.done,true);
  assert.equal(f.guide.active,false);
  assert.equal(f.values.get(KEY),true);
  f.guide.show(portrait);f.guide.previewDrag(30);f.guide.suspend();f.guide.complete();
  f.setHidden(true);f.setHidden(false);
  assert.equal(f.guide.active,false);
  assert.equal(f.writes.length,1);
  t.mock.timers.tick(1000);
  assert.equal(f.body.children.length,0,'completion releases the animated DOM');
  assert.equal(f.events.get('visibilitychange')?.size??0,0,'completion releases its page listener');
  const reload=fixture({saved:f.values.get(KEY)});reload.guide.show(portrait);
  assert.equal(reload.guide.done,true);
  assert.equal(reload.nodes.length,0);
});

test('completion while hidden releases the hint immediately',()=>{
  const f=fixture();f.guide.show(portrait);f.setHidden(true);f.guide.complete();
  assert.equal(f.body.children.length,0);
  assert.equal(f.guide.done,true);
  assert.equal(f.values.get(KEY),true);
});

test('existing players bypass first-visit UI without allocating animated nodes',()=>{
  const f=fixture({experienced:true});f.guide.show(portrait);
  assert.equal(f.guide.done,true);
  assert.equal(f.guide.active,false);
  assert.equal(f.nodes.length,0);
});

test('blocked storage never prevents playing or completing this session',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture({blocked:true});
  assert.doesNotThrow(()=>{f.guide.show(portrait);f.guide.previewDrag(30);f.guide.complete();});
  assert.equal(f.guide.done,true);
  t.mock.timers.tick(1000);
  assert.equal(f.body.children.length,0);
});
