import test from 'node:test';
import assert from 'node:assert/strict';
import {WardrobeShowroom} from '../dist/wardrobe-showroom.js';
import {cometProfile} from '../dist/comet-trail.js';
import {particleVisualStyle} from '../dist/particle-appearance.js';

function fixture(){
  const stats={created:0,removed:0,writes:0},doc={createElementNS(namespace,tag){assert.equal(namespace,'http://www.w3.org/2000/svg');stats.created++;return element(tag);}};
  function element(tag){return{tag,ownerDocument:doc,parentNode:null,attrs:new Map(),children:[],
    getAttribute(name){return this.attrs.get(name)??null;},setAttribute(name,value){stats.writes++;this.attrs.set(name,String(value));},
    append(child){this.children.push(child);child.parentNode=this;},removeChild(child){const i=this.children.indexOf(child);assert.ok(i>=0);this.children.splice(i,1);child.parentNode=null;stats.removed++;}};}
  return{host:element('div'),stats};
}
const pose={x:36,y:36,r:18},fullLength=cometProfile(33*pose.r,pose.r,pose.r,.6).length;
const selected=[{id:'galaxy',weight:1}];
function run(showroom,frames=48,layers=selected){for(let i=0;i<frames;i++)showroom.step(1/120,{radius:pose.r,layers});}
const visiblePaths=g=>g.paths.filter(path=>path.getAttribute('display')!=='none');

// A polygon's area centroid is its visual center; unlike its bounding box it
// remains exact while an asymmetric crescent rotates in place.
function geometry(path){
  const values=path.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number),points=[];
  for(let i=0;i<values.length;i+=2)points.push({x:values[i],y:values[i+1]});
  let area=0,cx=0,cy=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],cross=a.x*b.y-b.x*a.y;
    area+=cross;cx+=(a.x+b.x)*cross;cy+=(a.y+b.y)*cross;
  }
  cx/=3*area;cy/=3*area;
  return {x:cx,y:cy,area:Math.abs(area)/2,angle:Math.atan2(points[0].y-cy,points[0].x-cx)};
}
function close(actual,expected,tolerance=.0002){assert.ok(Math.abs(actual-expected)<tolerance,`${actual} should equal ${expected}`);}

test('preview has three stable samples using shared shapes and the actual thin ribbon, without gameplay randomness',()=>{
  const {host}=fixture(),showroom=new WardrobeShowroom(),oldRandom=Math.random;
  try{
    Math.random=()=>{throw new Error('showroom must not consume shared randomness');};
    run(showroom);showroom.paint(host,{pose,length:fullLength,color:0x123456,layers:selected});
  }finally{Math.random=oldRandom;}
  assert.equal(visiblePaths(showroom.dom.thin).length,9,'same nine thin-ribbon bands as gameplay');
  const paths=visiblePaths(showroom.dom.groups.get('galaxy'));
  assert.equal(paths.length,3);
  paths.forEach((path,i)=>{
    const style=particleVisualStyle(['sun','moon','star'][i]);
    assert.equal((path.getAttribute('d').match(/[ML]/g)||[]).length,style.points.length/2);
    assert.equal(path.getAttribute('fill'),'#123456');assert.ok(Number(path.getAttribute('opacity'))>0);
  });
  assert.ok(showroom.dom.thin.paths[0].getAttribute('d').includes('M36 '),'the ribbon head stays at the supplied fixed X');
});

test('all three centers remain fixed through breathing cycles while size, opacity and gentle rotation vary smoothly',()=>{
  const {host}=fixture(),showroom=new WardrobeShowroom(),layers=[{id:'triple',weight:1}];
  showroom.step(0,{radius:pose.r,layers});showroom.paint(host,{pose,length:fullLength,layers});
  const paths=visiblePaths(showroom.dom.groups.get('triple')),initial=paths.map(geometry),firstPaths=paths.map(p=>p.getAttribute('d'));
  const minArea=initial.map(g=>g.area),maxArea=[...minArea],minAlpha=paths.map(p=>+p.getAttribute('opacity')),maxAlpha=[...minAlpha];
  const minAngle=initial.map(g=>g.angle),maxAngle=[...minAngle];let previous=initial;
  for(let frame=0;frame<672;frame++){
    showroom.step(1/120,{radius:pose.r,layers});showroom.paint(host,{pose,length:fullLength,layers});
    assert.equal(visiblePaths(showroom.dom.groups.get('triple')).length,3);
    paths.forEach((path,i)=>{
      const g=geometry(path),alpha=+path.getAttribute('opacity');
      close(g.x,initial[i].x);close(g.y,initial[i].y);
      minArea[i]=Math.min(minArea[i],g.area);maxArea[i]=Math.max(maxArea[i],g.area);
      minAlpha[i]=Math.min(minAlpha[i],alpha);maxAlpha[i]=Math.max(maxAlpha[i],alpha);
      minAngle[i]=Math.min(minAngle[i],g.angle);maxAngle[i]=Math.max(maxAngle[i],g.angle);
      assert.ok(Math.abs(g.area-previous[i].area)<1,'breathing has no abrupt scale jump, including at the cycle boundary');
      previous[i]=g;
    });
  }
  paths.forEach((path,i)=>{
    assert.ok(maxArea[i]/minArea[i]>2,'particles visibly shrink and grow');
    assert.ok(maxAlpha[i]/minAlpha[i]>2,'particles fade and become opaque together with scale');
    assert.ok(minAlpha[i]>.1,'breathing does not blink fully off');
    assert.ok(maxAngle[i]-minAngle[i]>.25&&maxAngle[i]-minAngle[i]<.29,'rotation rocks within about sixteen degrees');
    assert.equal(path.getAttribute('d'),firstPaths[i],'two complete cycles return continuously to the starting shape');
  });
});

test('unequipped preview retains its ordinary ribbon with no decorative glyphs',()=>{
  const {host}=fixture(),showroom=new WardrobeShowroom();run(showroom,48,[]);
  showroom.paint(host,{pose,length:fullLength,layers:[]});
  assert.equal(showroom.dom.groups.size,0);assert.equal(visiblePaths(showroom.dom.thin).length,9);
  run(showroom);showroom.paint(host,{pose,length:fullLength,layers:selected});assert.equal(visiblePaths(showroom.dom.groups.get('galaxy')).length,3);
  showroom.step(1/120,{radius:pose.r,layers:[]});showroom.paint(host,{pose,length:fullLength,layers:[]});
  assert.equal(showroom.dom.groups.size,0);assert.equal(visiblePaths(showroom.dom.thin).length,9);
});

test('retraction softly masks from the tail toward a fixed head without repositioning any particle',()=>{
  const {host}=fixture(),showroom=new WardrobeShowroom();run(showroom);
  showroom.paint(host,{pose,length:fullLength,layers:selected});
  const paths=showroom.dom.groups.get('galaxy').paths,before=paths.map(p=>p.getAttribute('d'));
  const tailBefore=Number(showroom.dom.maskRect.getAttribute('x'));
  showroom.paint(host,{pose,length:fullLength*.5,alpha:.4,layers:selected});
  const tailAfter=Number(showroom.dom.maskRect.getAttribute('x')),width=Number(showroom.dom.maskRect.getAttribute('width'));
  assert.ok(tailAfter>tailBefore);close(tailAfter+width,pose.x);
  assert.equal(showroom.dom.scene.getAttribute('opacity'),'0.4');
  assert.ok(Number(showroom.dom.gradient.getAttribute('x2'))>Number(showroom.dom.gradient.getAttribute('x1')),'tail has a soft opacity ramp');
  assert.deepEqual(paths.map(p=>p.getAttribute('d')),before,'retraction never moves or rescales the fixed samples');
  showroom.paint(host,{pose,length:0,alpha:0,layers:selected});assert.equal(showroom.dom.svg.getAttribute('visibility'),'hidden');
});

test('layer crossfades retain three SVG paths per cosmetic and do not accumulate nodes',()=>{
  const {host,stats}=fixture(),showroom=new WardrobeShowroom(),layers=[{id:'galaxy',weight:.6},{id:'triple',weight:.4}];
  run(showroom,120,layers);showroom.paint(host,{pose,length:fullLength,layers});
  const root=host.children[0],thin=showroom.dom.thin.paths[0],group=showroom.dom.groups.get('galaxy').group;
  assert.equal(showroom.dom.groups.size,2);
  assert.equal(group.getAttribute('opacity'),'0.6');assert.equal(showroom.dom.groups.get('triple').group.getAttribute('opacity'),'0.4');
  const created=stats.created,writes=stats.writes;showroom.paint(host,{pose,length:fullLength,layers});assert.equal(stats.writes,writes);
  for(let i=0;i<240;i++){showroom.step(1/120,{radius:18,layers});showroom.paint(host,{pose,length:fullLength,layers});}
  assert.strictEqual(host.children[0],root);assert.strictEqual(showroom.dom.thin.paths[0],thin);assert.strictEqual(showroom.dom.groups.get('galaxy').group,group);
  assert.equal(stats.created,created,'no new DOM nodes are allocated while breathing');
  for(const g of showroom.dom.groups.values())assert.equal(visiblePaths(g).length,3);
  showroom.step(1/120,{radius:18,layers:selected});showroom.paint(host,{pose,length:fullLength,layers:selected});assert.equal(showroom.dom.groups.size,1);
});

test('reduced motion freezes a complete sample; resize keeps its relative composition and reset drops it',()=>{
  const {host,stats}=fixture(),showroom=new WardrobeShowroom();
  showroom.step(0,{radius:18,layers:selected,reducedMotion:true});showroom.paint(host,{pose,length:fullLength,layers:selected});
  const paths=showroom.dom.groups.get('galaxy').paths,writes=stats.writes,before=paths.map(p=>p.getAttribute('d')),centers=paths.map(geometry);
  showroom.step(10,{radius:18,layers:selected,reducedMotion:true});showroom.paint(host,{pose,length:fullLength,layers:selected});
  assert.equal(stats.writes,writes);assert.deepEqual(paths.map(p=>p.getAttribute('d')),before);
  const bigger={x:48,y:48,r:24};
  showroom.step(0,{radius:24,layers:selected,reducedMotion:true});showroom.paint(host,{pose:bigger,length:fullLength*4/3,layers:selected});
  paths.forEach((path,i)=>{const center=geometry(path);close(center.x,centers[i].x*4/3);close(center.y,centers[i].y*4/3);});
  showroom.reset();assert.equal(showroom.radius,0);assert.equal(showroom.points.length,0);assert.equal(showroom.dom.groups.size,0);
  assert.equal(showroom.dom.svg.getAttribute('visibility'),'hidden');
});
