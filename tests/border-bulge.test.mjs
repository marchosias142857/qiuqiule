import test from 'node:test';
import assert from 'node:assert/strict';
import {wallBulgeSpec,wallBulgeEnvelope,wallBulgeHeight,buildBulgedBorder} from '../dist/border-bulge.js';

const near=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} ≈ ${b}`);
const frame=Object.freeze({left:16,top:16,right:384,bottom:684,cornerRadius:22});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

test('the 5/6 scale preserves both straight-wall slope ratios and applies energy and feedback strength',()=>{
  for(const bank of [0,1]){
    const spec=wallBulgeSpec({power:1,bank,unit:18,strength:1});
    near(spec.peak,18*(bank?.28:.14)*5/6);
    near(spec.halfWidth,18*(bank?3.6:3)*5/6);
    near(spec.peak/spec.halfWidth,(bank?.28:.14)/(bank?3.6:3));
    near(wallBulgeSpec({power:.5,bank,unit:18}).peak,spec.peak*Math.pow(1/3,1.5)*.6);
    near(wallBulgeSpec({power:1,bank,unit:18,strength:1,reducedMotion:true}).peak,spec.peak/2);
    near(wallBulgeSpec({power:9,bank,unit:18,strength:1}).peak,spec.peak);
  }
});

test('slow grazing, disabled feedback and auxiliary balls never create a bulge',()=>{
  for(const power of [-1,0,.2499,.25,NaN,Infinity])assert.equal(wallBulgeSpec({power,unit:18}),null);
  assert.equal(wallBulgeSpec({power:1,unit:18,strength:0}),null);
  assert.equal(wallBulgeSpec({power:1,unit:18,auxiliary:true}),null);
  assert.equal(wallBulgeSpec({power:1,unit:0}),null);
});

test('ordinary decay exposes the first-frame peak, follows the 60ms exponential and finishes smoothly at 180ms',()=>{
  near(wallBulgeEnvelope(0),1);near(wallBulgeEnvelope(.1),Math.exp(-.1/.06));
  near(wallBulgeEnvelope(.15),Math.exp(-2.5));near(wallBulgeEnvelope(.18),0);
  let previous=1;
  for(let ms=1;ms<=200;ms++){
    const value=wallBulgeEnvelope(ms/1000);assert.ok(value>=0&&value<=previous+1e-12);previous=value;
  }
  assert.ok(wallBulgeEnvelope(.17999)<1e-7);
});

test('bank decay follows the reviewed nodes and has exactly one negative lobe',()=>{
  const options={bank:true};
  for(const [time,value] of [[0,1],[.016,1],[.033,1],[.075,0],[.15,-.25],[.225,-.05],[.3,0]])near(wallBulgeEnvelope(time,options),value);
  let previous=1;
  for(let ms=0;ms<=150;ms++){
    const value=wallBulgeEnvelope(ms/1000,options);assert.ok(value<=previous+1e-12&&value>=-.25);previous=value;
  }
  for(let ms=151;ms<=330;ms++){
    const value=wallBulgeEnvelope(ms/1000,options);assert.ok(value>=previous-1e-12&&value<=1e-12);previous=value;
  }
  const h=1e-7;
  for(const time of [.033,.075,.15,.225,.3]){
    const left=(wallBulgeEnvelope(time,options)-wallBulgeEnvelope(time-h,options))/h;
    const right=(wallBulgeEnvelope(time+h,options)-wallBulgeEnvelope(time,options))/h;
    near(left,right,.002);
  }
});

test('reduced-motion bank remains outward, monotonically recovers and retains the 300ms duration',()=>{
  const spec=wallBulgeSpec({power:1,bank:1,unit:18,strength:1,reducedMotion:true});
  near(spec.duration,.3);let previous=spec.peak;
  for(let ms=0;ms<=310;ms++){
    const value=wallBulgeHeight({...spec,age:ms/1000});assert.ok(value>=0&&value<=previous+1e-12);previous=value;
  }
  assert.ok(wallBulgeHeight({...spec,age:.225})>0);
  near(wallBulgeHeight({...spec,age:.3}),0);
});

test('normal straight-wall bump meets the original border at zero displacement and keeps a single contour',()=>{
  const height=2.1,halfWidth=45;
  const {paths}=buildBulgedBorder(frame,null,[{contactX:200,contactY:16,height,halfWidth}]);
  assert.equal(paths.length,1);assert.equal(paths[0].closed,true);
  assert.deepEqual(paths[0].points[0],paths[0].points.at(-1));
  const points=paths[0].points;
  assert.ok(points.some(p=>Math.abs(p.x-200)<1e-8&&Math.abs(p.y-(16-height))<1e-8));
  for(const x of [155,245])assert.ok(points.some(p=>Math.abs(p.x-x)<1e-8&&Math.abs(p.y-16)<1e-8));
  for(const p of points.filter(p=>p.x>245&&p.x<300&&p.y<30))near(p.y,16);
});

test('geometry never modifies frozen physics inputs, contact events or existing gap data',()=>{
  const gap=Object.freeze({left:175,right:225});
  const event=Object.freeze({contactX:180,contactY:684,height:4.2,halfWidth:54});
  const before=JSON.stringify({frame,gap,event});
  const result=buildBulgedBorder(frame,gap,Object.freeze([event]));
  assert.equal(JSON.stringify({frame,gap,event}),before);assert.ok(result.paths[0].points.length>0);
});

test('all four rounded corners remain connected when contact occurs at the physical square corner',()=>{
  const box={left:0,top:0,right:120,bottom:90,cornerRadius:20};
  for(const [x,y] of [[0,0],[120,0],[120,90],[0,90]]){
    const paths=buildBulgedBorder(box,null,[{contactX:x,contactY:y,height:4.2,halfWidth:54}]).paths;
    const points=paths[0].points;
    assert.equal(paths.length,1);assert.equal(paths[0].closed,true);
    assert.deepEqual(points[0],points.at(-1));
    assert.ok(points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    for(let i=1;i<points.length;i++)assert.ok(distance(points[i-1],points[i])<2.4,'no gaps or corner jumps');
    const sx=x===0?-1:1,sy=y===0?-1:1;
    const midpoint={x:(x===0?20:100)+sx*(20+4.2)/Math.sqrt(2),y:(y===0?20:70)+sy*(20+4.2)/Math.sqrt(2)};
    assert.ok(points.some(p=>distance(p,midpoint)<1e-7),'corner impact projects onto the rounded corner');
  }
});

test('corner deformation has matching tangents across all eight straight-to-arc junctions',()=>{
  const box={left:0,top:0,right:80,bottom:60,cornerRadius:10};
  const joins=[[10,0,25,0],[70,0,55,0],[80,10,80,25],[80,50,80,35],
    [70,60,55,60],[10,60,25,60],[0,50,0,35],[0,10,0,25]];
  for(const [x,y,cx,cy] of joins){
    // The profile has a nonzero slope at this join. A sample-varying normal
    // would kink here, unlike the module's fixed contact normal.
    const points=buildBulgedBorder(box,null,[{contactX:cx,contactY:cy,height:2,halfWidth:25}],{maxStep:.01}).paths[0].points;
    const normal=y===0?[0,-1]:x===80?[1,0]:y===60?[0,1]:[-1,0];
    const height=1+Math.cos(Math.PI*15/25);
    const target={x:x+normal[0]*height,y:y+normal[1]*height};
    const index=points.findIndex(p=>distance(p,target)<1e-7);assert.ok(index>=0);
    const count=points.length-1,a=points[(index-1+count)%count],p=points[index],b=points[(index+1)%count];
    const u={x:p.x-a.x,y:p.y-a.y},v={x:b.x-p.x,y:b.y-p.y};
    const angle=Math.acos(Math.min(1,(u.x*v.x+u.y*v.y)/(Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y))));
    assert.ok(angle<.0015,`tangent mismatch at ${x},${y}: ${angle}`);
  }
});

test('the slope safeguard limits even oversized requested bumps to ten degrees on straight edges',()=>{
  const points=buildBulgedBorder(frame,null,[{contactX:200,contactY:16,height:500,halfWidth:45}]).paths[0].points;
  const top=points.filter(p=>p.x>=155&&p.x<=245&&p.y<16.001);
  for(let i=1;i<top.length;i++){
    const a=top[i-1],b=top[i];
    assert.ok(Math.abs(Math.atan2(b.y-a.y,b.x-a.x))<Math.PI/18,'slope stays below ten degrees');
  }
});

test('a circular frame wraps the bump smoothly across its parameter seam',()=>{
  const box={left:0,top:0,right:100,bottom:100,cornerRadius:50};
  const result=buildBulgedBorder(box,null,[{contactX:50,contactY:0,height:3,halfWidth:45}]);
  const points=result.paths[0].points;
  near(points[0].x,50);near(points[0].y,-3);assert.deepEqual(points[0],points.at(-1));
  assert.ok(points[1].x>50&&points.at(-2).x<50);
});

test('a bottom opening stays open and deformation meets both lips at the original tangent',()=>{
  const box={left:0,top:0,right:120,bottom:90,cornerRadius:15},gap={left:45,right:75};
  const points=buildBulgedBorder(box,gap,[{contactX:40,contactY:90,height:4,halfWidth:45}],{maxStep:.05}).paths[0];
  assert.equal(points.closed,false);assert.deepEqual(points.points[0],{x:45,y:90});
  assert.deepEqual(points.points.at(-1),{x:75,y:90});
  assert.ok(Math.abs((points.points[1].y-90)/(points.points[1].x-45))<.001);
  assert.ok(points.points[1].x<45&&points.points.at(-2).x>75);
});

test('overlapping contacts blend continuously without adding heights',()=>{
  const box={left:0,top:0,right:120,bottom:90,cornerRadius:20};
  const sources=[{contactX:95,contactY:0,height:4,halfWidth:45},{contactX:120,contactY:25,height:4,halfWidth:45}];
  const points=buildBulgedBorder(box,null,sources).paths[0].points;
  for(let i=1;i<points.length;i++)assert.ok(distance(points[i-1],points[i])<2.4);
  assert.ok(points.every(p=>p.x<=124+1e-8&&p.y>=-4-1e-8));
  const changed=buildBulgedBorder(box,null,sources.map((s,i)=>({...s,height:s.height+(i?.0001:-.0001)}))).paths[0].points;
  assert.equal(points.length,changed.length);
  for(let i=0;i<points.length;i++)assert.ok(distance(points[i],changed[i])<.001,'no priority swap at equal amplitude');
});

test('auxiliary events are also ignored by the renderer and invalid geometry is harmless',()=>{
  const plain=buildBulgedBorder(frame,null,[]);
  const rejected=buildBulgedBorder(frame,null,[{contactX:200,contactY:16,height:4,halfWidth:50,auxiliary:true}]);
  assert.deepEqual(rejected,plain);
  assert.deepEqual(buildBulgedBorder({left:0,top:0,right:0,bottom:0},null,[]),{paths:[]});
});

test('overlapping contacts lose their influence continuously at a bank zero crossing or ordinary expiry',()=>{
  const box={left:0,top:0,right:120,bottom:90,cornerRadius:20};
  const remaining={contactX:95,contactY:0,height:3,halfWidth:45};
  const other={contactX:120,contactY:25,halfWidth:45};
  const baseline=buildBulgedBorder(box,null,[remaining],{maxStep:.25}).paths[0].points;
  // Compare each new sample to its closest baseline segment because the second
  // contact adds exact support/center sample positions even near zero height.
  const pointDistance=(p,points)=>{
    let best=Infinity;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y;
      const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
      best=Math.min(best,Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t));
    }
    return best;
  };
  for(const height of [-1e-5,0,1e-5]){
    const points=buildBulgedBorder(box,null,[remaining,{...other,height}],{maxStep:.25}).paths[0].points;
    for(const point of points)assert.ok(pointDistance(point,baseline)<.001,'fading state must not mask surviving bump');
  }
});
