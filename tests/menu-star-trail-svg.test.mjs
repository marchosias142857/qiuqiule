import test from 'node:test';
import assert from 'node:assert/strict';
import {paintStarTrailSvg,starTrailPreview} from '../dist/star-trails.js';
import {particleVisualStyle} from '../dist/particle-appearance.js';

function svgFixture(t){
  const stats={created:0,removed:0,writes:0};
  function element(tag){
    const attrs=new Map();
    return {tag,attrs,children:[],
      getAttribute(name){return attrs.get(name)??null;},
      setAttribute(name,value){stats.writes++;attrs.set(name,String(value));},
      append(node){this.children.push(node);},
      removeChild(node){stats.removed++;const index=this.children.indexOf(node);assert.notEqual(index,-1);this.children.splice(index,1);},
    };
  }
  const original=globalThis.document;
  globalThis.document={createElementNS(namespace,tag){
    assert.equal(namespace,'http://www.w3.org/2000/svg');stats.created++;return element(tag);
  }};
  t.after(()=>{if(original)globalThis.document=original;else delete globalThis.document;});
  return {host:element('div'),stats};
}

const pose={x:40,y:40,r:20};

test('smaller card particles preserve all three optical centers',()=>{
  const markup=starTrailPreview('galaxy');
  const paths=[...markup.matchAll(/data-shape="([^"]+)" d="([^"]+)"/g)];
  const expected=[[25,67,10],[49,56,11.5],[75,63,12]];
  paths.forEach(([,shape,d],index)=>{
    const values=d.match(/-?\d+(?:\.\d+)?/g).map(Number),points=[];
    for(let i=0;i<values.length;i+=2)points.push([values[i],values[i+1]]);
    let area=0,mx=0,my=0,extent=0;
    const [x,y,r]=expected[index];
    for(let i=0;i<points.length;i++){
      const a=points[i],b=points[(i+1)%points.length],cross=a[0]*b[1]-b[0]*a[1];
      area+=cross;mx+=(a[0]+b[0])*cross;my+=(a[1]+b[1])*cross;
      extent=Math.max(extent,Math.hypot(a[0]-x,a[1]-y));
    }
    assert.ok(Math.abs(mx/(3*area)-x)<.0001);
    assert.ok(Math.abs(my/(3*area)-y)<.0001);
    const style=particleVisualStyle(shape);
    assert.ok(Math.abs(extent-r*.85*style.sizeScale*style.extent)<.0001);
  });
});

test('the star-trail showroom reuses its SVG paths throughout motion and does not rewrite an unchanged frame',t=>{
  const {host,stats}=svgFixture(t),layers=[{id:'galaxy',weight:1}],options={color:'#739d66'};
  paintStarTrailSvg(host,layers,pose,0,options);
  const [root]=host.children,paths=root.children.slice();
  assert.deepEqual(paths.map(path=>path.getAttribute('data-shape')),['sun','moon','star']);
  const initial=stats.created;
  for(let frame=1;frame<=60;frame++)paintStarTrailSvg(host,layers,pose,frame/60,options);
  assert.equal(stats.created,initial);assert.equal(stats.removed,0);
  assert.strictEqual(host.children[0],root);
  paths.forEach((path,i)=>assert.strictEqual(root.children[i],path));
  const writes=stats.writes;
  paintStarTrailSvg(host,layers,pose,1,options);
  assert.equal(stats.writes,writes);
});

test('mixed rewards crossfade complete samples and unequipping clears the preview',t=>{
  const {host}=svgFixture(t),color='#548aba';
  paintStarTrailSvg(host,[{id:'triple',weight:1}],pose,0,{color});
  const initial=host.children[0].children.map(path=>Number(path.getAttribute('opacity')));
  paintStarTrailSvg(host,[{id:'triple',weight:.5},{id:'galaxy',weight:.5}],pose,.1,{color});
  const [root]=host.children;
  assert.equal(root.getAttribute('viewBox'),'0 0 80 80');
  assert.equal(root.getAttribute('aria-hidden'),'true');
  assert.deepEqual(root.children.map(path=>path.getAttribute('data-shape')),['triangle','square','diamond','sun','moon','star']);
  root.children.forEach(path=>assert.equal(path.getAttribute('fill'),color));
  for(let i=0;i<3;i++)assert.ok(Math.abs(Number(root.children[i].getAttribute('opacity'))-initial[i]*.5)<.0001);
  paintStarTrailSvg(host,[{id:'galaxy',weight:1}],pose,.2,{color});
  assert.strictEqual(host.children[0],root);
  assert.deepEqual(root.children.map(path=>path.getAttribute('data-shape')),['sun','moon','star']);
  paintStarTrailSvg(host,[],pose,.3,{color});
  assert.equal(host.children.length,0);
});

test('reduced motion freezes the showroom and mixed wardrobe icons clearly show all three ingredients',t=>{
  const {host,stats}=svgFixture(t),layers=[{id:'snowflake',weight:1}],options={reducedMotion:true};
  paintStarTrailSvg(host,layers,pose,0,options);
  const writes=stats.writes;
  paintStarTrailSvg(host,layers,pose,99,options);
  assert.equal(stats.writes,writes);
  for(const[id,shapes]of [['triple',['triangle','square','diamond']],['galaxy',['sun','moon','star']]]){
    const markup=starTrailPreview(id,'#526a9b');
    assert.match(markup,/viewBox="0 0 100 100"/);
    assert.deepEqual([...markup.matchAll(/data-shape="([^"]+)"/g)].map(match=>match[1]),shapes);
    assert.doesNotMatch(markup,/NaN|Infinity/);
  }
});
