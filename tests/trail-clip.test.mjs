import test from 'node:test';
import assert from 'node:assert/strict';
import {clipTrailOutside,createTrailClipper} from '../dist/trail-clip.js';

const polygon=values=>values.map(([x,y])=>({x,y}));
const box=(left,top,right,bottom)=>polygon([[left,top],[right,top],[right,bottom],[left,bottom]]);
const ellipse=({x=0,y=0,rx=5,ry=5,angle=0,count=192}={})=>Array.from({length:count},(_,i)=>{
  const turn=i/count*Math.PI*2,dx=Math.cos(turn)*rx,dy=Math.sin(turn)*ry;
  return {x:x+dx*Math.cos(angle)-dy*Math.sin(angle),y:y+dx*Math.sin(angle)+dy*Math.cos(angle)};
});
const area=points=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-p.y*q.x;},0)/2;
const inside=(p,points)=>{
  let result=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
};
const winding=(p,points)=>{
  let value=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],side=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
    if(a.y<=p.y&&b.y>p.y&&side>0)value++;
    if(a.y>p.y&&b.y<=p.y&&side<0)value--;
  }
  return value;
};
// Independent convex intersection supplies an area oracle for simple subjects.
function intersection(subject,clip){
  let out=subject;
  for(let i=0;i<clip.length;i++){
    const a=clip[i],b=clip[(i+1)%clip.length],side=p=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
    const next=[];
    for(let j=0;j<out.length;j++){
      const p=out[j],q=out[(j+1)%out.length],sp=side(p),sq=side(q);
      if(sp>=0)next.push(p);
      if((sp>=0)!==(sq>=0)){const t=sp/(sp-sq);next.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}
    }
    out=next;
  }
  return out;
}
function checkCoverage(subject,clip,out,{left=-22,right=22,top=-12,bottom=12,step=.47}={}){
  for(let y=top+.137;y<bottom;y+=step)for(let x=left+.219;x<right;x+=step){
    const p={x,y},expected=inside(p,subject)&&!inside(p,clip);
    const hits=out.filter(loop=>inside(p,loop)).length;
    assert.equal(hits,expected?1:0,`coverage at ${x}, ${y}`);
    assert.equal(out.some(loop=>winding(p,loop)!==0),expected,'Canvas nonzero and triangulated boundaries agree');
  }
  for(const loop of out)for(let i=0;i<loop.length;i++){
    const a=loop[i],b=loop[(i+1)%loop.length];
    for(const t of [.15,.5,.85]){
      const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
      // A point strictly inside every clip half-plane cannot be a drawn edge.
      const strict=clip.every((c,j)=>{const d=clip[(j+1)%clip.length];return (d.x-c.x)*(p.y-c.y)-(d.y-c.y)*(p.x-c.x)>1e-8;});
      assert.equal(strict,false,'no returned edge crosses the body interior');
    }
  }
}
function verify(subject,clip,options){
  const before=structuredClone({subject,clip}),out=clipTrailOutside(subject,clip);
  assert.deepEqual({subject,clip},before,'clipping is read-only');
  assert.ok(out.every(loop=>loop.length>=3&&loop.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));
  checkCoverage(subject,clip,out,options);
  return out;
}

test('an untouched trail retains its polygon while a fully covered trail disappears',()=>{
  const clip=ellipse(),outside=box(-20,-2,-8,2),covered=box(-1,-1,1,1);
  assert.equal(clipTrailOutside(outside,clip)[0],outside);
  assert.deepEqual(clipTrailOutside(covered,clip),[]);
  assert.deepEqual(clipTrailOutside([{x:NaN,y:0},...covered],clip),[]);
});

test('a straight trail is cut exactly on a rotated, stretched body boundary',()=>{
  const subject=box(-20,-2,1,2),clip=ellipse({rx:7.8,ry:3.2,angle:.73}),out=verify(subject,clip);
  assert.equal(out.length,1,'one continuous band has no internal slice seams');
  const expected=area(subject)-area(intersection(subject,clip));
  assert.ok(Math.abs(out.reduce((sum,p)=>sum+area(p),0)-expected)<1e-7);
  assert.equal(Math.min(...out[0].map(p=>p.x)),-20,'the exterior tail end is untouched');
});

test('a concave turning band can exit and re-enter the body without painting through it',()=>{
  const subject=polygon([[-20,-8],[8,-8],[8,8],[-20,8],[-20,4],[4,4],[4,-4],[-20,-4]]);
  const clip=ellipse({rx:6,ry:6}),out=verify(subject,clip);
  const expected=area(subject)-area(intersection(subject,clip));
  assert.ok(Math.abs(out.reduce((sum,p)=>sum+area(p),0)-expected)<1e-7);
  assert.ok(out.length>=1);
});

test('a whole body contained within the trail becomes a hole without independently filled slices',()=>{
  const subject=box(-20,-10,20,10),clip=ellipse(),out=verify(subject,clip);
  assert.equal(out.length,1,'a zero-width bridge retains a single fill');
  assert.ok(Math.abs(area(out[0])-(area(subject)-area(clip)))<1e-7);
});

test('a folded reversal is split into non-overlapping contours outside the body',()=>{
  const subject=polygon([[-20,-8],[20,8],[-20,8],[20,-8]]),clip=ellipse({rx:6,ry:4});
  const out=verify(subject,clip);
  assert.ok(out.length>=2);
});

test('winding order, tangent contacts, and collinear boundary overlap preserve coverage',()=>{
  const clip=box(-5,-5,5,5);
  for(const subject of [box(-20,-5,5,-2),box(-20,-8,-5,8),box(-20,-5,20,5),box(-20,5,20,8)]){
    const original=verify(subject,clip);
    const reversed=clipTrailOutside(subject.slice().reverse(),clip.slice().reverse());
    checkCoverage(subject,clip,reversed);
    assert.ok(Math.abs(original.reduce((n,p)=>n+Math.abs(area(p)),0)-reversed.reduce((n,p)=>n+Math.abs(area(p)),0))<1e-7);
  }
});

test('duplicate closing vertices and a moving deformed silhouette do not mutate trail history',()=>{
  const source=box(-20,-2,3,2),subject=[...source,source[0]];
  for(const angle of [0,.3,1.6,2.8])verify(subject,ellipse({x:.7,y:-.4,rx:6,ry:3,angle}));
  assert.deepEqual(subject,[...source,source[0]]);
});

test('one prepared body clips consecutive bands without retaining earlier intersections',()=>{
  const outline=ellipse({rx:7,ry:4,angle:.4}),clip=createTrailClipper(outline);
  const bands=[box(-20,-2,1,2),box(-20,-10,20,10),box(-1,-1,1,1),box(-20,7,-8,9)];
  const first=structuredClone(clip(bands[0]));
  for(let frame=0;frame<3;frame++)for(const band of bands)assert.deepEqual(clip(band),clipTrailOutside(band,outline));
  assert.deepEqual(clip(bands[0]),first);
});
